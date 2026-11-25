// The electronic receipt on close (#186, D127): the close takes the guest's email and the POS
// issues the sale as an electronic receipt, in the two shapes a connector can declare: the POS
// sends it, or the close returns its file for Restro to send. Without the capability the email is
// refused before any write, and without an email the close is the paper one.

import {
  type IsolatedHandle,
  PayAndCloseRequestSchema,
  type PosRef,
  type ServiceConnector,
  type ServiceContext,
} from '@restro/core'
import { kitContext, type WriteHarness } from '@restro/core/connectors/testing'
import { describe, expect, it } from 'vitest'

import { ManualClock } from './engine/clock'
import { SimEngine } from './engine/engine'
import { type SimSwitches, switchesOf } from './switches'
import { inProcessTransport, simPosHarness } from './testing'

const GUEST = 'guest@example.test'
/** Two gin and tonics, as the default scenario prices them. */
const AMOUNT = 900

type Harness = WriteHarness & { readonly engine: SimEngine }

/** The POS's close answer as the wire sends it; a test may change it before the connector reads it. */
type CloseAnswer = Record<string, unknown>

function receiptHarness(
  changes: Partial<SimSwitches>,
  changeAnswer: (answer: CloseAnswer) => CloseAnswer = (answer) => answer,
): Harness {
  const clock = new ManualClock()
  const engine = new SimEngine({ switches: switchesOf('pilot', changes), clock })
  const direct = inProcessTransport(engine)
  const harness = simPosHarness({
    name: 'receipt',
    engine,
    clock,
    transport: async (request) => {
      const response = await direct(request)
      if (!request.path.endsWith('/close') || response.status !== 200) return response
      return {
        ...response,
        body: JSON.stringify(changeAnswer(JSON.parse(response.body) as CloseAnswer)),
      }
    },
  })
  return { ...harness, engine }
}

async function isolateAll(
  connector: ServiceConnector,
  ctx: ServiceContext,
  table: PosRef,
  paymentTable: PosRef,
): Promise<IsolatedHandle> {
  const reading = await connector.readTable(ctx, table)
  if (!reading.complete) throw new Error(`incomplete: ${reading.reason}`)
  const bill = reading.value.bills[0]
  if (bill === undefined) throw new Error('no bill on the table')
  const moved = await connector.isolateLines(ctx, {
    table,
    picks: bill.lines.map((line) => ({ bill: bill.ref, line: line.ref, quantity: line.quantity })),
    paymentTable,
    ref: 'receipt-isolate',
  })
  if (moved.kind !== 'done') throw new Error(`isolating came back ${moved.kind}`)
  return moved.result.isolated
}

/** A round of two gin and tonics on an empty table, isolated on the payment table. */
async function isolated(harness: Harness) {
  const { connector, engine, waiter } = harness
  const ctx = kitContext(harness)
  await harness.pos.reset()
  const table = await waiter.emptyTable()
  const paymentTable = await waiter.paymentTable()
  if (paymentTable === null) throw new Error('the pilot profile moves rows')
  engine.waiter.addRound(table.pos, [{ article: '1001', quantity: '2' }])
  const handle = await isolateAll(connector, ctx, table, paymentTable)
  return { ctx, connector, handle, engine }
}

function close(isolatedHandle: IsolatedHandle, receiptEmail?: string) {
  return {
    isolated: isolatedHandle,
    amountMinor: AMOUNT,
    tipMinor: 0,
    paymentType: null,
    ...(receiptEmail === undefined ? {} : { receiptEmail }),
    ref: 'receipt-close',
  }
}

describe('the electronic receipt on close (D127, #186)', () => {
  it('the POS sends it: the close is done, the POS issued it to the address, no file comes back', async () => {
    const harness = receiptHarness({ electronicReceipt: true, receiptNumberOnClose: true })
    const { ctx, connector, handle, engine } = await isolated(harness)
    expect(connector.capabilities).toMatchObject({
      electronicReceipt: true,
      electronicReceiptFile: false,
    })
    const outcome = await connector.payAndClose(ctx, close(handle, GUEST))
    if (outcome.kind !== 'done') throw new Error(`the close came back ${outcome.kind}`)
    expect(outcome.result.electronicReceipt).toBe('sent')
    expect(outcome.result.receiptFile).toBeUndefined()
    const bill = engine.state.bills.find((b) => b.id === handle.ref.pos)
    expect(bill?.receipt).toMatchObject({ email: GUEST, delivery: 'sent' })
  })

  it('the close returns the file: it comes back as the POS made it, for Restro to send', async () => {
    const harness = receiptHarness({
      electronicReceipt: true,
      electronicReceiptFile: true,
      receiptNumberOnClose: true,
    })
    const { ctx, connector, handle, engine } = await isolated(harness)
    expect(connector.capabilities).toMatchObject({
      electronicReceipt: true,
      electronicReceiptFile: true,
    })
    const outcome = await connector.payAndClose(ctx, close(handle, GUEST))
    if (outcome.kind !== 'done') throw new Error(`the close came back ${outcome.kind}`)
    const file = outcome.result.receiptFile
    expect(outcome.result.electronicReceipt).toBe('file')
    expect(file).toMatchObject({ contentType: 'application/pdf' })
    expect(file?.filename).toBe(`receipt-${outcome.result.receiptNumber}.pdf`)
    expect(Buffer.from(file?.contentBase64 ?? '', 'base64').toString()).toContain(
      `sim-pos electronic receipt ${outcome.result.receiptNumber}`,
    )
    const bill = engine.state.bills.find((b) => b.id === handle.ref.pos)
    expect(bill?.receipt).toMatchObject({ email: GUEST, delivery: 'returned' })
  })

  it('no email, no electronic receipt: the paper close, with no file, in either shape', async () => {
    const harness = receiptHarness({ electronicReceipt: true, electronicReceiptFile: true })
    const { ctx, connector, handle, engine } = await isolated(harness)
    const outcome = await connector.payAndClose(ctx, close(handle))
    if (outcome.kind !== 'done') throw new Error(`the close came back ${outcome.kind}`)
    expect(outcome.result.receiptFile).toBeUndefined()
    expect(outcome.result.electronicReceipt).toBeUndefined()
    const bill = engine.state.bills.find((b) => b.id === handle.ref.pos)
    expect(bill?.receipt).toMatchObject({ email: null, delivery: null })
  })

  it.each([
    { shape: 'the POS sends it', changes: {} },
    { shape: 'the close returns the file', changes: { electronicReceiptFile: true } },
  ])(
    'the printer is down ($shape): the close is done, the receipt is not issued, no file comes back',
    async ({ changes }) => {
      const harness = receiptHarness({ electronicReceipt: true, ...changes })
      const { ctx, connector, handle, engine } = await isolated(harness)
      engine.waiter.setPrinterDown(true)
      const outcome = await connector.payAndClose(ctx, close(handle, GUEST))
      if (outcome.kind !== 'done') throw new Error(`the close came back ${outcome.kind}`)
      expect(outcome.result).toStrictEqual({ receiptNumber: null, electronicReceipt: 'not_issued' })
      const bill = engine.state.bills.find((b) => b.id === handle.ref.pos)
      expect(bill?.state).toBe('closed')
      expect(bill?.receipt).toMatchObject({ email: null, delivery: null })
    },
  )

  it.each([
    ['a Cyrillic filename', { filename: 'бележка 1.pdf' }, 'file'],
    ['a spaced filename', { filename: 'my receipt.pdf' }, 'file'],
    ['wrapped base64', { contentBase64: 'JVBERi0x\nLjQg\r\nc2lt' }, 'file'],
    ['an octet-stream type', { contentType: 'application/octet-stream' }, 'not_issued'],
    ['a file too large', { contentBase64: 'A'.repeat(2_800_000) }, 'not_issued'],
    ['bytes that are not base64', { contentBase64: 'not base64 at all!' }, 'not_issued'],
    ['no file at all', { filename: undefined, contentBase64: undefined }, 'not_issued'],
  ])('%s never turns a finished close into unknown', async (_name, change, expected) => {
    const harness = receiptHarness(
      { electronicReceipt: true, electronicReceiptFile: true, receiptNumberOnClose: true },
      (answer) => ({ ...answer, receiptFile: { ...(answer.receiptFile as object), ...change } }),
    )
    const { ctx, connector, handle, engine } = await isolated(harness)
    const outcome = await connector.payAndClose(ctx, close(handle, GUEST))
    if (outcome.kind !== 'done') throw new Error(`the close came back ${outcome.kind}`)
    expect(outcome.result.electronicReceipt).toBe(expected)
    expect(outcome.result.receiptFile !== undefined).toBe(expected === 'file')
    expect(outcome.result.receiptFile?.filename ?? '').toMatch(/^[A-Za-z0-9._-]*$/)
    expect(engine.state.bills.find((b) => b.id === handle.ref.pos)?.state).toBe('closed')
  })

  it('the POS issues no electronic receipt: an email is refused not_supported before any write', async () => {
    const harness = receiptHarness({})
    const { ctx, connector, handle, engine } = await isolated(harness)
    expect(connector.capabilities.electronicReceipt).toBe(false)
    const before = harness.pos.calls().filter((call) => call.write).length
    const outcome = await connector.payAndClose(ctx, close(handle, GUEST))
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'not_supported' } })
    expect(harness.pos.calls().filter((call) => call.write).length).toBe(before)
    expect(engine.state.bills.find((b) => b.id === handle.ref.pos)?.state).toBe('open')
  })

  it('a file shape without the capability is not a profile', () => {
    expect(() => switchesOf('pilot', { electronicReceiptFile: true })).toThrow()
  })

  it('the close request takes one valid address and nothing else', async () => {
    const harness = receiptHarness({ electronicReceipt: true })
    const { handle } = await isolated(harness)
    for (const bad of [
      '',
      'not an email',
      'a@b',
      'a@example.test, b@example.test',
      ' a@example.test',
    ]) {
      expect(PayAndCloseRequestSchema.safeParse(close(handle, bad)).success).toBe(false)
    }
    expect(PayAndCloseRequestSchema.safeParse(close(handle, GUEST)).success).toBe(true)
    expect(PayAndCloseRequestSchema.safeParse(close(handle)).success).toBe(true)
  })
})
