// The fixed lock order (design §2.3): rows are claimed kind by kind, in key order inside a kind,
// and anything out of order throws before the database is asked.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { LOCK_RANKS, LockLedger, LockOrderError } from './lock-order'

describe('the lock ledger', () => {
  it('lets a transaction lock sitting, order, sent order and lease rows in that order', () => {
    const ledger = new LockLedger()
    expect(ledger.claim('sitting', ['tb_2', 'tb_1'])).toEqual(['tb_1', 'tb_2'])
    expect(ledger.claim('table_order', ['tb_1'])).toEqual(['tb_1'])
    expect(ledger.claim('sent_order', ['so_1'])).toEqual(['so_1'])
    expect(ledger.claim('lease', ['order_slot:tb_1'])).toEqual(['order_slot:tb_1'])
  })

  it('refuses a kind that comes earlier in the order than one already held', () => {
    const ledger = new LockLedger()
    ledger.claim('sent_order', ['so_1'])
    expect(() => ledger.claim('table_order', ['tb_1'])).toThrow(LockOrderError)
  })

  it('refuses a key below the last one of the same kind', () => {
    const ledger = new LockLedger()
    ledger.claim('table_order', ['tb_5'])
    expect(() => ledger.claim('table_order', ['tb_3'])).toThrow(LockOrderError)
    expect(ledger.claim('table_order', ['tb_7'])).toEqual(['tb_7'])
  })

  it('skips rows already held, even out of order', () => {
    const ledger = new LockLedger()
    ledger.claim('sitting', ['tb_1'])
    ledger.claim('sent_order', ['so_1'])
    expect(ledger.claim('sitting', ['tb_1'])).toEqual([])
    expect(ledger.holds('sitting', 'tb_1')).toBe(true)
  })

  it('compares keys by code unit, like Postgres C collation', () => {
    const ledger = new LockLedger()
    expect(ledger.claim('sent_order', ['so_a', 'so_B', 'so_Z'])).toEqual(['so_B', 'so_Z', 'so_a'])
  })

  it('accepts every sequence of claims in rank order, and only those', () => {
    const rank = fc.constantFrom(...LOCK_RANKS)
    const claim = fc.tuple(
      rank,
      fc.array(fc.stringMatching(/^[a-z]{2}_[0-9a-z]{1,4}$/), { minLength: 1, maxLength: 4 }),
    )
    fc.assert(
      fc.property(fc.array(claim, { maxLength: 8 }), (claims) => {
        const ledger = new LockLedger()
        let lastRank = -1
        let lastKey: string | null = null
        const held = new Set<string>()
        for (const [kind, keys] of claims) {
          const index = LOCK_RANKS.indexOf(kind)
          const fresh = [...new Set(keys)].filter((key) => !held.has(`${kind}:${key}`)).sort()
          const breaks =
            fresh.length > 0 &&
            (index < lastRank ||
              (index === lastRank && lastKey !== null && (fresh[0] as string) < lastKey))
          if (breaks) {
            expect(() => ledger.claim(kind, keys)).toThrow(LockOrderError)
            return
          }
          expect(ledger.claim(kind, keys)).toEqual(fresh)
          for (const key of fresh) held.add(`${kind}:${key}`)
          if (fresh.length > 0) {
            lastRank = index
            lastKey = fresh[fresh.length - 1] as string
          }
        }
      }),
    )
  })
})
