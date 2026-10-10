// The publish jobs (brief S3-01b). They need no barsy credentials, so they are registered whether
// or not the worker holds the sealing keys (jobs/index.ts).
//
//   publish-menu     publishMenu (core/apply), then the files; records a job run
//   publish-files    only the files of the current publish (after a rollback; a repair)
//   publish-live     live.json, the sold-out overlay (S3-08 triggers it)
//   asset-variants   the webp variants of one photo (jobs/barsy.ts and the web app queue it); for a
//                    barsy photo it then queues the automatic publish of the menus that use it
//   publish-table-tokens  the t/<token>.json files of a venue's table QR codes: writes the active
//                    ones, removes the retired ones (S3-07; the only writer of those files)
//
// The three publish queues use pg-boss's `stately` policy with a singleton key per menu + venue
// (core/jobs.ts): one job waits and one runs. An automatic publish is sent with a 30 s delay, so
// syncs close together find one waiting job (their `send` returns null) and publish once, with
// everything that changed by the time it runs.
import type { AssetStore, PublishStore } from '@restro/assets'
import {
  AssetVariantsJobSchema,
  JOB_NAMES,
  type PublishMenuJob,
  PublishMenuJobSchema,
  type PublishScopeJob,
  PublishScopeJobSchema,
  type PublishTableTokensJob,
  PublishTableTokensJobSchema,
} from '@restro/core'
import { PublishError, publishMenu } from '@restro/core/apply'
import type { Job } from 'pg-boss'
import type { z } from 'zod'

import { autoPublishIsPaused, queuePublishForAsset, resumeAutoPublish } from '../publish/after-sync'
import {
  type PublishFilesDeps,
  type PublishFilesResult,
  writeLiveOverlay,
  writePublishFiles,
} from '../publish/files'
import { writeTableTokenFiles } from '../publish/table-tokens'
import { runAssetVariants } from '../publish/variants'
import { type RunReport, trackedRun } from '../sync/run'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

export interface PublishJobDeps {
  /** Where published files go. */
  readonly publishStore: PublishStore
  /** Where the photo originals are (the variants job reads them). */
  readonly assetStore: Pick<AssetStore, 'get'>
}

function parsePayload<S extends z.ZodType>(schema: S, job: Job<object>, name: string): z.output<S> {
  const parsed = schema.safeParse(job.data)
  if (!parsed.success) throw new Error(`the ${name} job has an invalid payload`)
  return parsed.data
}

/** What a refused publish says in its run: the code and the checks that failed, never values. */
function refusal(error: PublishError): RunReport {
  const issues = error.issues.length > 0 ? ` (${error.issues.join(', ')})` : ''
  return {
    status: 'failed',
    notes: [`publish refused: ${error.code}${issues}`],
    counters: { refused: 1 },
  }
}

/** A slug that another venue already holds is said in the run, since the menu is not served there. */
function slugNotes(files: PublishFilesResult): string[] {
  return files.status === 'checked' && files.slugIndex === 'taken'
    ? [
        `the address /m/${files.slug} belongs to another venue: choose another venue slug (the menu is published but not served there)`,
      ]
    : []
}

export function createPublishJobs(deps: PublishJobDeps): JobDefinition[] {
  const filesDeps = (context: WorkerContext): PublishFilesDeps => ({
    pool: context.pool,
    store: deps.publishStore,
    now: context.now,
  })

  /**
   * live.json after a publish or a repair: its `version` names the snapshot it was made for, so
   * it is remade whenever the pointer is written. A failure is logged and does not fail the
   * publish: the files that matter are already out.
   */
  async function refreshLive(context: WorkerContext, scope: PublishScopeJob): Promise<void> {
    try {
      await writeLiveOverlay(filesDeps(context), scope)
    } catch (error) {
      context.log.warn({ err: error }, 'live.json could not be written after a publish')
    }
  }

  // --- publish-menu ----------------------------------------------------------------------

  const publish = defineJob<PublishMenuJob>({
    name: JOB_NAMES.publishMenu,
    options: {
      policy: 'stately',
      queue: {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 5 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(PublishMenuJobSchema, job, JOB_NAMES.publishMenu)
        const { tenantId, menuId, venueId } = payload
        // A rollback pauses automatic publishing (S3-05). Every automatic publish, a sync's or a
        // photo's, is `auto_sync`, so this stops exactly those; the pause is read now, not when
        // the job was queued, so a job that was waiting out its delay cannot undo a rollback. No
        // run is recorded: nothing was published or refused, and the log says so.
        if (
          payload.reason === 'auto_sync' &&
          (await autoPublishIsPaused(context, { tenantId, venueId }))
        ) {
          context.log.info(
            { menuId, venueId },
            'automatic publish skipped: publishing is paused after a rollback',
          )
          continue
        }
        await trackedRun(
          { pool: context.pool, log: context.log, now: context.now },
          { tenantId, kind: 'publish_menu' },
          async () => {
            let result: Awaited<ReturnType<typeof publishMenu>>
            try {
              result = await publishMenu(
                context.pool,
                tenantId,
                {
                  menuId,
                  venueId,
                  reason: payload.reason,
                  actor: payload.actor,
                  ...(payload.approveHold === undefined
                    ? {}
                    : { approveHold: payload.approveHold }),
                },
                { now: context.now() },
              )
            } catch (error) {
              // A refusal (V10, a blocked menu, an outdated hold …) is an answer, not a fault:
              // retrying the same document would be refused again.
              if (error instanceof PublishError) return refusal(error)
              throw error
            }
            const counters = { snapshot_version: result.snapshot.version }

            // A person's publish (or approval) is the word to resume automatic publishing after a
            // rollback. The publish stands whatever happens here; a failure is said in the run.
            const resumeNotes: string[] = []
            if (payload.reason === 'manual') {
              try {
                if (await resumeAutoPublish(context, { tenantId, venueId })) {
                  resumeNotes.push('automatic publishing is on again')
                }
              } catch (error) {
                context.log.warn({ err: error }, 'automatic publishing could not be resumed')
                resumeNotes.push('automatic publishing could not be resumed: publish again')
              }
            }

            if (result.status === 'held') {
              // V11: the pointer did not move, so there is nothing to write.
              const held = result.snapshot.heldReason
              return {
                counters: { ...counters, held: 1 },
                notes: [
                  held === null
                    ? 'held for review'
                    : `held for review (${held.code}): ${held.hidden} of ${held.previously_visible} visible items would be hidden`,
                ],
              }
            }

            // `unchanged` writes files too: they are normally there already (nothing is written
            // then), and a publish whose files failed halfway is repaired by the next one.
            const files = await writePublishFiles(filesDeps(context), { tenantId, menuId, venueId })
            await refreshLive(context, { tenantId, menuId, venueId })
            const written = files.status === 'checked' ? files.written.length : 0
            return {
              counters: {
                ...counters,
                published: result.status === 'published' ? 1 : 0,
                unchanged: result.status === 'unchanged' ? 1 : 0,
                files_written: written,
              },
              notes: [
                result.status === 'published'
                  ? `published version ${result.snapshot.version}`
                  : `nothing to publish: the menu is as version ${result.snapshot.version}`,
                ...resumeNotes,
                ...slugNotes(files),
              ],
            }
          },
        )
      }
    },
  })

  // --- publish-files ---------------------------------------------------------------------

  const files = defineJob<PublishScopeJob>({
    name: JOB_NAMES.publishFiles,
    options: {
      policy: 'stately',
      queue: {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 5 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 2 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(PublishScopeJobSchema, job, JOB_NAMES.publishFiles)
        await trackedRun(
          { pool: context.pool, log: context.log, now: context.now },
          { tenantId: payload.tenantId, kind: 'publish_files' },
          async () => {
            const result = await writePublishFiles(filesDeps(context), payload)
            if (result.status === 'nothing_published') {
              return { notes: ['nothing is published for this menu yet'] }
            }
            await refreshLive(context, payload)
            return {
              counters: { snapshot_version: result.version, files_written: result.written.length },
              notes: [`files of version ${result.version} are in place`, ...slugNotes(result)],
            }
          },
        )
      }
    },
  })

  // --- publish-live ----------------------------------------------------------------------

  const live = defineJob<PublishScopeJob>({
    name: JOB_NAMES.publishLive,
    options: {
      policy: 'stately',
      queue: {
        retryLimit: 1,
        retryDelay: 5,
        expireInSeconds: 2 * 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 1 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(PublishScopeJobSchema, job, JOB_NAMES.publishLive)
        // Sold-out marks come and go all night: no job run each time, only the log.
        const result = await writeLiveOverlay(filesDeps(context), payload)
        context.log.info({ menuId: payload.menuId, ...result }, 'live overlay')
      }
    },
  })

  // --- asset-variants --------------------------------------------------------------------

  const variants = defineJob({
    name: JOB_NAMES.assetVariants,
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
        const payload = parsePayload(AssetVariantsJobSchema, job, JOB_NAMES.assetVariants)
        const result = await runAssetVariants(
          { pool: context.pool, assets: deps.assetStore, store: deps.publishStore },
          payload,
        )
        context.log.info({ status: result.status }, 'photo variants')
        // The publish that followed the pull usually ran before this picture was ready: a barsy
        // picture whose variants were just made publishes the menus that use it (S3-04).
        if (result.status === 'made') {
          const notes = await queuePublishForAsset(
            {
              pool: context.pool,
              log: context.log,
              enqueue: (name, data, options) => context.queue.send(name, data, options),
            },
            payload,
          )
          for (const note of notes) context.log.info({ assetId: payload.assetId }, note)
        }
      }
    },
  })

  // --- publish-table-tokens --------------------------------------------------------------

  const tableTokens = defineJob<PublishTableTokensJob>({
    name: JOB_NAMES.publishTableTokens,
    options: {
      // One job waits and one runs per venue + set of retired tokens (core/jobs.ts), so two jobs
      // that must remove different tokens are both kept.
      policy: 'stately',
      queue: {
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
        expireInSeconds: 2 * 60,
        retentionSeconds: 10 * 60,
        deleteAfterSeconds: 60 * 60,
      },
      work: { pollingIntervalSeconds: 1 },
    },
    async handler(jobs, context) {
      for (const job of jobs) {
        const payload = parsePayload(PublishTableTokensJobSchema, job, JOB_NAMES.publishTableTokens)
        // A manager edits a table at a time, all night: no job run each time, only the log.
        const result = await writeTableTokenFiles(
          { pool: context.pool, store: deps.publishStore },
          payload,
        )
        context.log.info(
          { venueId: payload.venueId, retired: payload.retired.length, ...result },
          'table token files',
        )
      }
    },
  })

  return [publish, files, live, variants, tableTokens] as JobDefinition[]
}
