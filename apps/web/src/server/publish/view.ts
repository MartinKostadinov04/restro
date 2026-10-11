// What the Publish tab shows, as plain data (brief S3-05). The server component reads it in one go
// (load.ts) and hands it to the cards; nothing here is a secret, and nothing is a barsy id (rule 3):
// only our `nd_` / `sn_` ids. Names stay as the document's `localized_text` and the browser picks
// the language, so the words on screen follow the interface language and the menu's own text
// comes from the menu.
//
// Pure, apart from the types: also imported by the client components (types only) and tested alone.

import type { AfterSyncMode, DiffArea, LocalizedText, Money, NewItemsMode } from '@restro/core'

/** Who did it, without ever carrying an id: a person (named when we still know them), the sync, or the system. */
export type ActorView =
  | { readonly kind: 'person'; readonly name: string | null }
  | { readonly kind: 'sync' }
  | { readonly kind: 'system' }

/** Why a version exists. */
export type VersionReason = 'manual' | 'auto_sync' | 'rollback'

export interface NamedItem {
  readonly id: string
  readonly name: LocalizedText
}

/** What differs between the live menu and the draft. */
export interface ChangesView {
  /** Items touched plus parts outside the items; 0 = nothing differs that the lists name. */
  readonly total: number
  /** The draft has exactly the live snapshot's content (same hash). */
  readonly identical: boolean
  readonly added: readonly NamedItem[]
  readonly hidden: readonly NamedItem[]
  readonly priceChanged: readonly (NamedItem & {
    readonly from: Money | null
    readonly to: Money | null
  })[]
  readonly renamed: readonly {
    readonly id: string
    readonly from: LocalizedText
    readonly to: LocalizedText
  }[]
  readonly otherChanged: readonly NamedItem[]
  readonly areas: readonly DiffArea[]
}

/** V12: an override whose barsy value has moved on, waiting for a person to look. */
export interface StaleView {
  readonly nodeId: string
  readonly fieldKey: string | null
  readonly name: LocalizedText | null
  /** The composer can open it (`?item=`). */
  readonly isItem: boolean
}

/** The draft: what a publish right now would put live, or why it could not be built. */
export type DraftView =
  | {
      readonly state: 'ready'
      readonly changes: ChangesView
      readonly staleOverrides: readonly StaleView[]
      readonly currency: string
    }
  /** V10: no item would be visible. */
  | { readonly state: 'nothing_visible' }
  /** Something blocks the whole menu (a missing language, template or root). */
  | { readonly state: 'blocked' }
  | { readonly state: 'unavailable' }

/** The version on guests' phones now. */
export interface LiveView {
  readonly version: number
  readonly publishedAt: string | null
  /** Why the version was published in the first place (never `rollback`: a rollback has no body). */
  readonly reason: 'manual' | 'auto_sync'
  readonly actor: ActorView
  /** Set when someone returned the menu to this version later on. */
  readonly returned: { readonly at: string; readonly actor: ActorView } | null
}

/** V11: an automatic publish waiting for a person. */
export interface HeldView {
  readonly snapshotId: string
  readonly hidden: number
  readonly previouslyVisible: number
  /** Whole percent of the live items it would hide. */
  readonly percent: number
  /** The items it would hide, by the names they have on the live menu. */
  readonly items: readonly NamedItem[]
  readonly at: string
  /** The menu has changed since the hold: approving it would be refused. */
  readonly outdated: boolean
}

/** What a version changed against the version before it. */
export interface VersionCounts {
  readonly total: number
  readonly added: number
  readonly hidden: number
  readonly priceChanged: number
  readonly renamed: number
  readonly otherChanged: number
  /** Parts outside the items that changed (the look, the sections, the texts). */
  readonly areas: number
}

export interface VersionEntry {
  readonly id: string
  readonly version: number
  readonly at: string
  readonly status: 'published' | 'held' | 'rejected'
  readonly reason: VersionReason
  readonly actor: ActorView
  /** A rollback row: the version the menu went back to. */
  readonly restoresVersion: number | null
  /** `superseded`: a held publish a later publish replaced. */
  readonly decisionNote: string | null
  /** A held row: what it would have hidden. */
  readonly held: { readonly hidden: number; readonly previouslyVisible: number } | null
  /** A published version with a body and an earlier version to compare with; null otherwise. */
  readonly counts: VersionCounts | null
  /** The first version has nothing before it to compare with. */
  readonly first: boolean
}

/**
 * Whether this entry is the version on guests' phones. The pointer never names a return row, and
 * version numbers are unique, so the number says it. Worked out from the live version (not stored
 * in the entry) so that older pages, loaded earlier, follow a return made since.
 */
export function isLiveEntry(entry: VersionEntry, liveVersion: number | null): boolean {
  return liveVersion !== null && entry.reason !== 'rollback' && entry.version === liveVersion
}

/** "Return to this version" is offered for a published version with a body that is not live. */
export function isReturnable(entry: VersionEntry, liveVersion: number | null): boolean {
  return (
    entry.status === 'published' && entry.reason !== 'rollback' && !isLiveEntry(entry, liveVersion)
  )
}

export interface HistoryPage {
  readonly entries: readonly VersionEntry[]
  /** Pass to load the next, older page; null on the last page. */
  readonly nextBeforeVersion: number | null
}

/** Why the publisher refused a run, as the tab words it. */
export type RefusalCode =
  | 'no_visible_items'
  | 'menu_blocked'
  | 'held_outdated'
  | 'held_not_found'
  | 'unsafe_snapshot'
  | 'other'

/** How the latest publish run ended. */
export interface PublishRunView {
  readonly id: string
  readonly state: 'running' | 'published' | 'unchanged' | 'held' | 'refused' | 'failed'
  /** The version a published or unchanged run ended at. */
  readonly version: number | null
  readonly refusal: RefusalCode | null
}

/** A job of this menu is queued or running: `publish` (a person's publish), `files` (after a return). */
export type BusyView = 'publish' | 'files' | null

/**
 * The venue's publishing rules (CF-09b, CF-04, D73): what happens after a sync of the till, and
 * what happens to the items the till adds. `inherited` is true while at least one of them is not
 * the venue's own yet and follows the integration's old setting; saving makes both the venue's.
 */
export interface PublishRulesView {
  readonly afterSync: AfterSyncMode
  readonly newItems: NewItemsMode
  readonly inherited: boolean
}

export interface PublishView {
  readonly venueId: string
  readonly venueSlug: string
  /** The venue's public code: with the slug it makes the guest page address (`menuPath`). */
  readonly venuePublicId: string
  readonly timeZone: string
  /** Owner or admin: may publish, approve, reject and return to a version. */
  readonly canPublish: boolean
  /** `none`: the venue has no menu yet, so there is nothing to publish. */
  readonly menu: 'ready' | 'none'
  readonly live: LiveView | null
  readonly draft: DraftView
  readonly held: HeldView | null
  /** Automatic publishing is paused after a return to an older version. */
  readonly paused: boolean
  /**
   * The guest address is out: the venue index `v/<code>.json` is in the published files and names
   * this venue. False only when something is published and that file is missing, which is how a
   * deleted and restored venue comes back (D76): its address is withdrawn until the owner
   * publishes. Then Publish stays on even when the menu is the same as the live one. True when
   * nothing is published yet, and when the files cannot be read (nothing then changes).
   */
  readonly addressServed: boolean
  /** The venue's publishing rules (the Rules card). */
  readonly rules: PublishRulesView
  readonly history: HistoryPage
  readonly busy: BusyView
  readonly lastRun: PublishRunView | null
}

// --- reading a publish run ---------------------------------------------------------------------

const REFUSALS: readonly RefusalCode[] = [
  'no_visible_items',
  'menu_blocked',
  'held_outdated',
  'held_not_found',
  'unsafe_snapshot',
]

/** The row of `job_runs` the view reads (a subset, so tests need not build the whole row). */
export interface PublishRunRow {
  readonly id: string
  readonly status: string
  readonly counters: Readonly<Record<string, number>>
  readonly errorSummary: string | null
}

/**
 * The outcome of a `publish_menu` run. The worker writes `counters.published = 1` for a publish,
 * `unchanged = 1` when the menu already was that version, `held = 1` for a hold (an automatic
 * publish only), and `publish refused: <code> (<checks>)` for a refusal.
 */
export function toPublishRunView(run: PublishRunRow): PublishRunView {
  const version = Number.isInteger(run.counters.snapshot_version)
    ? (run.counters.snapshot_version ?? null)
    : null
  if (run.status === 'queued' || run.status === 'running') {
    return { id: run.id, state: 'running', version: null, refusal: null }
  }
  if (run.status === 'completed') {
    if (run.counters.published === 1) {
      return { id: run.id, state: 'published', version, refusal: null }
    }
    if (run.counters.unchanged === 1) {
      return { id: run.id, state: 'unchanged', version, refusal: null }
    }
    // A hold (an automatic publish only): the pointer did not move.
    if (run.counters.held === 1) return { id: run.id, state: 'held', version, refusal: null }
    return { id: run.id, state: 'unchanged', version, refusal: null }
  }
  const code = /publish refused: ([a-z_]+)/.exec(run.errorSummary ?? '')?.[1]
  if (code !== undefined) {
    const refusal = REFUSALS.find((known) => known === code) ?? 'other'
    return { id: run.id, state: 'refused', version: null, refusal }
  }
  return { id: run.id, state: 'failed', version: null, refusal: null }
}

/** Whole percent, rounded half up; 0 when nothing was visible before. */
export function percentOf(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100)
}
