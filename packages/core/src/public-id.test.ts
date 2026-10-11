import { describe, expect, it } from 'vitest'

import { isPublicId, newPublicId, PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from './public-id'

describe('newPublicId', () => {
  it('is 12 characters of a-z0-9', () => {
    for (let i = 0; i < 200; i++) {
      const code = newPublicId()
      expect(code).toHaveLength(PUBLIC_ID_LENGTH)
      expect(code).toMatch(/^[a-z0-9]{12}$/)
      expect(isPublicId(code)).toBe(true)
    }
  })

  it('does not repeat in 10,000 draws', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(newPublicId())
    expect(seen.size).toBe(10_000)
  })

  it('uses every character of the alphabet', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) for (const char of newPublicId()) seen.add(char)
    expect([...seen].sort().join('')).toBe('0123456789abcdefghijklmnopqrstuvwxyz')
  })

  it('draws by rejection: bytes of 252 or more are thrown away, not folded into the alphabet', () => {
    // 255, 254, 253, 252 would map to 3, 2, 1, 0 with a plain modulo; here they are skipped.
    const rejected = [255, 254, 253, 252]
    const accepted = [0, 1, 35, 36, 71, 251, 7, 8, 9, 10, 11, 12]
    const stream = [...rejected, ...accepted]
    let calls = 0
    const code = newPublicId((length) => {
      calls += 1
      expect(length).toBeGreaterThanOrEqual(PUBLIC_ID_LENGTH)
      // The first request is answered with the rejected bytes and the accepted ones; padded so the
      // answer is as long as asked.
      return Uint8Array.from({ length }, (_, i) => stream[i] ?? 0)
    })
    expect(calls).toBe(1)
    // 0 -> 0, 1 -> 1, 35 -> z, 36 -> 0, 71 -> z, 251 -> 251 % 36 = 35 -> z, 7, 8, 9, 10 -> a, 11 -> b, 12 -> c
    expect(code).toBe('01z0zz789abc')
  })

  it('asks for more bytes when too many were rejected', () => {
    let calls = 0
    const code = newPublicId((length) => {
      calls += 1
      // The first batch is all rejected, the second is all fine.
      return new Uint8Array(length).fill(calls === 1 ? 255 : 10)
    })
    expect(calls).toBe(2)
    expect(code).toBe('aaaaaaaaaaaa')
  })

  it('maps every accepted byte to a character with the same frequency', () => {
    // Over all 252 accepted byte values, each of the 36 characters comes up exactly 7 times.
    const counts = new Map<string, number>()
    for (let byte = 0; byte < 252; byte++) {
      const code = newPublicId((length) => new Uint8Array(length).fill(byte))
      expect(new Set(code).size).toBe(1)
      counts.set(code[0] ?? '', (counts.get(code[0] ?? '') ?? 0) + 1)
    }
    expect(counts.size).toBe(36)
    expect([...counts.values()].every((count) => count === 7)).toBe(true)
  })
})

describe('isPublicId', () => {
  it('accepts exactly 12 characters of a-z0-9', () => {
    expect(isPublicId('k3x9p2m7qa1z')).toBe(true)
    expect(isPublicId('000000000000')).toBe(true)
  })

  it('refuses everything else', () => {
    for (const value of [
      'k3x9p2m7qa1Z',
      'k3x9p2m7qa1',
      'k3x9p2m7qa1zz',
      'k3x9p2m7qa1-',
      'k3x9p2m7 a1z',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isPublicId(value)).toBe(false)
    }
    expect(PUBLIC_ID_PATTERN.test('k3x9p2m7qa1z\n')).toBe(false)
  })
})
