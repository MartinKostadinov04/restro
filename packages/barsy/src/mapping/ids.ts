// Deterministic ids for the mapping. Same input must give the same change set (and the same source
// record ids), so node, change set and source record ids are derived from what they stand for
// instead of drawn at random:
//
//   - a node id hashes (kind, integration, barsy object), so a re-run names the same nodes and
//     apply() sees a createNode for a node that already exists as a no-op;
//   - a source record id hashes (integration, type, external id, scope, content hash), so the
//     same content is the same record and a changed object is a new version;
//   - a change set id hashes the job, the venue and the ops.
//
// The integration id is a random 128-bit id kept in the backend, so a derived id cannot be
// reversed to a barsy id without it (rule 3: barsy ids stay in the backend).

import { type Id, type IdKind, sha256Hex } from '@restro/core'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** 62^22 > 2^128: 22 base62 characters hold any 128-bit value, like `newId`. */
const BODY_LENGTH = 22
const SEPARATOR = '\u0000'

/** `kind_` + 22 base62 characters from the first 128 bits of SHA-256 over the parts. */
export function deriveId<K extends IdKind>(kind: K, ...parts: readonly string[]): Id<K> {
  const digest = sha256Hex(['restro:barsy-mapping:v1', kind, ...parts].join(SEPARATOR))
  let value = BigInt(`0x${digest.slice(0, 32)}`)
  let body = ''
  for (let i = 0; i < BODY_LENGTH; i++) {
    body = BASE62.charAt(Number(value % 62n)) + body
    value /= 62n
  }
  return `${kind}_${body}`
}
