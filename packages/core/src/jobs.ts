// The background jobs the web app and the worker talk about: their queue names and what each
// job's payload looks like (brief S2-03b). The web app only sends (`apps/web/src/server/jobs.ts`);
// the worker runs them. Both import this one module, so a name or a payload can never differ
// between the two sides. Pure: no I/O.
//
// Every payload carries the tenant id. The database is isolated per tenant (row-level security),
// so the worker cannot even look an integration up without knowing whose it is; a payload whose
// tenant does not own the integration finds nothing.

import { z } from 'zod'

import { ActorSchema } from './change-set'
import { TABLE_TOKEN_PATTERN } from './guest-files'
import { sha256Hex } from './hash'
import { idSchema } from './ids'

/** Queue names. */
export const JOB_NAMES = {
  /** Publish a menu for a venue (brief S3-01b), then write its files. */
  publishMenu: 'publish-menu',
  /** Write the snapshot and pointer files of the current publish (after a rollback; a repair). */
  publishFiles: 'publish-files',
  /** Write the live overlay (`live.json`) of a menu + venue. */
  publishLive: 'publish-live',
  /**
   * Scheduled, every minute (S3-08): queues `publish-live` for each published menu whose service
   * day changed since it last did (the 07:00 rollover drops yesterday's sold-out marks from
   * `live.json`), and now and then for all of them as a repair. Not sent by anyone else.
   */
  publishLiveTick: 'publish-live-tick',
  /** Make the webp variants of one photo for the publish store. */
  assetVariants: 'asset-variants',
  /**
   * Write the `t/<code hash>.json` files of a venue's table codes and remove the retired ones
   * (S3-07; named by the code's SHA-256 since #70).
   */
  publishTableTokens: 'publish-table-tokens',
  /**
   * Scheduled, and sent by the worker at its start (#70, D122 §9): seals every table code still
   * stored in plain, writes the venue's files under the codes' hashes, removes the files named by
   * the plain code, then clears the plain code. Safe to run again; a run cut short is finished by
   * the next. Not sent by anyone else.
   */
  sealTableCodes: 'seal-table-codes',
  /**
   * Write an organisation's index `o/<slug>.json` and the redirect files of its earlier slugs
   * (D84): after a rename of the organisation, a venue, or a change of a venue's state. The
   * publish jobs write the index themselves after a publish.
   */
  publishOrganizationIndex: 'publish-organization-index',
  /**
   * Erase one deleted venue now (D83: "Delete permanently"): its own rows, files, codes and
   * tokens (tombstoned). Only the worker's purge job, through the role `restro_purge`.
   */
  purgeVenue: 'purge-venue',
  /**
   * Scheduled, daily (D83, D96): purges what is due in every organisation: venues 30 days in the
   * bin, binned menus, deleted areas and tables, old versions, the change log past two months.
   * Not sent by anyone else.
   */
  purgeTick: 'purge-tick',
  /** Test the credentials and read what the installation holds (venues, languages, tree). */
  barsyConnect: 'barsy-connect',
  /** The full pull of one venue (collection path C). The only job that may conclude absence. */
  barsyFullPull: 'barsy-full-pull',
  /** The changes since the last run, or a full pull when the category tree changed. */
  barsyIncremental: 'barsy-incremental',
  /** Download one barsy picture into the asset store. */
  assetFetch: 'asset-fetch',
  /**
   * Read the tables of one mapped till venue (brief CF-16, T67). Needs no catalogue root: the
   * minute tick queues it for a mapped venue whose tables were never read.
   */
  placesRead: 'places-read',
  /**
   * Read the floor of one venue's till venue through the service connector (#71): its tables, the
   * payment tables among them and the bars where the POS has them. Only the simulated POS reads
   * a floor today; the worker refuses that kind in production.
   */
  floorRead: 'floor-read',
  /**
   * Scheduled, every minute (#71): queues `floor-read` for each mapped venue of a connector that
   * reads its floor whose last read is older than the floor read interval. Not sent by anyone else.
   */
  floorReadTick: 'floor-read-tick',
  /**
   * Read one table's POS bills through the service connector and record the reading (#74): the
   * bill every phone at the table is served, and the sitting's end when it shows the bill closed.
   * One per table at a time. The minute tick queues it for open tables; the guest API queues it
   * when a guest opens a bill read more than 15 s ago (`wantsFreshReading`).
   */
  tableRead: 'table-read',
  /**
   * Scheduled, every minute (#74): queues `table-read` for each table open for phones whose bill
   * was not read within the table read interval. Not sent by anyone else.
   */
  tableReadTick: 'table-read-tick',
  /**
   * Scheduled, every minute (#75, D121): sets aside the order of each open table that nobody
   * touched for the idle time ("Earlier order · Restore"), through `applyService` (`order.tidy`).
   * A phone's read does the same at once; this tick covers the tables nobody is reading. Not sent
   * by anyone else.
   */
  orderTidyTick: 'order-tidy-tick',
  /**
   * Send a table's waiting sent orders to its POS, one at a time (#77, D115): take the table's
   * slot, read the bill, add the round once, and when the answer is unknown read it back for a
   * minute. The guest API queues it after an accepted Send; the sweep queues it for a table with a
   * waiting sent order and no slot holder. Stately per table: a Send while one runs waits behind it.
   */
  orderSend: 'order-send',
  /**
   * Scheduled, every minute (#77): settles the sent order of each table whose slot lease passed
   * its deadline (`sent_order.expire`: Unconfirmed when it may have reached the POS), and queues
   * `order-send` for each table with a waiting sent order and no slot holder. Not sent by anyone
   * else.
   */
  orderSlotSweep: 'order-slot-sweep',
  /**
   * Probe one POS instance's connection (#79, D120): while it is paused, and for the five minutes
   * after a lift. Each run sends the next at the breaker's next probe time. Stately per instance.
   */
  connectionProbe: 'connection-probe',
  /**
   * Scheduled, every minute (#79): queues `connection-probe` for each paused connection, so a
   * restarted worker probes again at the time the pause row says. Not sent by anyone else.
   */
  connectionTick: 'connection-tick',
  /**
   * Scheduled, every minute (S3-04): queues the change check and the full pull of each connected
   * venue that the integration's schedule settings say are due (`dueSyncs`). It replaced the two
   * fixed schedules `barsy-incremental-tick` (every 5 minutes) and `barsy-full-pull-tick`
   * (daily at 12:00).
   */
  barsySyncTick: 'barsy-sync-tick',
  /**
   * Scheduled, every minute (#108): handles the stored provider notices (the notice route only
   * stores them): reads each one's payment back from its provider and records the refund total
   * and the dispute (`payment.observe`). Not sent by anyone else.
   */
  providerNotices: 'provider-notices',
} as const

/** One of the queue names. */
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES]

const tenantId = idSchema('tn')
const integrationId = idSchema('in')
const venueId = idSchema('vn')

/** `barsy-connect`. */
export const BarsyConnectJobSchema = z.strictObject({ tenantId, integrationId })
export type BarsyConnectJob = z.output<typeof BarsyConnectJobSchema>

/**
 * A job about one venue of an integration: the two pulls and the places read. `venueId` is OUR
 * venue (`vn_`), never a till's own venue id.
 */
export const VenueSyncJobSchema = z.strictObject({ tenantId, integrationId, venueId })
export type VenueSyncJob = z.output<typeof VenueSyncJobSchema>

/**
 * `table-read`: one table of one venue (`tb_`, never the POS's id for it). The worker finds the
 * table's POS instance itself, so a sender needs no more than the guest API knows.
 */
export const TableReadJobSchema = z.strictObject({ tenantId, venueId, tableId: idSchema('tb') })
export type TableReadJob = z.output<typeof TableReadJobSchema>

/** `connection-probe`: one POS instance (the instance owns the connection, not a venue). */
export const ConnectionProbeJobSchema = z.strictObject({ tenantId, integrationId })
export type ConnectionProbeJob = z.output<typeof ConnectionProbeJobSchema>

/** Payload of `order-send`: the table whose waiting sent orders go to its POS. */
export const OrderSendJobSchema = TableReadJobSchema
export type OrderSendJob = TableReadJob

/** `barsy-full-pull` and `barsy-incremental`: `venueId` is OUR venue (`vn_`), never a barsy `bid`. */
export const BarsyPullJobSchema = VenueSyncJobSchema
export type BarsyPullJob = VenueSyncJob

/**
 * `asset-fetch`: one picture of one article. `url` is the one the mapping built from barsy's
 * `picture_url`; the worker only follows it when it points at the integration's own host.
 */
export const AssetFetchJobSchema = z.strictObject({
  tenantId,
  integrationId,
  articleExternalId: z.string().regex(/^[1-9]\d{0,14}$/, 'expected a barsy article id'),
  pictureName: z.string().min(1).max(400),
  url: z.url({ protocol: /^https$/ }).max(2000),
})
export type AssetFetchJob = z.output<typeof AssetFetchJobSchema>

/** Why a publish job runs (the same two reasons as `publishMenu`). */
export const PUBLISH_JOB_REASONS = ['manual', 'auto_sync'] as const

/** Automatic publishes within this many seconds are merged into one snapshot (doc "Publish policy"). */
export const AUTO_PUBLISH_DELAY_SECONDS = 30

/**
 * `publish-menu`: publish one menu for one venue and write its files. `approveHold` is the held
 * snapshot (`sn_` id) a manual publish approves.
 */
export const PublishMenuJobSchema = z
  .strictObject({
    tenantId,
    menuId: idSchema('nd'),
    venueId,
    reason: z.enum(PUBLISH_JOB_REASONS),
    actor: ActorSchema,
    approveHold: idSchema('sn').optional(),
  })
  .refine(
    (job) => job.approveHold === undefined || job.reason === 'manual',
    'only a manual publish approves a held snapshot',
  )
export type PublishMenuJob = z.output<typeof PublishMenuJobSchema>

/** `publish-files` and `publish-live`: one menu of one venue. */
export const PublishScopeJobSchema = z.strictObject({
  tenantId,
  menuId: idSchema('nd'),
  venueId,
})
export type PublishScopeJob = z.output<typeof PublishScopeJobSchema>

/** `asset-variants`: the webp variants of one stored photo. */
export const AssetVariantsJobSchema = z.strictObject({ tenantId, assetId: idSchema('as') })
export type AssetVariantsJob = z.output<typeof AssetVariantsJobSchema>

/** The most tokens one `publish-table-tokens` job removes (a venue has far fewer tables). */
export const MAX_RETIRED_TOKENS = 500

/**
 * `publish-table-tokens` (S3-07): the venue whose table files `t/<code hash>.json` are brought up
 * to date, and the hashes of the codes that stopped working since (their files are removed). The
 * pattern also takes a plain code, so a job queued before #70 still removes its file. The job writes the
 * file of EVERY active code of the venue, so what it writes does not depend on the payload; only
 * `retired` does, which is why two jobs of one venue are merged only when `retired` is the same.
 */
export const PublishTableTokensJobSchema = z.strictObject({
  tenantId,
  venueId,
  retired: z.array(z.string().regex(TABLE_TOKEN_PATTERN)).max(MAX_RETIRED_TOKENS),
})
export type PublishTableTokensJob = z.output<typeof PublishTableTokensJobSchema>

/** `publish-organization-index`: one organisation. */
export const PublishOrganizationIndexJobSchema = z.strictObject({ tenantId })
export type PublishOrganizationIndexJob = z.output<typeof PublishOrganizationIndexJobSchema>

/** `purge-venue`: one deleted venue, erased now. */
export const PurgeVenueJobSchema = z.strictObject({ tenantId, venueId })
export type PurgeVenueJob = z.output<typeof PurgeVenueJobSchema>

/** The payload schema of each job that carries one. */
export const JOB_PAYLOADS = {
  [JOB_NAMES.barsyConnect]: BarsyConnectJobSchema,
  [JOB_NAMES.barsyFullPull]: BarsyPullJobSchema,
  [JOB_NAMES.barsyIncremental]: BarsyPullJobSchema,
  [JOB_NAMES.assetFetch]: AssetFetchJobSchema,
  [JOB_NAMES.placesRead]: VenueSyncJobSchema,
  [JOB_NAMES.floorRead]: VenueSyncJobSchema,
  [JOB_NAMES.tableRead]: TableReadJobSchema,
  [JOB_NAMES.orderSend]: OrderSendJobSchema,
  [JOB_NAMES.connectionProbe]: ConnectionProbeJobSchema,
  [JOB_NAMES.publishMenu]: PublishMenuJobSchema,
  [JOB_NAMES.publishFiles]: PublishScopeJobSchema,
  [JOB_NAMES.publishLive]: PublishScopeJobSchema,
  [JOB_NAMES.assetVariants]: AssetVariantsJobSchema,
  [JOB_NAMES.publishTableTokens]: PublishTableTokensJobSchema,
  [JOB_NAMES.publishOrganizationIndex]: PublishOrganizationIndexJobSchema,
  [JOB_NAMES.purgeVenue]: PurgeVenueJobSchema,
} as const

/** The jobs a producer may send (the ticks are only ever created by the scheduler). */
export type ProducedJobName = keyof typeof JOB_PAYLOADS

/** The payload type of a produced job. */
export type JobPayload<N extends ProducedJobName> = z.output<(typeof JOB_PAYLOADS)[N]>

/** True if `name` is a job a producer may send. */
export function isProducedJob(name: string): name is ProducedJobName {
  return Object.hasOwn(JOB_PAYLOADS, name)
}

/**
 * The queue policies the worker creates its queues with (pg-boss, docs "Queue policies"):
 * `exclusive` allows one queued-or-running job per queue and singleton key. Kept here because
 * the producer relies on it: a second `send` with the same key returns null instead of piling up.
 */
export const EXCLUSIVE_JOBS: ReadonlySet<string> = new Set<string>([
  JOB_NAMES.barsyConnect,
  JOB_NAMES.barsyFullPull,
  JOB_NAMES.barsyIncremental,
  JOB_NAMES.assetFetch,
  JOB_NAMES.assetVariants,
  JOB_NAMES.placesRead,
  JOB_NAMES.floorRead,
  JOB_NAMES.tableRead,
])

/**
 * The publish jobs use `stately`: per queue and singleton key at most one job WAITING and one
 * RUNNING. A send while one waits returns null (so two automatic publishes within the delay are
 * one job), and a send while one runs waits behind it (the run may have read the document
 * already, so the later change needs its own publish).
 */
export const STATELY_JOBS: ReadonlySet<string> = new Set<string>([
  JOB_NAMES.publishMenu,
  JOB_NAMES.publishFiles,
  JOB_NAMES.publishLive,
  JOB_NAMES.publishTableTokens,
  JOB_NAMES.publishOrganizationIndex,
  JOB_NAMES.purgeVenue,
  JOB_NAMES.orderSend,
  JOB_NAMES.connectionProbe,
])

/**
 * The pg-boss singleton key of a job: one key per integration for connect; one per integration
 * and venue for the two pulls and the places read (brief CF-16, T50), so a venue's pull is never
 * dropped because another venue's is queued; one picture is fetched once at a time. The
 * `exclusive` policy applies per queue AND key, so it only keeps two jobs of the SAME queue apart:
 * a full pull and an incremental run can both be active. What keeps pulls from overlapping (one
 * at a time per installation) is the worker's Postgres advisory lock
 * (apps/worker/src/sync/pull-lock.ts).
 *
 * Publishing is keyed by menu + venue. An automatic publish has its own key, so a person's
 * "Publish" is never swallowed by an automatic one still waiting out its delay (their reasons
 * differ: only a manual publish may approve a hold or get past V11); a manual one is keyed by
 * the hold it approves too.
 */
export function jobSingletonKey<N extends ProducedJobName>(name: N, data: JobPayload<N>): string {
  switch (name) {
    case JOB_NAMES.assetFetch: {
      const fetch = data as AssetFetchJob
      return `${fetch.integrationId}:${fetch.articleExternalId}`
    }
    case JOB_NAMES.assetVariants:
      return (data as AssetVariantsJob).assetId
    case JOB_NAMES.publishTableTokens: {
      // The venue, plus a short hash of the tokens to remove: a waiting job is replaced only by an
      // identical one, so a job that must remove a token is never dropped for another.
      const tokens = data as PublishTableTokensJob
      const retired = [...tokens.retired].sort().join(',')
      return retired === ''
        ? tokens.venueId
        : `${tokens.venueId}:${sha256Hex(retired).slice(0, 16)}`
    }
    case JOB_NAMES.publishOrganizationIndex:
      return (data as PublishOrganizationIndexJob).tenantId
    case JOB_NAMES.purgeVenue:
      return (data as PurgeVenueJob).venueId
    case JOB_NAMES.tableRead:
      // One reading job per table (#74): a second send while one is queued or running is dropped.
      return (data as TableReadJob).tableId
    case JOB_NAMES.orderSend:
      // One sender per table (#77); a Send while it runs queues one more run behind it.
      return (data as OrderSendJob).tableId
    case JOB_NAMES.publishFiles:
    case JOB_NAMES.publishLive: {
      const scope = data as PublishScopeJob
      return `${scope.menuId}:${scope.venueId}`
    }
    case JOB_NAMES.publishMenu: {
      const publish = data as PublishMenuJob
      const base = `${publish.menuId}:${publish.venueId}`
      return publish.reason === 'auto_sync'
        ? `${base}:auto`
        : `${base}:manual:${publish.approveHold ?? 'new'}`
    }
    default: {
      // Connect carries no venue: one per integration. A venue job: one per integration and venue.
      const keyed = data as { integrationId: string; venueId?: string }
      return keyed.venueId === undefined
        ? keyed.integrationId
        : `${keyed.integrationId}:${keyed.venueId}`
    }
  }
}

/**
 * The key for a pull that a running pull sends again for later (its integration was busy):
 * `key` is the running job's own singleton key (integration and venue). The running job still
 * holds that key, and the `exclusive` policy would drop a second job with it (`send` returns
 * null), so the later copy carries a key of its own. The second makes it unique per deferral: a
 * copy that is busy again can send its own successor.
 */
export function deferredSingletonKey(key: string, at: Date): string {
  return `${key}:later:${Math.floor(at.getTime() / 1000)}`
}

/**
 * Seconds to wait before a job may start: an automatic publish waits `AUTO_PUBLISH_DELAY_SECONDS`
 * so that syncs close together are published once; every other job starts at once.
 */
export function jobStartAfter<N extends ProducedJobName>(
  name: N,
  data: JobPayload<N>,
): number | undefined {
  return name === JOB_NAMES.publishMenu && (data as PublishMenuJob).reason === 'auto_sync'
    ? AUTO_PUBLISH_DELAY_SECONDS
    : undefined
}

/** Validates a payload for `name` and returns it with the options `send` needs. */
export function prepareJob<N extends ProducedJobName>(
  name: N,
  data: unknown,
): {
  readonly data: JobPayload<N>
  readonly singletonKey: string
  /** Seconds before the job may start; absent for a job that starts at once. */
  readonly startAfter?: number
} {
  const parsed = JOB_PAYLOADS[name].safeParse(data)
  if (!parsed.success) {
    throw new TypeError(`invalid payload for job ${name}: ${z.prettifyError(parsed.error)}`)
  }
  const payload = parsed.data as JobPayload<N>
  const startAfter = jobStartAfter(name, payload)
  return {
    data: payload,
    singletonKey: jobSingletonKey(name, payload),
    ...(startAfter === undefined ? {} : { startAfter }),
  }
}
