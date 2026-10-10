// Errors of sealing and opening. Messages are fixed text: never a key, a plaintext, an envelope
// or any part of one, so a SealError is safe to log.

/** Why sealing or opening failed. */
export type SealErrorCode =
  /** A key is not base64url DER of an X25519 key of the expected kind (public SPKI / private PKCS8). */
  | 'invalid_key'
  /** The context (tenant, integration, host) is malformed. */
  | 'invalid_context'
  /** The plaintext is too large to seal. */
  | 'too_large'
  /** The text is not an `rs1` envelope (wrong shape, encoding or lengths). */
  | 'malformed'
  /** The envelope was sealed for another key pair (a rotated worker key): reconnect. */
  | 'wrong_key'
  /** Authentication failed: the envelope was changed, or sealed for another tenant, integration or host. */
  | 'open_failed'
  /** The envelope opened, but its content is not what the caller expects (e.g. barsy credentials). */
  | 'invalid_payload'

/** Thrown by every seal and open function. */
export class SealError extends Error {
  override name = 'SealError'
  readonly code: SealErrorCode

  constructor(code: SealErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
