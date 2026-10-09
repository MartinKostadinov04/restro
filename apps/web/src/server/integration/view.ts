// What the Integration tab shows, as plain data. The server builds it (service.ts); the client
// components of src/integration/ render it. No secret is ever in it: not the sealed credentials
// (only whether there are some), not a password. Times are ISO strings; the components format
// them in the venue's time zone.

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

/** A barsy venue of the installation. `key` is what the picker sends back; it is never shown. */
export interface BarsyVenueOption {
  readonly key: number
  readonly name: string
  /** Mapped to the venue whose tab this is. */
  readonly mappedHere: boolean
  /** Mapped to another venue of the organisation: the name of that venue. */
  readonly usedBy: string | null
}

/** A category of the cached public tree. `id` is what the picker sends back; it is never shown. */
export interface CategoryNode {
  readonly id: number
  readonly name: string
  readonly children: readonly CategoryNode[]
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

/** One refused write of a run: the field (our key) and why. */
export interface RefusedWrite {
  readonly fieldKey: string | null
  readonly code: string
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
  /** The latest of the last full and the last incremental pull, from the sync state. */
  readonly lastSyncedAt: string | null
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
