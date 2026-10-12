// A venue's state as the All venues card and the publisher see it (D86): Draft (never published,
// or unpublished), Live (its live menu is published), Archived (in the bin, D83). One function,
// pure, over the venue row's own columns and whether its live menu has a published version; every
// screen and job that says a state says this one.

/** The three states of D86. */
export type VenueState = 'draft' | 'live' | 'archived'

/** What the state is decided from: two venue columns and one fact about its live menu. */
export interface VenueStateFacts {
  /** `venues.archived_at`: set when the venue is in the bin. */
  readonly archivedAt: Date | string | null
  /** `venues.unpublished_at`: set when the owner withdrew the venue from guests (cleared by a publish). */
  readonly unpublishedAt: Date | string | null
  /** True when the venue's live menu (`venues.live_menu_id`) has a published version for it. */
  readonly livePublished: boolean
}

/**
 * The venue's state: archived beats everything; an unpublished venue is a draft whatever is
 * published; otherwise live when its live menu is published, else a draft.
 */
export function venueStateOf(facts: VenueStateFacts): VenueState {
  if (facts.archivedAt !== null) return 'archived'
  if (facts.unpublishedAt !== null) return 'draft'
  return facts.livePublished ? 'live' : 'draft'
}

/** True when guests may read the venue's files: it is live (D86). */
export function venueIsServed(facts: VenueStateFacts): boolean {
  return venueStateOf(facts) === 'live'
}
