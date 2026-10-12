// What the purge erases and when (D83, D96, D91; Martin's plan review of 10-12). Pure: the rules
// over dates and rows, which the worker's purge job (the only code that may delete, through the
// role `restro_purge`) applies and the admin's wording explains. Nothing here touches a database.
//
//   - A deleted venue (D76, `venues.archived_at`) is purged 30 days later, or at once on "Delete
//     permanently". A binned menu (D91, `menus.deleted_at`) and a deleted area or table of a
//     hand-made venue (D95, `archived_at`) go the same way after 30 days.
//   - Versions (D96): per menu and venue, the live version is never purged; of the earlier
//     published versions the newest two stay restorable while they are younger than 30 days;
//     every other row of the history (older restorable ones, held and rejected publishes, the
//     records of rollbacks) goes once it is 30 days old. A snapshot a kept rollback record points
//     to stays as long as that record does (the record is history; its target must exist).
//   - The change log (`events`) is kept 2 months.
//   - A purged venue's public code and table tokens are tombstoned: never reissued (D83). Its
//     address name may be used again inside its organisation.

/** Days a deleted venue stays restorable in the bin before the purge. */
export const VENUE_BIN_DAYS = 30
/** Days a binned menu stays restorable. */
export const MENU_BIN_DAYS = 30
/** Days a deleted area or table of a hand-made venue stays before the purge. */
export const TABLE_BIN_DAYS = 30
/** How many earlier published versions stay restorable besides the live one (D96). */
export const VERSIONS_KEPT = 2
/** Days after which any version other than the live one is purged (D96). */
export const VERSION_PURGE_DAYS = 30
/** Days the change log (`events`) is kept (D96: two months). */
export const CHANGE_LOG_DAYS = 61

const DAY_MS = 24 * 60 * 60 * 1000

/** The instant `days` before `now`: rows older than it are due. */
export function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/** True when something marked at `at` has waited `days` or more by `now`. */
export function isDue(at: Date | string | null, now: Date, days: number): boolean {
  if (at === null) return false
  const marked = typeof at === 'string' ? new Date(at) : at
  return marked.getTime() <= cutoff(now, days).getTime()
}

/** One row of a menu + venue's version history, as the rule needs it. */
export interface VersionRow {
  readonly id: string
  readonly version: number
  readonly status: 'published' | 'held' | 'rejected'
  readonly reason: 'manual' | 'auto_sync' | 'rollback'
  /** True when the row carries a menu body (a rollback record has none). */
  readonly hasBody: boolean
  /** A rollback record: the snapshot it restored. */
  readonly restoresSnapshotId: string | null
  /** When the row was made (`created_at`). */
  readonly createdAt: Date | string
}

/** What the versions rule decided for one menu + venue. */
export interface VersionsDecision {
  /** The snapshot ids to erase, oldest version first. */
  readonly purge: readonly string[]
  /** The ids kept: the live one, the restorable ones and what rollback records still point to. */
  readonly keep: readonly string[]
}

const at = (value: Date | string): number =>
  typeof value === 'string' ? Date.parse(value) : value.getTime()

/**
 * Which versions of one menu + venue go (D96; see the header). `currentSnapshotId` is what the
 * publish pointer names (null when nothing is published: then every row is only history and
 * goes by age). Deterministic and pure: the worker deletes exactly `purge`, oldest first, and the
 * admin can show what will go.
 */
export function versionsToPurge(input: {
  readonly now: Date
  readonly currentSnapshotId: string | null
  readonly rows: readonly VersionRow[]
}): VersionsDecision {
  const old = cutoff(input.now, VERSION_PURGE_DAYS).getTime()
  const rows = [...input.rows].sort((a, b) => b.version - a.version)
  const keep = new Set<string>()
  if (input.currentSnapshotId !== null) keep.add(input.currentSnapshotId)

  // The newest restorable versions besides the live one, while they are young enough.
  let restorable = 0
  for (const row of rows) {
    if (row.id === input.currentSnapshotId) continue
    if (row.status !== 'published' || !row.hasBody) continue
    if (restorable >= VERSIONS_KEPT) break
    if (at(row.createdAt) <= old) break
    keep.add(row.id)
    restorable += 1
  }
  // Every other row stays only while it is young.
  for (const row of rows) {
    if (keep.has(row.id)) continue
    if (at(row.createdAt) > old) keep.add(row.id)
  }
  // A kept rollback record needs its target.
  for (const row of rows) {
    if (keep.has(row.id) && row.restoresSnapshotId !== null) keep.add(row.restoresSnapshotId)
  }
  const purge = rows
    .filter((row) => !keep.has(row.id))
    .sort((a, b) => a.version - b.version)
    .map((row) => row.id)
  return { purge, keep: rows.filter((row) => keep.has(row.id)).map((row) => row.id) }
}

/** The two kinds of value a tombstone reserves forever (D83). */
export type TombstoneKind = 'public_code' | 'table_token'
