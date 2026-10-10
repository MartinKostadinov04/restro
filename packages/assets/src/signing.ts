// Signed links to files of the local asset store. The link carries an expiry and an HMAC of the
// key and expiry, so a link cannot be edited to read another file or to live longer. The route
// that serves it still demands a signed-in person of the file's tenant: the signature is the
// "presigned" part, the session is the "authenticated route" part.
import { createHmac, timingSafeEqual } from 'node:crypto'

const LABEL = 'restro-local-asset-url-v1'

function signature(secret: string, key: string, expires: number): string {
  return createHmac('sha256', `${LABEL}\n${secret}`).update(`${key}\n${expires}`).digest('hex')
}

/** The `exp` (unix seconds) and `sig` query values for a key. */
export function signAssetLink(
  secret: string,
  key: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): { exp: number; sig: string } {
  const exp = Math.floor(nowMs / 1000) + Math.max(1, Math.floor(ttlSeconds))
  return { exp, sig: signature(secret, key, exp) }
}

/** True if `sig` is the signature of `key` and `exp`, and `exp` has not passed. */
export function verifyAssetLink(
  secret: string,
  key: string,
  exp: unknown,
  sig: unknown,
  nowMs = Date.now(),
): boolean {
  if (typeof exp !== 'string' || typeof sig !== 'string') return false
  if (!/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false
  const expires = Number(exp)
  if (expires * 1000 < nowMs) return false
  const expected = Buffer.from(signature(secret, key, expires), 'hex')
  return timingSafeEqual(expected, Buffer.from(sig, 'hex'))
}
