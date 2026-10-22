// The wire's routes: POS-shaped HTTP onto the engine's calls (#51 design §2.1). Reads are GETs,
// writes are POSTs with a JSON body; ids sit in the path percent-encoded, since they may hold
// spaces. A body is parsed losslessly and checked with Zod: anything malformed is a 400, a path
// the POS doesn't have a 404.
//
//   GET  /api/ping                                   ping
//   GET  /api/tables?page=n                          listTables
//   GET  /api/bars?page=n                            listBars
//   GET  /api/tables/{table}/bills?state=open&page=n listBills
//   GET  /api/bills?state=open&page=n                listOpenBills
//   GET  /api/bills/{bill}/rows?page=n               listRows
//   POST /api/tables/{table}/rows                    addRows
//   POST /api/bills/{bill}/move                      moveRows
//   POST /api/bills/{bill}/void                      voidRow
//   POST /api/bills/{bill}/close                     closeBill
//   POST /api/sales                                  sale

import { decimalToMinor } from '@restro/core'
import { z } from 'zod'

import type { PaymentIn, RowIn, SimCall } from '../engine/calls'

export type Route =
  | { readonly kind: 'call'; readonly call: SimCall }
  | { readonly kind: 'error'; readonly status: 400 | 404; readonly detail: string }

const Id = z.string().min(1).max(200)
const Quantity = z.string().min(1).max(20)
const Amount = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,2})?$/, 'an amount of at most two decimals')
  .transform((text) => decimalToMinor(text))

const RowBody = z.strictObject({
  article: Id,
  quantity: Quantity,
  note: z.string().max(200).nullish(),
  options: z.array(Id).max(50).optional(),
  ref: z.string().min(1).max(200).nullish(),
  amount: Amount.optional(),
})
const PaymentBody = z.strictObject({ type: Id.nullish(), amount: Amount })

const AddBody = z.strictObject({
  bill: Id,
  rows: z.array(RowBody).max(100),
  ref: z.string().min(1).max(200).nullish(),
})
const MoveBody = z.strictObject({
  rows: z.array(z.strictObject({ row: Id, quantity: Quantity.nullish() })).max(100),
  to: z.strictObject({ table: Id, bill: Id.nullish() }),
})
const VoidBody = z.strictObject({ row: Id, quantity: Quantity.nullish() })
const CloseBody = z.strictObject({
  payments: z.array(PaymentBody).max(10),
  note: z.string().max(200).nullish(),
  receiptEmail: z.email().nullish(),
})
const SaleBody = z.strictObject({
  table: Id,
  rows: z.array(RowBody).max(100),
  payments: z.array(PaymentBody).max(10),
})

function rowIn(row: z.output<typeof RowBody>): RowIn {
  return {
    article: row.article,
    quantity: row.quantity,
    note: row.note ?? null,
    options: row.options ?? [],
    ref: row.ref ?? null,
    amountMinor: row.amount ?? null,
  }
}

function paymentIn(payment: z.output<typeof PaymentBody>): PaymentIn {
  return { type: payment.type ?? null, amountMinor: payment.amount }
}

const notFound: Route = { kind: 'error', status: 404, detail: 'no such path' }

function bad(detail: string): Route {
  return { kind: 'error', status: 400, detail }
}

function pageOf(query: URLSearchParams): number | null {
  const text = query.get('page') ?? '1'
  return /^[1-9]\d{0,5}$/.test(text) ? Number(text) : null
}

/** Maps a request onto an engine call. `body` is the losslessly parsed JSON body, or null. */
export function route(method: string, url: URL, body: unknown): Route {
  const parts = url.pathname.split('/').slice(1)
  if (parts[0] !== 'api') return notFound
  let segments: string[]
  try {
    segments = parts.slice(1).map((part) => decodeURIComponent(part))
  } catch {
    return bad('a path segment is not valid percent-encoding')
  }
  const [first, id, last, ...rest] = segments
  if (rest.length > 0) return notFound
  const query = url.searchParams

  if (method === 'GET') {
    const page = pageOf(query)
    if (page === null) return bad('page is a whole number from 1')
    const state = query.get('state') ?? 'open'
    if (state !== 'open' && state !== 'closed') return bad('state is open or closed')
    if (first === 'ping' && id === undefined) return call({ method: 'ping' })
    if (first === 'tables' && id === undefined) return call({ method: 'listTables', page })
    if (first === 'bars' && id === undefined) return call({ method: 'listBars', page })
    if (first === 'tables' && id !== undefined && last === 'bills') {
      return call({ method: 'listBills', table: id, state, page })
    }
    if (first === 'bills' && id === undefined) {
      return state === 'open' ? call({ method: 'listOpenBills', page }) : bad('state is open')
    }
    if (first === 'bills' && id !== undefined && last === 'rows') {
      return call({ method: 'listRows', bill: id, page })
    }
    return notFound
  }

  if (method === 'POST') {
    if (first === 'tables' && id !== undefined && last === 'rows') {
      return parsed(AddBody, body, (b) => ({
        method: 'addRows',
        table: id,
        bill: b.bill,
        rows: b.rows.map(rowIn),
        ref: b.ref ?? null,
      }))
    }
    if (first === 'bills' && id !== undefined && last === 'move') {
      return parsed(MoveBody, body, (b) => ({
        method: 'moveRows',
        bill: id,
        rows: b.rows.map((row) => ({ row: row.row, quantity: row.quantity ?? null })),
        to: { table: b.to.table, bill: b.to.bill ?? null },
      }))
    }
    if (first === 'bills' && id !== undefined && last === 'void') {
      return parsed(VoidBody, body, (b) => ({
        method: 'voidRow',
        bill: id,
        row: b.row,
        quantity: b.quantity ?? null,
      }))
    }
    if (first === 'bills' && id !== undefined && last === 'close') {
      return parsed(CloseBody, body, (b) => ({
        method: 'closeBill',
        bill: id,
        payments: b.payments.map(paymentIn),
        note: b.note ?? null,
        receiptEmail: b.receiptEmail ?? null,
      }))
    }
    if (first === 'sales' && id === undefined) {
      return parsed(SaleBody, body, (b) => ({
        method: 'sale',
        table: b.table,
        rows: b.rows.map(rowIn),
        payments: b.payments.map(paymentIn),
      }))
    }
    return notFound
  }
  return notFound
}

function call(simCall: SimCall): Route {
  return { kind: 'call', call: simCall }
}

function parsed<T>(schema: z.ZodType<T>, body: unknown, build: (value: T) => SimCall): Route {
  try {
    const result = schema.safeParse(body)
    if (!result.success) return bad(`malformed body: ${result.error.message}`)
    return call(build(result.data))
  } catch (error) {
    // A malformed amount fails inside the money module's transform.
    return bad(error instanceof Error ? error.message : 'malformed body')
  }
}
