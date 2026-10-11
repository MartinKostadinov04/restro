// Errors about a snapshot say where the problem is, never what the offending value was: a
// message that echoed it could carry the very external id or internal text the check refused
// (rule 3) into a log, a job run or the admin. Path segments that are not plainly ours (a
// schema key, a field key, one of our ids, an index) are redacted too, since a record key can
// itself be the leak.

import { ID_LIKE_PATTERN, type MenuSnapshot, MenuSnapshotSchema } from './schema'

/** Why a snapshot was refused. */
export type SnapshotErrorCode =
  /** The snapshot does not match `menu-snapshot/1` (an unknown key, a wrong id, a dangling id…). */
  | 'invalid_snapshot'
  /** A string in the snapshot equals a value the backend keeps to itself (leak guard). */
  | 'forbidden_value'

/** One refused place in a snapshot: its (redacted) path and what is wrong there. */
export interface SnapshotProblem {
  readonly path: string
  /** A Zod issue code, or the kind of forbidden value found (`external_id`, …). */
  readonly code: string
}

/** Thrown when a snapshot is malformed or would leak something; nothing is published. */
export class SnapshotError extends Error {
  override name = 'SnapshotError'
  readonly code: SnapshotErrorCode
  readonly problems: readonly SnapshotProblem[]

  constructor(code: SnapshotErrorCode, problems: readonly SnapshotProblem[]) {
    const shown = problems
      .slice(0, 10)
      .map((problem) => `${problem.path} (${problem.code})`)
      .join(', ')
    const more = problems.length > 10 ? ` and ${problems.length - 10} more` : ''
    super(`${code}: ${shown}${more}`)
    this.code = code
    this.problems = problems
  }
}

/** Schema keys and field keys (`snake_case`), and locale keys (`bg_BG`). */
const SAFE_KEY = /^(?:[a-z][a-z0-9_]{0,63}|[a-z]{2}_[A-Z]{2})$/

/**
 * A path as text (`items.nd_….fields.abv`, `[2]` for an index), with every segment that is not
 * plainly one of ours, or that is itself refused, replaced by `<key>`.
 */
export function snapshotPath(
  path: readonly PropertyKey[],
  refused: { has(value: string): boolean } = new Set<string>(),
): string {
  let text = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      text += `[${segment}]`
      continue
    }
    const key = String(segment)
    const safe = (SAFE_KEY.test(key) || ID_LIKE_PATTERN.test(key)) && !refused.has(key)
    text += `${text === '' ? '' : '.'}${safe ? key : '<key>'}`
  }
  return text === '' ? '(root)' : text
}

/** Strict parse of a snapshot; throws `SnapshotError('invalid_snapshot')` with safe paths. */
export function parseSnapshot(
  snapshot: unknown,
  refused?: { has(value: string): boolean },
): MenuSnapshot {
  const parsed = MenuSnapshotSchema.safeParse(snapshot)
  if (parsed.success) return parsed.data
  throw new SnapshotError(
    'invalid_snapshot',
    parsed.error.issues.map((issue) => ({
      path: snapshotPath(issue.path, refused),
      code: issue.code,
    })),
  )
}
