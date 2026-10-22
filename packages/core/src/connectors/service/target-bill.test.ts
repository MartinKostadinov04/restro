import { describe, expect, it } from 'vitest'

import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from './capabilities'
import { posRef } from './pos-ref'
import type { PosBill } from './schemas'
import { chooseTargetBill } from './target-bill'

const DAY_START = new Date('2026-10-22T07:00:00+03:00')

function bill(id: string, openedAt: string | null, openedByRestro: boolean | null): PosBill {
  return {
    ref: posRef(id),
    totalMinor: 0,
    paidMinor: 0,
    openedAt,
    openedByRestro,
    paymentInFlight: false,
    lines: [],
  }
}

const ALL: ServiceCapabilities = {
  ...NO_SERVICE_CAPABILITIES,
  severalBillsPerTable: true,
  firstItemsOpenBill: true,
  addToStaffOpenedBill: true,
  billOpeningTime: true,
}

const choose = (bills: PosBill[], capabilities = ALL, excludeBills = [] as PosBill['ref'][]) =>
  chooseTargetBill({ bills, capabilities, serviceDayStartsAt: DAY_START, excludeBills })

describe('chooseTargetBill (D115, D124 §2 and §3, fix 7+8)', () => {
  const tonight1 = bill('a', '2026-10-22T21:00:00+03:00', false)
  const tonight2 = bill('b', '2026-10-22T22:00:00+03:00', true)
  const yesterday = bill('y', '2026-10-21T23:00:00+03:00', true)

  it('joins the oldest open POS bill of tonight', () => {
    expect(choose([tonight1, tonight2])).toStrictEqual({ kind: 'join', bill: tonight1.ref })
  })

  it('never joins a POS bill from before the service day; opens one where allowed', () => {
    expect(choose([yesterday, tonight2])).toStrictEqual({ kind: 'join', bill: tonight2.ref })
    expect(choose([yesterday])).toStrictEqual({ kind: 'open' })
  })

  it("asks the waiter when only yesterday's bill is there and no second bill may open", () => {
    expect(choose([yesterday], { ...ALL, severalBillsPerTable: false })).toStrictEqual({
      kind: 'refuse',
      code: 'needs_first_item',
    })
  })

  it('cannot check the service day where the POS gives no opening time', () => {
    const noTime = bill('n', null, true)
    expect(choose([noTime], { ...ALL, billOpeningTime: false })).toStrictEqual({
      kind: 'join',
      bill: noTime.ref,
    })
    expect(choose([noTime])).toStrictEqual({ kind: 'open' })
  })

  it("joins only Restro's own POS bills where staff bills are closed to apps", () => {
    const caps = { ...ALL, addToStaffOpenedBill: false }
    expect(choose([tonight1, tonight2], caps)).toStrictEqual({ kind: 'join', bill: tonight2.ref })
    expect(choose([tonight1], caps)).toStrictEqual({ kind: 'open' })
    expect(choose([bill('u', '2026-10-22T21:00:00+03:00', null)], caps)).toStrictEqual({
      kind: 'open',
    })
  })

  it('never joins a POS bill under payment', () => {
    expect(choose([tonight1, tonight2], ALL, [tonight1.ref])).toStrictEqual({
      kind: 'join',
      bill: tonight2.ref,
    })
    expect(choose([{ ...tonight1, paymentInFlight: true }])).toStrictEqual({ kind: 'open' })
  })

  it('an empty table: opens where first items open a bill, else asks the waiter', () => {
    expect(choose([])).toStrictEqual({ kind: 'open' })
    expect(choose([], { ...ALL, firstItemsOpenBill: false })).toStrictEqual({
      kind: 'refuse',
      code: 'needs_first_item',
    })
  })
})
