// Rule 6 as a pure function: what a full pull concludes about the source links it did not see
// (doc "The full pull, per venue", step 8; "Link lifecycle"; "Failure modes and guarantees").
// Absence means deletion only after a complete full pull. A pull with any failed page concludes
// nothing about absence; being seen is positive evidence, so it may still bring a link back.
//
// No I/O, no clock: the caller passes `now` and the links as stored, and turns the result into
// `setLinkState` ops for apply().

import type { LinkStateName } from '../change-set'

/** How long a link stays `missing` before a complete pull concludes it is `deleted`. */
export const MISSING_TO_DELETED_AFTER_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** One stored link, by the caller's key (for example `<externalType>:<externalId>`). */
export interface PulledLink {
  readonly key: string
  readonly state: LinkStateName
  /** `source_links.state_changed_at`: when the link entered its current state. */
  readonly stateChangedAt: Date
}

/** What one full pull saw. */
export interface FullPullEvidence {
  /** One entry per page (or call) of the pull: true when it succeeded. */
  readonly pagesOk: readonly boolean[]
  /** The keys of every object the pull saw and mapped. */
  readonly seen: ReadonlySet<string>
  /** Every link of the integration that the pull covers, as stored. Keys are unique. */
  readonly links: readonly PulledLink[]
  /** Keys the source itself reports as deleted (barsy `delete_flag`). */
  readonly deletedSeen: ReadonlySet<string>
  readonly now: Date
  /** Default `MISSING_TO_DELETED_AFTER_DAYS` (7). */
  readonly missingToDeletedAfterDays?: number
}

/** One link to move, and where to. */
export interface LinkChange {
  readonly key: string
  readonly to: LinkStateName
}

/** The conclusion of a full pull: whether it was complete, and the moves, sorted by key. */
export interface FullPullConclusion {
  /** True only when the pull had at least one page and every page succeeded. */
  readonly complete: boolean
  readonly changes: readonly LinkChange[]
}

/**
 * Decides the link moves a full pull justifies (rule 6).
 *
 * Complete pull (at least one page, every page ok):
 * - reported deleted by the source (`deletedSeen`) → `deleted`;
 * - seen, and `missing` or `deleted` → `active`;
 * - absent and `active` → `missing`;
 * - absent and `missing` for at least `missingToDeletedAfterDays` → `deleted`.
 *
 * Incomplete pull (no pages, or any failed page): no link moves to `missing` or `deleted` at all;
 * seen links that are `missing` or `deleted` still return to `active`.
 *
 * Keys in `seen` or `deletedSeen` without a stored link are ignored (apply() creates new links).
 * The output is sorted by key and does not depend on the order of any input. Throws a
 * `TypeError` (a caller bug, so the pull concludes nothing) for a duplicate link key, a key both
 * seen and reported deleted (the mapper's `active` and `deleted` intents never overlap), or an
 * invalid `now` / day count.
 */
export function concludeFullPull(evidence: FullPullEvidence): FullPullConclusion {
  const days = evidence.missingToDeletedAfterDays ?? MISSING_TO_DELETED_AFTER_DAYS
  if (!Number.isFinite(days) || days <= 0) {
    throw new TypeError('missingToDeletedAfterDays must be a positive number')
  }
  const now = evidence.now.getTime()
  if (!Number.isFinite(now)) throw new TypeError('now must be a valid date')
  for (const key of evidence.deletedSeen) {
    if (evidence.seen.has(key)) {
      throw new TypeError(`key ${key} is both seen and reported deleted in one pull`)
    }
  }

  const complete = evidence.pagesOk.length > 0 && evidence.pagesOk.every((ok) => ok === true)
  const keys = new Set<string>()
  const changes: LinkChange[] = []
  for (const link of evidence.links) {
    if (keys.has(link.key)) throw new TypeError(`link key ${link.key} appears twice`)
    keys.add(link.key)
    const to = complete
      ? afterCompletePull(link, evidence, now, days)
      : afterIncompletePull(link, evidence)
    if (to !== link.state) changes.push({ key: link.key, to })
  }
  changes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { complete, changes }
}

function afterCompletePull(
  link: PulledLink,
  evidence: FullPullEvidence,
  now: number,
  days: number,
): LinkStateName {
  if (evidence.deletedSeen.has(link.key)) return 'deleted'
  if (evidence.seen.has(link.key)) return 'active'
  if (link.state === 'active') return 'missing'
  if (link.state === 'missing' && now - link.stateChangedAt.getTime() >= days * DAY_MS) {
    return 'deleted'
  }
  return link.state
}

function afterIncompletePull(link: PulledLink, evidence: FullPullEvidence): LinkStateName {
  return evidence.seen.has(link.key) ? 'active' : link.state
}
