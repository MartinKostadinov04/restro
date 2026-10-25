// The write checks (#51 design §5, "Adding lines", "Timeouts", "The payment route"; D115,
// D124 §2 and §3). Each sets the POS up through the waiter driver, runs one write and returns
// the problems it found. "Adds to the oldest bill" is conditional on the declared capabilities:
// the expected answer is what `chooseTargetBill` says for that declaration.

import { addMinor, subtractMinor } from '../../../money'
import type { ServiceCapabilities } from '../capabilities'
import type { ServiceConnector } from '../connector'
import { type PosRef, posRef, samePosRef } from '../pos-ref'
import {
  type AddLinesRequest,
  AddLinesResultSchema,
  type BillLine,
  EmptyResultSchema,
  IsolatedBillSchema,
  type IsolatedHandle,
  type IsolateLinesRequest,
  IsolateLinesResultSchema,
  PayAndCloseResultSchema,
  type PosBill,
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
 * Writes hang while reads answer: the round reaches the POS, answers `unknown` within the write
 * timeout, never `refused`, and is written exactly once, also through the read-back window after
 * it answered (D115: read back, never sent twice).
 */
export const writeTimeoutCheck: Check<WriteHarness> = async (harness) => {
  await harness.pos.reset()
  const table = await harness.waiter.emptyTable()
  const now = kitContext(harness).now().getTime()
  await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: true })
  const request = await addRequest(harness, table)
  const callsBefore = harness.pos.calls().length
  harness.faults.stallWrites()
  const { value, ms } = await timed(() => harness.connector.addLines(kitContext(harness), request))
  const problems = outcomeProblems(AddOutcomeSchema, 'the add outcome', value)
  if (value.kind !== 'unknown')
    problems.push(`a stalled round answered ${describe(value)}, not unknown`)
  if (ms > KIT_TIMINGS.writeTimeoutMs + KIT_MARGIN_MS) {
    problems.push(`a stalled round took ${Math.round(ms)} ms: it ignores the write timeout`)
  }
  await new Promise((resolve) => setTimeout(resolve, KIT_TIMINGS.readBackWindowMs))
  const writes = harness.pos
    .calls()
    .slice(callsBefore)
    .filter((call) => call.write)
  if (writes.length === 0) {
    problems.push('the stalled round never reached the POS: no write was attempted')
  } else if (writes.length > 1) {
    problems.push(
      `a stalled round was written ${writes.length} times: ${writes.map((w) => w.name).join(', ')}`,
    )
  }
  return problems
}

/**
 * How the declared capabilities isolate a guest's lines (D122 §8, fix 7+8): split them off onto
 * a second bill of the same table, move them to a payment table at a one-bill POS, or not at all.
 */
export type IsolationRoute = 'split' | 'payment_table' | 'none'

export function isolationRoute(capabilities: ServiceCapabilities): IsolationRoute {
  if (capabilities.severalBillsPerTable) return 'split'
  if (capabilities.moveLinesToTable) return 'payment_table'
  return 'none'
}

const total = (bills: TableBills | null) =>
  bills === null ? 0 : bills.bills.reduce((sum, bill) => sum + bill.totalMinor, 0)
const lineKey = (line: BillLine) => `${line.item?.pos ?? '-'}|${line.quantity}|${line.amountMinor}`
const keys = (lines: readonly BillLine[]) => lines.map(lineKey).sort()
const findBill = (bills: TableBills, ref: PosRef): PosBill | undefined =>
  bills.bills.find((bill) => samePosRef(bill.ref, ref))

interface PaymentSetUp {
  readonly table: PosRef
  readonly before: TableBills
  readonly bill: PosBill
  readonly line: BillLine
}

/** The payment route set up: a bill with one line, then Restro's round of two of one item. */
async function paymentSetUp(harness: WriteHarness): Promise<PaymentSetUp | string> {
  await harness.pos.reset()
  const ctx = kitContext(harness)
  const table = await harness.waiter.emptyTable()
  const now = ctx.now().getTime()
  await harness.waiter.openBill(table, { openedAt: new Date(now - HOUR), byRestro: true })
  const request = await addRequest(harness, table)
  const add = await harness.connector.addLines(ctx, request)
  if (add.kind !== 'done')
    return `setting up the payment route: the round came back ${describe(add)}`
  const before = await readComplete(harness, table)
  if (typeof before === 'string') return before
  const item = request.lines[0]?.item
  for (const bill of before.bills) {
    const line = bill.lines.find(
      (l) =>
        l.item !== null && item !== undefined && samePosRef(l.item, item) && l.quantity === '2',
    )
    if (line !== undefined) return { table, before, bill, line }
  }
  return "setting up the payment route: the round's line is not on the table"
}

/** Reads the real table, and the payment table where the route moves lines there. */
async function readRoute(
  harness: WriteHarness,
  table: PosRef,
  paymentTable: PosRef | null,
): Promise<{ readonly real: TableBills; readonly payment: TableBills | null } | string> {
  const real = await readComplete(harness, table)
  if (typeof real === 'string') return real
  if (paymentTable === null) return { real, payment: null }
  const payment = await readComplete(harness, paymentTable)
  if (typeof payment === 'string') return payment
  return { real, payment }
}

/**
 * The payment route (part 2, conformance-tested now), by the declared capabilities:
 *   - isolating moves exactly the pick: the table's total is unchanged, the original bill lost
 *     exactly the picked part and the isolated bill holds exactly it (a move, never a copy);
 *   - a split-off bill that reads on the real table is under payment, so no send joins it;
 *   - part of a line's quantity is isolated only where declared, else refused `not_supported`;
 *   - undo restores the real table's total; a close succeeds once and a second is refused;
 *   - where the POS can isolate neither way, isolating is refused `not_supported`.
 */
export const paymentRouteCheck: Check<WriteHarness> = async (harness) => {
  const connector: ServiceConnector = harness.connector
  const caps = connector.capabilities
  const ctx = kitContext(harness)
  const setUp = await paymentSetUp(harness)
  if (typeof setUp === 'string') return [setUp]
  const { table, before, bill, line } = setUp
  const route = isolationRoute(caps)
  const paymentTable = route === 'payment_table' ? await harness.waiter.paymentTable() : null
  if (route === 'payment_table' && paymentTable === null) {
    return ['moveLinesToTable is declared, but the harness gives no payment table']
  }
  const part = caps.movePartOfLineQuantity
  const isolateRequest: IsolateLinesRequest = {
    table,
    picks: [{ bill: bill.ref, line: line.ref, quantity: part ? '1' : line.quantity }],
    paymentTable,
    ref: 'kit-isolate',
  }
  const problems: string[] = []

  const refusedAsUnsupported = async (request: IsolateLinesRequest, why: string) => {
    const outcome = await connector.isolateLines(ctx, request)
    problems.push(...outcomeProblems(IsolateOutcomeSchema, 'the isolate outcome', outcome))
    if (outcome.kind !== 'refused' || outcome.refusal.code !== 'not_supported') {
      problems.push(`${why}, but isolating came back ${describe(outcome)}, not not_supported`)
    }
    const after = await readRoute(harness, table, paymentTable)
    if (typeof after === 'string') problems.push(after)
    else if (JSON.stringify(after.real) !== JSON.stringify(before)) {
      problems.push(`${why}, but isolating changed the table`)
    }
  }
  if (route === 'none') {
    await refusedAsUnsupported(
      isolateRequest,
      'neither severalBillsPerTable nor moveLinesToTable is declared',
    )
    return problems
  }
  if (!part) {
    await refusedAsUnsupported(
      { ...isolateRequest, picks: [{ bill: bill.ref, line: line.ref, quantity: '1' }] },
      'movePartOfLineQuantity is not declared',
    )
  }

  const isolated = await connector.isolateLines(ctx, isolateRequest)
  problems.push(...outcomeProblems(IsolateOutcomeSchema, 'the isolate outcome', isolated))
  if (isolated.kind !== 'done') return [...problems, `isolating came back ${describe(isolated)}`]
  const handle: IsolatedHandle = isolated.result.isolated
  const handleTable = route === 'split' ? table : paymentTable
  if (handleTable !== null && !samePosRef(handle.table, handleTable)) {
    problems.push(`the isolated bill is on ${handle.table.pos}, not ${handleTable.pos}`)
  }

  const back = await connector.readIsolated(ctx, handle)
  problems.push(...outcomeProblems(IsolatedReadingSchema, 'the isolated reading', back))
  if (!back.complete || back.value.bill === null) {
    return [...problems, 'the isolated bill did not read back']
  }
  const isolatedLines = back.value.bill.lines
  const isolatedAmount = isolatedLines.reduce((sum, l) => sum + l.amountMinor, 0)
  const item = line.item?.pos ?? '-'
  const picked = part ? `${item}|1|${isolatedAmount}` : lineKey(line)
  if (JSON.stringify(keys(isolatedLines)) !== JSON.stringify([picked])) {
    problems.push(
      `the isolated bill holds ${keys(isolatedLines).join(', ')}, not exactly the pick ${picked}`,
    )
  }

  const moved = await readRoute(harness, table, paymentTable)
  if (typeof moved === 'string') return [...problems, moved]
  const movedTotal = total(moved.real) + total(moved.payment)
  if (movedTotal !== total(before)) {
    problems.push(
      `isolating changed the total from ${total(before)} to ${movedTotal}: the lines were copied, not moved`,
    )
  }
  const remainder = part ? [`${item}|1|${line.amountMinor - isolatedAmount}`] : []
  const wanted = [...bill.lines.filter((l) => l !== line).map(lineKey), ...remainder].sort()
  const original = findBill(moved.real, bill.ref)
  const left = original === undefined ? [] : keys(original.lines)
  if (JSON.stringify(left) !== JSON.stringify(wanted)) {
    problems.push(
      `after isolating, the original bill holds ${left.join(', ') || 'nothing'}, not ${wanted.join(', ') || 'nothing'}`,
    )
  }
  const onTable = findBill(moved.real, handle.ref)
  if (onTable !== undefined && !onTable.paymentInFlight) {
    problems.push('the isolated bill reads on the real table without paymentInFlight')
  }

  const undo = await connector.undoIsolate(ctx, { isolated: handle, table, ref: 'kit-undo' })
  problems.push(...outcomeProblems(UndoOutcomeSchema, 'the undo outcome', undo))
  if (undo.kind !== 'done') return [...problems, `undoing came back ${describe(undo)}`]
  const restored = await readRoute(harness, table, paymentTable)
  if (typeof restored === 'string') return [...problems, restored]
  if (total(restored.real) !== total(before)) {
    problems.push(`undo left the table at ${total(restored.real)}, not ${total(before)}`)
  }
  if (total(restored.payment) !== 0) problems.push('undo left lines on the payment table')

  const again = await connector.isolateLines(ctx, { ...isolateRequest, ref: 'kit-isolate-2' })
  if (again.kind !== 'done') return [...problems, `isolating again came back ${describe(again)}`]
  const close = {
    isolated: again.result.isolated,
    amountMinor: isolatedAmount,
    tipMinor: 0,
    paymentType: null,
    ref: 'kit-close',
  }
  const first = await connector.payAndClose(ctx, close)
  problems.push(...outcomeProblems(CloseOutcomeSchema, 'the close outcome', first))
  if (first.kind !== 'done') return [...problems, `the close came back ${describe(first)}`]
  if (!caps.receiptNumberOnClose && first.result.receiptNumber !== null) {
    problems.push('the close gives a receipt number, but receiptNumberOnClose is not declared')
  }
  const second = await connector.payAndClose(ctx, { ...close, ref: 'kit-close-2' })
  if (second.kind !== 'refused')
    problems.push(`a second close came back ${describe(second)}, not refused`)
  return problems
}

/** The tip the kit gives: odd on purpose, so a tip read as a fraction or rounded shows. */
export const KIT_TIP_MINOR = 137

/** What `lines` holds beyond `base`, line by line (item, quantity, amount). */
function extraLines(lines: readonly BillLine[], base: readonly BillLine[]): BillLine[] {
  const left = base.map(lineKey)
  return lines.filter((line) => {
    const at = left.indexOf(lineKey(line))
    if (at === -1) return true
    left.splice(at, 1)
    return false
  })
}

/**
 * A tip on close (D127, design §10), on a bill isolated as the payment route does it:
 *   - where `recordTipOnClose` is declared, the close is done, and the closed bill (as the waiter
 *     sees it) holds the isolated lines plus at most one tip line of exactly the tip, with a total
 *     of lines plus tip; nothing of the tip lands on the real table;
 *   - undeclared, a tip above 0 is refused `not_supported` and nothing reaches the POS.
 */
export const tipOnCloseCheck: Check<WriteHarness> = async (harness) => {
  const connector: ServiceConnector = harness.connector
  const setUp = await tipSetUp(harness)
  if (typeof setUp === 'string') return [setUp]
  const callsBefore = harness.pos.calls().length
  const outcome = await connector.payAndClose(kitContext(harness), tipClose(setUp, 'kit-close-tip'))
  const problems = outcomeProblems(CloseOutcomeSchema, 'the close outcome', outcome)

  if (!connector.capabilities.recordTipOnClose) {
    if (outcome.kind !== 'refused' || outcome.refusal.code !== 'not_supported') {
      problems.push(
        `recordTipOnClose is not declared, but a close with a tip came back ${describe(outcome)}, not not_supported`,
      )
    }
    const wrote = harness.pos
      .calls()
      .slice(callsBefore)
      .filter((call) => call.write)
    for (const call of wrote) problems.push(`a refused tip still wrote to the POS: ${call.name}`)
    return problems
  }

  if (outcome.kind !== 'done') {
    return [...problems, `the close with a tip came back ${describe(outcome)}`]
  }
  return [...problems, ...(await closedWithTipProblems(harness, setUp))]
}

/**
 * A retried close with a tip (D115, D127), where `recordTipOnClose` is declared: the close's
 * first write lands and its answer never comes, so the close is unknown; the same close sent
 * again (the platform's next step) is done, or answers that the bill is already closed. Either
 * way the bill closes once, with one tip line: a retry that posts the tip again, or reads its own
 * tip as a wrong amount, fails.
 */
export const tipRetryCheck: Check<WriteHarness> = async (harness) => {
  const stallNextWrite = harness.faults.stallNextWrite
  if (!harness.connector.capabilities.recordTipOnClose || stallNextWrite === undefined) return []
  const setUp = await tipSetUp(harness)
  if (typeof setUp === 'string') return [setUp]
  const ctx = kitContext(harness)
  const request = tipClose(setUp, 'kit-close-tip-retry')
  stallNextWrite.call(harness.faults)
  const first = await harness.connector.payAndClose(ctx, request)
  const problems = outcomeProblems(CloseOutcomeSchema, 'the first close outcome', first)
  if (first.kind !== 'unknown') {
    problems.push(`a close whose write hung came back ${describe(first)}, not unknown`)
  }
  const retry = await harness.connector.payAndClose(ctx, request)
  problems.push(...outcomeProblems(CloseOutcomeSchema, 'the retried close outcome', retry))
  const settled =
    retry.kind === 'done' ||
    (retry.kind === 'refused' &&
      (retry.refusal.code === 'already_done' || retry.refusal.code === 'bill_closed'))
  if (!settled) {
    return [...problems, `the retried close with a tip came back ${describe(retry)}, not done`]
  }
  return [...problems, ...(await closedWithTipProblems(harness, setUp))]
}

interface TipSetUp {
  readonly table: PosRef
  readonly before: TableBills
  readonly handle: IsolatedHandle
  readonly isolatedLines: readonly BillLine[]
  readonly linesMinor: number
}

/** A bill isolated as the payment route does it, ready to close with the kit's tip. */
async function tipSetUp(harness: WriteHarness): Promise<TipSetUp | string> {
  const connector: ServiceConnector = harness.connector
  const caps = connector.capabilities
  const ctx = kitContext(harness)
  const setUp = await paymentSetUp(harness)
  if (typeof setUp === 'string') return setUp
  const { table, before, bill, line } = setUp
  const route = isolationRoute(caps)
  if (caps.recordTipOnClose && (route === 'none' || !caps.closeWithPaymentType)) {
    return 'recordTipOnClose is declared, but the POS cannot isolate a bill and close it'
  }
  let handle: IsolatedHandle = { ref: posRef('kit-no-such-bill'), table }
  let isolatedLines: readonly BillLine[] = []
  if (route !== 'none') {
    const paymentTable = route === 'payment_table' ? await harness.waiter.paymentTable() : null
    const isolated = await connector.isolateLines(ctx, {
      table,
      picks: [{ bill: bill.ref, line: line.ref, quantity: line.quantity }],
      paymentTable,
      ref: 'kit-isolate-tip',
    })
    if (isolated.kind !== 'done') return `isolating came back ${describe(isolated)}`
    handle = isolated.result.isolated
    const back = await connector.readIsolated(ctx, handle)
    if (!back.complete || back.value.bill === null) return 'the isolated bill did not read back'
    isolatedLines = back.value.bill.lines
  }
  const linesMinor = isolatedLines.reduce((sum, l) => addMinor(sum, l.amountMinor), 0)
  return { table, before, handle, isolatedLines, linesMinor }
}

function tipClose(setUp: TipSetUp, ref: string) {
  return {
    isolated: setUp.handle,
    amountMinor: addMinor(setUp.linesMinor, KIT_TIP_MINOR),
    tipMinor: KIT_TIP_MINOR,
    paymentType: null,
    ref,
  }
}

/**
 * The closed bill, as the waiter sees it: the isolated lines plus at most one tip line of exactly
 * the tip, with a total of lines plus tip; nothing of the tip lands on the real table.
 */
async function closedWithTipProblems(harness: WriteHarness, setUp: TipSetUp): Promise<string[]> {
  const { table, before, handle, isolatedLines, linesMinor } = setUp
  const closedBill = harness.waiter.closedBill
  if (closedBill === undefined) {
    return ['recordTipOnClose is declared, but the harness cannot show a closed bill']
  }
  const closed = await closedBill.call(harness.waiter, handle.ref)
  if (closed === null) return ['the bill with the tip did not close']
  const problems: string[] = []
  const wanted = addMinor(linesMinor, KIT_TIP_MINOR)
  if (closed.totalMinor !== wanted) {
    problems.push(
      `the closed bill's total is ${closed.totalMinor}, not its lines plus the tip (${wanted})`,
    )
  }
  const missing = extraLines(isolatedLines, closed.lines)
  if (missing.length > 0) problems.push(`the closed bill lost ${missing.map(lineKey).join(', ')}`)
  const extra = extraLines(closed.lines, isolatedLines)
  if (extra.length > 1) {
    problems.push(`the tip landed as ${extra.length} lines: ${extra.map(lineKey).join(', ')}`)
  } else if (extra[0] !== undefined && extra[0].amountMinor !== KIT_TIP_MINOR) {
    problems.push(`the tip line is ${extra[0].amountMinor}, not the tip ${KIT_TIP_MINOR}`)
  }
  const real = await readComplete(harness, table)
  if (typeof real === 'string') return [...problems, real]
  const left = subtractMinor(total(before), linesMinor)
  if (total(real) !== left) {
    problems.push(`after the close the real table is at ${total(real)}, not ${left}`)
  }
  return problems
}

/**
 * Pay-first (D127, #113), where `firstItemsOpenBill` is declared: a round on an empty payment
 * table (an empty table where the POS has none) opens a bill, names it, and a reading of the
 * table then finds that bill holding the round.
 */
export const newBillReferenceCheck: Check<WriteHarness> = async (harness) => {
  if (!harness.connector.capabilities.firstItemsOpenBill) return []
  await harness.pos.reset()
  const table = (await harness.waiter.paymentTable()) ?? (await harness.waiter.emptyTable())
  const before = await readComplete(harness, table)
  if (typeof before === 'string') return [before]
  if (before.bills.length > 0) return [`the empty table ${table.pos} already has a POS bill`]
  const request = await addRequest(harness, table)
  const outcome = await harness.connector.addLines(kitContext(harness), request)
  const problems = outcomeProblems(AddOutcomeSchema, 'the add outcome', outcome)
  if (outcome.kind !== 'done') return [...problems, `the round came back ${describe(outcome)}`]
  if (!outcome.result.opened) problems.push('the round did not say it opened a POS bill')
  const ref = outcome.result.bill
  if (ref === null) return [...problems, 'the round opened a POS bill but did not name it']
  const after = await readComplete(harness, table)
  if (typeof after === 'string') return [...problems, after]
  const found = findBill(after, ref)
  if (found === undefined) {
    problems.push(`a reading of the table does not find ${ref.pos}, the bill the round named`)
  } else if (found.lines.length !== request.lines.length) {
    problems.push(
      `${ref.pos} holds ${found.lines.length} lines, not the round's ${request.lines.length}`,
    )
  }
  return problems
}

/** The read steps write nothing: the table, the floor and an isolated bill. */
export const writesAreDeclaredCheck: Check<WriteHarness> = async (harness) => {
  // The calls themselves are POS-specific; the guard on the write module (guard.ts) is what
  // pins them to D110. Here the kit only checks that a read step wrote nothing on the way.
  const ctx = kitContext(harness)
  const route = isolationRoute(harness.connector.capabilities)
  const setUp = await paymentSetUp(harness)
  let table = await harness.waiter.emptyTable()
  let handle: IsolatedHandle = { ref: posRef('kit-no-such-bill'), table }
  if (typeof setUp !== 'string' && route !== 'none') {
    table = setUp.table
    const isolated = await harness.connector.isolateLines(ctx, {
      table,
      picks: [{ bill: setUp.bill.ref, line: setUp.line.ref, quantity: setUp.line.quantity }],
      paymentTable: route === 'payment_table' ? await harness.waiter.paymentTable() : null,
      ref: 'kit-isolate-read',
    })
    if (isolated.kind === 'done') handle = isolated.result.isolated
  }
  const callsBefore = harness.pos.calls().length
  await harness.connector.readTable(ctx, table)
  await harness.connector.readFloor(ctx)
  await harness.connector.readIsolated(ctx, handle)
  const wrote = harness.pos
    .calls()
    .slice(callsBefore)
    .filter((call) => call.write)
  return wrote.map((call) => `a read step wrote to the POS: ${call.name}`)
}
