// The write checks (#51 design §5, "Adding lines", "Timeouts", "The payment route"; D115,
// D124 §2 and §3). Each sets the POS up through the waiter driver, runs one write and returns
// the problems it found. "Adds to the oldest bill" is conditional on the declared capabilities:
// the expected answer is what `chooseTargetBill` says for that declaration.

import type { ServiceConnector } from '../connector'
import type { PosRef } from '../pos-ref'
import {
  type AddLinesRequest,
  AddLinesResultSchema,
  EmptyResultSchema,
  IsolatedBillSchema,
  IsolateLinesResultSchema,
  PayAndCloseResultSchema,
  readingSchema,
  type TableBills,
  type WriteOutcome,
  writeOutcomeSchema,
} from '../schemas'
import { chooseTargetBill, type TargetBill } from '../target-bill'
import { type Check, kitContext, timed } from './checks-read'
import { KIT_MARGIN_MS, KIT_TIMINGS, type WriteHarness } from './harness'

const AddOutcomeSchema = writeOutcomeSchema(AddLinesResultSchema)
const IsolateOutcomeSchema = writeOutcomeSchema(IsolateLinesResultSchema)
const CloseOutcomeSchema = writeOutcomeSchema(PayAndCloseResultSchema)
const UndoOutcomeSchema = writeOutcomeSchema(EmptyResultSchema)
const IsolatedReadingSchema = readingSchema(IsolatedBillSchema)

const HOUR = 3_600_000

/** The kit's service day: it started two hours before the harness's now. */
function serviceDayStart(harness: WriteHarness): Date {
  return new Date(kitContext(harness).now().getTime() - 2 * HOUR)
}

async function addRequest(
  harness: WriteHarness,
  table: PosRef,
  excludeBills: readonly PosRef[] = [],
): Promise<AddLinesRequest> {
  return {
    table,
    lines: [{ item: await harness.waiter.sellableItem(), quantity: '2', options: [], note: null }],
    ref: `kit-${Math.random().toString(36).slice(2, 10)}`,
    serviceDayStartsAt: serviceDayStart(harness).toISOString(),
    excludeBills: [...excludeBills],
  }
}

async function readComplete(harness: WriteHarness, table: PosRef): Promise<TableBills | string> {
  const reading = await harness.connector.readTable(kitContext(harness), table)
  return reading.complete ? reading.value : `the table read incomplete: ${reading.reason}`
}

function outcomeProblems(
  schema: { safeParse(v: unknown): { success: boolean; error?: unknown } },
  label: string,
  outcome: unknown,
): string[] {
  const parsed = schema.safeParse(outcome)
  return parsed.success ? [] : [`${label} does not match its schema: ${String(parsed.error)}`]
}

/**
 * Sets a table up, sends one round, and compares what happened with the platform's rule for the
 * declared capabilities: joined the right POS bill, opened one, or refused `needs_first_item`.
 */
async function targetCheck(
  harness: WriteHarness,
  setUp: (table: PosRef) => Promise<{ readonly exclude?: readonly PosRef[] }>,
): Promise<string[]> {
  await harness.pos.reset()
  const table = await harness.waiter.emptyTable()
  const { exclude = [] } = await setUp(table)
  const before = await readComplete(harness, table)
  if (typeof before === 'string') return [before]
  const expected: TargetBill = chooseTargetBill({
    bills: before.bills,
    capabilities: harness.connector.capabilities,
    serviceDayStartsAt: serviceDayStart(harness),
    excludeBills: exclude,
  })
  const request = await addRequest(harness, table, exclude)
  const outcome = await harness.connector.addLines(kitContext(harness), request)
  const problems = outcomeProblems(AddOutcomeSchema, 'the add outcome', outcome)
  const after = await readComplete(harness, table)
  if (typeof after === 'string') return [...problems, after]
  const lineCount = (bills: TableBills, ref: PosRef) =>
    bills.bills.find((bill) => bill.ref.pos === ref.pos)?.lines.length ?? 0

  if (expected.kind === 'refuse') {
    if (outcome.kind !== 'refused' || outcome.refusal.code !== expected.code) {
      problems.push(`expected a refusal ${expected.code}, got ${describe(outcome)}`)
    }
    if (JSON.stringify(after) !== JSON.stringify(before))
      problems.push('a refused add changed the table')
    return problems
  }
  if (outcome.kind !== 'done')
    return [...problems, `expected the round added, got ${describe(outcome)}`]
  if (expected.kind === 'join') {
    if (outcome.result.opened)
      problems.push('the round opened a new POS bill instead of joining one')
    if (outcome.result.bill !== null && outcome.result.bill.pos !== expected.bill.pos) {
      problems.push(`the round joined ${outcome.result.bill.pos}, not ${expected.bill.pos}`)
    }
    if (
      lineCount(after, expected.bill) !==
      lineCount(before, expected.bill) + request.lines.length
    ) {
      problems.push(`the round's lines are not on ${expected.bill.pos}`)
    }
    for (const bill of before.bills) {
      if (bill.ref.pos !== expected.bill.pos && lineCount(after, bill.ref) !== bill.lines.length) {
        problems.push(`the round touched ${bill.ref.pos} as well`)
      }
    }
  } else {
    if (!outcome.result.opened) problems.push('the round did not say it opened a POS bill')
    if (after.bills.length !== before.bills.length + 1) problems.push('no new POS bill appeared')
    for (const bill of before.bills) {
      if (lineCount(after, bill.ref) !== bill.lines.length) {
        problems.push(`opening a bill also touched ${bill.ref.pos}`)
      }
    }
  }
  return problems
}

function describe(outcome: WriteOutcome<unknown>): string {
  return outcome.kind === 'refused' ? `refused ${outcome.refusal.code}` : outcome.kind
}

/** An empty table: open a POS bill where "first items open a bill", else `needs_first_item`. */
export const emptyTableCheck: Check<WriteHarness> = (harness) =>
  targetCheck(harness, async () => ({}))

/** Two POS bills of tonight opened by Restro: the round joins the oldest (D115). */
export const oldestBillCheck: Check<WriteHarness> = (harness) =>
  targetCheck(harness, async (table) => {
    const now = kitContext(harness).now().getTime()
    await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: true })
    if (harness.connector.capabilities.severalBillsPerTable) {
      await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR / 2), byRestro: true })
    }
    return {}
  })

/** A staff-opened bill only: joined where "add to a staff-opened bill", else never (D124 §3). */
export const staffBillCheck: Check<WriteHarness> = (harness) =>
  targetCheck(harness, async (table) => {
    const now = kitContext(harness).now().getTime()
    await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: false })
    return {}
  })

/** A POS bill from before the service day is never joined (D124 §2), where opening times are read. */
export const yesterdaysBillCheck: Check<WriteHarness> = async (harness) => {
  if (!harness.connector.capabilities.billOpeningTime) return []
  return targetCheck(harness, async (table) => {
    const now = kitContext(harness).now().getTime()
    await harness.waiter.openBill(table, { openedAt: new Date(now - 20 * HOUR), byRestro: true })
    return {}
  })
}

/** A POS bill under payment is never joined by a send (verification fix 7+8). */
export const excludedBillCheck: Check<WriteHarness> = (harness) =>
  targetCheck(harness, async (table) => {
    const now = kitContext(harness).now().getTime()
    const first = await harness.waiter.openBill(table, {
      openedAt: new Date(now - HOUR),
      byRestro: true,
    })
    return { exclude: [first] }
  })

/** The chosen POS bill closes just before the write: a definite "no" about that bill. */
export const closedBillCheck: Check<WriteHarness> = async (harness) => {
  const closeBefore = harness.waiter.closeBillBeforeNextWrite
  if (closeBefore === undefined) return []
  await harness.pos.reset()
  const table = await harness.waiter.emptyTable()
  const now = kitContext(harness).now().getTime()
  const bill = await harness.waiter.openBill(table, {
    openedAt: new Date(now - HOUR),
    byRestro: true,
  })
  closeBefore.call(harness.waiter, bill)
  const outcome = await harness.connector.addLines(
    kitContext(harness),
    await addRequest(harness, table),
  )
  const problems = outcomeProblems(AddOutcomeSchema, 'the add outcome', outcome)
  if (outcome.kind !== 'refused')
    return [...problems, `a round onto a closed bill came back ${outcome.kind}`]
  if (!['bill_closed', 'bill_locked'].includes(outcome.refusal.code)) {
    problems.push(`a closed bill was refused as ${outcome.refusal.code}`)
  }
  if (outcome.refusal.scope !== 'bill')
    problems.push(`a closed bill was scoped to the ${outcome.refusal.scope}`)
  return problems
}

/**
 * A stalled POS: the round answers `unknown` within the write timeout, never `refused`, and is
 * written at most once, also after it answered (D115: read back, never sent twice).
 */
export const writeTimeoutCheck: Check<WriteHarness> = async (harness) => {
  await harness.pos.reset()
  const table = await harness.waiter.emptyTable()
  const now = kitContext(harness).now().getTime()
  await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: true })
  const request = await addRequest(harness, table)
  const callsBefore = harness.pos.calls().length
  harness.faults.stall()
  const { value, ms } = await timed(() => harness.connector.addLines(kitContext(harness), request))
  const problems = outcomeProblems(AddOutcomeSchema, 'the add outcome', value)
  if (value.kind !== 'unknown')
    problems.push(`a stalled round answered ${describe(value)}, not unknown`)
  if (ms > KIT_TIMINGS.writeTimeoutMs + KIT_MARGIN_MS) {
    problems.push(`a stalled round took ${Math.round(ms)} ms: it ignores the write timeout`)
  }
  await new Promise((resolve) => setTimeout(resolve, KIT_TIMINGS.writeTimeoutMs))
  const writes = harness.pos
    .calls()
    .slice(callsBefore)
    .filter((call) => call.write)
  if (writes.length > 1) {
    problems.push(
      `a stalled round was written ${writes.length} times: ${writes.map((w) => w.name).join(', ')}`,
    )
  }
  return problems
}

/**
 * The payment route (part 2, conformance-tested now): isolate then read back gives exactly the
 * picked lines; undo restores the real table's total; a close succeeds once and a second is
 * refused.
 */
export const paymentRouteCheck: Check<WriteHarness> = async (harness) => {
  await harness.pos.reset()
  const connector: ServiceConnector = harness.connector
  const ctx = kitContext(harness)
  const table = await harness.waiter.emptyTable()
  const now = ctx.now().getTime()
  await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: true })
  const add = await connector.addLines(ctx, await addRequest(harness, table))
  if (add.kind !== 'done')
    return [`setting up the payment route: the round came back ${describe(add)}`]
  const before = await readComplete(harness, table)
  if (typeof before === 'string') return [before]
  const bill = before.bills[0]
  const line = bill?.lines[0]
  if (bill === undefined || line === undefined)
    return ['setting up the payment route: no line to pick']
  const paymentTable = await harness.waiter.paymentTable()
  const isolateRequest = {
    table,
    picks: [{ bill: bill.ref, line: line.ref, quantity: line.quantity }],
    paymentTable,
    ref: 'kit-isolate',
  }
  const problems: string[] = []

  const isolated = await connector.isolateLines(ctx, isolateRequest)
  problems.push(...outcomeProblems(IsolateOutcomeSchema, 'the isolate outcome', isolated))
  if (isolated.kind !== 'done') return [...problems, `isolating came back ${describe(isolated)}`]
  const back = await connector.readIsolated(ctx, isolated.result.isolated)
  problems.push(...outcomeProblems(IsolatedReadingSchema, 'the isolated reading', back))
  if (!back.complete || back.value.bill === null) {
    return [...problems, 'the isolated bill did not read back']
  }
  const got = back.value.bill.lines.map((l) => `${l.item?.pos}:${l.quantity}:${l.amountMinor}`)
  const want = [`${line.item?.pos}:${line.quantity}:${line.amountMinor}`]
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(
      `the isolated bill holds ${got.join(', ')}, not exactly the pick ${want.join(', ')}`,
    )
  }

  const undo = await connector.undoIsolate(ctx, {
    isolated: isolated.result.isolated,
    table,
    ref: 'kit-undo',
  })
  problems.push(...outcomeProblems(UndoOutcomeSchema, 'the undo outcome', undo))
  if (undo.kind !== 'done') return [...problems, `undoing came back ${describe(undo)}`]
  const restored = await readComplete(harness, table)
  if (typeof restored === 'string') return [...problems, restored]
  const total = (bills: TableBills) => bills.bills.reduce((sum, b) => sum + b.totalMinor, 0)
  if (total(restored) !== total(before)) {
    problems.push(`undo left the table at ${total(restored)}, not ${total(before)}`)
  }

  const again = await connector.isolateLines(ctx, { ...isolateRequest, ref: 'kit-isolate-2' })
  if (again.kind !== 'done') return [...problems, `isolating again came back ${describe(again)}`]
  const close = {
    isolated: again.result.isolated,
    amountMinor: line.amountMinor,
    paymentType: null,
    ref: 'kit-close',
  }
  const first = await connector.payAndClose(ctx, close)
  problems.push(...outcomeProblems(CloseOutcomeSchema, 'the close outcome', first))
  if (first.kind !== 'done') return [...problems, `the close came back ${describe(first)}`]
  if (!harness.connector.capabilities.receiptNumberOnClose && first.result.receiptNumber !== null) {
    problems.push('the close gives a receipt number, but receiptNumberOnClose is not declared')
  }
  const second = await connector.payAndClose(ctx, { ...close, ref: 'kit-close-2' })
  if (second.kind !== 'refused')
    problems.push(`a second close came back ${describe(second)}, not refused`)
  return problems
}

/** Every write leaves only waiter actions on the wire: nothing but the steps' own calls. */
export const writesAreDeclaredCheck: Check<WriteHarness> = async (harness) => {
  // The calls themselves are POS-specific; the guard on the write module (guard.ts) is what
  // pins them to D110. Here the kit only checks that a read step wrote nothing on the way.
  await harness.pos.reset()
  const table = await harness.waiter.emptyTable()
  const callsBefore = harness.pos.calls().length
  await harness.connector.readTable(kitContext(harness), table)
  await harness.connector.readFloor(kitContext(harness))
  const wrote = harness.pos
    .calls()
    .slice(callsBefore)
    .filter((call) => call.write)
  return wrote.map((call) => `a read step wrote to the POS: ${call.name}`)
}
