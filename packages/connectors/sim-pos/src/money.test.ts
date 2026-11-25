// Property tests for rule 8 (#68): money is conserved across rows, moves and voids, and a price
// sent as a JSON float parses to the same minor units as the same price sent as decimal text.

import { decimalToMinor, posRef } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { createSimPosConnector } from './connector'
import { ManualClock } from './engine/clock'
import { billTotal, SimEngine } from './engine/engine'
import { SIM_PASSWORD } from './engine/scenario'
import { quantityText, splitAmount } from './engine/units'
import { switchesOf } from './switches'
import { inProcessTransport } from './testing'
import { moneyNumberText, parseWireJson, renderWireJson } from './wire/json'

const TABLES = ['30007', 'T 8 hall', '0b6f3a8e-9c21-4f57-a0d4-2e81c7b5f903', '39001', 'pay 2 main']
const ARTICLES = ['1001', 'gin tonic', 'a3e0c6d2-5b14-4e89-9f70-c2d41b8e6a37', '1004', 'shot 5']

const op = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    table: fc.nat(TABLES.length - 1),
    article: fc.nat(ARTICLES.length - 1),
    thousandths: fc.integer({ min: 1, max: 5000 }),
  }),
  fc.record({
    kind: fc.constant('move' as const),
    pick: fc.nat(),
    part: fc.double({ min: 0, max: 1, noNaN: true }),
    to: fc.nat(TABLES.length - 1),
  }),
  fc.record({
    kind: fc.constant('void' as const),
    pick: fc.nat(),
    part: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
)

describe('money is conserved (rule 8)', () => {
  it('across rows, moves (whole and part) and voids, every amount a whole number of minor units', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        const engine = new SimEngine({
          switches: switchesOf('pilot', {
            movePartialQuantity: true,
            billTotalDiffersFromLines: false,
          }),
          clock: new ManualClock(),
        })
        const grand = () => engine.state.bills.reduce((sum, bill) => sum + billTotal(bill), 0)
        let added = grand()
        let voided = 0
        for (const step of ops) {
          const rows = engine.state.bills
            .filter((bill) => bill.state === 'open')
            .flatMap((bill) => bill.rows.map((row) => ({ bill, row })))
          if (step.kind === 'add') {
            const before = grand()
            engine.waiter.addRound(TABLES[step.table] ?? '30007', [
              {
                article: ARTICLES[step.article] ?? '1001',
                quantity: quantityText(step.thousandths),
              },
            ])
            added += grand() - before
            continue
          }
          const picked = rows[step.pick % Math.max(1, rows.length)]
          if (picked === undefined) continue
          const { bill, row } = picked
          const taken = Math.max(1, Math.round(row.quantity * step.part))
          if (step.kind === 'move') {
            const to = TABLES[step.to] ?? '30007'
            if (to === bill.table) continue
            const others = engine.state.bills.filter((b) => b.table === to && b.state === 'open')
            if (others.length > 1) continue
            engine.waiter.moveLines(bill.id, [{ row: row.id, quantity: quantityText(taken) }], to)
          } else {
            if (bill.rows.length === 1 && taken === row.quantity) continue
            voided += engine.waiter.voidLine(bill.id, row.id, quantityText(taken))
          }
        }
        for (const bill of engine.state.bills) {
          for (const row of bill.rows) {
            expect(Number.isSafeInteger(row.amountMinor) && row.amountMinor >= 0).toBe(true)
          }
        }
        expect(grand() + voided).toBe(added)
      }),
      { numRuns: 200 },
    )
  })

  it('a split never makes or loses a minor unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (amount, quantity, part) => {
          const taken = Math.round(quantity * part)
          const split = splitAmount(amount, taken, quantity)
          expect(split.taken + split.rest).toBe(amount)
          expect(split.taken >= 0 && split.rest >= 0).toBe(true)
        },
      ),
    )
  })
})

describe('JSON floats parse to the same minor units as decimal text (rule 8)', () => {
  it('for any amount, on the wire', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (minor) => {
        const asFloat = renderWireJson({ price: minor }, { pricesAsJsonFloats: true })
        const asText = renderWireJson({ price: minor }, { pricesAsJsonFloats: false })
        expect(asFloat).toBe(`{"price":${moneyNumberText(minor)}}`)
        const fromFloat = (parseWireJson(asFloat) as { price: string }).price
        const fromText = (parseWireJson(asText) as { price: string }).price
        expect(decimalToMinor(fromFloat)).toBe(minor)
        expect(decimalToMinor(fromText)).toBe(minor)
      }),
    )
  })

  it('through the connector: a table reads the same either way', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            article: fc.nat(ARTICLES.length - 1),
            thousandths: fc.integer({ min: 1, max: 9999 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (rounds) => {
          const read = async (pricesAsJsonFloats: boolean) => {
            const clock = new ManualClock()
            const engine = new SimEngine({
              switches: switchesOf('cautious', {
                pricesAsJsonFloats,
                rateLimit: { concurrent: 1, perSecond: 1000 },
              }),
              clock,
            })
            for (const round of rounds) {
              engine.waiter.addRound('30007', [
                {
                  article: ARTICLES[round.article] ?? '1001',
                  quantity: quantityText(round.thousandths),
                },
              ])
            }
            const connector = createSimPosConnector({
              transport: inProcessTransport(engine),
              login: { user: 'restro bar 1', password: SIM_PASSWORD },
              switches: engine.switches,
            })
            const timings = {
              probeBudgetMs: 500,
              readTimeoutMs: 2000,
              writeTimeoutMs: 2000,
              readBackWindowMs: 1000,
            }
            const reading = await connector.readTable(
              { now: () => clock.now(), timings },
              posRef('30007'),
            )
            const bill = engine.state.bills.find((b) => b.table === '30007')
            return { reading, total: bill === undefined ? 0 : billTotal(bill) }
          }
          const floats = await read(true)
          const text = await read(false)
          expect(floats.reading).toEqual(text.reading)
          expect(floats.reading.complete && floats.reading.value.bills[0]?.totalMinor).toBe(
            floats.total,
          )
        },
      ),
      { numRuns: 25 },
    )
  })
})
