// The barsy sync jobs (brief S2-03b). Registered only when the worker holds the sealing keys: see
// `createBarsyJobs` and jobs/index.ts. Each job opens its integration through `withIntegration`
// (one place that opens the sealed credentials), records itself in `job_runs`, and does its work
// through the pieces under ../sync/.
//
//   barsy-connect         test the credentials, read the installation's venues and trees
//   barsy-full-pull       path C for one venue; the only job that concludes absence
//   barsy-incremental     path E: the tree check and the changed articles
//   places-read           the tables of one mapped venue, root or not (CF-16, T67)
//   asset-fetch           one barsy photo into the asset store
//   barsy-sync-tick       the one schedule (every minute): queues the pulls that are due (S3-04)
//
// The queues use pg-boss's `exclusive` policy with the integration and the venue as singleton key
// (CF-16), so a second full pull of one venue is never queued while one is queued or running,
// whoever sends it (the web app's "Sync now", the ticks, an incremental run that notices the tree
// changed), and one venue's pull never drops another's. The policy is per queue, so it does not
// keep a full pull and an incremental run apart: every pull runs inside the integration's Postgres
// advisory lock (../sync/pull-lock.ts), held for the whole pull: one pull at a time per
// installation, because barsy allows two requests at a time per installation and one pull already
// uses both, and because venues that share a catalogue then never conclude its absence at once.

import { BarsyAuthError as AuthRefused, type BarsyReader as Reader } from '@restro/barsy'
import {
  type AssetFetchJob,
  AssetFetchJobSchema,
  type BarsyConnectJob as ConnectJob,
  BarsyConnectJobSchema as ConnectJobSchema,
  canonicalJson,
  deferredSingletonKey,
  dueSyncs,
  JOB_NAMES,
  prepareJob,
  type VenueSyncJob,
  VenueSyncJobSchema,
  venueSyncSchedule,
} from '@restro/core'
import {
  appendSourceRecords,
  readSyncState,
  upsertBarsyVenues as recordTillVenues,
  storeCachedTree,
  updateIntegration,
  updateSyncState,
} from '@restro/core/apply'
import {
  authOrganization,
  integrations,
  venues as ourVenues,
  barsyVenues as venueLinks,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Job } from 'pg-boss'
import type { z } from 'zod'

import type { BarsyPolicy, SealKeys } from '../config'
import { queuePublishAfterSync } from '../publish/after-sync'
import {
  cachedTreeOf,
  recordSuccess,
  runFullPull,
  runIncremental,
  scopeHashOf,
  syncPlaces,
  treeHashOf,
} from '../sync/catalogue'
import {
  type IntegrationSession,
  type PhotoStore,
  type SyncEnvironment,
  withIntegration,
} from '../sync/context'
import { lastUpdateFilter } from '../sync/cursor'
import {
  fullPullStartedWithin,
  loadMappedVenue,
  loadVenueTarget,
  rootsOf,
  SYNC_SKIP_TEXT,
  syncSkipReason,
  type VenueTarget,
  venuesOnCatalogue,
} from '../sync/data'
import { LimiterRegistry } from '../sync/limiter'
import { fetchPhoto, type ObsoleteReason, PhotoRefused } from '../sync/photos'
import { PULL_LOCK_POLL_MS, PULL_LOCK_WAIT_MS, withPullLock } from '../sync/pull-lock'
import { trackedRun } from '../sync/run'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

/** What the sync jobs need from the process besides the job context. */
export interface BarsyJobDeps {
  readonly keys: SealKeys
  readonly policy: BarsyPolicy
  readonly store: PhotoStore
  /** One limiter per installation, shared by every job (two requests at a time). */
  readonly limiters?: LimiterRegistry
  /** `fetch` for photo downloads; tests replace it. */
  readonly fetch?: typeof fetch
  /** How long a full pull waits for a running pull before it is queued again. Tests shorten it. */
  readonly pullLockWaitMs?: number
  /** How often a waiting full pull asks for the lock again. Tests shorten it. */
  readonly pullLockPollMs?: number
  /** Pull locks the process may hold at once (default: the app pool's size minus one). */
  readonly pullLocksMax?: number
}

const MINUTE = 60_000

/** A full pull that started this recently is not asked for again by an incremental run. */
const FULL_PULL_COOLDOWN_MS = 15 * MINUTE

/** What a photo job's run says when the article's current record no longer matches the job. */
const OBSOLETE_TEXT: Record<ObsoleteReason, string> = {
  unlinked: 'the article is no longer linked',
  picture_removed: 'the article no longer has a picture',
  picture_changed: 'the article’s picture changed since this job was queued',
}

/** A full pull that found another pull running starts again this many seconds later. */
const FULL_PULL_DEFER_SECONDS = 60

/** A places read the tick queued that has not run is asked for again after this long. */
const PLACES_RETRY_MS = 10 * MINUTE

function parsePayload<S extends z.ZodType>(schema: S, job: Job<object>, name: string): z.output<S> {
  const parsed = schema.safeParse(job.data)
  if (!parsed.success) throw new Error(`the ${name} job has an invalid payload`)
  return parsed.data
}

/**
 * Queues the automatic publish after a pull that changed something: of the venue the pull read,
 * and of every other venue on the same catalogue (CF-16), since the items they share changed for
 * them too. A menu that did not change publishes nothing.
 */
async function publishAfterPull(
  env: SyncEnvironment,
  payload: VenueSyncJob,
  session: IntegrationSession,
  target: VenueTarget,
  appliedOps: number,
): Promise<void> {
  if (appliedOps <= 0) return
  const venueIds = new Set<string>([payload.venueId])
  if (target.catalogueId !== null) {
    try {
      const shared = await venuesOnCatalogue(
        env,
        payload.tenantId,
        payload.integrationId,
        target.catalogueId,
      )
      for (const venueId of shared) venueIds.add(venueId)
    } catch (error) {
      env.log.warn({ err: error }, 'the venues sharing a catalogue could not be listed')
    }
  }
  for (const venueId of venueIds) {
    await queuePublishAfterSync(
      env,
      {
        tenantId: payload.tenantId,
        integrationId: payload.integrationId,
        venueId,
        config: session.integration.config,
      },
      appliedOps,
    )
  }
}

function isFlagSet(value: unknown): boolean {
  return value === 1 || value === true
}

/**
 * Reads the installation's venue list and records every live venue with its name and catalogue
 * (`menu_id`, CF-16). Returns the live venues.
 */
async function recordVenueList(
  env: SyncEnvironment,
  target: { readonly tenantId: string; readonly integrationId: string },
  reader: Reader,
) {
  const venues = (await reader.getVenues()).data
  const live = venues.filter((venue) => !isFlagSet(venue.delete_flag))
  await recordTillVenues(
    env.pool,
    target.tenantId,
    target.integrationId,
    live.map((venue) => ({
      bid: venue.barsy_id,
      name: venue.name,
      catalogueId: venue.menu_id ?? null,
      // The roots the till designates for the venue's menus (D88): its public menu, its tree.
      publicCatId: venue.public_cat_id ?? null,
      treeCatId: venue.cat_id ?? null,
    })),
  )
  return { venues, live }
}

/**
 * The catalogue the venue sells from and the roots of its menus, as the venue list says now
 * (CF-16, D88), and a note when the list could not be read (the stored ones are used then).
 * Wrong credentials are thrown.
 */
async function refreshCatalogue(
  env: SyncEnvironment,
  payload: VenueSyncJob,
  session: IntegrationSession,
  target: VenueTarget,
): Promise<{ target: VenueTarget; notes: string[] }> {
  try {
    const { live } = await recordVenueList(env, payload, session.reader)
    const own = live.find((venue) => venue.barsy_id === target.bid)
    const catalogueId = own?.menu_id ?? target.catalogueId
    const roots =
      own === undefined
        ? target.roots
        : rootsOf(own.public_cat_id ?? null, own.cat_id ?? null, target.catalogueRootCatId)
    return {
      target: { ...target, catalogueId, roots: roots.length === 0 ? target.roots : roots },
      notes: [],
    }
  } catch (error) {
    if (error instanceof AuthRefused) throw error
    env.log.warn({ err: error }, 'the venue list could not be read')
    return {
      target,
      notes: ['the venue list could not be read; the catalogue stored before was used'],
    }
  }
}

export function createBarsyJobs(deps: BarsyJobDeps): JobDefinition[] {
  const limiters = deps.limiters ?? new LimiterRegistry()
  const maxHeld = deps.pullLocksMax
  // A full pull waits for a running pull; an incremental run does not (the next tick is near).
  const fullPullLock = {
    waitMs: deps.pullLockWaitMs ?? PULL_LOCK_WAIT_MS,
    pollMs: deps.pullLockPollMs ?? PULL_LOCK_POLL_MS,
    maxHeld,
  }
  const incrementalLock = { waitMs: 0, maxHeld }

  /**
   * A sync queued for a venue that was deleted since, or whose till link was released, ends here
   * (D76): skipped with the reason in the log, no run recorded, nothing asked of the till and
   * nothing written. Never a failure, so the job is not retried.
   */
  async function skipped(env: SyncEnvironment, payload: VenueSyncJob): Promise<boolean> {
    const reason = await syncSkipReason(
      env,
      payload.tenantId,
      payload.integrationId,
      payload.venueId,
    )
    if (reason === null) return false
    env.log.info(
      { venueId: payload.venueId, integrationId: payload.integrationId, reason },
      SYNC_SKIP_TEXT[reason],
    )
    return true
  }

  const environment = (context: WorkerContext, job?: Job<object>): SyncEnvironment => ({
    pool: context.pool,
    log: context.log,
    now: context.now,
    keys: deps.keys,
    policy: deps.policy,
    limiters,
    enqueue: (name, data, options) => context.queue.send(name, data, options),
    store: deps.store,
    fetch: deps.fetch ?? fetch,
    signal: job?.signal,
  })

  // --- barsy-connect ---------------------------------------------------------------------

  const connect = defineJob<ConnectJob>({
    name: JOB_NAMES.barsyConnect,
    options: {
      policy: 'exclusive',
      queue: {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 10 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(ConnectJobSchema, job, JOB_NAMES.barsyConnect)
        const env = environment(context, job)
        await trackedRun(env, { ...payload, kind: 'barsy_connect' }, async () =>
          withIntegration(env, payload, async (session) => {
            const { client, reader } = session
            // Both pings return 1 (the official docs). A 401 here stores the code wrong_credentials.
            await client.ping()
            await client.pingUser()
            const { venues, live } = await recordVenueList(env, payload, reader)
            const languages = (await reader.getLanguages()).data
            // OPEN (CF-12): which Currencies_getlist field marks the system currency? Not yet verified
            // in the official docs (https://docs.lukanet.com/barsy.api/methods/currencies/getlist.html),
            // so no currency check happens here; the status code `currency_not_eur` waits for it.
            const currencies = (await reader.getCurrencies()).data
            const details = (await reader.getArticleDetailsTree()).data

            const notes: string[] = []
            let trees = 0
            for (const venue of live) {
              try {
                const tree = (await reader.getCategoryTree(venue.barsy_id)).data
                await storeCachedTree(
                  env.pool,
                  payload.tenantId,
                  payload.integrationId,
                  venue.barsy_id,
                  cachedTreeOf(tree, env.now()),
                )
                trees += 1
              } catch (error) {
                if (error instanceof AuthRefused) throw error
                notes.push(
                  `the category tree of a venue could not be read (barsy id ${venue.barsy_id})`,
                )
                env.log.warn({ err: error }, 'a venue’s category tree could not be read')
              }
            }

            // Tier 1: what the installation told us about itself, exactly as it did.
            const record = (externalType: string, externalId: string, object: unknown) => {
              const raw = canonicalJson(object)
              return {
                externalType,
                externalId,
                scope: 'master' as const,
                raw,
                payload: JSON.parse(raw) as unknown,
              }
            }
            await appendSourceRecords(env.pool, payload.tenantId, payload.integrationId, [
              ...venues.map((venue) => record('barsy_venue', String(venue.barsy_id), venue)),
              ...languages.map((language) => record('language', language.lang_id, language)),
              ...currencies.map((currency) =>
                record('currency', String(currency.currency_id), currency),
              ),
              record('article_details', 'tree', details),
            ])

            await updateIntegration(env.pool, payload.tenantId, payload.integrationId, {
              status: 'connected',
              statusDetail: null,
              lastCheckedAt: env.now(),
            })
            return {
              counters: {
                venues: live.length,
                languages: languages.length,
                currencies: currencies.length,
                trees_cached: trees,
              },
              notes,
            }
          }),
        )
      }
    },
  })

  // --- barsy-full-pull -------------------------------------------------------------------

  const fullPull = defineJob<VenueSyncJob>({
    name: JOB_NAMES.barsyFullPull,
    options: {
      policy: 'exclusive',
      queue: {
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        // A large catalogue is a few dozen calls, each under barsy's 30 seconds.
        expireInSeconds: 45 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(VenueSyncJobSchema, job, JOB_NAMES.barsyFullPull)
        const env = environment(context, job)
        if (await skipped(env, payload)) continue
        await trackedRun(env, { ...payload, kind: 'barsy_full_pull' }, async (run) => {
          // Held for the whole pull. Another pull of this integration (an incremental run, or a
          // full pull of a retried job) is waited for, up to a minute.
          const locked = await withPullLock(
            env,
            payload.integrationId,
            () =>
              withIntegration(env, payload, async (session) => {
                const stored = await loadVenueTarget(
                  env,
                  payload.tenantId,
                  payload.integrationId,
                  payload.venueId,
                )
                const start = env.now()
                // The catalogue as barsy lists it now: the read and its absence check follow it.
                const { target, notes } = await refreshCatalogue(env, payload, session, stored)
                const ctx = { env, session, target, runId: run.id, start }
                const outcome = await runFullPull(ctx)
                await recordSuccess(ctx, outcome, 'full')
                await updateIntegration(env.pool, payload.tenantId, payload.integrationId, {
                  status: 'connected',
                  statusDetail: null,
                  lastCheckedAt: env.now(),
                })
                await publishAfterPull(
                  env,
                  payload,
                  session,
                  target,
                  outcome.counters.ops_applied ?? 0,
                )
                return {
                  counters: outcome.counters,
                  notes: [...notes, ...outcome.notes],
                  deletionCheckSkipped: outcome.deletionCheckSkipped,
                  ...(outcome.absenceHeld !== undefined
                    ? { absenceHeld: outcome.absenceHeld }
                    : {}),
                  refused: outcome.refused,
                }
              }),
            fullPullLock,
          )
          if (locked.acquired) return locked.value

          // Still busy after the wait: send this pull again, to start in a minute, so that a
          // "Sync now" is never lost. This job is still active under its own key (integration and
          // venue), and the queue's exclusive policy would drop a second job with that key (`send`
          // returns null), so the copy carries a key of its own.
          const own = prepareJob(JOB_NAMES.barsyFullPull, payload).singletonKey
          const later = await env.enqueue(JOB_NAMES.barsyFullPull, payload, {
            singletonKey: deferredSingletonKey(own, env.now()),
            startAfter: FULL_PULL_DEFER_SECONDS,
          })
          if (later === null) {
            // Throwing makes pg-boss retry this job, which is better than losing the request.
            throw new Error('a full pull could not be queued again while another pull was running')
          }
          return {
            notes: [
              `another pull is running; this full pull was queued again to start in ${FULL_PULL_DEFER_SECONDS} s`,
            ],
          }
        })
      }
    },
  })

  // --- barsy-incremental -----------------------------------------------------------------

  const incremental = defineJob<VenueSyncJob>({
    name: JOB_NAMES.barsyIncremental,
    options: {
      policy: 'exclusive',
      queue: {
        // The next change check comes at the next interval; a retry adds nothing.
        retryLimit: 0,
        expireInSeconds: 10 * 60,
        retentionSeconds: 30 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(VenueSyncJobSchema, job, JOB_NAMES.barsyIncremental)
        const env = environment(context, job)
        if (await skipped(env, payload)) continue
        await trackedRun(env, { ...payload, kind: 'barsy_incremental' }, async (run) => {
          // Another pull in progress (a full pull reads everything anyway): do not wait, the next
          // check is due again after the interval. Held for the whole run otherwise.
          const locked = await withPullLock(
            env,
            payload.integrationId,
            () =>
              withIntegration(env, payload, async (session) => {
                const target = await loadVenueTarget(
                  env,
                  payload.tenantId,
                  payload.integrationId,
                  payload.venueId,
                )
                const start = env.now()
                const tree = (await session.reader.getCategoryTree(target.bid)).data
                const state = readSyncState(session.integration.config, target.bid)
                // A cursor that never ran, or one that belongs to another tree, menu category,
                // barsy venue or mapping setting, is not a base for a partial pull: the changed
                // articles of the new scope are not the whole of it. Read everything instead.
                const cursor = state.cursor
                const treeChanged = cursor === undefined || state.tree_hash !== treeHashOf(tree)
                const scopeChanged = state.scope_hash !== scopeHashOf(session, target)
                if (treeChanged || scopeChanged) {
                  const what = treeChanged
                    ? 'the category tree changed'
                    : 'the menu category or sync settings changed'
                  if (
                    await fullPullStartedWithin(
                      env,
                      payload.tenantId,
                      payload.integrationId,
                      FULL_PULL_COOLDOWN_MS,
                    )
                  ) {
                    return { notes: [`${what}; a full pull ran a moment ago`] }
                  }
                  const full = prepareJob(JOB_NAMES.barsyFullPull, payload)
                  const id = await env.enqueue(JOB_NAMES.barsyFullPull, full.data, {
                    singletonKey: full.singletonKey,
                  })
                  return {
                    notes: [
                      id === null
                        ? `${what}; a full pull is already queued`
                        : `${what}: a full pull was queued`,
                    ],
                  }
                }
                const ctx = { env, session, target, runId: run.id, start }
                const outcome = await runIncremental(
                  ctx,
                  tree,
                  lastUpdateFilter(new Date(cursor), target.timezone),
                )
                await recordSuccess(ctx, outcome, 'incremental')
                await publishAfterPull(
                  env,
                  payload,
                  session,
                  target,
                  outcome.counters.ops_applied ?? 0,
                )
                return {
                  counters: outcome.counters,
                  notes: outcome.notes,
                  refused: outcome.refused,
                }
              }),
            incrementalLock,
          )
          return locked.acquired ? locked.value : { notes: ['skipped: another pull is running'] }
        })
      }
    },
  })

  // --- places-read -----------------------------------------------------------------------

  /**
   * The tables of one mapped venue (CF-16, T67): they do not depend on the menu category, so they
   * are read as soon as the venue is mapped. Inside the pull lock (the full pull reads them too);
   * when another pull runs, the tick asks again later.
   */
  const placesRead = defineJob<VenueSyncJob>({
    name: JOB_NAMES.placesRead,
    options: {
      policy: 'exclusive',
      queue: {
        retryLimit: 1,
        retryDelay: 60,
        expireInSeconds: 5 * 60,
        retentionSeconds: 30 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(VenueSyncJobSchema, job, JOB_NAMES.placesRead)
        const env = environment(context, job)
        if (await skipped(env, payload)) continue
        await trackedRun(env, { ...payload, kind: 'places_read' }, async () => {
          const locked = await withPullLock(
            env,
            payload.integrationId,
            () =>
              withIntegration(env, payload, async (session) => {
                const venue = await loadMappedVenue(
                  env,
                  payload.tenantId,
                  payload.integrationId,
                  payload.venueId,
                )
                const result = await syncPlaces({ env, session, venue, now: env.now() })
                return {
                  counters: result.counters,
                  notes: result.notes,
                  ...(result.read ? {} : { status: 'failed' as const }),
                }
              }),
            incrementalLock,
          )
          return locked.acquired
            ? locked.value
            : { notes: ['skipped: another pull is running; the tables are read a little later'] }
        })
      }
    },
  })

  // --- asset-fetch -----------------------------------------------------------------------

  const assetFetch = defineJob<AssetFetchJob>({
    name: JOB_NAMES.assetFetch,
    options: {
      policy: 'exclusive',
      queue: {
        retryLimit: 3,
        retryDelay: 20,
        retryBackoff: true,
        expireInSeconds: 5 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(AssetFetchJobSchema, job, JOB_NAMES.assetFetch)
        const env = environment(context, job)
        await trackedRun(env, { ...payload, kind: 'asset_fetch' }, async (run) =>
          withIntegration(env, payload, async (session) => {
            try {
              const result = await fetchPhoto(env, session, payload, run.id)
              // A new asset gets its phone-sized webp variants (idempotent; the backfill command
              // catches any that this misses).
              if (result.asset === 'created' && result.assetId !== undefined) {
                const variants = prepareJob(JOB_NAMES.assetVariants, {
                  tenantId: payload.tenantId,
                  assetId: result.assetId,
                })
                await env.enqueue(JOB_NAMES.assetVariants, variants.data, {
                  singletonKey: variants.singletonKey,
                })
              }
              const counters = {
                assets_created: result.asset === 'created' ? 1 : 0,
                assets_reused: result.asset === 'reused' ? 1 : 0,
              }
              if (result.status === 'obsolete') {
                // Not an error: the article moved on while this job waited (or downloaded).
                return {
                  counters: { ...counters, image_set: 0, obsolete: 1 },
                  notes: [`obsolete: ${OBSOLETE_TEXT[result.reason]}`],
                }
              }
              return {
                counters: { ...counters, image_set: result.applied ? 1 : 0, obsolete: 0 },
                refused: result.rejected,
              }
            } catch (error) {
              if (error instanceof PhotoRefused) {
                return { status: 'failed' as const, notes: [`picture refused: ${error.reason}`] }
              }
              throw error
            }
          }),
        )
      }
    },
  })

  // --- the schedules ---------------------------------------------------------------------

  /**
   * The mapped venues of connected integrations, as (tenant, integration, venue), with what the
   * schedule needs: the integration's config (settings, time zone and sync state), the barsy
   * venue's `bid` and whether it has a catalogue root (only then are pulls due; its tables are
   * read either way). Tenants are listed from the organisation table (a system table: the app role
   * can read it without a tenant scope; the organisation id is the tenant id), then each tenant's
   * rows are read inside its own scope.
   */
  async function syncTargets(context: WorkerContext) {
    const organisations = await withSystem(context.pool, (tx) =>
      tx.select({ id: authOrganization.id }).from(authOrganization),
    )
    const targets: {
      tenantId: string
      integrationId: string
      venueId: string
      bid: number
      hasRoot: boolean
      config: unknown
      /** The venue's own settings (its sync mode, D82) and time zone. */
      venueSettings: unknown
      venueTimeZone: string
    }[] = []
    for (const organisation of organisations) {
      const rows = await withTenant(context.pool, organisation.id, (tx) =>
        tx
          .select({
            integrationId: integrations.id,
            venueId: venueLinks.venueId,
            bid: venueLinks.bid,
            root: venueLinks.catalogueRootCatId,
            publicRoot: venueLinks.publicCatId,
            treeRoot: venueLinks.treeCatId,
            config: integrations.config,
            venueSettings: ourVenues.settings,
            venueTimeZone: ourVenues.timezone,
          })
          .from(integrations)
          .innerJoin(venueLinks, eq(venueLinks.integrationId, integrations.id))
          .innerJoin(ourVenues, eq(ourVenues.id, venueLinks.venueId))
          .where(
            and(
              eq(integrations.kind, 'barsy'),
              eq(integrations.status, 'connected'),
              isNotNull(venueLinks.venueId),
              // A deleted venue is never scheduled (D76); its link is released with it, this is
              // the second line.
              isNull(ourVenues.archivedAt),
            ),
          ),
      )
      for (const row of rows) {
        if (row.venueId !== null) {
          targets.push({
            tenantId: organisation.id,
            integrationId: row.integrationId,
            venueId: row.venueId,
            bid: row.bid,
            hasRoot: rootsOf(row.publicRoot, row.treeRoot, row.root).length > 0,
            config: row.config,
            venueSettings: row.venueSettings,
            venueTimeZone: row.venueTimeZone,
          })
        }
      }
    }
    return targets
  }

  /**
   * The one schedule of the sync (S3-04, D59; per venue since D82): every minute it asks
   * `dueSyncs` of each mapped venue with a catalogue root whether a change check or a full pull is
   * due under the VENUE's sync mode (`venueSyncSchedule`: its own, else the integration's schedule
   * of before), timed in the venue's own time zone, and queues what is; a mapped venue whose
   * tables were never read gets a places read (CF-16, T67). The queued time (a change check) or slot (a full pull) is written
   * to the sync state, so the interval is counted from the last attempt, and a pull that failed
   * is not asked for again every minute. With the settings at their defaults this is what the two
   * fixed schedules did: a change check every 5 minutes and a full pull daily at 12:00 (D41,
   * D50/P31).
   */
  const syncTick = defineJob({
    name: JOB_NAMES.barsySyncTick,
    schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
    options: {
      // The next tick comes soon enough; a missed one is not retried.
      queue: {
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
    },
    async handler(_jobs, context) {
      const now = context.now()
      const targets = await syncTargets(context)
      let incrementals = 0
      let fullPulls = 0
      let placesReads = 0
      let failed = 0
      for (const target of targets) {
        // One venue's trouble (an unreadable setting, a database hiccup) never stops the others.
        try {
          const state = readSyncState(target.config, target.bid)
          const payload = {
            tenantId: target.tenantId,
            integrationId: target.integrationId,
            venueId: target.venueId,
          }
          const record = (patch: Parameters<typeof updateSyncState>[4]) =>
            updateSyncState(context.pool, target.tenantId, target.integrationId, target.bid, patch)
          if (state.places_read_at === undefined) {
            const asked = state.places_queued_at ? Date.parse(state.places_queued_at) : Number.NaN
            if (Number.isNaN(asked) || now.getTime() - asked >= PLACES_RETRY_MS) {
              const job = prepareJob(JOB_NAMES.placesRead, payload)
              const id = await context.queue.send(JOB_NAMES.placesRead, job.data, {
                singletonKey: job.singletonKey,
              })
              if (id !== null) {
                placesReads += 1
                await record({ places_queued_at: now.toISOString() })
              }
            }
          }
          if (!target.hasRoot) continue
          const schedule = venueSyncSchedule(target.venueSettings, target.config)
          const due = dueSyncs(now, target.venueTimeZone, schedule, state)
          if (due.incremental) {
            const job = prepareJob(JOB_NAMES.barsyIncremental, payload)
            const id = await context.queue.send(JOB_NAMES.barsyIncremental, job.data, {
              singletonKey: job.singletonKey,
            })
            if (id !== null) {
              incrementals += 1
              await record({ last_incremental_queued_at: now.toISOString() })
            }
          }
          if (due.fullPull && due.fullPullSlot !== null) {
            const job = prepareJob(JOB_NAMES.barsyFullPull, payload)
            const id = await context.queue.send(JOB_NAMES.barsyFullPull, job.data, {
              singletonKey: job.singletonKey,
            })
            if (id !== null) {
              fullPulls += 1
              await record({ last_full_pull_slot: due.fullPullSlot.toISOString() })
            }
          }
        } catch (error) {
          failed += 1
          context.log.warn({ err: error }, 'the syncs of a venue could not be scheduled')
        }
      }
      // Every minute: say so only when something was queued or went wrong.
      const level = incrementals + fullPulls + placesReads + failed > 0 ? 'info' : 'debug'
      context.log[level](
        { targets: targets.length, incrementals, fullPulls, placesReads, failed },
        'sync tick',
      )
    },
  })

  return [connect, fullPull, incremental, placesRead, assetFetch, syncTick] as JobDefinition[]
}
