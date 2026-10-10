// Writers of `job_runs` (brief S2-03b): one row per run of a sync job, with its counters. Not the
// menu document, so no apply(); only this folder may import the write side of the database.
//
// What a run records: status, counters, and a short text for people (`error_summary`): why it
// failed, or what a completed run skipped ("deletion check skipped: 1 page failed") and which
// writes apply() refused. The text is scrubbed here, whoever calls: URLs (their query strings
// hold keys and ids) are removed, and it is cut to a fixed length. A run also gets structured
// `details` (its notes, one per line, and the refused writes as node / field / code) that the
// Integration tab reads; the text stays for runs recorded before `details` existed.

import { type DbPool, type JobRun, type JobRunDetails, jobRuns } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq } from 'drizzle-orm'

import { isId, newId } from '../ids'
import type { AbsenceHeld } from '../sync/absence-hold'
import type { ApplyRejection } from './apply'
import { ProvisionError } from './provision'

const KIND_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const MAX_SUMMARY_LENGTH = 2000
const MAX_REFUSED_REASONS = 5
/** At most this many notes and this many refused writes are kept in `details`. */
export const MAX_DETAIL_ENTRIES = 200

/** What `startJobRun` needs. */
export interface StartJobRunInput {
  /** `barsy_connect`, `barsy_full_pull`, … : lower-case with underscores. */
  readonly kind: string
  /** The integration the run belongs to, if any. */
  readonly integrationId?: string
  readonly startedAt?: Date
}

/** Opens a run (status `running`) and returns its `jb_` id, which the run's change sets carry. */
export async function startJobRun(
  pool: DbPool,
  tenantId: string,
  input: StartJobRunInput,
): Promise<JobRun> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!KIND_PATTERN.test(input.kind)) {
    throw new ProvisionError('invalid_input', 'a job kind is lower-case words joined by _')
  }
  if (input.integrationId !== undefined && !isId('in', input.integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [row] = await tx
      .insert(jobRuns)
      .values({
        id: newId('jb'),
        tenantId,
        integrationId: input.integrationId ?? null,
        kind: input.kind,
        status: 'running',
        startedAt: input.startedAt ?? new Date(),
      })
      .returning()
    if (!row) throw new ProvisionError('invalid_input', 'the job run was not created')
    return row
  })
}

/** How a run ended. */
export interface FinishJobRunInput {
  readonly status: 'completed' | 'failed'
  /** Whole numbers only (categories seen, created, updated, unchanged, missing, …). */
  readonly counters?: Readonly<Record<string, number>>
  /**
   * Why it failed, or what it skipped. Scrubbed and cut to 2000 characters; each line also
   * becomes a note in `details`.
   */
  readonly summary?: string
  /** More lines for `details.notes` (the summary's lines come first). */
  readonly notes?: readonly string[]
  /** The writes apply() refused, copied from its results (`ApplyResult.rejected`). */
  readonly refused?: readonly ApplyRejection[]
  /** True when a full pull did not conclude absence; written into `details` when given. */
  readonly deletionCheckSkipped?: boolean
  /**
   * Set when a complete full pull held its absence conclusion back (empty or sharply smaller read,
   * T62); written into `details.absence_held` as `{ reason, would_hide, active }`.
   */
  readonly absenceHeld?: AbsenceHeld
  readonly finishedAt?: Date
}

/** Removes what must never be stored: URLs (query strings, keys, user info) and control characters. */
export function scrubSummary(text: string): string {
  const clean = [...text.replace(/\bhttps?:\/\/\S+/gi, '[url]')]
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 && code !== 10 ? ' ' : char
    })
    .join('')
  return clean.length > MAX_SUMMARY_LENGTH ? `${clean.slice(0, MAX_SUMMARY_LENGTH - 3)}...` : clean
}

/** "3 writes refused: price_locked x2, unknown_link x1. First: …" */
export function describeRefused(refused: readonly ApplyRejection[]): string | null {
  if (refused.length === 0) return null
  const byCode = new Map<string, number>()
  for (const rejection of refused) byCode.set(rejection.code, (byCode.get(rejection.code) ?? 0) + 1)
  const codes = [...byCode].map(([code, count]) => `${code} x${count}`).join(', ')
  const reasons = refused
    .slice(0, MAX_REFUSED_REASONS)
    .map((rejection) => `${rejection.code}: ${rejection.reason}`)
    .join(' | ')
  return `${refused.length} write${refused.length === 1 ? '' : 's'} refused (${codes}). ${reasons}`
}

/** The structured record of a run: notes (one per line of text) and the refused writes. */
export function buildJobRunDetails(
  lines: readonly string[],
  refused: readonly ApplyRejection[],
): JobRunDetails {
  const notes = lines
    .flatMap((line) => line.split('\n'))
    .map((line) => scrubSummary(line).trim())
    .filter((line) => line !== '')
    .slice(0, MAX_DETAIL_ENTRIES)
  return {
    notes,
    refused: refused.slice(0, MAX_DETAIL_ENTRIES).map((rejection) => ({
      nodeRef: rejection.nodeRef ?? null,
      ...(rejection.fieldKey !== undefined ? { fieldKey: rejection.fieldKey } : {}),
      code: rejection.code,
    })),
  }
}

/**
 * Closes a run: status, counters, the text for people and the structured `details`. Refused
 * writes add `refused_writes` and `refused_<code>` counters and a line to the text. Returns the
 * row, or null when the tenant has no such run.
 */
export async function finishJobRun(
  pool: DbPool,
  tenantId: string,
  jobRunId: string,
  input: FinishJobRunInput,
): Promise<JobRun | null> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('jb', jobRunId)) throw new ProvisionError('invalid_input', 'jobRunId must be a jb_ id')
  const counters: Record<string, number> = {}
  for (const [name, value] of Object.entries(input.counters ?? {})) {
    if (!Number.isSafeInteger(value)) {
      throw new ProvisionError('invalid_input', `counter ${name} must be a whole number`)
    }
    counters[name] = value
  }
  const refused = input.refused ?? []
  if (refused.length > 0) {
    counters.refused_writes = (counters.refused_writes ?? 0) + refused.length
    for (const rejection of refused) {
      const name = `refused_${rejection.code}`
      counters[name] = (counters[name] ?? 0) + 1
    }
  }
  const lines = [input.summary, describeRefused(refused)].filter(
    (line): line is string => line !== undefined && line !== null && line !== '',
  )
  const summary = lines.length === 0 ? null : scrubSummary(lines.join('\n'))
  // The refused-writes line is in `details.refused` already; the notes are the rest.
  const details: JobRunDetails = {
    ...buildJobRunDetails(
      [...(input.summary ? [input.summary] : []), ...(input.notes ?? [])],
      refused,
    ),
    ...(input.deletionCheckSkipped !== undefined
      ? { deletionCheckSkipped: input.deletionCheckSkipped }
      : {}),
    ...(input.absenceHeld !== undefined
      ? {
          absence_held: {
            reason: input.absenceHeld.reason,
            would_hide: input.absenceHeld.wouldHide,
            active: input.absenceHeld.active,
          },
        }
      : {}),
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [row] = await tx
      .update(jobRuns)
      .set({
        status: input.status,
        counters,
        errorSummary: summary,
        details,
        finishedAt: input.finishedAt ?? new Date(),
      })
      .where(and(eq(jobRuns.id, jobRunId), eq(jobRuns.status, 'running')))
      .returning()
    return row ?? null
  })
}
