// Table codes and the addresses a guest or a signed-out visitor can steer (the repair-review's A7).
// Kept proof, no database: a code encodes 128 random bits and repeats nothing; the next address
// after signing in stays on this site whatever it is given; the table route's redirect is relative,
// with the code in the fragment, and refuses a code of the wrong shape before it reads anything.
import { hashTableCode, newPublicId, newTableToken, TABLE_TOKEN_PATTERN } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { safeNextPath } from '../../lib/safe-next'
import { tableTokenResponse } from '../publish/table-token'

const OWN = 'https://own.example'

const HOSTILE = [
  'https://evil.example',
  '//evil.example',
  String.raw`/\evil.example`,
  String.raw`\\evil.example`,
  '/\t/evil.example',
  '/\n/evil.example',
  'javascript:alert(1)',
  'data:text/html,x',
  ' https://evil.example',
]

describe('a table code', () => {
  const CODES = 20_000

  it('holds 22 base62 characters and does not repeat', () => {
    const seen = new Set<string>()
    for (let index = 0; index < CODES; index++) {
      const code = newTableToken()
      expect(code).toMatch(/^[0-9A-Za-z]{22}$/)
      seen.add(code)
    }
    expect(seen.size).toBe(CODES)
  })

  // The shape of the encoding, which is not a weakness of the codes. `base62Body` writes 128 bits
  // as 22 base62 digits, and 62^22 is larger than 2^128, so the digits at the top are not even:
  //  - the first digit is the quotient by 62^21, about 7.8, so it takes only the values 0 to 7;
  //  - the second is the quotient by 62^20 (about 483.3) taken mod 62, so 49 characters (0 to m)
  //    come up 8 times in 483.3 and the other 13 (n to z) 7 times or less: about 10% light;
  //  - from the third on, a quotient of 29,963 or more is cut mod 62 and the skew is under 0.2%.
  // So the spread is counted over positions 2 to 21 (the 3rd character on), and the first two are
  // asserted as the shape they have, so that a change to the generator is caught, not absorbed.
  // Every id kind (`newId`, `idFromBytes`) and the table token share this encoding.
  // `newPublicId` does not: its characters are drawn one by one, by rejection, and are even.
  const SPREAD_CODES = 400_000
  const COUNTED_FROM = 2
  const BODY_LENGTH = 22
  // A bucket's count is binomial, so its relative standard deviation is sqrt((1 - p) / (n p)). A
  // false failure needs one of the 62 buckets to be Z deviations out; at Z = 6 that is 2 in a
  // billion per bucket, 1.2 in ten million per run (62 buckets).
  const Z = 6

  // One draw shared by the tests below: the sample size is what makes the checks sharp.
  const codes = Array.from({ length: SPREAD_CODES }, () => newTableToken())

  it('from the third character on, every character is spread evenly', () => {
    const counts = new Map<string, number>()
    const buckets = 62
    for (const code of codes) {
      for (const char of code.slice(COUNTED_FROM)) counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    expect(counts.size).toBe(buckets)
    const samples = SPREAD_CODES * (BODY_LENGTH - COUNTED_FROM)
    const expected = samples / buckets
    const tolerance = Z * Math.sqrt((1 - 1 / buckets) / expected)
    // Well under the 5% this test once had; it grows only as the sample shrinks.
    expect(tolerance).toBeLessThan(0.05)
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(tolerance)
    }
  })

  // The exact weight of each of the 62 characters at a position, worked out from the encoding:
  // each value of the quotient by 62^(21 - position) counts as many numbers below 2^128 as it
  // holds, the last one only in part, and the character is that quotient mod 62.
  const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const weights = (position: number): Map<string, number> => {
    const total = 2n ** 128n
    const unit = 62n ** BigInt(BODY_LENGTH - 1 - position)
    const held = new Array<bigint>(62).fill(0n)
    for (let quotient = 0n; quotient * unit < total; quotient++) {
      const rest = total - quotient * unit
      const slot = Number(quotient % 62n)
      held[slot] = (held[slot] ?? 0n) + (rest < unit ? rest : unit)
    }
    return new Map(ALPHABET.split('').map((char, i) => [char, Number(held[i] ?? 0n) / Number(total)]))
  }

  // All 62 characters at a position against their exact weight. Each count is binomial; the
  // allowed gap is Bernstein's bound for it, which holds for small weights too, at a false-failure
  // rate of ALPHA per character. ALPHA is 1e-8 over the 124 checks of the two positions below, so
  // a run fails by chance about once in 10^8 (the issue asked for 1 in 10^12).
  const ALPHA = 1e-8 / 124
  const L = Math.log(2 / ALPHA)
  const expectPositionToMatchEncoding = (position: number): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const code of codes) {
      const char = code.charAt(position)
      counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    for (const [char, weight] of weights(position)) {
      const count = counts.get(char) ?? 0
      if (weight === 0) {
        expect(count, char).toBe(0)
        continue
      }
      const mean = SPREAD_CODES * weight
      const variance = mean * (1 - weight)
      const gap = L / 3 + Math.sqrt((L / 3) ** 2 + 2 * L * variance)
      expect(Math.abs(count - mean), `${char} at ${position}`).toBeLessThan(gap)
    }
    return counts
  }

  it('the first character takes only the values 0 to 7, each at its exact weight (7 the lightest)', () => {
    const counts = expectPositionToMatchEncoding(0)
    expect([...counts.keys()].sort().join('')).toBe('01234567')
    const seven = weights(0).get('7')!
    expect(seven).toBeGreaterThan(0)
    expect(seven).toBeLessThan(1 / 8) // the last quotient is held in part: lighter than the others
  })

  it('the second character is light on 13 of the 62 (n to z), each at its exact weight', () => {
    const table = weights(1)
    const light = [...table].filter(([char]) => char >= 'n').reduce((sum, [, w]) => sum + w, 0)
    expect(light).toBeLessThan((13 / 62) * 0.95) // about 0.189 against an even 0.210
    expectPositionToMatchEncoding(1)
  })
})

describe('the next address after signing in', () => {
  for (const value of HOSTILE) {
    it(`${JSON.stringify(value)} falls back`, () => {
      expect(safeNextPath(value)).toBe('/venues')
    })
  }

  it('whatever it is given, it stays on this site', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.webUrl(),
          fc.string().map((text) => `/${text}`),
          fc.string().map((text) => `//${text}`),
        ),
        (value) => {
          expect(new URL(safeNextPath(value), OWN).origin).toBe(OWN)
        },
      ),
      { numRuns: 2000 },
    )
  })
})

describe('the table route', () => {
  it('redirects to a relative address with the code in the fragment, nothing in the query', async () => {
    const code = newTableToken()
    const hash = await hashTableCode(code)
    const body = JSON.stringify({
      venue_public_id: newPublicId(),
      venue_slug: 'club',
      organization_slug: 'org',
      table_label: '12',
    })
    const answer = await tableTokenResponse(code, {
      get: async (path) => (path === `t/${hash}.json` ? new TextEncoder().encode(body) : null),
    })
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe(`/m/org/club#t=${code}`)
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
    expect(answer.headers.get('cache-control')).toBe('no-store')
  })

  it('a code of the wrong shape reads nothing', async () => {
    let reads = 0
    const source = {
      get: async () => {
        reads += 1
        return null
      },
    }
    for (const code of ['short', 'a/../b-long-enough', '../../etc/passwd', 'a'.repeat(129)]) {
      expect(TABLE_TOKEN_PATTERN.test(code)).toBe(false)
      expect((await tableTokenResponse(code, source)).status).toBe(404)
    }
    expect(reads).toBe(0)
  })
})
