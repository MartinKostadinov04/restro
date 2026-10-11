// When a sync may be started (brief S2-05 item 6, CF-09b): the person may manage the integration,
// it has credentials and has been checked (`connected`), and no connection check or pull is
// queued or running. "Sync this venue" (the venue's Menu source card) also needs the venue linked
// to a till venue with a menu category; "Sync everything now" (Settings -> Integrations) needs at
// least one such venue.
//
// Pure, so the page (to explain the button) and the server action (to refuse a forged request)
// ask the same question.
import type { ActiveJob, IntegrationStatus, SyncGate } from './view'

export interface SyncGateInput {
  readonly canManage: boolean
  /** Null when the venue has no integration yet. */
  readonly integration: {
    readonly hasCredentials: boolean
    readonly status: IntegrationStatus
  } | null
  /** The venue is mapped to one of the installation's venues. */
  readonly venueMapped: boolean
  readonly rootChosen: boolean
  readonly activeJob: ActiveJob
}

/** The first thing that stands in the way, in the order a manager would fix it. */
export function syncGate(input: SyncGateInput): SyncGate {
  if (!input.canManage) return { enabled: false, reason: 'not_manager' }
  if (!input.integration?.hasCredentials) return { enabled: false, reason: 'no_credentials' }
  if (input.activeJob === 'connect') return { enabled: false, reason: 'checking' }
  if (input.integration.status !== 'connected') return { enabled: false, reason: 'not_connected' }
  if (!input.venueMapped) return { enabled: false, reason: 'no_till_venue' }
  if (!input.rootChosen) return { enabled: false, reason: 'no_root' }
  if (input.activeJob === 'pull') return { enabled: false, reason: 'busy' }
  return { enabled: true }
}

export interface SyncAllGateInput {
  readonly canManage: boolean
  /** Null when the organisation has no integration yet. */
  readonly integration: {
    readonly hasCredentials: boolean
    readonly status: IntegrationStatus
  } | null
  /** How many venues of ours serve a till venue. */
  readonly linkedVenues: number
  /** How many of those have chosen their menu category (only those can be pulled). */
  readonly linkedWithCategory: number
  readonly activeJob: ActiveJob
}

/** The same question for "Sync everything now": one pull per linked venue with a menu category. */
export function syncAllGate(input: SyncAllGateInput): SyncGate {
  if (!input.canManage) return { enabled: false, reason: 'not_manager' }
  if (!input.integration?.hasCredentials) return { enabled: false, reason: 'no_credentials' }
  if (input.activeJob === 'connect') return { enabled: false, reason: 'checking' }
  if (input.integration.status !== 'connected') return { enabled: false, reason: 'not_connected' }
  if (input.linkedVenues === 0) return { enabled: false, reason: 'no_till_venue' }
  if (input.linkedWithCategory === 0) return { enabled: false, reason: 'no_root' }
  if (input.activeJob === 'pull') return { enabled: false, reason: 'busy' }
  return { enabled: true }
}
