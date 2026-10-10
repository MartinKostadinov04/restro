// SCRAM-SHA-256 password verifier in the format Postgres stores (RFC 5802 / RFC 7677):
//   SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>
// `ALTER ROLE ... PASSWORD '<verifier>'` stores it as is, so the plain password never reaches
// the server, its statement log or pg_stat_statements (what psql's \password does too).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

/** Postgres's default iteration count (scram_iterations). */
const DEFAULT_ITERATIONS = 4096

/**
 * Passwords are limited to printable ASCII without spaces: SASLprep (which Postgres applies)
 * leaves those unchanged, so this verifier matches what the server computes at login.
 */
const PASSWORD_PATTERN = /^[\x21-\x7e]+$/

/** Minimum length for the app role's password. */
export const MIN_PASSWORD_LENGTH = 16

/** Throws if the password is too short or has characters outside printable ASCII. */
export function assertUsablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`)
  }
  if (!PASSWORD_PATTERN.test(password)) {
    throw new Error('The password may only contain printable ASCII characters, without spaces.')
  }
}

/** Builds the stored SCRAM-SHA-256 verifier for `password`. */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations: number = DEFAULT_ITERATIONS,
): string {
  if (!PASSWORD_PATTERN.test(password)) {
    throw new Error('The password may only contain printable ASCII characters, without spaces.')
  }
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest()
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}
