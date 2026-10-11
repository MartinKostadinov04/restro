// What the Integration tab shows, as plain data. The server builds it (service.ts); the client
// components of src/integration/ render it. No secret is ever in it: not the sealed credentials
// (only whether there are some), not a password. Times are ISO strings; the components format
// them in the venue's time zone.

import type { AfterSyncMode, IncrementalMinutes, NewItemsMode } from '@restro/core'

/** `integrations.status`. */
export type IntegrationStatus = 'new' | 'connected' | 'error'

/** The background job of this integration that is queued or running, if any. */
export type ActiveJob = 'connect' | 'pull' | null

/** Why "Sync now" is switched off. */
export type SyncBlock =
  | 'not_manager'
  | 'no_credentials'
  | 'checking'
  | 'not_connected'
  | 'no_barsy_venue'
  | 'no_root'
  | 'busy'

/** The answer to "may a sync be started now?". */
export type SyncGate =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: SyncBlock }

/**
 * A barsy venue of the installation. `key` is what the picker sends back; it is never shown.
 * `address` and `publicMenuSetUp` are hints from the stored record of the venue (B1-Q6): present
 * only when the record says so, and never a reason to choose anything by itself.
 */
export interface BarsyVenueOption {
  readonly key: number
  readonly name: string
  /** Mapped to the venue whose tab this is. */
  readonly mappedHere: boolean
  /** Mapped to another venue of the organisation: the name of that venue. */
  readonly usedBy: string | null
  /** The venue's public address, if its record has one. */
  readonly address?: string
  /** The venue has a public menu set up in the till (its record names a public category). */
  readonly publicMenuSetUp?: true
}

/**
 * A category of the cached public tree. `id` is what the picker sends back; it is never shown.
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
  /** The characteristic key in barsy. Sent back by the picker, never shown. */
  readonly key: string
  readonly name: string
}

export interface MappingSettings {
  readonly priceSource: PriceSource
  /** The characteristic the manager chose, or null for automatic detection. */
  readonly allergenKey: string | null
  /** What automatic detection finds in the cached details tree, if anything. */
  readonly allergenDetected: AllergenOption | null
  readonly allergenOptions: readonly AllergenOption[]
  /** A key of the 11 barsy languages (`bg_BG`). */
  readonly defaultLocale: string
}

/**
 * The sync settings (D59) as the Synchronisation card shows them: `config.schedule` and
 * `config.publish` with the defaults filled in (core/sync-settings), and when the next syncs are
 * planned (core/sync-schedule).
 */
export interface SyncSettingsView {
  readonly incrementalEnabled: boolean
  readonly incrementalMinutes: IncrementalMinutes
  readonly fullPullEnabled: boolean
  /** `HH:mm` in the venue's time zone. */
  readonly fullPullTime: string
  readonly afterSync: AfterSyncMode
  readonly newItems: NewItemsMode
  /**
   * Scheduled syncs run only for a connected integration whose barsy venue and catalogue are
   * chosen. Until then the card says so instead of naming times.
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

/** The latest complete full pull of the integration, when it was held (nothing was hidden). */
export interface HeldSync extends AbsenceHeldView {
  /** When that pull finished (ISO). */
  readonly finishedAt: string | null
}

export interface RunView {
  readonly id: string
  /** `barsy_connect`, `barsy_full_pull`, `barsy_incremental`, … */
  readonly kind: string
  readonly status: 'queued' | 'running' | 'completed' | 'failed'
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

export interface IntegrationView {
  /** The person may change things (organisation owner or admin). */
  readonly canManage: boolean
  /** The web has a usable sealing key; without one credentials cannot be saved. */
  readonly sealReady: boolean
  /** The venue's IANA time zone. */
  readonly timeZone: string
  /** The venue's name, for messages. */
  readonly venueName: string
  readonly integration: IntegrationInfo | null
  readonly activeJob: ActiveJob
  readonly barsyVenues: readonly BarsyVenueOption[]
  /** The barsy venue mapped to this venue is known (the root picker can work). */
  readonly venueMapped: boolean
  /** The cached public category tree of the mapped barsy venue; null until a connection read it. */
  readonly tree: readonly CategoryNode[] | null
  readonly treeFetchedAt: string | null
  readonly rootCatId: number | null
  readonly settings: MappingSettings
  readonly syncSettings: SyncSettingsView
  /** The latest of the last full and the last incremental pull, from the sync state. */
  readonly lastSyncedAt: string | null
  /**
   * Set while the latest complete full pull is one that held its absence conclusion back: the menu
   * was left as it was and the manager should check the category and the venue. Null otherwise.
   * It comes from its own query, not from `runs`, since twenty later runs would push it out.
   */
  readonly heldSync: HeldSync | null
  readonly gate: SyncGate
  readonly runs: readonly RunView[]
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
  | 'barsy_venue_taken'
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
    }
  | { readonly ok: false; readonly error: IntegrationErrorCode }
