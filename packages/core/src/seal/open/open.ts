// The opening half: needs the worker's private key (`SEAL_PRIVATE_KEY`). Only apps/worker may
// import this folder (dependency-cruiser rule `seal-open-only-from-worker`).

import {
  createDecipheriv,
  createPrivateKey,
  diffieHellman,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto'

import { TABLE_TOKEN_PATTERN } from '../../guest-files'
import { type BarsyCredentials, BarsyCredentialsSchema } from '../credentials'
import {
  decodeEnvelope,
  deriveKey,
  type IntegrationSealContext,
  keyId,
  parseDerKey,
  publicKeyFromRaw,
  rawPublicKey,
  type SealContext,
  sealAad,
  TAG_BYTES,
} from '../envelope'
import { SealError } from '../errors'
import { STAFF_PIN_PATTERN } from '../staff-pin'

const PRIVATE_KEY_FORMAT =
  'the seal private key must be base64url DER (PKCS8) of an X25519 private key (pnpm keys:seal)'

/** Reads `SEAL_PRIVATE_KEY`: base64url DER (PKCS8) of an X25519 private key. */
export function parseSealPrivateKey(text: string): KeyObject {
  const key = parseDerKey(
    text,
    (der) => createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }),
    PRIVATE_KEY_FORMAT,
  )
  if (key.type !== 'private') throw new SealError('invalid_key', PRIVATE_KEY_FORMAT)
  return key
}

/** True if `privateKey` is the private half of `publicKey`. */
export function isSealKeyPair(publicKey: KeyObject, privateKey: KeyObject): boolean {
  return rawPublicKey(publicKey).equals(rawPublicKey(privateKey))
}

/**
 * A new key pair, each half base64url DER (`SEAL_PUBLIC_KEY`: SPKI, `SEAL_PRIVATE_KEY`: PKCS8).
 * For tests; operators use `pnpm keys:seal`, which writes the private key to a file and never
 * prints it.
 */
export function generateSealKeyPair(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('x25519')
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  }
}

/** A private key given as a KeyObject or as base64url DER (PKCS8). */
function ownKey(privateKey: KeyObject | string): KeyObject {
  if (typeof privateKey === 'string') return parseSealPrivateKey(privateKey)
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'x25519') {
    throw new SealError('invalid_key', 'opening takes an X25519 private key')
  }
  return privateKey
}

/**
 * Opens an `rs1` envelope sealed for this private key and this context. Throws `malformed` (not
 * an envelope), `wrong_key` (sealed for another key: the credentials must be entered again) or
 * `open_failed` (changed, or sealed for another tenant, integration or host).
 */
export function openSecret(
  privateKey: KeyObject | string,
  sealed: string,
  context: SealContext,
): string {
  const own = ownKey(privateKey)
  const aad = sealAad(context)
  const envelope = decodeEnvelope(sealed)
  const ownRaw = rawPublicKey(own)
  if (!envelope.kid.equals(keyId(ownRaw))) {
    throw new SealError(
      'wrong_key',
      'sealed for another key: connect the integration again to seal the credentials anew',
    )
  }
  const failed = () =>
    new SealError(
      'open_failed',
      'the sealed value does not open: changed, or sealed for another tenant, integration or host',
    )

  let shared: Buffer
  try {
    shared = diffieHellman({
      privateKey: own,
      publicKey: publicKeyFromRaw(envelope.ephemeralPublic),
    })
  } catch {
    throw failed()
  }
  // A low-order ephemeral key gives an all-zero secret: never derive a key from it.
  if (shared.every((byte) => byte === 0)) throw failed()
  const key = deriveKey(shared, envelope.ephemeralPublic, ownRaw)
  shared.fill(0)
  const ciphertext = envelope.sealed.subarray(0, envelope.sealed.length - TAG_BYTES)
  const tag = envelope.sealed.subarray(envelope.sealed.length - TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce, {
      authTagLength: TAG_BYTES,
    })
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    const message = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const text = message.toString('utf8')
    message.fill(0)
    return text
  } catch {
    throw failed()
  } finally {
    key.fill(0)
  }
}

/** Opens sealed barsy credentials and checks their shape (Zod); never puts a value in an error. */
export function openBarsyCredentials(
  sealed: string,
  context: IntegrationSealContext & { readonly privateKey: KeyObject | string },
): BarsyCredentials {
  const text = openSecret(context.privateKey, sealed, context)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new SealError('invalid_payload', 'the sealed value is not barsy credentials')
  }
  const parsed = BarsyCredentialsSchema.safeParse(json)
  if (!parsed.success) {
    throw new SealError('invalid_payload', 'the sealed value is not barsy credentials')
  }
  return parsed.data
}

/**
 * Opens a table's sealed code (D122 §9) for the worker's reveal endpoint and checks its shape;
 * never puts the value in an error. `openSecret`'s errors otherwise: `open_failed` for an envelope
 * sealed for another table or tenant.
 */
export function openTableCode(
  privateKey: KeyObject | string,
  sealed: string,
  context: { readonly tenantId: string; readonly tableId: string },
): string {
  const code = openSecret(privateKey, sealed, { purpose: 'table_code', ...context })
  if (!TABLE_TOKEN_PATTERN.test(code)) {
    throw new SealError('invalid_payload', 'the sealed value is not a table code')
  }
  return code
}

/**
 * Opens a staff member's sealed PIN (D122 §7) for the worker's reveal endpoint and checks its
 * shape; never puts the value in an error. `open_failed` for an envelope sealed for another
 * person or tenant.
 */
export function openStaffPin(
  privateKey: KeyObject | string,
  sealed: string,
  context: { readonly tenantId: string; readonly staffMemberId: string },
): string {
  const pin = openSecret(privateKey, sealed, { purpose: 'staff_pin', ...context })
  if (!STAFF_PIN_PATTERN.test(pin)) {
    throw new SealError('invalid_payload', 'the sealed value is not a PIN')
  }
  return pin
}
