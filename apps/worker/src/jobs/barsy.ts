// The barsy sync jobs (brief S2-03b). Registered only when the worker holds the sealing keys: see
// `createBarsyJobs` and jobs/index.ts. Each job opens its integration through `withIntegration`
// (one place that opens the sealed credentials), records itself in `job_runs`, and does its work
// through the pieces under ../sync/.
//
//   barsy-connect         test the credentials, read the installation's venues and trees
//   barsy-full-pull       path C for one venue; the only job that concludes absence
//   barsy-incremental     path E: the tree check and the changed articles
//   asset-fetch           one barsy photo into the asset store
//   barsy-incremental-tick / barsy-full-pull-tick   the schedules that queue the two pulls
//
// The queues use pg-boss's `exclusive` policy and the integration id as singleton key, so a second
// full pull of one integration is never queued while one is queued or running, whoever sends it
// (the web app's "Sync now", the ticks, an incremental run that notices the tree changed). The
// policy is per queue, so it does not keep a full pull and an incremental run apart: both run
// inside the integration's Postgres advisory lock (../sync/pull-lock.ts), held for the whole pull.

import { BarsyAuthError } from '@restro/barsy'
import {
  type AssetFetchJob,
  AssetFetchJobSchema,
  type BarsyConnectJob,
  BarsyConnectJobSchema,
  type BarsyPullJob,
  BarsyPullJobSchema,
  canonicalJson,
  deferredSingletonKey,
  JOB_NAMES,
  prepareJob,
} from '@restro/core'
import {
  appendSourceRecords,
  readSyncState,
  storeCachedTree,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { authOrganization, barsyVenues, integrations, withSystem, withTenant } from '@restro/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Job } from 'pg-boss'
import type { z } from 'zod'

import type { BarsyPolicy, SealKeys } from '../config'
import { queuePublishAfterSync } from '../publish/after-sync'
import {
  cachedTreeOf,
  recordSuccess,
  runFullPull,
  runIncremental,
  treeHashOf,
} from '../sync/catalogue'
import {
  type IntegrationSession,
  type PhotoStore,
  type SyncEnvironment,
  withIntegration,
} from '../sync/context'
import { lastUpdateFilter } from '../sync/cursor'
import { fullPullStartedWithin, loadVenueTarget } from '../sync/data'
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

function parsePayload<S extends z.ZodType>(schema: S, job: Job<object>, name: string): z.output<S> {
  const parsed = schema.safeParse(job.data)
  if (!parsed.success) throw new Error(`the ${name} job has an invalid payload`)
  return parsed.data
}

/** Who the publish after a pull is queued for: the venue the pull read, with the integration's settings. */
function afterSyncTarget(
  payload: BarsyPullJob,
  session: IntegrationSession,
): Parameters<typeof queuePublishAfterSync>[1] {
  return {
    tenantId: payload.tenantId,
    integrationId: payload.integrationId,
    venueId: payload.venueId,
    config: session.integration.config,
  }
}

function isFlagSet(value: unknown): boolean {
  return value === 1 || value === true
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

  const connect = defineJob<BarsyConnectJob>({
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
        const payload = parsePayload(BarsyConnectJobSchema, job, JOB_NAMES.barsyConnect)
        const env = environment(context, job)
        await trackedRun(env, { ...payload, kind: 'barsy_connect' }, async () =>
          withIntegration(env, payload, async (session) => {
            const { client, reader } = session
            // Both pings return 1 (the official docs). A 401 here stores the code wrong_credentials.
            await client.ping()
            await client.pingUser()
            const venues = (await reader.getVenues()).data
            const languages = (await reader.getLanguages()).data
            const currencies = (await reader.getCurrencies()).data
            const details = (await reader.getArticleDetailsTree()).data

            const live = venues.filter((venue) => !isFlagSet(venue.delete_flag))
            await upsertBarsyVenues(
              env.pool,
              payload.tenantId,
              payload.integrationId,
              live.map((venue) => ({ bid: venue.barsy_id, name: venue.name })),
            )
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
                if (error instanceof BarsyAuthError) throw error
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

  const fullPull = defineJob<BarsyPullJob>({
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
        const payload = parsePayload(BarsyPullJobSchema, job, JOB_NAMES.barsyFullPull)
        const env = environment(context, job)
        await trackedRun(env, { ...payload, kind: 'barsy_full_pull' }, async (run) => {
          // Held for the whole pull. Another pull of this integration (an incremental run, or a
          // full pull of a retried job) is waited for, up to a minute.
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
                const ctx = { env, session, target, runId: run.id, start: env.now() }
                const outcome = await runFullPull(ctx)
                await recordSuccess(ctx, outcome, 'full')
                await updateIntegration(env.pool, payload.tenantId, payload.integrationId, {
                  status: 'connected',
                  statusDetail: null,
                  lastCheckedAt: env.now(),
                })
                const published = await queuePublishAfterSync(
                  env,
                  afterSyncTarget(payload, session),
                  outcome.counters.ops_applied ?? 0,
                )
                return {
                  counters: outcome.counters,
                  notes: published === null ? outcome.notes : [...outcome.notes, published],
                  deletionCheckSkipped: outcome.deletionCheckSkipped,
                  refused: outcome.refused,
                }
              }),
            fullPullLock,
          )
          if (locked.acquired) return locked.value

          // Still busy after the wait: send this pull again, to start in a minute, so that a
          // "Sync now" is never lost. This job is still active under the integration id, and the
          // queue's exclusive policy would drop a second job with that key (`send` returns null),
          // so the copy carries a key of its own.
          const later = await env.enqueue(JOB_NAMES.barsyFullPull, payload, {
            singletonKey: deferredSingletonKey(payload.integrationId, env.now()),
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

  const incremental = defineJob<BarsyPullJob>({
    name: JOB_NAMES.barsyIncremental,
    options: {
      policy: 'exclusive',
      queue: {
        // The next tick is five minutes away; a retry adds nothing.
        retryLimit: 0,
        expireInSeconds: 10 * 60,
        retentionSeconds: 30 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(BarsyPullJobSchema, job, JOB_NAMES.barsyIncremental)
        const env = environment(context, job)
        await trackedRun(env, { ...payload, kind: 'barsy_incremental' }, async (run) => {
          // Another pull in progress (a full pull reads everything anyway): do not wait, the next
          // tick is five minutes away. Held for the whole run otherwise.
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
                if (state.cursor === undefined || state.tree_hash !== treeHashOf(tree)) {
                  if (
                    await fullPullStartedWithin(
                      env,
                      payload.tenantId,
                      payload.integrationId,
                      FULL_PULL_COOLDOWN_MS,
                    )
                  ) {
                    return { notes: ['the category tree changed; a full pull ran a moment ago'] }
                  }
                  const full = prepareJob(JOB_NAMES.barsyFullPull, payload)
                  const id = await env.enqueue(JOB_NAMES.barsyFullPull, full.data, {
                    singletonKey: full.singletonKey,
                  })
                  return {
                    notes: [
                      id === null
                        ? 'the category tree changed; a full pull is already queued'
                        : 'the category tree changed: a full pull was queued',
                    ],
                  }
                }
                const ctx = { env, session, target, runId: run.id, start }
                const outcome = await runIncremental(
                  ctx,
                  tree,
                  lastUpdateFilter(new Date(state.cursor), target.timezone),
                )
                await recordSuccess(ctx, outcome, 'incremental')
                const published = await queuePublishAfterSync(
                  env,
                  afterSyncTarget(payload, session),
                  outcome.counters.ops_applied ?? 0,
                )
                return {
                  counters: outcome.counters,
                  notes: published === null ? outcome.notes : [...outcome.notes, published],
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
   * Connected integrations that have a venue with a catalogue root, as (tenant, integration,
   * venue). Tenants are listed from the organisation table (a system table: the app role can read
   * it without a tenant scope; the organisation id is the tenant id), then each tenant's rows are
   * read inside its own scope.
   */
  async function pullTargets(context: WorkerContext) {
    const organisations = await withSystem(context.pool, (tx) =>
      tx.select({ id: authOrganization.id }).from(authOrganization),
    )
    const targets: { tenantId: string; integrationId: string; venueId: string }[] = []
    for (const organisation of organisations) {
      const rows = await withTenant(context.pool, organisation.id, (tx) =>
        tx
          .select({ integrationId: integrations.id, venueId: barsyVenues.venueId })
          .from(integrations)
          .innerJoin(barsyVenues, eq(barsyVenues.integrationId, integrations.id))
          .where(
            and(
              eq(integrations.kind, 'barsy'),
              eq(integrations.status, 'connected'),
              isNotNull(barsyVenues.venueId),
              isNotNull(barsyVenues.catalogueRootCatId),
            ),
          ),
      )
      for (const row of rows) {
        if (row.venueId !== null) {
          targets.push({
            tenantId: organisation.id,
            integrationId: row.integrationId,
            venueId: row.venueId,
          })
        }
      }
    }
    return targets
  }

  function ticker(
    name: string,
    queueName: typeof JOB_NAMES.barsyFullPull | typeof JOB_NAMES.barsyIncremental,
    cron: string,
  ) {
    return defineJob({
      name,
      schedule: { cron, tz: 'Europe/Sofia' },
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
        const targets = await pullTargets(context)
        let queued = 0
        for (const target of targets) {
          const job = prepareJob(queueName, target)
          const id = await context.queue.send(queueName, job.data, {
            singletonKey: job.singletonKey,
          })
          if (id !== null) queued += 1
        }
        context.log.info({ queue: queueName, targets: targets.length, queued }, 'tick')
      },
    })
  }

  return [
    connect,
    fullPull,
    incremental,
    assetFetch,
    // Every five minutes (D41), and the full pull daily at 12:00 venue time (D50/P31).
    ticker(JOB_NAMES.barsyIncrementalTick, JOB_NAMES.barsyIncremental, '*/5 * * * *'),
    ticker(JOB_NAMES.barsyFullPullTick, JOB_NAMES.barsyFullPull, '0 12 * * *'),
  ] as JobDefinition[]
}
