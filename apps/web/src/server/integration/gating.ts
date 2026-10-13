// When a sync may be started (adjustments I1, I2): the person may manage the integration, the
// instance has credentials and has been checked (`connected`), and no connection check or pull is
// queued or running. "Sync this venue" (the venue's Menu source card) also needs the venue linked
// to a venue of the system whose menus the system has reported; "Sync everything now" (the
// instance's tab) needs at least one such venue on the instance.
//
// Pure, so the page (to explain the button) and the server action (to refuse a forged request)
// ask the same question.
import type { ActiveJob, IntegrationStatus, SyncGate } from './view'

export interface SyncGateInput {
  readonly canManage: boolean
  /** Null when the venue has no instance. */
  readonly integration: {
    readonly hasCredentials: boolean
    readonly status: IntegrationStatus
  } | null
  /** The venue is linked to one of the installation's venues. */
  readonly venueLinked: boolean
  /** The system has reported what to read for the venue, so a pull can run. */
  readonly menuKnown: boolean
  readonly activeJob: ActiveJob
}

/** The first thing that stands in the way, in the order a manager would fix it. */
export function syncGate(input: SyncGateInput): SyncGate {
  if (!input.canManage) return { enabled: false, reason: 'not_manager' }
  if (!input.integration?.hasCredentials) return { enabled: false, reason: 'no_credentials' }
  if (input.activeJob === 'connect') return { enabled: false, reason: 'checking' }
  if (input.integration.status !== 'connected') return { enabled: false, reason: 'not_connected' }
  if (!input.venueLinked) return { enabled: false, reason: 'no_till_venue' }
  if (!input.menuKnown) return { enabled: false, reason: 'no_menu' }
  if (input.activeJob === 'pull') return { enabled: false, reason: 'busy' }
  return { enabled: true }
}

export interface SyncAllGateInput {
  readonly canManage: boolean
  /** Null when the instance does not exist. */
  readonly integration: {
    readonly hasCredentials: boolean
    readonly status: IntegrationStatus
  } | null
  /** How many venues of ours use the instance. */
  readonly linkedVenues: number
  /** How many of those the system has reported menus for (only those can be pulled). */
  readonly pullableVenues: number
  readonly activeJob: ActiveJob
}

/** The same question for "Sync everything now": one pull per linked venue the system can read. */
export function syncAllGate(input: SyncAllGateInput): SyncGate {
  if (!input.canManage) return { enabled: false, reason: 'not_manager' }
  if (!input.integration?.hasCredentials) return { enabled: false, reason: 'no_credentials' }
  if (input.activeJob === 'connect') return { enabled: false, reason: 'checking' }
  if (input.integration.status !== 'connected') return { enabled: false, reason: 'not_connected' }
  if (input.linkedVenues === 0) return { enabled: false, reason: 'no_till_venue' }
  if (input.pullableVenues === 0) return { enabled: false, reason: 'no_menu' }
  if (input.activeJob === 'pull') return { enabled: false, reason: 'busy' }
  return { enabled: true }
}
