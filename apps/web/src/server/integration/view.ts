// What Settings -> Integrations and a venue's Menu source card show, as plain data (CF-09b, D73).
// The server builds it (service.ts); the client components of src/integration/ render it. No
// secret is ever in it: not the sealed credentials (only whether there are some), not a password.
// Times are ISO strings; the components format them in a time zone they are given: the
// integration's for the page, the venue's for the venue's card.

import type { IncrementalMinutes } from '@restro/core'

/** `integrations.status`. */
export type IntegrationStatus = 'new' | 'connected' | 'error'

/** The background job of this integration that is queued or running, if any. */
export type ActiveJob = 'connect' | 'pull' | null

/** Why a sync is switched off. */
export type SyncBlock =
  | 'not_manager'
  | 'no_credentials'
  | 'checking'
  | 'not_connected'
  | 'no_till_venue'
  | 'no_root'
  | 'busy'

/** The answer to "may a sync be started now?". */
export type SyncGate =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: SyncBlock }

/** A venue of ours, as the pickers and the list name it. */
export interface VenueRef {
  readonly id: string
  readonly name: string
}

/** What a till venue is for us: serving one of our venues, free to be given one, or set aside. */
export type TillVenueState = 'linked' | 'unlinked' | 'not_used'

/**
 * A venue of the installation as the list shows it. `key` is what the actions get back; it is
 * never shown. `address` and `publicMenuSetUp` are hints from the stored record of the venue
 * (B1-Q6): present only when the record says so, and never a reason to choose anything by itself.
 */
export interface TillVenueRow {
  readonly key: number
  readonly name: string
  readonly state: TillVenueState
  /** The venue of ours this one serves (state `linked`). */
  readonly venue: VenueRef | null
  /** A linked venue has chosen the menu category its menu is read from. */
  readonly hasMenuCategory: boolean
  /** The venue's public address, if its record has one. */
  readonly address?: string
  /** The venue has a public menu set up in the till (its record names a public category). */
  readonly publicMenuSetUp?: true
}

/**
 * A category of the cached public tree. `id` is what the picker sends back; it is never drawn.
 * `suggested` marks the category the venue's record names as its public menu (B1-Q6): a hint,
 * nothing is chosen for the manager.
 */
export interface CategoryNode {
  readonly id: number
  readonly name: string
  readonly children: readonly CategoryNode[]
  readonly suggested?: true
}

export type PriceSource = 'actual_price' | 'current_price'

export interface AllergenOption {
  /** The characteristic key in the till. Sent back by the picker, never shown. */
  readonly key: string
  readonly name: string
}

/** How the till's data is read for the whole installation (the price is per venue, D73). */
export interface MappingSettings {
  /** The characteristic the manager chose, or null for automatic detection. */
  readonly allergenKey: string | null
  /** What automatic detection finds in the cached details tree, if anything. */
  readonly allergenDetected: AllergenOption | null
  readonly allergenOptions: readonly AllergenOption[]
  /** A key of the 11 languages (`bg_BG`). */
  readonly defaultLocale: string
}

/**
 * The automatic sync (D59, D73): `config.schedule` with the defaults filled in
 * (core/sync-settings), and when the next syncs are planned (core/sync-schedule). One schedule
 * for the whole installation, in the integration's time zone.
 */
export interface SyncSettingsView {
  readonly incrementalEnabled: boolean
  readonly incrementalMinutes: IncrementalMinutes
  readonly fullPullEnabled: boolean
  /** `HH:mm` in the integration's time zone. */
  readonly fullPullTime: string
  /**
   * Scheduled syncs run only for a connected integration with a linked venue that has a menu
   * category. Until then the card says so instead of naming times.
   */
  readonly scheduleActive: boolean
  /** About when the next change check starts (ISO); null when they are off or nothing is scheduled. */
  readonly nextIncrementalAt: string | null
  /** When the next full pull starts (ISO); null when it is off or nothing is scheduled. */
  readonly nextFullPullAt: string | null
}

/** One refused write of a run: the field (our key) and why. */
export interface RefusedWrite {
  readonly fieldKey: string | null
  readonly code: string
}

/** A complete full pull that held its absence conclusion back (T62): why, and how much. */
export interface AbsenceHeldView {
  readonly reason: 'empty_read' | 'too_many_missing'
  /** How many items the pull would have hidden. */
  readonly wouldHide: number
  /** How many items were on the menu before the pull. */
  readonly active: number
}

/** The latest complete full pull of a venue, when it was held (nothing was hidden). */
export interface HeldSync extends AbsenceHeldView {
  /** When that pull finished (ISO). */
  readonly finishedAt: string | null
}

/** A held pull and the venue it concerns (null: a run recorded before runs named their venue). */
export interface HeldSyncOfVenue extends HeldSync {
  readonly venue: VenueRef | null
}

export interface RunView {
  readonly id: string
  /** `barsy_connect`, `barsy_full_pull`, `barsy_incremental`, … */
  readonly kind: string
  readonly status: 'queued' | 'running' | 'completed' | 'failed'
  /** The venue of ours the run was for; null for a connection check and for older runs. */
  readonly venue: VenueRef | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly counters: Readonly<Record<string, number>>
  /** The text of the run; the notes below replace it when the run has structured details. */
  readonly errorSummary: string | null
  /** Null on runs recorded before structured details existed. */
  readonly details: {
    readonly notes: readonly string[]
    readonly refused: readonly RefusedWrite[]
    /** Set on runs recorded since the flag existed; absent on older runs. */
    readonly deletionCheckSkipped?: boolean
    /** Set when this complete full pull held its absence conclusion back. */
    readonly absenceHeld?: AbsenceHeldView
  } | null
}

export interface IntegrationInfo {
  /** The stored host name (a host, not a secret). */
  readonly host: string
  /** Credentials are stored (sealed); their content never leaves the server. */
  readonly hasCredentials: boolean
  readonly status: IntegrationStatus
  readonly statusDetail: string | null
  readonly lastCheckedAt: string | null
}

/** Settings -> Integrations: the organisation's one connection and everything set once for it. */
export interface IntegrationView {
  /** The person may change things (organisation owner or admin). */
  readonly canManage: boolean
  /** The web has a usable sealing key; without one credentials cannot be saved. */
  readonly sealReady: boolean
  /** The integration's IANA time zone: the clock of the schedule and of the page. */
  readonly timeZone: string
  readonly integration: IntegrationInfo | null
  readonly activeJob: ActiveJob
  /** Every venue the installation lists, by name, each with its state. */
  readonly tillVenues: readonly TillVenueRow[]
  /** Venues of ours that serve no till venue yet: what "Link to an existing venue" offers. */
  readonly linkableVenues: readonly VenueRef[]
  /** Complete full pulls that held their conclusion back, with the venue each concerns. */
  readonly heldSyncs: readonly HeldSyncOfVenue[]
  readonly mapping: MappingSettings
  readonly syncSettings: SyncSettingsView
  /** The gate of "Sync everything now". */
  readonly gate: SyncGate
  /** The runs of every venue of the installation, newest first. */
  readonly runs: readonly RunView[]
}

/** What a venue's Menu source card shows, in its three cases (CF-09b, D73). */
export type MenuSourceView =
  /** No integration exists yet: a sentence and a link to Settings -> Integrations. */
  | { readonly state: 'no_integration'; readonly canManage: boolean }
  /** An integration exists and this venue has no till venue: offer the ones without a venue. */
  | {
      readonly state: 'unlinked'
      readonly canManage: boolean
      readonly options: readonly TillVenueOption[]
    }
  | LinkedMenuSource

/** A till venue a venue can be given or moved to. */
export interface TillVenueOption {
  readonly key: number
  readonly name: string
  /** Serves another venue of ours: the name of that venue (it cannot be chosen). */
  readonly usedBy: string | null
  /** Set aside as "Not used"; choosing it takes the mark off. */
  readonly notUsed: boolean
  readonly address?: string
  readonly publicMenuSetUp?: true
}

export interface LinkedMenuSource {
  readonly state: 'linked'
  readonly canManage: boolean
  /** The venue's time zone, for the last sync. */
  readonly timeZone: string
  /** The till venue it serves (read-only here; "Change…" is deliberate). */
  readonly tillVenueName: string
  /** The other till venues, for "Change…". */
  readonly options: readonly TillVenueOption[]
  /** The cached public category tree of the till venue; null until a connection read it. */
  readonly tree: readonly CategoryNode[] | null
  readonly treeFetchedAt: string | null
  readonly rootCatId: number | null
  /** Which price the menu shows; the venue's own, else the integration's old default. */
  readonly priceSource: PriceSource
  /** The latest of the last full and the last incremental pull of this venue. */
  readonly lastSyncedAt: string | null
  /** The latest complete full pull of this venue held back its conclusion: look at the category. */
  readonly heldSync: HeldSync | null
  readonly activeJob: ActiveJob
  readonly gate: SyncGate
}

/** What a server action answers. Never carries a password or a sealed value. */
export type IntegrationErrorCode =
  | 'not_allowed'
  | 'not_found'
  | 'invalid'
  | 'invalid_host'
  | 'sync_keys_missing'
  | 'host_in_use'
  /** The connection already holds a menu: another installation's ids would land on its items. */
  | 'host_change_blocked'
  /** The till venue serves another venue of ours already. */
  | 'till_venue_taken'
  /** The venue serves a till venue already ("Link to an existing venue" only takes a free one). */
  | 'venue_already_linked'
  /** A till venue that serves a venue cannot be set aside as "Not used". */
  | 'till_venue_linked'
  | 'not_ready'
  | 'already_running'
  /** The job queue could not be reached (the worker's queue tables are not there, or the database is down). */
  | 'queue_unavailable'
  | 'failed'

export type IntegrationActionResult =
  | {
      readonly ok: true
      /** For saving credentials and re-checking: the connection check is in the queue. */
      readonly queued?: boolean
      /** For "Sync everything now": how many pulls were put in the queue. */
      readonly pulls?: number
      /** For "Add as venue": the new venue, which the person is then sent to. */
      readonly venueId?: string
    }
  | { readonly ok: false; readonly error: IntegrationErrorCode }
