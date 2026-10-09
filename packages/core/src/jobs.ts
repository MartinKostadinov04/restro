// The background jobs the web app and the worker talk about: their queue names and what each
// job's payload looks like (brief S2-03b). The web app only sends (`apps/web/src/server/jobs.ts`);
// the worker runs them. Both import this one module, so a name or a payload can never differ
// between the two sides. Pure: no I/O.
//
// Every payload carries the tenant id. The database is isolated per tenant (row-level security),
// so the worker cannot even look an integration up without knowing whose it is; a payload whose
// tenant does not own the integration finds nothing.

import { z } from 'zod'

import { idSchema } from './ids'

/** Queue names. */
export const JOB_NAMES = {
  /** Test the credentials and read what the installation holds (venues, languages, tree). */
  barsyConnect: 'barsy-connect',
  /** The full pull of one venue (collection path C). The only job that may conclude absence. */
  barsyFullPull: 'barsy-full-pull',
  /** The changes since the last run, or a full pull when the category tree changed. */
  barsyIncremental: 'barsy-incremental',
  /** Download one barsy picture into the asset store. */
  assetFetch: 'asset-fetch',
  /** Scheduled, every 5 minutes: queues an incremental run per connected venue. */
  barsyIncrementalTick: 'barsy-incremental-tick',
  /** Scheduled, daily: queues a full pull per connected venue. */
  barsyFullPullTick: 'barsy-full-pull-tick',
} as const

/** One of the queue names. */
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES]

const tenantId = idSchema('tn')
const integrationId = idSchema('in')
const venueId = idSchema('vn')

/** `barsy-connect`. */
export const BarsyConnectJobSchema = z.strictObject({ tenantId, integrationId })
export type BarsyConnectJob = z.output<typeof BarsyConnectJobSchema>

/** `barsy-full-pull` and `barsy-incremental`: `venueId` is OUR venue (`vn_`), never a barsy `bid`. */
export const BarsyPullJobSchema = z.strictObject({ tenantId, integrationId, venueId })
export type BarsyPullJob = z.output<typeof BarsyPullJobSchema>

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

/** The payload schema of each job that carries one. */
export const JOB_PAYLOADS = {
  [JOB_NAMES.barsyConnect]: BarsyConnectJobSchema,
  [JOB_NAMES.barsyFullPull]: BarsyPullJobSchema,
  [JOB_NAMES.barsyIncremental]: BarsyPullJobSchema,
  [JOB_NAMES.assetFetch]: AssetFetchJobSchema,
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
])

/**
 * The pg-boss singleton key of a job: two pulls of one integration never overlap (one key per
 * integration for connect and the two pulls), and one picture is fetched once at a time.
 * Venue-level keys come with a second venue per integration (tracker T50).
 */
export function jobSingletonKey<N extends ProducedJobName>(name: N, data: JobPayload<N>): string {
  if (name === JOB_NAMES.assetFetch) {
    const fetch = data as AssetFetchJob
    return `${fetch.integrationId}:${fetch.articleExternalId}`
  }
  return (data as { integrationId: string }).integrationId
}

/** Validates a payload for `name` and returns it with the options `send` needs. */
export function prepareJob<N extends ProducedJobName>(
  name: N,
  data: unknown,
): { readonly data: JobPayload<N>; readonly singletonKey: string } {
  const parsed = JOB_PAYLOADS[name].safeParse(data)
  if (!parsed.success) {
    throw new TypeError(`invalid payload for job ${name}: ${z.prettifyError(parsed.error)}`)
  }
  const payload = parsed.data as JobPayload<N>
  return { data: payload, singletonKey: jobSingletonKey(name, payload) }
}
