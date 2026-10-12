// What Settings -> Integrations and a venue's Menu source card show, as plain data (adjustments
// I1 and I2, D81, D82). The server builds it (service.ts); the client components of
// src/integration/ render it. No secret is ever in it: not the sealed credentials (only whether
// there are some), not a password. Times are ISO strings; the components format them in a time
// zone they are given: the instance's for the screen, the venue's for the venue's card.
//
// Neutral: no system is named here. What a connector supplies (its system settings, the part of a
// venue's Menu source that is its own) arrives as kind-tagged data from `connectors/data.ts`.

import type { InstanceSettingsData, VenueSourceData } from '@/connectors/data'

/** `integrations.status`. */
export type IntegrationStatus = 'new' | 'connected' | 'error'

/** The background job of an instance that is queued or running, if any. */
export type ActiveJob = 'connect' | 'pull' | null

/** Why a sync is switched off. */
export type SyncBlock =
  | 'not_manager'
  | 'no_credentials'
  | 'checking'
  | 'not_connected'
  | 'no_till_venue'
  /** The system has not told us yet what to read for the venue (its menus). */
  | 'no_menu'
  | 'busy'

/** The answer to "may a sync be started now?". */
export type SyncGate =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: SyncBlock }

/** A venue of ours, as the lists name it. */
export interface VenueRef {
  readonly id: string
  readonly name: string
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
  /** The connector's name for the run (`<system>_full_pull`, …) or a neutral one (`places_read`). */
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

/** A system the organisation can choose, with how many instances of it exist. */
export interface SystemOption {
  /** The connector kind (`integrations.kind`); sent back by the picker. */
  readonly kind: string
  /** The connector's name for the system: what `{source}` stands for. */
  readonly label: string
  /** Instances of this system that are not removed. */
  readonly instances: number
}

/** One named instance of a system: a connection to one installation (D81). */
export interface InstanceView {
  /** The instance's `in_` id: sent back by the actions. */
  readonly id: string
  readonly kind: string
  /** The connector's name for the system (`{source}`). */
  readonly source: string
  /** What the owner calls this connection. */
  readonly name: string
  /** The stored host name (a host, not a secret). */
  readonly host: string
  /** Credentials are stored (sealed); their content never leaves the server. */
  readonly hasCredentials: boolean
  readonly status: IntegrationStatus
  readonly statusDetail: string | null
  readonly lastCheckedAt: string | null
  /** The instance's IANA time zone: the clock of its status and history. */
  readonly timeZone: string
  readonly activeJob: ActiveJob
  /** The live venues of ours that use this instance. */
  readonly venues: readonly VenueRef[]
  /** Complete full pulls that held their conclusion back, with the venue each concerns. */
  readonly heldSyncs: readonly HeldSyncOfVenue[]
  /** The gate of "Sync everything now". */
  readonly gate: SyncGate
  /** The runs of every venue of the instance, newest first. */
  readonly runs: readonly RunView[]
  /** The system settings card's data, supplied by the connector. */
  readonly settings: InstanceSettingsData
}

/** Settings -> Integrations: the chosen systems and their instances. */
export interface IntegrationsView {
  /** The person may change things (organisation owner or admin). */
  readonly canManage: boolean
  /** The web has a usable sealing key; without one credentials cannot be saved. */
  readonly sealReady: boolean
  /** Every system we support, in the connectors folder's order. */
  readonly systems: readonly SystemOption[]
  /** The kinds the organisation chose; each has a tab. */
  readonly chosen: readonly string[]
  /** The instances that are not removed, oldest first. */
  readonly instances: readonly InstanceView[]
}

/** What a venue's Menu source card shows: nothing for a hand-made venue, else the common part and the connector's. */
export type MenuSourceView = { readonly state: 'none' } | LinkedMenuSource

export interface LinkedMenuSource {
  readonly state: 'linked'
  readonly canManage: boolean
  /** The venue's time zone, for the last sync and its history. */
  readonly timeZone: string
  /** The connector's name for the system (`{source}`). */
  readonly source: string
  /** The instance this venue's menu comes from, by the name the owner gave it. */
  readonly instanceName: string
  /** The venue's own name in the system (read-only: a venue's source never changes, D87). */
  readonly tillVenueName: string
  /** The latest of the last full and the last incremental pull of this venue. */
  readonly lastSyncedAt: string | null
  /** The latest complete full pull of this venue held back its conclusion: look at the venue. */
  readonly heldSync: HeldSync | null
  readonly activeJob: ActiveJob
  readonly gate: SyncGate
  /** This venue's own runs, newest first. */
  readonly runs: readonly RunView[]
  /** The part the connector supplies. */
  readonly connector: VenueSourceData
}

/** What a server action answers. Never carries a password or a sealed value. */
export type IntegrationErrorCode =
  | 'not_allowed'
  | 'not_found'
  | 'invalid'
  | 'invalid_host'
  | 'sync_keys_missing'
  | 'host_in_use'
  /** The instance already serves venues or holds a menu: another installation's ids would land on it. */
  | 'host_change_blocked'
  /** A system with instances cannot be unselected. */
  | 'has_instances'
  /** An instance that venues link to cannot be removed. */
  | 'has_venues'
  /** An instance can only be added for a system the organisation chose. */
  | 'system_not_chosen'
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
      /** For adding an instance: the new instance. */
      readonly integrationId?: string
    }
  | { readonly ok: false; readonly error: IntegrationErrorCode }
