// When "Sync now" is allowed (brief S2-05, item 6): the person may manage the integration, it has
// credentials and has been checked (`connected`), the barsy venue and the catalogue root are
// chosen, and no connection check or full pull of the integration is queued or running (the
// queue is exclusive per integration: a second one would not be queued anyway).
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
  if (!input.venueMapped) return { enabled: false, reason: 'no_barsy_venue' }
  if (!input.rootChosen) return { enabled: false, reason: 'no_root' }
  if (input.activeJob === 'pull') return { enabled: false, reason: 'busy' }
  return { enabled: true }
}
