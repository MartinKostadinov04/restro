// The public code of a venue (D68, brief CF-14): 12 random characters of `a-z0-9` that find the
// venue's menu at `/m/<slug>-<code>`. It is the only part of the address that matters: the slug
// before it is a readable decoration that can change. The code never changes and says nothing
// about any internal id (rule 3): it comes from the system's random numbers, never from a `vn_`
// id. Pure (no I/O besides the random source), so the browser and the server share it.

/** How many characters a venue's public code has. */
export const PUBLIC_ID_LENGTH = 12

/** The characters of a public code. */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
/** 36 * 7: the largest multiple of the alphabet size that fits in a byte. Bytes at or above it are redrawn. */
const ACCEPT_BELOW = 252

/** A public code as the database and the files hold it: 12 characters of `a-z0-9`. */
export const PUBLIC_ID_PATTERN = /^[a-z0-9]{12}$/

/** True for a string that can be a venue's public code. */
export function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_ID_PATTERN.test(value)
}

/** Where random bytes come from; tests pass their own. */
export type RandomBytes = (length: number) => Uint8Array

const systemRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))

/**
 * A new public code. Every character comes from one random byte by rejection sampling: a byte of
 * 252 or more is thrown away, so the 36 characters are exactly equally likely (a plain
 * `byte % 36` would favour the first four). Uniqueness is the database's: a unique index decides,
 * and the caller draws again on the rare clash (about 4.7e18 codes exist).
 */
export function newPublicId(randomBytes: RandomBytes = systemRandomBytes): string {
  let code = ''
  while (code.length < PUBLIC_ID_LENGTH) {
    for (const byte of randomBytes(PUBLIC_ID_LENGTH * 2)) {
      if (byte >= ACCEPT_BELOW) continue
      code += ALPHABET[byte % ALPHABET.length]
      if (code.length === PUBLIC_ID_LENGTH) break
    }
  }
  return code
}
