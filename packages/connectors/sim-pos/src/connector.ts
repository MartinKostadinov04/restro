// The service connector over the simulated POS's wire (#68; spec #64, Implementation Decisions
// 1): the first implementation of the whole seam, so the platform can be built and tested
// against it before any real POS is wired. It only does what the POS lets it (its switches'
// capabilities), the safest way: it reads before it writes, writes once, and never retries.
//
//   - One deadline per step, from the platform's timings: a step that runs out is `unknown`
//     (a write) or incomplete (a read), never refused (D115).
//   - A list is read page by page and checked against the count the POS states: a failed or
//     short page makes the whole reading incomplete (rule 6).
//   - Every POS id leaves inside a PosRef (rule 3); money is minor units through the money
//     module, from the exact text of each JSON number (rule 8).
//   - Writes go through `./write` only (D110); an undefined behaviour of the POS (501), or a
//     request it calls malformed, throws: that is a bug here, never a guess.

import {
  addMinor,
  type Currency,
  chooseTargetBill,
  decimalToMinor,
  type Floor,
  type FloorBar,
  type FloorTable,
  type IsolatedHandle,
  minorToDecimal,
  type PosBill,
  type PosRef,
  posRef,
  type Reading,
  type Refusal,
  type RefusalCode,
  type RefusalScope,
  type ServiceConnector,
  samePosRef,
  subtractMinor,
  type TableBills,
} from '@restro/core'
import { z } from 'zod'

import { type Sent, type SimClient, type SimTransport, segment, simClient } from './client'
import { capabilitiesOf, type SimSwitches } from './switches'
import * as write from './write'

export const SIM_KIND = 'sim'

export interface SimPosConnectorOptions {
  readonly transport: SimTransport
  readonly login: { readonly user: string; readonly password: string }
  /** The simulated POS's switches: the connector declares what they allow. */
  readonly switches: SimSwitches
  readonly currency?: Currency
  /** The logins whose rows read as Restro's (`whoEnteredLine`). Default: this login. */
  readonly restroLogins?: readonly string[]
  /**
   * The POS's tip article: a tip on close is one row of it (`tipAsLine`, Q41; D127's tip line in
   * group А). Without it `recordTipOnClose` is not declared, whatever the switches allow.
   */
  readonly tipItem?: string
}

/** A POS answer the connector cannot take: an undefined behaviour, a malformed request, or a shape it doesn't know. */
export class SimPosConnectorError extends Error {
  override name = 'SimPosConnectorError'
  constructor(
    readonly code: 'undefined_behaviour' | 'bad_request' | 'unexpected_answer',
    detail: string,
  ) {
    super(detail)
  }
}

// ---------------------------------------------------------------------------------------------
// Answer shapes (every JSON number arrives as its source text)

const Id = z.string().min(1).max(200)
const Count = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
const Money = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .transform((text) => decimalToMinor(text))

const PageShape = z.object({ page: Count, pages: Count, count: Count, items: z.array(z.unknown()) })
const TableItem = z.object({
  id: Id,
  number: z.string().min(1),
  hall: z.string().min(1),
  bar: Id.optional(),
})
const BarItem = z.object({ id: Id, name: z.string().min(1) })
const BillItem = z.object({ id: Id, total: Money, paid: Money })
const RowItem = z.object({
  id: Id,
  article: Id,
  name: z.string(),
  quantity: z.string(),
  amount: Money,
  by: z.string().optional(),
  at: z.string().optional(),
  ref: z.string().nullable().optional(),
})
const AddAnswer = z.object({ bill: Id, opened: z.boolean() })
const MoveAnswer = z.object({ bill: Id })
const CloseAnswer = z.object({ bill: Id, receipt: z.string().min(1).optional() })
const PingAnswer = z.object({ mode: z.enum(['live', 'training']).optional() })
const ErrorAnswer = z.object({
  error: z.string(),
  detail: z.string().optional(),
  line: Count.optional(),
})

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new SimPosConnectorError('unexpected_answer', `${what}: ${parsed.error.message}`)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------------------------
// From an answer to an outcome

type Failure =
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'unknown'; readonly reason: string }

function refusal(
  code: RefusalCode,
  scope: RefusalScope,
  detail: string | null,
  line: number | null = null,
): { readonly kind: 'refused'; readonly refusal: Refusal } {
  const index = scope === 'line' ? line : null
  // A line refusal must name its line; where the POS named none, it reaches the bill.
  const reach: RefusalScope = scope === 'line' && index === null ? 'bill' : scope
  return {
    kind: 'refused',
    refusal: { code, scope: reach, line: index, detail: detail?.slice(0, 500) ?? null },
  }
}

/** A definite refusal where the POS said one; else `unknown`. Throws on what is our bug. */
function failureOf(sent: Sent): Failure {
  if (sent.kind === 'lost') return { kind: 'unknown', reason: sent.reason }
  const body = ErrorAnswer.safeParse(sent.body)
  const error = body.success ? body.data.error : 'unreadable'
  const detail = body.success ? (body.data.detail ?? null) : null
  const line = body.success ? (body.data.line ?? null) : null
  switch (sent.status) {
    case 501:
      throw new SimPosConnectorError('undefined_behaviour', detail ?? 'undefined behaviour')
    case 400:
    case 404:
      throw new SimPosConnectorError('bad_request', `${sent.status} ${error}: ${detail ?? ''}`)
    case 401:
      return refusal('credentials', 'login', detail)
    case 403:
      // An outside app may not add to a waiter's bill: the guest asks the waiter (D124 §3).
      return error === 'staff_bill'
        ? refusal('needs_first_item', 'bill', detail)
        : refusal('no_rights', 'login', detail)
    case 409:
      if (error === 'bill_closed' || error === 'bill_locked' || error === 'needs_first_item') {
        return refusal(error, 'bill', detail)
      }
      break
    case 422:
      if (error === 'sold_out') return refusal('item_unavailable', 'line', detail, line)
      if (error === 'article_unknown') return refusal('line_refused', 'line', detail, line)
      if (error === 'amount_mismatch') return refusal('amount_mismatch', 'bill', detail)
      if (error === 'fiscal_device') return refusal('fiscal_device', 'venue', detail)
      break
  }
  // Busy, failed, offline or anything else: the POS did not say it didn't (D115).
  return { kind: 'unknown', reason: `the POS answered ${sent.status} ${error}`.slice(0, 500) }
}

const ok = (sent: Sent): sent is Extract<Sent, { kind: 'answer' }> =>
  sent.kind === 'answer' && sent.status === 200

/** Runs a step under one deadline. */
async function within<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

type Listed<T> =
  | { readonly ok: true; readonly items: T[] }
  | { readonly ok: false; readonly reason: string }

function incomplete(reason: string): { readonly complete: false; readonly reason: string } {
  return { complete: false, reason: reason.slice(0, 500) }
}

function unknown(reason: string): { readonly kind: 'unknown'; readonly reason: string } {
  return { kind: 'unknown', reason: reason.slice(0, 500) }
}

/** Quantity text to thousandths, or null where it has more decimals than the POS keeps. */
function thousandths(text: string): number | null {
  return /^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(text) ? decimalToMinor(text, 3) : null
}

// ---------------------------------------------------------------------------------------------

export function createSimPosConnector(options: SimPosConnectorOptions): ServiceConnector {
  const tipItem = options.tipItem ?? null
  const declared = capabilitiesOf(options.switches)
  const capabilities = Object.freeze({
    ...declared,
    recordTipOnClose: declared.recordTipOnClose && tipItem !== null,
  })
  const client: SimClient = simClient(options.transport, options.login)
  const currency: Currency = options.currency ?? 'EUR'
  const restro = new Set(options.restroLogins ?? [options.login.user])
  /** Isolated bills of payments in flight: id → the bill and table they came from. */
  const inFlight = new Map<string, { readonly origin: string; readonly table: string }>()

  /** Every item of a paged list, or why the reading is incomplete (rule 6). */
  async function list<T>(
    path: string,
    item: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<Listed<T>> {
    const items: T[] = []
    let stated: { pages: number; count: number } | null = null
    for (let page = 1; stated === null || page <= stated.pages; page += 1) {
      const sent = await client.get(`${path}${path.includes('?') ? '&' : '?'}page=${page}`, signal)
      if (!ok(sent)) {
        const failure = failureOf(sent)
        return {
          ok: false,
          reason: failure.kind === 'unknown' ? failure.reason : `refused ${failure.refusal.code}`,
        }
      }
      const answer = parse(PageShape, sent.body, `page ${page} of ${path}`)
      if (stated !== null && (answer.pages !== stated.pages || answer.count !== stated.count)) {
        return { ok: false, reason: `${path} changed while it was read` }
      }
      stated = { pages: answer.pages, count: answer.count }
      items.push(...answer.items.map((value) => parse(item, value, `an item of ${path}`)))
    }
    if (stated === null || items.length !== stated.count) {
      return {
        ok: false,
        reason: `${path} gave ${items.length} items of the ${stated?.count ?? 0} it states`,
      }
    }
    return { ok: true, items }
  }

  async function tableBills(table: PosRef, signal: AbortSignal): Promise<Reading<TableBills>> {
    const heads = await list(`/api/tables/${segment(table.pos)}/bills?state=open`, BillItem, signal)
    if (!heads.ok) return incomplete(heads.reason)
    const bills: PosBill[] = []
    for (const head of heads.items) {
      const rows = await list(`/api/bills/${segment(head.id)}/rows`, RowItem, signal)
      if (!rows.ok) return incomplete(rows.reason)
      bills.push({
        ref: posRef(head.id),
        totalMinor: head.total,
        paidMinor: head.paid,
        // No switch says the POS gives either (D124 §2, §3): not claimed.
        openedAt: null,
        openedByRestro: null,
        paymentInFlight: inFlight.has(head.id),
        lines: rows.items.map((row) => ({
          ref: posRef(row.id),
          item: posRef(row.article),
          name: row.name,
          quantity: row.quantity,
          amountMinor: row.amount,
          enteredBy:
            capabilities.whoEnteredLine && row.by !== undefined
              ? restro.has(row.by)
                ? 'restro'
                : 'staff'
              : null,
          enteredAt: capabilities.whoEnteredLine ? (row.at ?? null) : null,
          restroRef: capabilities.ownLineReference ? (row.ref ?? null) : null,
        })),
      })
    }
    return { complete: true, value: { table, currency, bills } }
  }

  return {
    kind: SIM_KIND,
    capabilities,

    async probe(ctx) {
      const sent = await within(ctx.timings.probeBudgetMs, (signal) =>
        client.get('/api/ping', signal),
      )
      if (!ok(sent)) {
        const failure = failureOf(sent)
        return failure.kind === 'refused' ? failure : unknown(failure.reason)
      }
      const answer = parse(PingAnswer, sent.body, 'the ping')
      return {
        kind: 'answered',
        mode: capabilities.trainingMode ? (answer.mode ?? null) : null,
        degraded: null,
        fiscalDevice: null,
      }
    },

    async readFloor(ctx): Promise<Reading<Floor>> {
      return within(ctx.timings.readTimeoutMs, async (signal) => {
        const tables = await list('/api/tables', TableItem, signal)
        if (!tables.ok) return incomplete(tables.reason)
        let bars: FloorBar[] = []
        if (capabilities.tableBar) {
          const listed = await list('/api/bars', BarItem, signal)
          if (!listed.ok) return incomplete(listed.reason)
          bars = listed.items.map((bar) => ({ ref: posRef(bar.id), name: bar.name }))
        }
        const floor: FloorTable[] = tables.items.map((table) => ({
          ref: posRef(table.id),
          name: table.number,
          area: table.hall,
          bar: capabilities.tableBar && table.bar !== undefined ? posRef(table.bar) : null,
          // The POS has no mark for a payment table: they are ordinary tables only Restro uses.
          paymentTable: null,
        }))
        return { complete: true, value: { tables: floor, bars } }
      })
    },

    readTable(ctx, table) {
      return within(ctx.timings.readTimeoutMs, (signal) => tableBills(table, signal))
    },

    async readIsolated(ctx, isolated) {
      const reading = await within(ctx.timings.readTimeoutMs, (signal) =>
        tableBills(isolated.table, signal),
      )
      if (!reading.complete) return reading
      const bill = reading.value.bills.find((b) => samePosRef(b.ref, isolated.ref)) ?? null
      return { complete: true, value: { currency, bill } }
    },

    async addLines(ctx, request) {
      for (const [index, line] of request.lines.entries()) {
        if (!capabilities.notesReachTicket && (line.note !== null || line.options.length > 0)) {
          return refusal('not_supported', 'line', 'notes and options do not reach the bar', index)
        }
      }
      const before = await within(ctx.timings.readTimeoutMs, (signal) =>
        tableBills(request.table, signal),
      )
      if (!before.complete) {
        return unknown(
          `the table read incomplete before the round, which was not sent: ${before.reason}`,
        )
      }
      const target = chooseTargetBill({
        bills: before.value.bills,
        capabilities,
        serviceDayStartsAt: new Date(request.serviceDayStartsAt),
        excludeBills: request.excludeBills,
      })
      if (target.kind === 'refuse') {
        return refusal(target.code, 'bill', 'Ask your waiter to put your first item on')
      }
      const body = {
        bill: target.kind === 'join' ? target.bill.pos : 'new',
        rows: request.lines.map((line) => ({
          article: line.item.pos,
          quantity: line.quantity,
          ...(capabilities.notesReachTicket
            ? { note: line.note, options: line.options.map((option) => option.pos) }
            : {}),
          ...(capabilities.ownLineReference ? { ref: request.ref } : {}),
        })),
        ...(capabilities.idempotentAdd ? { ref: request.ref } : {}),
      }
      const sent = await within(ctx.timings.writeTimeoutMs, (signal) =>
        write.postRows(client, request.table.pos, body, signal),
      )
      if (!ok(sent)) return failureOf(sent)
      const answer = parse(AddAnswer, sent.body, 'the add')
      return { kind: 'done', result: { bill: posRef(answer.bill), opened: answer.opened } }
    },

    async isolateLines(ctx, request) {
      const split = capabilities.severalBillsPerTable
      if (!split && !capabilities.moveLinesToTable) {
        return refusal('not_supported', 'bill', 'Ask your waiter to split this bill')
      }
      const paymentTable = split ? null : request.paymentTable
      if (!split && paymentTable === null) {
        return refusal('not_supported', 'bill', 'isolating here needs a payment table')
      }
      const first = request.picks[0]
      if (first === undefined || request.picks.some((pick) => !samePosRef(pick.bill, first.bill))) {
        return refusal('not_supported', 'bill', 'the picks come from more than one POS bill')
      }
      const real = await within(ctx.timings.readTimeoutMs, (signal) =>
        tableBills(request.table, signal),
      )
      if (!real.complete)
        return unknown(`the table read incomplete, nothing was moved: ${real.reason}`)
      const bill = real.value.bills.find((b) => samePosRef(b.ref, first.bill))
      if (bill === undefined) return refusal('bill_closed', 'bill', 'the bill is no longer open')
      if (bill.paymentInFlight) return refusal('busy', 'bill', 'another payment holds this bill')
      const sum = bill.lines.reduce((total, line) => addMinor(total, line.amountMinor), 0)
      if (sum !== bill.totalMinor) {
        // A charge of the bill's own (Q37): moving lines off it is not defined.
        return refusal('not_supported', 'bill', 'Ask your waiter to split this bill')
      }
      const rows: { row: string; quantity?: string }[] = []
      const seen = new Set<string>()
      for (const [index, pick] of request.picks.entries()) {
        const line = bill.lines.find((l) => samePosRef(l.ref, pick.line))
        const held = line === undefined ? null : thousandths(line.quantity)
        const wanted = thousandths(pick.quantity)
        if (line === undefined || held === null || wanted === null || seen.has(pick.line.pos)) {
          return refusal(
            'line_refused',
            'line',
            'the pick does not match a line of the bill',
            index,
          )
        }
        seen.add(pick.line.pos)
        if (wanted > held) return refusal('line_refused', 'line', 'more than the line holds', index)
        if (wanted < held && !capabilities.movePartOfLineQuantity) {
          return refusal('not_supported', 'line', 'only whole lines move', index)
        }
        rows.push(
          wanted < held ? { row: pick.line.pos, quantity: pick.quantity } : { row: pick.line.pos },
        )
      }
      let target: PosRef = request.table
      if (paymentTable !== null) {
        const busy = await within(ctx.timings.readTimeoutMs, (signal) =>
          tableBills(paymentTable, signal),
        )
        if (!busy.complete) return unknown(`the payment table read incomplete: ${busy.reason}`)
        if (busy.value.bills.length > 0) {
          return refusal('busy', 'bill', 'the payment table holds another payment')
        }
        target = paymentTable
      }
      const body = {
        rows,
        to: split ? { table: request.table.pos, bill: 'new' } : { table: target.pos },
      }
      const sent = await within(ctx.timings.writeTimeoutMs, (signal) =>
        write.moveRows(client, bill.ref.pos, body, signal),
      )
      if (!ok(sent)) return failureOf(sent)
      const answer = parse(MoveAnswer, sent.body, 'the move')
      inFlight.set(answer.bill, { origin: bill.ref.pos, table: request.table.pos })
      const isolated: IsolatedHandle = { ref: posRef(answer.bill), table: target }
      return { kind: 'done', result: { isolated } }
    },

    async payAndClose(ctx, request) {
      // D127: a tip goes on the same bill and receipt, or it isn't taken. Nothing is written.
      if (request.tipMinor > 0 && (!capabilities.recordTipOnClose || tipItem === null)) {
        return refusal('not_supported', 'bill', 'the POS records no tip from Restro')
      }
      if (!capabilities.closeWithPaymentType) {
        return refusal('not_supported', 'bill', 'the POS takes no payment from Restro')
      }
      if (request.tipMinor > 0 && tipItem !== null) {
        // The tip row and the close are two calls: read first, so a bill that won't close for
        // this amount gets no tip row; then the row, as a waiter adds it at the till, then the
        // close. A tip row that landed before a failed close stays for staff (undoIsolate).
        const reading = await within(ctx.timings.readTimeoutMs, (signal) =>
          tableBills(request.isolated.table, signal),
        )
        if (!reading.complete) {
          return unknown(
            `the isolated bill read incomplete, nothing was written: ${reading.reason}`,
          )
        }
        const bill = reading.value.bills.find((b) => samePosRef(b.ref, request.isolated.ref))
        if (bill === undefined) return refusal('bill_closed', 'bill', 'the bill is no longer open')
        const balance = subtractMinor(bill.totalMinor, bill.paidMinor)
        // A retry after a timeout (D115): this close's tip row may already be on the bill. It is
        // found by Restro's reference where the POS carries one, else as the tip article's row of
        // exactly this tip; then it is not posted again and the bill closes as it stands.
        const landed = bill.lines.some(
          (line) =>
            line.item?.pos === tipItem &&
            (capabilities.ownLineReference
              ? line.restroRef === request.ref
              : line.amountMinor === request.tipMinor),
        )
        const expected = landed ? balance : addMinor(balance, request.tipMinor)
        if (expected !== request.amountMinor) {
          return refusal('amount_mismatch', 'bill', 'the bill and the tip are not the amount')
        }
        if (!landed) {
          const tip = {
            bill: bill.ref.pos,
            rows: [
              {
                article: tipItem,
                quantity: '1',
                amount: minorToDecimal(request.tipMinor),
                ...(capabilities.ownLineReference ? { ref: request.ref } : {}),
              },
            ],
            ...(capabilities.idempotentAdd ? { ref: `${request.ref}-tip` } : {}),
          }
          const added = await within(ctx.timings.writeTimeoutMs, (signal) =>
            write.postRows(client, request.isolated.table.pos, tip, signal),
          )
          if (!ok(added)) return failureOf(added)
        }
      }
      const body = {
        payments: [
          {
            ...(request.paymentType === null ? {} : { type: request.paymentType.pos }),
            amount: minorToDecimal(request.amountMinor),
          },
        ],
      }
      const sent = await within(ctx.timings.writeTimeoutMs, (signal) =>
        write.closeBill(client, request.isolated.ref.pos, body, signal),
      )
      if (!ok(sent)) return failureOf(sent)
      const answer = parse(CloseAnswer, sent.body, 'the close')
      inFlight.delete(request.isolated.ref.pos)
      const receiptNumber = capabilities.receiptNumberOnClose ? (answer.receipt ?? null) : null
      return { kind: 'done', result: { receiptNumber } }
    },

    async undoIsolate(ctx, request) {
      const reading = await within(ctx.timings.readTimeoutMs, (signal) =>
        tableBills(request.isolated.table, signal),
      )
      if (!reading.complete) return unknown(`the isolated bill read incomplete: ${reading.reason}`)
      const isolated = reading.value.bills.find((b) => samePosRef(b.ref, request.isolated.ref))
      if (isolated === undefined) {
        return refusal('bill_closed', 'bill', 'the isolated bill is no longer open')
      }
      if (tipItem !== null && isolated.lines.some((line) => line.item?.pos === tipItem)) {
        // A tip row from a close that failed: moved back, it would charge the table a tip.
        return refusal('not_supported', 'bill', 'a tip is on this bill: staff take it off')
      }
      if (isolated.lines.length > 0) {
        let to: { table: string; bill?: string } = { table: request.table.pos }
        if (capabilities.severalBillsPerTable) {
          const real = await within(ctx.timings.readTimeoutMs, (signal) =>
            tableBills(request.table, signal),
          )
          if (!real.complete) return unknown(`the table read incomplete: ${real.reason}`)
          const origin = inFlight.get(request.isolated.ref.pos)?.origin
          const open = real.value.bills.some((b) => b.ref.pos === origin)
          to = { table: request.table.pos, bill: open && origin !== undefined ? origin : 'new' }
        }
        const body = { rows: isolated.lines.map((line) => ({ row: line.ref.pos })), to }
        const sent = await within(ctx.timings.writeTimeoutMs, (signal) =>
          write.moveRows(client, isolated.ref.pos, body, signal),
        )
        if (!ok(sent)) return failureOf(sent)
      }
      inFlight.delete(request.isolated.ref.pos)
      return { kind: 'done', result: {} }
    },
  }
}
