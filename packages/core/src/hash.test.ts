import { createHash } from 'node:crypto'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('matches node:crypto for random text, including Cyrillic and block boundaries', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
      }),
      { numRuns: 500 },
    )
    for (const length of [55, 56, 63, 64, 65, 119, 120, 128]) {
      const text = 'Негрони'.repeat(length).slice(0, length)
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    }
  })
})

describe('canonicalJson', () => {
  it('sorts object keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null }, e: undefined })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    )
  })

  it('keeps array order and writes -0 as 0', () => {
    expect(canonicalJson([2, 1, -0])).toBe('[2,1,0]')
  })

  it('refuses what is not JSON', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1n, () => 1, Symbol('x'), undefined]) {
      expect(() => canonicalJson(bad), String(bad)).toThrow(TypeError)
    }
  })

  it('gives equal strings for equal values whatever the key order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse())
        expect(canonicalJson(reversed)).toBe(canonicalJson(record))
      }),
    )
  })
})
