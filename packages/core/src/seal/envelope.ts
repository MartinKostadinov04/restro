// The sealed-envelope format `rs1` (brief S2-03a; D55: the web seals barsy credentials with the
// worker's public key, only the worker can open them). Shared by both halves; nothing here
// touches a private key.
//
//   X25519 ephemeral ECDH with the recipient's public key
//   → HKDF-SHA256 (salt = ephemeral public key ‖ recipient public key, info `restro-seal-v1`)
//   → AES-256-GCM, random 12-byte nonce, 16-byte tag,
//     AAD `restro-seal-v1|<tenantId>|<integrationId>|<host>` (credentials) or
//         `restro-seal-v1|table_code|<tenantId>|<tableId>` (a table's code, D122 §9) or
//         `restro-seal-v1|staff_pin|<tenantId>|<staffMemberId>` (a staff member's PIN, D122 §7)
//
//   envelope = `rs1.<kid>.<ephPub>.<nonce>.<ciphertext‖tag>`, each part base64url (no padding)
//   kid      = the first 8 bytes of SHA-256(recipient public key)
//
// Public keys are the raw 32-byte X25519 values inside the hash, the salt and the envelope. The
// AAD binds the envelope to one tenant, one integration and one host: copied anywhere else, or
// left behind after the host changes, it fails to open, so the worker never sends credentials
// to a host they were not sealed for.

import { createHash, createPublicKey, hkdfSync, type KeyObject } from 'node:crypto'

import { isId } from '../ids'
import { SealError } from './errors'

/** The envelope's version tag (its first part). */
export const SEAL_VERSION = 'rs1'

/** HKDF info and the first element of the AAD. */
export const SEAL_INFO = 'restro-seal-v1'

/** The longest plaintext `sealSecret` accepts (credentials are a few hundred bytes). */
export const MAX_PLAINTEXT_BYTES = 64 * 1024

const KID_BYTES = 8
const PUBLIC_KEY_BYTES = 32
export const NONCE_BYTES = 12
export const TAG_BYTES = 16
const BASE64URL = /^[A-Za-z0-9_-]*$/
/** A bare host name, optionally with a port: what `integrations.host` holds. */
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/

/** What an integration's sealed credentials are bound to (its AAD). */
export interface IntegrationSealContext {
  /** Our tenant id (`tn_…`). */
  readonly tenantId: string
  /** Our integration id (`in_…`). */
  readonly integrationId: string
  /** The installation's host, as stored on the integration (`demo.barsyonline.com`). */
  readonly host: string
}

/**
 * What a table's sealed code is bound to (D122 §9): the tenant and the table. Copied onto another
 * table, the envelope does not open, so a code can never be shown as another table's.
 */
export interface TableCodeSealContext {
  readonly purpose: 'table_code'
  /** Our tenant id (`tn_…`). */
  readonly tenantId: string
  /** Our table id (`tb_…`). */
  readonly tableId: string
}

/**
 * What a staff member's sealed PIN is bound to (D122 §7; decision log 4.8): the tenant and the
 * person. Copied onto another person, the envelope does not open.
 */
export interface StaffPinSealContext {
  readonly purpose: 'staff_pin'
  /** Our tenant id (`tn_…`). */
  readonly tenantId: string
  /** Our staff member id (`sm_…`). */
  readonly staffMemberId: string
}

/** What an envelope is bound to (its AAD). */
export type SealContext = IntegrationSealContext | TableCodeSealContext | StaffPinSealContext

/**
 * The AAD for a context: `restro-seal-v1|<tenantId>|<integrationId>|<host>` (the host in lower
 * case) for credentials, `restro-seal-v1|table_code|<tenantId>|<tableId>` for a table's code and
 * `restro-seal-v1|staff_pin|<tenantId>|<staffMemberId>` for a PIN. The second part tells them
 * apart: a tenant id always starts with `tn_`. Throws `invalid_context` for a malformed part, so
 * no separator can be smuggled in.
 */
export function sealAad(context: SealContext): string {
  if (!isId('tn', context.tenantId)) {
    throw new SealError('invalid_context', 'the seal context needs a tn_ tenant id')
  }
  if ('purpose' in context && context.purpose === 'staff_pin') {
    if (!isId('sm', context.staffMemberId)) {
      throw new SealError(
        'invalid_context',
        'the seal context of a PIN needs an sm_ staff member id',
      )
    }
    return `${SEAL_INFO}|staff_pin|${context.tenantId}|${context.staffMemberId}`
  }
  if ('purpose' in context) {
    if (context.purpose !== 'table_code' || !isId('tb', context.tableId)) {
      throw new SealError(
        'invalid_context',
        'the seal context of a table code needs a tb_ table id',
      )
    }
    return `${SEAL_INFO}|table_code|${context.tenantId}|${context.tableId}`
  }
  const host = typeof context.host === 'string' ? context.host.trim().toLowerCase() : ''
  if (!isId('in', context.integrationId)) {
    throw new SealError('invalid_context', 'the seal context needs an in_ integration id')
  }
  if (!HOST.test(host)) {
    throw new SealError('invalid_context', 'the seal context needs a bare host name')
  }
  return `${SEAL_INFO}|${context.tenantId}|${context.integrationId}|${host}`
}

/** The raw 32-byte X25519 public key of a public key, or of the public half of a private key. */
export function rawPublicKey(key: KeyObject): Buffer {
  const publicKey = key.type === 'public' ? key : createPublicKey(key)
  const jwk = publicKey.export({ format: 'jwk' })
  const raw = typeof jwk.x === 'string' ? Buffer.from(jwk.x, 'base64url') : Buffer.alloc(0)
  if (publicKey.asymmetricKeyType !== 'x25519' || raw.length !== PUBLIC_KEY_BYTES) {
    throw new SealError('invalid_key', 'the key is not an X25519 key')
  }
  return raw
}

/** A public KeyObject from a raw 32-byte X25519 value. */
export function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') },
    format: 'jwk',
  })
}

/** The key id: the first 8 bytes of SHA-256 of the recipient's raw public key. */
export function keyId(recipientPublicRaw: Buffer): Buffer {
  return createHash('sha256').update(recipientPublicRaw).digest().subarray(0, KID_BYTES)
}

/** The AES-256-GCM key: HKDF-SHA256 over the shared secret, salted with both public keys. */
export function deriveKey(shared: Buffer, ephemeralRaw: Buffer, recipientRaw: Buffer): Buffer {
  const salt = Buffer.concat([ephemeralRaw, recipientRaw])
  return Buffer.from(hkdfSync('sha256', shared, salt, SEAL_INFO, 32))
}

/** Strict base64url: only the URL alphabet, no padding, and the canonical encoding of its bytes. */
function decodePart(part: string): Buffer | null {
  if (!BASE64URL.test(part)) return null
  const bytes = Buffer.from(part, 'base64url')
  return bytes.toString('base64url') === part ? bytes : null
}

/** The parts of an envelope. */
export interface Envelope {
  readonly kid: Buffer
  readonly ephemeralPublic: Buffer
  readonly nonce: Buffer
  /** Ciphertext followed by the 16-byte tag. */
  readonly sealed: Buffer
}

/** Joins the parts into `rs1.<kid>.<ephPub>.<nonce>.<ciphertext‖tag>`. */
export function encodeEnvelope(envelope: Envelope): string {
  return [
    SEAL_VERSION,
    envelope.kid.toString('base64url'),
    envelope.ephemeralPublic.toString('base64url'),
    envelope.nonce.toString('base64url'),
    envelope.sealed.toString('base64url'),
  ].join('.')
}

/** Splits an envelope; throws `malformed` for anything that is not exactly an `rs1` envelope. */
export function decodeEnvelope(text: unknown): Envelope {
  const malformed = () => new SealError('malformed', 'this is not a sealed rs1 envelope')
  if (typeof text !== 'string' || text.length > 4 * MAX_PLAINTEXT_BYTES) throw malformed()
  const parts = text.split('.')
  if (parts.length !== 5 || parts[0] !== SEAL_VERSION) throw malformed()
  const [kid, ephemeralPublic, nonce, sealed] = parts.slice(1).map(decodePart)
  if (
    !kid ||
    kid.length !== KID_BYTES ||
    !ephemeralPublic ||
    ephemeralPublic.length !== PUBLIC_KEY_BYTES ||
    !nonce ||
    nonce.length !== NONCE_BYTES ||
    !sealed ||
    sealed.length < TAG_BYTES
  ) {
    throw malformed()
  }
  return { kid, ephemeralPublic, nonce, sealed }
}

/** Reads a base64url DER key with `read`; any failure is `invalid_key` with the fixed `message`. */
export function parseDerKey(
  text: unknown,
  read: (der: Buffer) => KeyObject,
  message: string,
): KeyObject {
  const der = typeof text === 'string' ? decodePart(text.trim()) : null
  if (!der || der.length === 0) throw new SealError('invalid_key', message)
  let key: KeyObject
  try {
    key = read(der)
  } catch {
    throw new SealError('invalid_key', message)
  }
  if (key.asymmetricKeyType !== 'x25519') throw new SealError('invalid_key', message)
  return key
}
