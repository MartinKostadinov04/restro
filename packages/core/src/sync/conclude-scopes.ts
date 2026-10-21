// Rule 6 for several venues on one till account (brief CF-16, T71, D73), as a pure function: what
// one venue's full pull may conclude about absence, per catalogue and per venue.
//
// A till keeps its items in catalogues that venues can share; every venue shows the part of its
// catalogue under its own menu category ("root"). So a full pull of one venue reads the WHOLE
// catalogue in that venue's context, and concludes:
//   - per catalogue: an item link of THIS catalogue that the read did not list goes `missing`
//     (then `deleted` after the grace period), exactly as `concludeFullPull` says. An item the
//     catalogue still lists is never concluded absent, whichever venue's root holds it; an item
//     of another catalogue (or of none we know) is never touched;
//   - per venue: the venue's own section links go `missing` / `deleted` from the read of its root,
//     and an item its menu shows that its root no longer holds is hidden in this venue only.
// The option groups and options of a combo follow their combo: they are concluded when this pull
// mapped the combo (it read the combo's options) or the combo is gone from the catalogue.
//
// The CF-02 holds (`absenceHold`, T62) apply per catalogue and per venue: an empty read, or one
// that would hide more than 30% (and at least 5) of the active items, concludes nothing for that
// scope and says why. A catalogue hold also holds the venue (its read is the suspect one); a
// venue hold leaves the catalogue's conclusion alone. An incomplete pull concludes nothing at all.
//
// The only outputs are moves to `missing` or `deleted` and hides in one venue: this never brings
// anything back, never shows anything and never touches a price (rule 5). Things seen come back
// through the pull's own "seen" marks, not through here.
//
// No I/O, no clock.

import { type AbsenceHeld, absenceHold } from './absence-hold'
import { concludeFullPull, type LinkChange, type PulledLink } from './conclude-full-pull'

/** A stored link, as the scoped conclusion needs it. */
export interface ScopedLink extends PulledLink {
  /** `source_links.last_seen_at`: when a run last saw the object. */
  readonly lastSeenAt: Date
}

/** A stored item link, with the catalogue its current source record says it is in. */
export interface CatalogueItemLink extends ScopedLink {
  /** Null when unknown (no record names one): such a link is never concluded per catalogue. */
  readonly catalogueId: number | null
}

/** A link that belongs to an item: an option group or an option of a combo. */
export interface ChildLink extends ScopedLink {
  /** The key of the item it belongs to. */
  readonly parentKey: string
}

/** The whole catalogue this pull read. */
export interface CatalogueRead {
  readonly catalogueId: number
  /** Every item link of the integration, as stored, with its catalogue. */
  readonly items: readonly CatalogueItemLink[]
  /** Keys of the items the read listed. */
  readonly seen: ReadonlySet<string>
  /** Keys of the items the read listed as deleted by the source. */
  readonly deletedSeen: ReadonlySet<string>
}

/** What this pull read of the venue: its root. */
export interface VenueRead {
  /** The venue's section links (sections in its menu), as stored. */
  readonly sections: readonly ScopedLink[]
  /** Keys of the sections the read of the root listed. */
  readonly sectionsSeen: ReadonlySet<string>
  /** Item keys the venue's menu shows now: placed in its sections, link active, not hidden here. */
  readonly shown: ReadonlySet<string>
  /** Item keys the venue's root holds in this read. */
  readonly inRoot: ReadonlySet<string>
}

export interface ScopedPullEvidence {
  /** One entry per page (or call) of the pull: true when it succeeded. */
  readonly pagesOk: readonly boolean[]
  readonly now: Date
  /** When the pull started: a link seen after it was seen by another run, so it is left alone. */
  readonly start: Date
  /** The whole catalogue the pull read; null when it read only the venue's root (none known). */
  readonly catalogue: CatalogueRead | null
  readonly venue: VenueRead
  /** Every option group and option link of the integration, as stored. */
  readonly children: readonly ChildLink[]
  /** Keys of the option groups and options this pull read. */
  readonly childrenSeen: ReadonlySet<string>
  /** Default `MISSING_TO_DELETED_AFTER_DAYS` (7). */
  readonly missingToDeletedAfterDays?: number
}

/** A held conclusion: for which scope, about what, why and how much. */
export interface ScopedHold extends AbsenceHeld {
  readonly scope: 'catalogue' | 'venue'
  readonly what: 'items' | 'sections'
}

export interface ScopedConclusion {
  /** True only when the pull had at least one page and every page succeeded. */
  readonly complete: boolean
  /** Moves of item, option and section links to `missing` or `deleted`, sorted by key. */
  readonly moves: readonly LinkChange[]
  /** Item keys to hide in this venue only, sorted. */
  readonly venueHides: readonly string[]
  /** The holds that stopped a conclusion (the catalogue's first). */
  readonly held: readonly ScopedHold[]
  /** Moves left out because another run saw the link after this pull started. */
  readonly raced: number
}

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

const NOTHING: Omit<ScopedConclusion, 'complete'> = {
  moves: [],
  venueHides: [],
  held: [],
  raced: 0,
}

/**
 * The absence moves of a list of links: `concludeFullPull`, revivals left out (they ride on the
 * pull's seen marks), and the race guard applied.
 */
function absenceMoves(
  evidence: ScopedPullEvidence,
  links: readonly ScopedLink[],
  seen: ReadonlySet<string>,
  deletedSeen: ReadonlySet<string>,
): { moves: LinkChange[]; raced: number } {
  const conclusion = concludeFullPull({
    pagesOk: evidence.pagesOk,
    seen,
    deletedSeen,
    links,
    now: evidence.now,
    ...(evidence.missingToDeletedAfterDays === undefined
      ? {}
      : { missingToDeletedAfterDays: evidence.missingToDeletedAfterDays }),
  })
  const stored = new Map(links.map((link) => [link.key, link]))
  const moves: LinkChange[] = []
  let raced = 0
  for (const change of conclusion.changes) {
    if (change.to === 'active') continue
    const link = stored.get(change.key)
    if (link === undefined) continue
    if (link.lastSeenAt.getTime() > evidence.start.getTime()) {
      raced += 1
      continue
    }
    moves.push(change)
  }
  return { moves, raced }
}

const activeCount = (links: readonly ScopedLink[]) =>
  links.filter((link) => link.state === 'active').length
const missingCount = (moves: readonly LinkChange[]) =>
  moves.filter((move) => move.to === 'missing').length

/**
 * Decides what one venue's full pull concludes about absence (see the header). Throws a
 * `TypeError` for inconsistent input (a key both seen and reported deleted, a duplicate link key,
 * an invalid date): a caller bug, so the pull concludes nothing.
 */
export function concludeVenuePull(evidence: ScopedPullEvidence): ScopedConclusion {
  const complete = evidence.pagesOk.length > 0 && evidence.pagesOk.every((ok) => ok === true)
  if (!complete) return { complete, ...NOTHING }
  if (!Number.isFinite(evidence.start.getTime())) throw new TypeError('start must be a valid date')

  const held: ScopedHold[] = []
  let raced = 0

  // Per catalogue.
  const itemMoves: LinkChange[] = []
  /** Items the catalogue no longer lists: their link handles them, the venue does not hide them. */
  const gone = new Set<string>()
  const { catalogue } = evidence
  if (catalogue !== null) {
    const own = catalogue.items.filter((link) => link.catalogueId === catalogue.catalogueId)
    const result = absenceMoves(evidence, own, catalogue.seen, catalogue.deletedSeen)
    raced += result.raced
    const active = activeCount(own)
    const wouldHide = missingCount(result.moves)
    const verdict = absenceHold({
      activeBefore: active,
      seen: catalogue.seen.size,
      wouldGoMissing: wouldHide,
    })
    if (verdict.hold) {
      held.push({ scope: 'catalogue', what: 'items', reason: verdict.reason, wouldHide, active })
      return { complete, moves: [], venueHides: [], held, raced }
    }
    itemMoves.push(...result.moves)
    for (const link of own) {
      if (!catalogue.seen.has(link.key)) gone.add(link.key)
    }
  }

  // Option groups and options: those of a combo this pull mapped, or of one that is gone.
  const { venue } = evidence
  const children = evidence.children.filter(
    (link) => venue.inRoot.has(link.parentKey) || gone.has(link.parentKey),
  )
  const childResult = absenceMoves(evidence, children, evidence.childrenSeen, new Set())
  raced += childResult.raced

  // Per venue: its sections, and the items its root no longer holds.
  const sectionResult = absenceMoves(evidence, venue.sections, venue.sectionsSeen, new Set())
  const hides = [...venue.shown]
    .filter((key) => !venue.inRoot.has(key) && !gone.has(key))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const itemsVerdict = absenceHold({
    activeBefore: venue.shown.size,
    seen: venue.inRoot.size,
    wouldGoMissing: hides.length,
  })
  const sectionsActive = activeCount(venue.sections)
  const sectionsWouldHide = missingCount(sectionResult.moves)
  const sectionsVerdict = absenceHold({
    activeBefore: sectionsActive,
    seen: venue.sectionsSeen.size,
    wouldGoMissing: sectionsWouldHide,
  })
  let venueMoves: LinkChange[] = sectionResult.moves
  let venueHides: string[] = hides
  if (itemsVerdict.hold) {
    held.push({
      scope: 'venue',
      what: 'items',
      reason: itemsVerdict.reason,
      wouldHide: hides.length,
      active: venue.shown.size,
    })
    venueMoves = []
    venueHides = []
  } else if (sectionsVerdict.hold && sectionsVerdict.reason === 'empty_read') {
    // Sections hold only for an empty read: a menu may lose several sections at once.
    held.push({
      scope: 'venue',
      what: 'sections',
      reason: 'empty_read',
      wouldHide: sectionsWouldHide,
      active: sectionsActive,
    })
    venueMoves = []
    venueHides = []
  } else {
    raced += sectionResult.raced
  }

  const moves = [...itemMoves, ...childResult.moves, ...venueMoves].sort(byKey)
  return { complete, moves, venueHides, held, raced }
}
