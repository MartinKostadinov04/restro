// The four checks of D125 2.3 and the rule that paying turns on only when every one passes (#109):
// pure, no database. What the platform cannot read is the owner's tick and starts as "not done"; a
// stored value that does not parse reads as nothing done; any state but connected is off.
import { describe, expect, it } from 'vitest'

import {
  type AccountChecks,
  NO_CHECKS,
  PAYING_CHECKS,
  type PaymentTableFacts,
  payingReadiness,
  readAccountChecks,
} from './payment-connection'

const TICK = { at: '2026-10-27T10:00:00Z', by: 'user:u1' }
const READY: AccountChecks = {
  ...NO_CHECKS,
  cardPayments: true,
  ticks: { cardTypeInTill: TICK, receiptEmailsOff: TICK },
}
const MARKED: PaymentTableFacts = { paymentTables: 2, queuesWithoutOne: 0 }
const NONE: PaymentTableFacts = { paymentTables: 0, queuesWithoutOne: 0 }

describe('payingReadiness', () => {
  it('is off for an account nobody ticked, listing every check in D125’s order', () => {
    const readiness = payingReadiness({ state: 'connected', checks: NO_CHECKS, tables: NONE })
    expect(readiness.on).toBe(false)
    expect(readiness.missing).toEqual(PAYING_CHECKS)
    expect(readiness.checks.map((c) => [c.check, c.source])).toEqual([
      ['cardPayments', 'provider'],
      ['cardTypeInTill', 'owner'],
      ['paymentTables', 'venue'],
      ['receiptEmailsOff', 'owner'],
    ])
  })

  it('is on only when the account is connected and all four pass', () => {
    expect(payingReadiness({ state: 'connected', checks: READY, tables: MARKED })).toMatchObject({
      on: true,
      missing: [],
    })
    for (const state of ['connecting', 'lost_access', 'disconnected', null] as const) {
      expect(payingReadiness({ state, checks: READY, tables: MARKED }).on).toBe(false)
    }
  })

  it('names the one check that is missing', () => {
    const without = (change: Partial<AccountChecks>, tables = MARKED) =>
      payingReadiness({ state: 'connected', checks: { ...READY, ...change }, tables }).missing
    expect(without({ cardPayments: false })).toEqual(['cardPayments'])
    expect(without({ ticks: { cardTypeInTill: null, receiptEmailsOff: TICK } })).toEqual([
      'cardTypeInTill',
    ])
    expect(without({ ticks: { cardTypeInTill: TICK, receiptEmailsOff: null } })).toEqual([
      'receiptEmailsOff',
    ])
    expect(without({}, NONE)).toEqual(['paymentTables'])
  })

  it('wants a payment table in every queue that has tables', () => {
    const queues = payingReadiness({
      state: 'connected',
      checks: READY,
      tables: { paymentTables: 1, queuesWithoutOne: 1 },
    })
    expect(queues.missing).toEqual(['paymentTables'])
  })

  it('shows the provider’s words only while card payments are not allowed', () => {
    const waiting = { ...READY, cardPayments: false, missing: ['bank account'] }
    expect(
      payingReadiness({ state: 'connected', checks: waiting, tables: MARKED }).providerMissing,
    ).toEqual(['bank account'])
    expect(
      payingReadiness({
        state: 'connected',
        checks: { ...READY, missing: ['stale'] },
        tables: MARKED,
      }).providerMissing,
    ).toEqual([])
  })
})

describe('readAccountChecks', () => {
  it('reads nothing done from nothing, or from anything that does not parse', () => {
    expect(readAccountChecks({})).toEqual(NO_CHECKS)
    expect(readAccountChecks(null)).toEqual(NO_CHECKS)
    expect(readAccountChecks({ cardPayments: 'yes' })).toEqual(NO_CHECKS)
    // A tick without who or when is not a tick.
    expect(readAccountChecks({ ticks: { cardTypeInTill: { at: 'now' } } })).toEqual(NO_CHECKS)
  })

  it('keeps what was stored', () => {
    expect(
      readAccountChecks({
        cardPayments: true,
        missing: ['x'],
        lostReason: 'access_removed',
        ticks: { cardTypeInTill: TICK },
      }),
    ).toMatchObject({
      cardPayments: true,
      missing: ['x'],
      lostReason: 'access_removed',
      ticks: { cardTypeInTill: TICK, receiptEmailsOff: null },
    })
  })

  it('keeps a key it does not know, so a write puts it back as it was', () => {
    const read = readAccountChecks({
      cardPayments: true,
      someFutureKey: { nested: true },
      ticks: {
        cardTypeInTill: { ...TICK, someFutureKey: 1 },
        receiptEmailsOff: TICK,
        someFutureTick: TICK,
      },
    })
    expect(read).toEqual({
      ...NO_CHECKS,
      cardPayments: true,
      someFutureKey: { nested: true },
      ticks: {
        cardTypeInTill: { ...TICK, someFutureKey: 1 },
        receiptEmailsOff: TICK,
        someFutureTick: TICK,
      },
    })
  })

  it('resets only the value that is bad, not the ticks or the mark beside it', () => {
    const read = readAccountChecks({
      cardPayments: 'yes',
      missing: 'bank account',
      lostReason: 'access_removed',
      guestHost: 7,
      ticks: { cardTypeInTill: TICK, receiptEmailsOff: { at: 'now' } },
    })
    expect(read).toEqual({
      ...NO_CHECKS,
      lostReason: 'access_removed',
      ticks: { cardTypeInTill: TICK, receiptEmailsOff: null },
    })
    // A reason this version does not know reads as none, and the ticks stay.
    expect(
      readAccountChecks({ lostReason: 'something_new', ticks: { cardTypeInTill: TICK } }),
    ).toMatchObject({ lostReason: null, ticks: { cardTypeInTill: TICK, receiptEmailsOff: null } })
  })
})
