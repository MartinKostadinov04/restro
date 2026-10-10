// The sealing half: anyone with the worker's public key (the web app) can seal; nothing here can
// open. Node `crypto` only.

import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from 'node:crypto'

import {
  deriveKey,
  encodeEnvelope,
  keyId,
  MAX_PLAINTEXT_BYTES,
  NONCE_BYTES,
  parseDerKey,
  rawPublicKey,
  type SealContext,
  sealAad,
  TAG_BYTES,
} from './envelope'
import { SealError } from './errors'

const PUBLIC_KEY_FORMAT =
  'the seal public key must be base64url DER (SPKI) of an X25519 public key (pnpm keys:seal)'

/** Reads `SEAL_PUBLIC_KEY`: base64url DER (SPKI) of an X25519 public key. */
export function parseSealPublicKey(text: string): KeyObject {
  const key = parseDerKey(
    text,
    (der) => createPublicKey({ key: der, format: 'der', type: 'spki' }),
    PUBLIC_KEY_FORMAT,
  )
  if (key.type !== 'public') throw new SealError('invalid_key', PUBLIC_KEY_FORMAT)
  return key
}

/** A public key given as a KeyObject or as base64url DER (SPKI). Never a private key. */
function recipientKey(publicKey: KeyObject | string): KeyObject {
  if (typeof publicKey === 'string') return parseSealPublicKey(publicKey)
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'x25519') {
    throw new SealError('invalid_key', 'sealing takes an X25519 public key')
  }
  return publicKey
}

/**
 * Seals `plaintext` for the holder of the private key that belongs to `publicKey`, bound to
 * `context` (tenant, integration, host). Returns an `rs1.…` envelope; every call uses a new
 * ephemeral key and a new random nonce, so sealing the same text twice gives different envelopes.
 */
export function sealSecret(
  publicKey: KeyObject | string,
  plaintext: string,
  context: SealContext,
): string {
  const recipient = recipientKey(publicKey)
  const aad = sealAad(context)
  if (typeof plaintext !== 'string') throw new SealError('too_large', 'only text can be sealed')
  const message = Buffer.from(plaintext, 'utf8')
  if (message.length > MAX_PLAINTEXT_BYTES) {
    message.fill(0)
    throw new SealError('too_large', `at most ${MAX_PLAINTEXT_BYTES} bytes can be sealed`)
  }

  const recipientRaw = rawPublicKey(recipient)
  const ephemeral = generateKeyPairSync('x25519')
  const ephemeralRaw = rawPublicKey(ephemeral.publicKey)
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient })
  const key = deriveKey(shared, ephemeralRaw, recipientRaw)
  const nonce = randomBytes(NONCE_BYTES)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const sealed = Buffer.concat([cipher.update(message), cipher.final(), cipher.getAuthTag()])
    return encodeEnvelope({
      kid: keyId(recipientRaw),
      ephemeralPublic: ephemeralRaw,
      nonce,
      sealed,
    })
  } finally {
    shared.fill(0)
    key.fill(0)
    message.fill(0)
  }
}

/**
 * The key id an envelope sealed for `publicKey` carries (base64url): lets the web show which
 * worker key a stored secret was sealed for, without opening it.
 */
export function sealKeyId(publicKey: KeyObject | string): string {
  return keyId(rawPublicKey(recipientKey(publicKey))).toString('base64url')
}
