import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { lapsedStockMarks, planStock, type StockReading, type StockSlot } from './stock'

const ITEMS = ['nd_a', 'nd_b', 'nd_c', 'nd_d'] as const

const slotArb: fc.Arbitrary<StockSlot> = fc.oneof(
  // Nothing in the POS layer at the venue's scope.
  fc.constant({ value: null, ours: false }),
  // The POS's own flag (a menu reading's `for_sale`).
  fc.boolean().map((value) => ({ value, ours: false })),
  // A mark a stock pass wrote.
  fc.constant({ value: false, ours: true }),
)

const stateArb = fc
  .tuple(...ITEMS.map(() => fc.option(slotArb, { nil: undefined })))
  .map((slots) => {
    const state = new Map<string, StockSlot>()
    slots.forEach((slot, index) => {
      // An item with no slot is not linked to the POS: nothing may be written for it.
      if (slot !== undefined) state.set(ITEMS[index] as string, slot)
    })
    return state
  })

const readingArb: fc.Arbitrary<StockReading> = fc.oneof(
  fc.constant({ complete: false } as const),
  fc
    .array(
      fc.record({
        itemId: fc.constantFrom(...ITEMS, 'nd_unknown'),
        available: fc.boolean(),
      }),
      { maxLength: 6 },
    )
    .map((items) => ({ complete: true, items }) as const),
)

/** The slots after a plan: a mark is our `false`, a clear removes our value. */
function applied(state: ReadonlyMap<string, StockSlot>, reading: StockReading) {
  const plan = planStock(state, reading)
  const next = new Map(state)
  for (const id of plan.mark) next.set(id, { value: false, ours: true })
  for (const id of plan.clear) next.set(id, { value: null, ours: false })
  return { plan, next }
}

/** Whether a slot lets the item be ordered (the POS layer's part of `for_sale`). */
const orderable = (slot: StockSlot | undefined) => slot === undefined || slot.value !== false

describe('planStock (D122 §4 Stock)', () => {
  it('marks an item the POS says ran out, and clears our mark when it says it is back', () => {
    const state = new Map<string, StockSlot>([
      ['nd_a', { value: null, ours: false }],
      ['nd_b', { value: false, ours: true }],
    ])
    expect(
      planStock(state, {
        complete: true,
        items: [
          { itemId: 'nd_a', available: false },
          { itemId: 'nd_b', available: true },
        ],
      }),
    ).toEqual({ mark: ['nd_a'], clear: ['nd_b'] })
  })

  it("never clears the POS's own off-sale flag, and never marks an item off sale already", () => {
    const state = new Map<string, StockSlot>([
      ['nd_a', { value: false, ours: false }],
      ['nd_b', { value: false, ours: true }],
    ])
    expect(
      planStock(state, {
        complete: true,
        items: [
          { itemId: 'nd_a', available: true },
          { itemId: 'nd_b', available: false },
        ],
      }),
    ).toEqual({ mark: [], clear: [] })
  })

  it('takes the cautious answer when one reading names an item twice', () => {
    const state = new Map<string, StockSlot>([['nd_a', { value: false, ours: true }]])
    expect(
      planStock(state, {
        complete: true,
        items: [
          { itemId: 'nd_a', available: true },
          { itemId: 'nd_a', available: false },
        ],
      }),
    ).toEqual({ mark: [], clear: [] })
  })

  it('rule 6: an incomplete reading concludes nothing', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(planStock(state, { complete: false })).toEqual({ mark: [], clear: [] })
      }),
    )
  })

  it('rule 6: an item missing from a complete reading is left as it was', () => {
    fc.assert(
      fc.property(stateArb, readingArb, (state, reading) => {
        const { next } = applied(state, reading)
        const named = new Set(reading.complete ? reading.items.map((item) => item.itemId) : [])
        for (const id of ITEMS) {
          if (!named.has(id)) expect(next.get(id)).toEqual(state.get(id))
        }
      }),
    )
  })

  it('rule 5: no reading makes an item more orderable than the POS says', () => {
    fc.assert(
      fc.property(stateArb, fc.array(readingArb, { maxLength: 6 }), (start, readings) => {
        let state: ReadonlyMap<string, StockSlot> = start
        for (const reading of readings) {
          const { plan, next } = applied(state, reading)
          // Nothing is ever written as orderable: a plan only marks or clears our own mark.
          for (const id of plan.clear) expect(state.get(id)).toEqual({ value: false, ours: true })
          for (const id of ITEMS) {
            const answers = reading.complete
              ? reading.items.filter((item) => item.itemId === id)
              : []
            const saysOut = answers.some((item) => !item.available)
            const saysBack = answers.length > 0 && !saysOut
            // What the POS said ran out is not orderable once it is linked.
            if (saysOut && state.has(id)) expect(orderable(next.get(id))).toBe(false)
            // An item becomes orderable only where a complete reading said it is back.
            if (!orderable(state.get(id)) && orderable(next.get(id))) expect(saysBack).toBe(true)
            // The POS's own off-sale flag never changes here.
            const before = state.get(id)
            if (before !== undefined && !before.ours && before.value === false) {
              expect(next.get(id)).toEqual(before)
            }
          }
          // Nothing is written for an item that is not linked to the POS.
          for (const id of [...plan.mark, ...plan.clear]) expect(state.has(id)).toBe(true)
          state = next
        }
      }),
    )
  })
})

describe('lapsedStockMarks', () => {
  it("lapses a mark of an earlier service day and keeps tonight's", () => {
    expect(
      lapsedStockMarks(
        [
          { itemId: 'nd_a', serviceDate: '2026-10-25' },
          { itemId: 'nd_b', serviceDate: '2026-10-26' },
          { itemId: 'nd_c', serviceDate: null },
        ],
        '2026-10-26',
      ),
    ).toEqual(['nd_a', 'nd_c'])
  })
})
