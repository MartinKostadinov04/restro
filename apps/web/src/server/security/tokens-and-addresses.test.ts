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

  it('every character after the first is spread evenly (the first only carries the top bits)', () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < CODES; index++) {
      for (const char of newTableToken().slice(1)) counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    expect(counts.size).toBe(62)
    const expected = (CODES * 21) / 62
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05)
    }
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
