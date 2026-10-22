// Sealing and opening together (brief S2-03a): round trips, every tampered part fails, the AAD
// binds tenant, integration and host, another key fails with the kid error, and no error ever
// carries a key or a plaintext. This file sits inside seal/open/, the only folder outside
// apps/worker that may import the opening half.
import { createPublicKey, generateKeyPairSync } from 'node:crypto'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { newId } from '../../ids'
import {
  type SealContext,
  SealError,
  sealBarsyCredentials,
  sealSecret,
  sealStaffPin,
} from '../index'
import {
  generateSealKeyPair,
  isSealKeyPair,
  openBarsyCredentials,
  openSecret,
  openStaffPin,
  parseSealPrivateKey,
} from './index'

const keys = generateSealKeyPair()
const other = generateSealKeyPair()
const context: SealContext = {
  tenantId: newId('tn'),
  integrationId: newId('in'),
  host: 'demo.barsyonline.com',
}

/** The SealError a call throws (fails the test if it returns or throws something else). */
function errorOf(run: () => unknown): SealError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(SealError)
    return error as SealError
  }
  throw new Error('expected a SealError')
}

describe('openSecret', () => {
  it('opens what sealSecret sealed, for KeyObjects and DER text alike', () => {
    const text = 'Здравей, barsy! 🍸 "quotes" \\ and \n newlines'
    const sealed = sealSecret(keys.publicKey, text, context)
    expect(openSecret(keys.privateKey, sealed, context)).toBe(text)
    const privateKey = parseSealPrivateKey(keys.privateKey)
    expect(openSecret(privateKey, sealed, context)).toBe(text)
    expect(openSecret(privateKey, sealSecret(keys.publicKey, '', context), context)).toBe('')
    // The host is compared case-insensitively, as DNS does.
    expect(openSecret(privateKey, sealed, { ...context, host: 'DEMO.barsyonline.com' })).toBe(text)
  })

  it('round-trips any text (fast-check)', () => {
    const privateKey = parseSealPrivateKey(keys.privateKey)
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 300 }), (text) => {
        expect(openSecret(privateKey, sealSecret(keys.publicKey, text, context), context)).toBe(
          text,
        )
      }),
      { numRuns: 200 },
    )
  })

  it('fails for a tampered byte in any part of the envelope', () => {
    const sealed = sealSecret(keys.publicKey, 'the password', context)
    const parts = sealed.split('.')
    // Flip one bit of each decoded byte of every part after the version.
    for (let part = 1; part < parts.length; part += 1) {
      const bytes = Buffer.from(parts[part] ?? '', 'base64url')
      for (let index = 0; index < bytes.length; index += 1) {
        const changed = Buffer.from(bytes)
        changed[index] = (changed[index] ?? 0) ^ 0x01
        const copy = [...parts]
        copy[part] = changed.toString('base64url')
        const error = errorOf(() => openSecret(keys.privateKey, copy.join('.'), context))
        expect(['malformed', 'wrong_key', 'open_failed']).toContain(error.code)
        // A changed kid is "another key"; any other change fails authentication.
        if (part === 1) expect(error.code).toBe('wrong_key')
        if (part > 1) expect(error.code).toBe('open_failed')
      }
    }
  })

  it('fails for any changed character of the envelope text, including the version and padding bits', () => {
    const sealed = sealSecret(keys.publicKey, 'pw', context)
    for (let index = 0; index < sealed.length; index += 1) {
      const original = sealed[index]
      const replacement = original === '.' ? 'A' : original === 'A' ? 'B' : 'A'
      const changed = `${sealed.slice(0, index)}${replacement}${sealed.slice(index + 1)}`
      errorOf(() => openSecret(keys.privateKey, changed, context))
    }
    for (const broken of [
      '',
      'rs1',
      sealed.replace(/^rs1/, 'rs2'),
      `${sealed}.`,
      `${sealed}=`,
      sealed.split('.').slice(0, 4).join('.'),
      sealed.replaceAll('-', '+'),
    ]) {
      if (broken === sealed) continue
      expect(['malformed', 'open_failed']).toContain(
        errorOf(() => openSecret(keys.privateKey, broken, context)).code,
      )
    }
    expect(errorOf(() => openSecret(keys.privateKey, 42 as never, context)).code).toBe('malformed')
  })

  it('fails when tenant, integration or host differ from what it was sealed for', () => {
    const sealed = sealSecret(keys.publicKey, 'pw', context)
    for (const elsewhere of [
      { ...context, tenantId: newId('tn') },
      { ...context, integrationId: newId('in') },
      { ...context, host: 'other.barsyonline.com' },
      { ...context, host: 'demo.barsyonline.com:443' },
    ]) {
      expect(errorOf(() => openSecret(keys.privateKey, sealed, elsewhere)).code).toBe('open_failed')
    }
  })

  it('fails with the kid error for another private key (a rotated worker key)', () => {
    const sealed = sealSecret(keys.publicKey, 'pw', context)
    const error = errorOf(() => openSecret(other.privateKey, sealed, context))
    expect(error.code).toBe('wrong_key')
    expect(error.message).toMatch(/another key/)
  })

  it('refuses a low-order ephemeral key (all-zero shared secret)', () => {
    const sealed = sealSecret(keys.publicKey, 'pw', context).split('.')
    // The X25519 point of order 1 (u = 0).
    sealed[2] = Buffer.alloc(32).toString('base64url')
    expect(errorOf(() => openSecret(keys.privateKey, sealed.join('.'), context)).code).toBe(
      'open_failed',
    )
  })

  it('takes only an X25519 private key, and no error repeats a key or a plaintext', () => {
    const plaintext = 'very-secret-plaintext'
    const sealed = sealSecret(keys.publicKey, plaintext, context)
    const ed = generateKeyPairSync('ed25519')
    const edDer = ed.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
    const messages: string[] = []
    for (const bad of ['', 'nope', keys.publicKey, edDer, `${keys.privateKey}=`]) {
      const error = errorOf(() => openSecret(bad, sealed, context))
      expect(error.code).toBe('invalid_key')
      messages.push(error.message)
    }
    messages.push(errorOf(() => openSecret(other.privateKey, sealed, context)).message)
    messages.push(
      errorOf(() => openSecret(keys.privateKey, sealed, { ...context, host: 'x.example' })).message,
    )
    for (const message of messages) {
      for (const secret of [plaintext, keys.privateKey, other.privateKey, keys.publicKey, sealed]) {
        expect(message).not.toContain(secret)
      }
    }
  })
})

describe('key helpers', () => {
  it('generateSealKeyPair gives base64url DER halves that belong together', () => {
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]+$/)
    const privateKey = parseSealPrivateKey(keys.privateKey)
    expect(privateKey.asymmetricKeyType).toBe('x25519')
    const publicKey = createPublicKey({
      key: Buffer.from(keys.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    })
    expect(isSealKeyPair(publicKey, privateKey)).toBe(true)
    expect(isSealKeyPair(publicKey, parseSealPrivateKey(other.privateKey))).toBe(false)
  })
})

describe('staff PINs (#72)', () => {
  const person = { tenantId: newId('tn'), staffMemberId: newId('sm') }

  it('round-trip, bound to the tenant and the person', () => {
    const sealed = sealStaffPin(keys.publicKey, '4821', person)
    expect(sealed).not.toContain('4821')
    expect(openStaffPin(keys.privateKey, sealed, person)).toBe('4821')
    expect(
      errorOf(() =>
        openStaffPin(keys.privateKey, sealed, { ...person, staffMemberId: newId('sm') }),
      ).code,
    ).toBe('open_failed')
    expect(
      errorOf(() => openStaffPin(keys.privateKey, sealed, { ...person, tenantId: newId('tn') }))
        .code,
    ).toBe('open_failed')
  })

  it('seal and open only four digits', () => {
    expect(errorOf(() => sealStaffPin(keys.publicKey, '48211', person)).code).toBe(
      'invalid_payload',
    )
    const notPin = sealSecret(keys.publicKey, 'abcd', { purpose: 'staff_pin', ...person })
    const error = errorOf(() => openStaffPin(keys.privateKey, notPin, person))
    expect(error.code).toBe('invalid_payload')
    expect(error.message).not.toContain('abcd')
  })
})

describe('barsy credentials', () => {
  const sealing = { ...context, publicKey: keys.publicKey }
  const opening = { ...context, privateKey: keys.privateKey }

  it('round-trip through sealBarsyCredentials and openBarsyCredentials', () => {
    const credentials = { user: 'restro-api', password: 'p@ss wörd: "x"' }
    const sealed = sealBarsyCredentials(credentials, sealing)
    expect(openBarsyCredentials(sealed, opening)).toEqual(credentials)
  })

  it('refuse a sealed value that is not credentials, without showing it', () => {
    for (const text of ['not json', '{"user":"u"}', '{"user":"u","password":"p","x":1}', '[]']) {
      const error = errorOf(() =>
        openBarsyCredentials(sealSecret(keys.publicKey, text, context), opening),
      )
      expect(error.code).toBe('invalid_payload')
      expect(error.message).not.toContain(text)
    }
  })

  it('a value sealed for one integration does not open for another', () => {
    const sealed = sealBarsyCredentials({ user: 'u', password: 'p' }, sealing)
    expect(
      errorOf(() => openBarsyCredentials(sealed, { ...opening, integrationId: newId('in') })).code,
    ).toBe('open_failed')
  })
})
