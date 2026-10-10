// Small pure helpers of the Integration tab's components: how long a run took, which counters
// to list, and whether a run skipped its deletion check.
import type { RunView } from '@/server/integration/view'

/** The counters a run's row lists, in this order, when the run has them. */
export const COUNTER_KEYS = [
  'articles_seen',
  'categories_seen',
  'created',
  'updated',
  'unchanged',
  'missing',
  'deleted',
  'reactivated',
  'failed_pages',
  'refused_writes',
  'items_held',
  'venues',
  'languages',
] as const

export type CounterKey = (typeof COUNTER_KEYS)[number]

/** The counters of a run that the tab knows how to label, in display order. */
export function listedCounters(
  counters: RunView['counters'],
): { key: CounterKey; value: number }[] {
  return COUNTER_KEYS.flatMap((key) => {
    const value = counters[key]
    return typeof value === 'number' ? [{ key, value }] : []
  })
}

/** Milliseconds between start and finish, or null while the run has not finished. */
export function runDurationMs(run: Pick<RunView, 'startedAt' | 'finishedAt'>): number | null {
  if (run.startedAt === null || run.finishedAt === null) return null
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt)
  return Number.isFinite(ms) ? Math.max(0, ms) : null
}

/** A duration split for the message "{minutes} min {seconds} s" (minutes 0 means seconds only). */
export function splitDuration(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000))
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

/**
 * The sync records `deletionCheckSkipped` in the run's details when it did not conclude absence
 * (rule 6: a failed page, or several mapped venues). Runs recorded before the flag are matched by
 * the text "deletion check skipped: …": in the notes, or in the error summary of a run without
 * details.
 */
export function deletionCheckSkipped(run: Pick<RunView, 'details' | 'errorSummary'>): boolean {
  const details = run.details
  if (details !== null && details.deletionCheckSkipped !== undefined) {
    return details.deletionCheckSkipped === true
  }
  const pattern = /deletion check skipped/i
  if (details !== null) return details.notes.some((note) => pattern.test(note))
  return run.errorSummary !== null && pattern.test(run.errorSummary)
}

/** The kinds the history labels; anything else is "Other". */
export const KNOWN_RUN_KINDS = ['barsy_connect', 'barsy_full_pull', 'barsy_incremental'] as const

export function isKnownRunKind(kind: string): kind is (typeof KNOWN_RUN_KINDS)[number] {
  return (KNOWN_RUN_KINDS as readonly string[]).includes(kind)
}

/** The refusal codes the history explains in words; others are shown as "Refused" plus the code. */
export const KNOWN_REFUSAL_CODES = [
  'less_cautious',
  'layer_not_allowed',
  'unknown_field',
  'not_linked',
  'unknown_node',
  'unknown_link',
  'link_taken',
  'already_linked',
] as const

export function isKnownRefusalCode(code: string): code is (typeof KNOWN_REFUSAL_CODES)[number] {
  return (KNOWN_REFUSAL_CODES as readonly string[]).includes(code)
}
