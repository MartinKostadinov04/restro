// Errors the sync raises on purpose. Their messages are written for people (they end up in the
// integration's status detail and in job runs), so they never hold a host's query string, a
// credential or a key.

export type SyncErrorCode =
  /** The tenant has no such integration (or it is not a barsy one). */
  | 'integration_not_found'
  /** The integration holds no credentials yet. */
  | 'no_credentials'
  /** The host is not allowed in this environment (rule 9). */
  | 'host_refused'
  /** The sealed credentials do not open (sealed for another key, host or integration). */
  | 'credentials_unreadable'
  /** The venue is not mapped to a barsy venue with a catalogue root. */
  | 'venue_not_mapped'
  /** Shutting down: the job stops early and is retried. */
  | 'aborted'

/** A failure that retrying will not fix; the job records it and ends without a retry. */
export class SyncError extends Error {
  override name = 'SyncError'
  readonly code: SyncErrorCode

  constructor(code: SyncErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}
