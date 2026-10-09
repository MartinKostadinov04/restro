// One tracked run of a sync job: a `job_runs` row from start to finish, and what a failure means.
//
//   - credentials barsy refuses (401/403): the integration goes to `error` with "Wrong user or
//     password"; the run fails and the job is NOT retried (retrying a wrong password only risks
//     locking the API user);
//   - a host this worker may not use, credentials that do not open, an integration without
//     credentials: the run fails with that reason and the job is not retried; the first two also
//     put the integration in `error`;
//   - anything else (a timeout, a server error, a database error): the run fails with a safe
//     summary of the error and the error is rethrown, so pg-boss retries per the queue's settings.
//
// A run's text never holds a URL with a query string, a credential or a key: error summaries come
// from `summarizeError` (no query parameters) and `finishJobRun` scrubs URLs again.

import { BarsyAuthError } from '@restro/barsy'
import {
  type ApplyRejection,
  finishJobRun,
  startJobRun,
  updateIntegration,
} from '@restro/core/apply'
import type { JobRun } from '@restro/db'

import { summarizeError } from '../errors'
import type { SyncEnvironment } from './context'
import { SyncError } from './errors'

/** What a job body reports when it finishes normally. */
export interface RunReport {
  readonly counters?: Record<string, number>
  /** Lines for the run's text (what was skipped, and why). */
  readonly notes?: readonly string[]
  readonly refused?: readonly ApplyRejection[]
  /** `failed` for a run that ended without doing its work but is not an error to retry. */
  readonly status?: 'completed' | 'failed'
}

/** The wording the Integration tab shows. */
export const WRONG_CREDENTIALS = 'Wrong user or password'

/** Why a run ended with a `SyncError`, in words for the Integration tab. */
function statusDetailFor(error: SyncError): string | null {
  switch (error.code) {
    case 'host_refused':
    case 'credentials_unreadable':
      return error.message
    default:
      return null
  }
}

export async function trackedRun(
  env: SyncEnvironment,
  target: { readonly tenantId: string; readonly integrationId: string; readonly kind: string },
  body: (run: JobRun) => Promise<RunReport | undefined>,
): Promise<void> {
  const { tenantId, integrationId } = target
  const run = await startJobRun(env.pool, tenantId, {
    kind: target.kind,
    integrationId,
    startedAt: env.now(),
  })
  const finish = async (status: 'completed' | 'failed', report: RunReport, summary?: string) => {
    try {
      await finishJobRun(env.pool, tenantId, run.id, {
        status,
        ...(report.counters ? { counters: report.counters } : {}),
        summary: [summary, ...(report.notes ?? [])].filter(Boolean).join('\n'),
        refused: report.refused ?? [],
        finishedAt: env.now(),
      })
    } catch (error) {
      // The original outcome matters more than a failure to write it down.
      env.log.error({ err: error, runId: run.id }, 'could not finish the job run')
    }
  }
  const markIntegration = async (detail: string) => {
    try {
      await updateIntegration(env.pool, tenantId, integrationId, {
        status: 'error',
        statusDetail: detail,
        lastCheckedAt: env.now(),
      })
    } catch (error) {
      env.log.error({ err: error, runId: run.id }, 'could not set the integration status')
    }
  }

  try {
    const report = (await body(run)) ?? {}
    await finish(report.status ?? 'completed', report)
  } catch (error) {
    if (error instanceof BarsyAuthError) {
      await markIntegration(WRONG_CREDENTIALS)
      await finish('failed', {}, `barsy refused the credentials (HTTP ${error.status})`)
      return
    }
    if (error instanceof SyncError && error.code !== 'aborted') {
      const detail = statusDetailFor(error)
      if (detail !== null) await markIntegration(detail)
      await finish('failed', {}, error.message)
      return
    }
    await finish('failed', {}, summarizeError(error))
    throw error
  }
}
