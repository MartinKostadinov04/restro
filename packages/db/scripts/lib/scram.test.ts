import { createHash, createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { assertUsablePassword, scramSha256Verifier } from './scram.ts'

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

describe('scramSha256Verifier', () => {
  it('produces the stored keys of the RFC 7677 example exchange (user/pencil)', () => {
    // RFC 7677, section 3: password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096 iterations.
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
    const verifier = scramSha256Verifier('pencil', salt, 4096)
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier)
    expect(match?.[1]).toBe('W22ZaJ0SNY7soEsUEjb6gQ==')
    const storedKey = Buffer.from(match?.[2] ?? '', 'base64')
    const serverKey = Buffer.from(match?.[3] ?? '', 'base64')

    const authMessage = [
      'n=user,r=rOprNGfwEbeRWgbNEkqO',
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
    ].join(',')
    // The server signature the RFC's server sends back proves ServerKey is right.
    expect(hmac(serverKey, authMessage).toString('base64')).toBe(
      '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
    )
    // The RFC's client proof, unmasked with the client signature, must hash to StoredKey.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64')
    const signature = hmac(storedKey, authMessage)
    const clientKey = Buffer.from(proof.map((byte, index) => byte ^ (signature[index] ?? 0)))
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true)
  })

  it('uses a fresh random salt each time', () => {
    expect(scramSha256Verifier('the-same-password')).not.toBe(
      scramSha256Verifier('the-same-password'),
    )
  })
})

describe('assertUsablePassword', () => {
  it('accepts a long printable ASCII password', () => {
    expect(() => assertUsablePassword('Abcdefgh-1234567_!')).not.toThrow()
  })

  it.each(['short', 'has a space inside it', 'кирилица-кирилица-кирилица'])(
    'rejects %j',
    (password) => {
      expect(() => assertUsablePassword(password)).toThrow()
    },
  )
})
