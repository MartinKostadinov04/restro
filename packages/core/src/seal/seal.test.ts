// The sealing half on its own (what the web app can do): the envelope format, fresh randomness
// per seal, no plaintext in the envelope, strict contexts and keys. Opening is tested in
// ./open/open.test.ts, the only place outside apps/worker allowed to import it.
import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { newId } from '../ids'
import {
  MAX_PLAINTEXT_BYTES,
  parseSealPublicKey,
  type SealContext,
  SealError,
  sealAad,
  sealBarsyCredentials,
  sealKeyId,
  sealSecret,
} from './index'

const pair = generateKeyPairSync('x25519')
const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
const context: SealContext = {
  tenantId: newId('tn'),
  integrationId: newId('in'),
  host: 'demo.barsyonline.com',
}
const ENVELOPE = /^rs1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(SealError)
    return (error as SealError).code
  }
  return undefined
}

describe('sealSecret', () => {
  it('returns an rs1 envelope: kid (8 bytes), ephemeral key (32), nonce (12), ciphertext + tag', () => {
    const sealed = sealSecret(publicDer, 'hello', context)
    expect(sealed).toMatch(ENVELOPE)
    const [, kid, eph, nonce, body] = sealed.split('.')
    expect(Buffer.from(kid ?? '', 'base64url')).toHaveLength(8)
    expect(Buffer.from(eph ?? '', 'base64url')).toHaveLength(32)
    expect(Buffer.from(nonce ?? '', 'base64url')).toHaveLength(12)
    expect(Buffer.from(body ?? '', 'base64url')).toHaveLength(5 + 16)
    expect(kid).toBe(sealKeyId(publicDer))
    // A KeyObject works as well as its DER text.
    expect(sealSecret(pair.publicKey, 'hello', context)).toMatch(ENVELOPE)
  })

  it('uses a fresh nonce and a fresh ephemeral key for every seal (5000 seals)', () => {
    const nonces = new Set<string>()
    const ephemerals = new Set<string>()
    const key = parseSealPublicKey(publicDer)
    for (let i = 0; i < 5000; i += 1) {
      const [, , eph, nonce] = sealSecret(key, 'same text', context).split('.')
      nonces.add(nonce ?? '')
      ephemerals.add(eph ?? '')
    }
    expect(nonces.size).toBe(5000)
    expect(ephemerals.size).toBe(5000)
  })

  it('never contains the plaintext, in any common encoding', () => {
    const secret = 'barsy-password-Пароль-123!'
    const sealed = sealBarsyCredentials(
      { user: 'api-user', password: secret },
      { ...context, publicKey: publicDer },
    )
    for (const form of [
      secret,
      'api-user',
      Buffer.from(secret).toString('base64url'),
      Buffer.from(secret).toString('base64'),
      Buffer.from(secret).toString('hex'),
      Buffer.from(JSON.stringify({ user: 'api-user', password: secret })).toString('base64url'),
    ]) {
      expect(sealed).not.toContain(form)
    }
    expect(sealed).not.toContain(publicDer)
    expect(sealed).not.toContain(privateDer)
  })

  it('binds the AAD to tenant, integration and host, and refuses a malformed context', () => {
    expect(sealAad(context)).toBe(
      `restro-seal-v1|${context.tenantId}|${context.integrationId}|demo.barsyonline.com`,
    )
    expect(sealAad({ ...context, host: ' Demo.BarsyOnline.com ' })).toBe(sealAad(context))
    expect(sealAad({ ...context, host: 'localhost:8443' })).toContain('|localhost:8443')
    for (const bad of [
      { ...context, tenantId: 'tn_x|in_y' },
      { ...context, tenantId: context.integrationId },
      { ...context, integrationId: 'in_' },
      { ...context, host: '' },
      { ...context, host: 'demo.barsyonline.com|evil' },
      { ...context, host: 'https://demo.barsyonline.com' },
      { ...context, host: 'user@demo.barsyonline.com' },
      { ...context, host: 'demo.barsyonline.com/path' },
    ]) {
      expect(codeOf(() => sealSecret(publicDer, 'x', bad))).toBe('invalid_context')
    }
  })

  it('takes only an X25519 public key, and never echoes a bad key', () => {
    const ed = generateKeyPairSync('ed25519')
    const edDer = ed.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
    for (const bad of ['', 'not-a-key', `${publicDer}=`, `${publicDer}!`, edDer, privateDer]) {
      let message = ''
      try {
        sealSecret(bad, 'x', context)
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_key' })
        message = (error as Error).message
      }
      expect(message).not.toBe('')
      if (bad.length > 0) expect(message).not.toContain(bad)
    }
    expect(codeOf(() => sealSecret(pair.privateKey, 'x', context))).toBe('invalid_key')
    expect(codeOf(() => sealSecret(ed.publicKey, 'x', context))).toBe('invalid_key')
    expect(parseSealPublicKey(` ${publicDer} `).equals(pair.publicKey)).toBe(true)
  })

  it('refuses a plaintext over the limit', () => {
    expect(codeOf(() => sealSecret(publicDer, 'x'.repeat(MAX_PLAINTEXT_BYTES + 1), context))).toBe(
      'too_large',
    )
    expect(sealSecret(publicDer, 'x'.repeat(MAX_PLAINTEXT_BYTES), context)).toMatch(ENVELOPE)
  })

  it('checks barsy credentials before sealing, naming the field and never the value', () => {
    const sealedFor = { ...context, publicKey: publicDer }
    let message = ''
    try {
      sealBarsyCredentials({ user: 'secret-user-name', password: '' }, sealedFor)
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_payload' })
      message = (error as Error).message
    }
    expect(message).toContain('password')
    expect(message).not.toContain('secret-user-name')
    expect(
      codeOf(() =>
        sealBarsyCredentials({ user: 'u', password: 'p', extra: 1 } as never, sealedFor),
      ),
    ).toBe('invalid_payload')
  })
})
