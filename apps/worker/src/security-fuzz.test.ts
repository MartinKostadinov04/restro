// The worker's request boundaries, fuzzed (the repair-review's A7). Pure; no database.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { makeLinkCode, openLinkCode } from './alerts/telegram-link'
import { TelegramRequestSchema } from './alerts/telegram-link-api'
import { RevealRequestSchema } from './reveal'

const SEED = { seed: 20261030, numRuns: 500 }
const SECRET = 'attack-service-token-attack-service-token'
const VENUE = `vn_${'0'.repeat(21)}1`

describe('the worker schemas', () => {
  it('arbitrary JSON never throws', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        RevealRequestSchema.safeParse(value)
        TelegramRequestSchema.safeParse(value)
      }),
      SEED,
    )
  })
})

describe('a Telegram link code', () => {
  it('any text opens to nothing', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.base64String()), (code) => {
        expect(openLinkCode(SECRET, code, new Date())).toBeNull()
      }),
      SEED,
    )
  })

  it('a flipped character, or another key, opens to nothing', () => {
    const now = new Date()
    const code = makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE as never, now })
    expect(openLinkCode(SECRET, code, now)).not.toBeNull()
    expect(openLinkCode(`${SECRET}x`, code, now)).toBeNull()
    fc.assert(
      fc.property(fc.nat({ max: code.length - 2 }), (at) => {
        const flipped = code[at] === 'A' ? 'B' : 'A'
        const changed = `${code.slice(0, at)}${flipped}${code.slice(at + 1)}`
        expect(openLinkCode(SECRET, changed, now)).toBeNull()
      }),
      { seed: 20261030, numRuns: 100 },
    )
  })

  it('an old code is expired', () => {
    const now = new Date('2026-10-30T10:00:00Z')
    const code = makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE as never, now })
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
    expect(openLinkCode(SECRET, code, later)).toBe('expired')
  })
})
