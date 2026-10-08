// Ids of Better Auth's rows. An organisation IS a tenant, so its id comes from core's
// `newId('tn')` (`tn_` + 22 base62 characters). Everything else Better Auth keeps for itself
// (users, sessions, ...) gets a random 32-character base62 id, like Better Auth's own default.
import { newId } from '@restro/core'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const AUTH_ID_LENGTH = 32
// 62 * 4 = 248: bytes at or above it are dropped, so every character is equally likely.
const LIMIT = 248

function randomBase62(length: number): string {
  let id = ''
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < LIMIT && id.length < length) id += BASE62[byte % 62]
    }
  }
  return id
}

/** The id for a new Better Auth row of the given model (`organization`, `user`, ...). */
export function authModelId(model: string): string {
  return model === 'organization' ? newId('tn') : randomBase62(AUTH_ID_LENGTH)
}
