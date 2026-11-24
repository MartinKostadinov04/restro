// One bill closed with several card payments (#541, D160 §3): one close, one receipt listing every
// payment with Restro's reference, each reference read back on the closed bill; the payments add
// up to the isolated bill plus the tips or the close is refused with nothing written (rule 8, all
// or nothing). The simulated POS declares it with `severalPaymentsPerClose` (Q20) only.

import {
  addMinor,
  type ClosePayment,
  closeProof,
  type IsolatedHandle,
  type PosRef,
  ratioOfMinor,
  type ServiceConnector,
  type ServiceContext,
  subtractMinor,
} from '@restro/core'
import { kitContext, type WriteHarness } from '@restro/core/connectors/testing'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ManualClock } from './engine/clock'
import { billTotal, SimEngine } from './engine/engine'
import { quantityText } from './engine/units'
import { type SimSwitches, switchesOf } from './switches'
import { inProcessTransport, simPosHarness } from './testing'

/** The default scenario's articles a guest can order (the tip article is not one). */
const ARTICLES = ['1001', 'gin tonic', 'a3e0c6d2-5b14-4e89-9f70-c2d41b8e6a37', '1004', 'shot 5']

const SEVERAL: Partial<SimSwitches> = {
  severalPaymentsPerClose: true,
  readClosedBills: true,
  receiptNumberOnClose: true,
}

function harnessOf(changes: Partial<SimSwitches>): WriteHarness & { readonly engine: SimEngine } {
  const clock = new ManualClock()
  const engine = new SimEngine({ switches: switchesOf('pilot', changes), clock })
  const harness = simPosHarness({
    name: 'several payments',
    engine,
    clock,
    transport: inProcessTransport(engine),
  })
  return { ...harness, engine }
}

/** A round on a free table, all of it moved to a free payment table; its amount in minor units. */
async function isolatedRound(
  harness: WriteHarness & { readonly engine: SimEngine },
  ctx: ServiceContext,
  rows: readonly { readonly article: string; readonly quantity: string }[],
): Promise<{ readonly handle: IsolatedHandle; readonly linesMinor: number }> {
  await harness.pos.reset()
  const { connector, engine, waiter } = harness
  const table: PosRef = await waiter.emptyTable()
  const paymentTable = await waiter.paymentTable()
  if (paymentTable === null) throw new Error('the pilot profile moves rows')
  const opened = engine.waiter.addRound(table.pos, rows)
  const bill = engine.state.bills.find((b) => b.id === opened.bill)
  if (bill === undefined) throw new Error('the round opened no bill')
  const linesMinor = billTotal(bill)
  const reading = await connector.readTable(ctx, table)
  if (!reading.complete) throw new Error(`incomplete: ${reading.reason}`)
  const read = reading.value.bills[0]
  if (read === undefined) throw new Error('no bill on the table')
  const isolated = await connector.isolateLines(ctx, {
    table,
    picks: read.lines.map((line) => ({ bill: read.ref, line: line.ref, quantity: line.quantity })),
    paymentTable,
    ref: 'several-isolate',
  })
  if (isolated.kind !== 'done') throw new Error(`isolating came back ${isolated.kind}`)
  return { handle: isolated.result.isolated, linesMinor }
}

function closeOf(handle: IsolatedHandle, payments: readonly ClosePayment[]) {
  return {
    isolated: handle,
    amountMinor: payments.reduce((sum, p) => addMinor(sum, p.amountMinor), 0),
    tipMinor: payments.reduce((sum, p) => addMinor(sum, p.tipMinor), 0),
    paymentType: null,
    payments: [...payments],
    ref: 'py_close',
  }
}

/** `linesMinor` shared by `weights`, the last the rest, every share at least 1. */
function shares(linesMinor: number, weights: readonly number[]): number[] {
  const whole = weights.reduce((sum, weight) => sum + weight, 0)
  const parts = weights
    .slice(0, -1)
    .map((weight) => Math.max(1, ratioOfMinor(linesMinor - weights.length, weight, whole)))
  const taken = parts.reduce((sum, part) => addMinor(sum, part), 0)
  return [...parts, subtractMinor(linesMinor, taken)]
}

describe('one bill closed with several card payments (D160 §3, #541)', () => {
  it('three payments close once: one receipt lists the three, each reference reads back', async () => {
    const harness = harnessOf(SEVERAL)
    const ctx = kitContext(harness)
    const { handle, linesMinor } = await isolatedRound(harness, ctx, [
      { article: '1001', quantity: '3' },
      { article: '1004', quantity: '2' },
    ])
    const [a, b, c] = shares(linesMinor, [1, 1, 1])
    const payments: ClosePayment[] = [
      { amountMinor: (a ?? 0) + 150, tipMinor: 150, ref: 'py_1' },
      { amountMinor: b ?? 0, tipMinor: 0, ref: 'py_2' },
      { amountMinor: c ?? 0, tipMinor: 0, ref: 'py_3' },
    ]
    const close = closeOf(handle, payments)
    const withTip = harnessOf({ ...SEVERAL, tipAsLine: true })
    // A tip needs the tip row (`tipAsLine`, Q41): without it the close is refused before any write.
    expect((await harness.connector.payAndClose(ctx, close)).kind).toBe('refused')
    const tipCtx = kitContext(withTip)
    const round = await isolatedRound(withTip, tipCtx, [
      { article: '1001', quantity: '3' },
      { article: '1004', quantity: '2' },
    ])
    const tipped = closeOf(round.handle, payments)
    const outcome = await withTip.connector.payAndClose(tipCtx, tipped)
    expect(outcome).toMatchObject({ kind: 'done', result: { receiptNumber: expect.any(String) } })

    const bill = withTip.engine.state.bills.find((x) => x.id === round.handle.ref.pos)
    expect(bill?.state).toBe('closed')
    expect(bill?.receipt?.number).toBe(outcome.kind === 'done' ? outcome.result.receiptNumber : '')
    expect(bill?.payments.map((p) => [p.amountMinor, p.ref])).toStrictEqual(
      payments.map((p) => [p.amountMinor, p.ref]),
    )
    expect(bill === undefined ? 0 : billTotal(bill)).toBe(addMinor(linesMinor, 150))

    const read = await withTip.connector.readClosedBill?.(tipCtx, round.handle)
    expect(read?.complete).toBe(true)
    const closed = read?.complete ? read.value : null
    expect(closed?.paymentRefs).toStrictEqual(['py_1', 'py_2', 'py_3'])
    for (const ref of ['py_1', 'py_2', 'py_3']) {
      const proof = closeProof(
        closed === null || closed === undefined ? null : { ...closed, receiptNumber: null },
        { refs: new Set([ref]), amountMinor: tipped.amountMinor },
      )
      expect(proof).toEqual({ receiptNumber: null })
    }
  })

  it('payments that add up to the bill close it, and any others are refused with nothing written (rule 8)', async () => {
    const harness = harnessOf(SEVERAL)
    const { connector, engine } = harness
    const ctx = kitContext(harness)
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            article: fc.nat(ARTICLES.length - 1),
            thousandths: fc.integer({ min: 1000, max: 5000 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: -300, max: 300 }),
        async (rows, weights, off) => {
          const { handle, linesMinor } = await isolatedRound(
            harness,
            ctx,
            rows.map((row) => ({
              article: ARTICLES[row.article] ?? '1001',
              quantity: quantityText(row.thousandths),
            })),
          )
          fc.pre(linesMinor >= weights.length + Math.max(0, -off) + 1)
          const amounts = shares(linesMinor, weights)
          const payments = amounts.map((amountMinor, index) => ({
            amountMinor: index === 0 ? amountMinor + off : amountMinor,
            tipMinor: 0,
            ref: `py_${index + 1}`,
          }))
          fc.pre(payments.every((p) => p.amountMinor > 0))
          const before = engine.digest()
          const outcome = await connector.payAndClose(ctx, closeOf(handle, payments))
          if (off === 0) {
            expect(outcome.kind).toBe('done')
            const bill = engine.state.bills.find((x) => x.id === handle.ref.pos)
            expect(bill?.payments.map((p) => p.ref)).toStrictEqual(payments.map((p) => p.ref))
          } else {
            expect(outcome).toMatchObject({
              kind: 'refused',
              refusal: { code: 'amount_mismatch' },
            })
            expect(engine.digest()).toBe(before)
          }
        },
      ),
      { numRuns: 40 },
    )
  })

  it('payments whose sums differ from the close are refused before anything reaches the POS', async () => {
    const harness = harnessOf(SEVERAL)
    const ctx = kitContext(harness)
    const { handle, linesMinor } = await isolatedRound(harness, ctx, [
      { article: '1001', quantity: '2' },
    ])
    const half = ratioOfMinor(linesMinor, 1, 2)
    const request = {
      ...closeOf(handle, [
        { amountMinor: half, tipMinor: 0, ref: 'py_1' },
        { amountMinor: subtractMinor(linesMinor, half), tipMinor: 0, ref: 'py_2' },
      ]),
      amountMinor: addMinor(linesMinor, 1),
    }
    const callsBefore = harness.pos.calls().length
    const outcome = await harness.connector.payAndClose(ctx, request)
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'amount_mismatch' } })
    expect(harness.pos.calls().slice(callsBefore)).toStrictEqual([])
  })

  it('a close the POS refuses prints nothing and records nothing', async () => {
    const harness = harnessOf(SEVERAL)
    const { connector, engine } = harness
    const ctx = kitContext(harness)
    const { handle, linesMinor } = await isolatedRound(harness, ctx, [
      { article: '1001', quantity: '2' },
    ])
    const [a, b, c] = shares(linesMinor, [1, 1, 1])
    const close = closeOf(handle, [
      { amountMinor: a ?? 0, tipMinor: 0, ref: 'py_1' },
      { amountMinor: b ?? 0, tipMinor: 0, ref: 'py_2' },
      { amountMinor: c ?? 0, tipMinor: 0, ref: 'py_3' },
    ])
    engine.faults.add({ on: 'closeBill', times: 1, fault: { kind: 'refuse', code: 'bill_locked' } })
    const before = engine.digest()
    const refused = await connector.payAndClose(ctx, close)
    expect(refused).toMatchObject({ kind: 'refused', refusal: { code: 'bill_locked' } })
    expect(engine.digest()).toBe(before)
    expect(engine.state.receiptSeq).toBe(0)
    expect((await connector.payAndClose(ctx, close)).kind).toBe('done')
    expect(engine.state.receiptSeq).toBe(1)
  })

  it('undeclared, two payments are refused not_supported before any write', async () => {
    const harness = harnessOf({})
    expect(harness.connector.capabilities.closeWithSeveralPayments).toBe(false)
    const ctx = kitContext(harness)
    const { handle, linesMinor } = await isolatedRound(harness, ctx, [
      { article: '1001', quantity: '2' },
    ])
    const half = ratioOfMinor(linesMinor, 1, 2)
    const callsBefore = harness.pos.calls().length
    const outcome = await harness.connector.payAndClose(
      ctx,
      closeOf(handle, [
        { amountMinor: half, tipMinor: 0, ref: 'py_1' },
        { amountMinor: subtractMinor(linesMinor, half), tipMinor: 0, ref: 'py_2' },
      ]),
    )
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'not_supported' } })
    expect(harness.pos.calls().slice(callsBefore)).toStrictEqual([])
  })

  it('is declared only with a close that takes a payment type', () => {
    const connector: ServiceConnector = harnessOf({
      severalPaymentsPerClose: true,
      closeWithPaymentType: false,
    }).connector
    expect(connector.capabilities.closeWithSeveralPayments).toBe(false)
    expect(harnessOf(SEVERAL).connector.capabilities.closeWithSeveralPayments).toBe(true)
  })

  it('one payment, as before, sends no payment reference', async () => {
    const harness = harnessOf(SEVERAL)
    const ctx = kitContext(harness)
    const { handle, linesMinor } = await isolatedRound(harness, ctx, [
      { article: '1001', quantity: '2' },
    ])
    const outcome = await harness.connector.payAndClose(ctx, {
      isolated: handle,
      amountMinor: linesMinor,
      tipMinor: 0,
      paymentType: null,
      ref: 'py_close',
    })
    expect(outcome.kind).toBe('done')
    const bill = harness.engine.state.bills.find((x) => x.id === handle.ref.pos)
    expect(bill?.payments.map((p) => [p.amountMinor, p.ref])).toStrictEqual([[linesMinor, null]])
  })
})
