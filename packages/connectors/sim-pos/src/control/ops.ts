// The waiter control (#71; #51 design §2.5): every operation of a waiter at the POS's front end,
// offered by name so the control page, the CLI and a scenario's `setup` list call the same code.
// Each operation is a thin call into `engine.waiter` (which stays the one place the rules live);
// this file only turns names and text arguments into those calls and answers JSON-safe data.
//
// Tables are named the way staff say them, by their number ("7") or by the POS's own id; a bill by
// its id, or by `table` when the table has one open bill. Quantities and amounts stay text and
// minor units (rule 8): nothing here does arithmetic on money.

import { z } from 'zod'
import type { SimEngine } from '../engine/engine'
import { SimSetupError } from '../engine/errors'
import type { SimBill, SimTable } from '../engine/state'

/** Thrown for an operation the caller got wrong (unknown name, bad arguments, nothing found). */
export class WaiterOpError extends Error {
  override name = 'WaiterOpError'
}

/** One argument of an operation, for the control page's form and the CLI's help. */
export interface WaiterOpParam {
  readonly name: string
  readonly hint: string
  readonly required: boolean
}

export interface WaiterOp {
  readonly name: string
  readonly summary: string
  readonly params: readonly WaiterOpParam[]
  readonly schema: z.ZodType
  run(engine: SimEngine, args: never): unknown
}

// --- finding things -----------------------------------------------------------------------------

function tableOf(engine: SimEngine, key: string): SimTable {
  const tables = engine.state.tables
  const found =
    tables.find((table) => table.id === key) ?? tables.find((table) => table.number === key)
  if (found === undefined) throw new WaiterOpError(`no table "${key}" (use its number or its id)`)
  return found
}

/** The one open bill of a table. */
function openBillOf(engine: SimEngine, table: SimTable): SimBill {
  const open = engine.state.bills.filter((bill) => bill.table === table.id && bill.state === 'open')
  if (open.length === 0) throw new WaiterOpError(`table ${table.number} has no open bill`)
  if (open.length > 1) {
    throw new WaiterOpError(`table ${table.number} has ${open.length} open bills; name one`)
  }
  return open[0] as SimBill
}

function billOf(
  engine: SimEngine,
  target: { bill?: string | undefined; table?: string | undefined },
) {
  if (target.bill !== undefined) {
    const bill = engine.state.bills.find((candidate) => candidate.id === target.bill)
    if (bill === undefined) throw new WaiterOpError(`no bill "${target.bill}"`)
    return bill
  }
  if (target.table !== undefined) return openBillOf(engine, tableOf(engine, target.table))
  throw new WaiterOpError('name a bill (--bill) or a table with one open bill (--table)')
}

/** `article[:quantity]` → one entry; the quantity stays text ("2", "0.5"). */
function parsePick(text: string): { id: string; quantity: string | undefined } {
  const colon = text.lastIndexOf(':')
  if (colon > 0 && /^\d+(\.\d+)?$/.test(text.slice(colon + 1))) {
    return { id: text.slice(0, colon), quantity: text.slice(colon + 1) }
  }
  return { id: text, quantity: undefined }
}

// --- argument shapes ----------------------------------------------------------------------------

const Text = z.string().min(1).max(200)
/** One or several texts; a form or a command line gives them as one text, comma-separated. */
const Picks = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '')
      : value,
  z.array(Text).min(1),
)
/** A flag as JSON (true) or as a command line gives it ("true"). */
const Flag = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
])
const Target = { bill: Text.optional(), table: Text.optional() }

const bill = (
  target: { bill?: string | undefined; table?: string | undefined },
  engine: SimEngine,
) => billOf(engine, target)

function define<S extends z.ZodType>(op: {
  readonly name: string
  readonly summary: string
  readonly params: readonly WaiterOpParam[]
  readonly schema: S
  readonly run: (engine: SimEngine, args: z.output<S>) => unknown
}): WaiterOp {
  return op as unknown as WaiterOp
}

const param = (name: string, hint: string, required = true): WaiterOpParam => ({
  name,
  hint,
  required,
})
const targetParams = [
  param('table', 'the table number or id'),
  param('bill', 'or the bill id', false),
] as const

function round(engine: SimEngine, args: z.output<typeof RoundArgs>) {
  const table = tableOf(engine, args.table)
  const added = engine.waiter.addRound(
    table.id,
    args.items.map((item) => {
      const pick = parsePick(item)
      return {
        article: pick.id,
        ...(pick.quantity === undefined ? {} : { quantity: pick.quantity }),
      }
    }),
    {
      ...(args.by === undefined ? {} : { by: args.by }),
      ...(args.bill === undefined ? {} : { bill: args.bill }),
    },
  )
  return { bill: added.bill, rows: added.rows }
}

const RoundArgs = z.strictObject({
  table: Text,
  items: Picks,
  by: Text.optional(),
  bill: Text.optional(),
})

const itemsParam = param('items', 'articles to add, repeated: --items 2001:2 --items 2502')

/** Every operation, in the order the control page lists them. */
export const WAITER_OPS: readonly WaiterOp[] = [
  define({
    name: 'put-first-item',
    summary: "Puts a table's first item on: opens its bill.",
    params: [
      param('table', 'the table number or id'),
      itemsParam,
      param('by', 'a waiter login', false),
    ],
    schema: RoundArgs.omit({ bill: true }),
    run(engine, args) {
      const table = tableOf(engine, args.table)
      if (engine.state.bills.some((open) => open.table === table.id && open.state === 'open')) {
        throw new WaiterOpError(`table ${table.number} already has an open bill; use add-round`)
      }
      return round(engine, { ...args })
    },
  }),
  define({
    name: 'add-round',
    summary: "Adds a round to the table's bill (opens one if the table has none).",
    params: [
      param('table', 'the table number or id'),
      itemsParam,
      param('by', 'a waiter login', false),
      param('bill', 'a bill id, or "new" (several-bill POS only)', false),
    ],
    schema: RoundArgs,
    run: round,
  }),
  define({
    name: 'void-line',
    summary: 'Voids a row, or part of its quantity.',
    params: [...targetParams, param('row', 'the row id'), param('quantity', 'part to void', false)],
    schema: z.strictObject({ ...Target, row: Text, quantity: Text.optional() }),
    run(engine, args) {
      const target = bill(args, engine)
      return {
        bill: target.id,
        voidedMinor: engine.waiter.voidLine(target.id, args.row, args.quantity),
      }
    },
  }),
  define({
    name: 'move-lines',
    summary: "Moves rows to another table's bill (opened if it has none).",
    params: [
      ...targetParams,
      param('rows', 'row ids, repeated; row:quantity moves part'),
      param('to', 'the table to move to (number or id)'),
    ],
    schema: z.strictObject({ ...Target, rows: Picks, to: Text }),
    run(engine, args) {
      const from = bill(args, engine)
      const to = tableOf(engine, args.to)
      const moved = engine.waiter.moveLines(
        from.id,
        args.rows.map((row) => {
          const pick = parsePick(row)
          return {
            row: pick.id,
            ...(pick.quantity === undefined ? {} : { quantity: pick.quantity }),
          }
        }),
        to.id,
      )
      return { from: from.id, to: moved.bill }
    },
  }),
  define({
    name: 'close-bill',
    summary: 'Closes a bill in cash or by card at its balance.',
    params: [...targetParams, param('kind', 'cash (default) or card', false)],
    schema: z.strictObject({ ...Target, kind: z.enum(['cash', 'card']).optional() }),
    run(engine, args) {
      const target = bill(args, engine)
      engine.waiter.closeBill(target.id, args.kind ?? 'cash')
      return { bill: target.id, closed: true }
    },
  }),
  define({
    name: 'lock-bill',
    summary: 'Holds a bill as if open on a terminal: other changes are refused.',
    params: targetParams,
    schema: z.strictObject(Target),
    run(engine, args) {
      const target = bill(args, engine)
      engine.waiter.lockBill(target.id)
      return { bill: target.id, locked: true }
    },
  }),
  define({
    name: 'unlock-bill',
    summary: 'Lets go of a locked bill.',
    params: targetParams,
    schema: z.strictObject(Target),
    run(engine, args) {
      const target = bill(args, engine)
      engine.waiter.unlockBill(target.id)
      return { bill: target.id, locked: false }
    },
  }),
  define({
    name: 'split-bill',
    summary: 'Splits rows off onto a new bill of the same table (several-bill POS only).',
    params: [...targetParams, param('rows', 'row ids, repeated')],
    schema: z.strictObject({ ...Target, rows: Picks }),
    run(engine, args) {
      const source = bill(args, engine)
      return { bill: engine.waiter.splitBill(source.id, args.rows).bill }
    },
  }),
  define({
    name: 'merge-bills',
    summary: 'Moves every row of one bill onto another of the same table (several-bill POS only).',
    params: [param('from', 'the bill to empty'), param('into', 'the bill that receives')],
    schema: z.strictObject({ from: Text, into: Text }),
    run(engine, args) {
      engine.waiter.mergeBills(args.from, args.into)
      return { from: args.from, into: args.into }
    },
  }),
  define({
    name: 'sold-out',
    summary: 'Marks an article sold out (soldOut false puts it back).',
    params: [
      param('article', 'the article id'),
      param('soldOut', 'true (default) or false', false),
    ],
    schema: z.strictObject({ article: Text, soldOut: Flag.optional() }),
    run(engine, args) {
      engine.waiter.markSoldOut(args.article, args.soldOut ?? true)
      return { article: args.article, soldOut: args.soldOut ?? true }
    },
  }),
  define({
    name: 'offline',
    summary: 'Takes a login offline: every call it makes fails until it is back.',
    params: [param('login', 'the login id')],
    schema: z.strictObject({ login: Text }),
    run(engine, args) {
      engine.waiter.takeOffline(args.login)
      return { login: args.login, offline: true }
    },
  }),
  define({
    name: 'online',
    summary: 'Brings a login back.',
    params: [param('login', 'the login id')],
    schema: z.strictObject({ login: Text }),
    run(engine, args) {
      engine.waiter.bringOnline(args.login)
      return { login: args.login, offline: false }
    },
  }),
  define({
    name: 'approve-round',
    summary: 'Approves the rows waiting at the bar on a bill; the ticket prints now.',
    params: targetParams,
    schema: z.strictObject(Target),
    run(engine, args) {
      const target = bill(args, engine)
      engine.waiter.approveRound(target.id)
      return { bill: target.id }
    },
  }),
  define({
    name: 'charge-bill',
    summary:
      "Puts a charge of the bill's own on it (an entrance fee), in minor units; its total is then not the sum of its rows (Q37).",
    params: [...targetParams, param('amountMinor', 'a whole number of cents, e.g. 500')],
    schema: z.strictObject({ ...Target, amountMinor: z.coerce.number().int() }),
    run(engine, args) {
      const target = bill(args, engine)
      engine.waiter.chargeBill(target.id, args.amountMinor)
      return { bill: target.id, amountMinor: args.amountMinor }
    },
  }),
  define({
    name: 'training',
    summary: "Turns the POS's training mode on or off.",
    params: [param('on', 'true or false')],
    schema: z.strictObject({ on: Flag }),
    run(engine, args) {
      engine.waiter.setTrainingMode(args.on)
      return { training: args.on }
    },
  }),
  define({
    name: 'printer-down',
    summary: 'The fiscal printer fails (or works again): a close then prints no receipt.',
    params: [param('down', 'true or false')],
    schema: z.strictObject({ down: Flag }),
    run(engine, args) {
      engine.waiter.setPrinterDown(args.down)
      return { printerDown: args.down }
    },
  }),
  define({
    name: 'close-day',
    summary: 'Closes the service day (only with no bill open).',
    params: [],
    schema: z.strictObject({}),
    run(engine) {
      engine.waiter.closeDay()
      return { day: engine.state.day }
    },
  }),
]

/** The operation names, for the CLI's help and the page's list. */
export const WAITER_OP_NAMES: readonly string[] = WAITER_OPS.map((op) => op.name)

/**
 * Runs one operation. The arguments are checked with the operation's schema; a mistake of the
 * caller is a `WaiterOpError`, and a POS rule the engine refuses (a closed bill, an undefined
 * behaviour) reaches the caller as the engine's own error.
 */
export function runWaiterOp(engine: SimEngine, name: string, args: unknown): unknown {
  const op = WAITER_OPS.find((candidate) => candidate.name === name)
  if (op === undefined) {
    throw new WaiterOpError(`no operation "${name}" (known: ${WAITER_OP_NAMES.join(', ')})`)
  }
  const parsed = op.schema.safeParse(args)
  if (!parsed.success) throw new WaiterOpError(`${name}: ${z.prettifyError(parsed.error)}`)
  return op.run(engine, parsed.data as never)
}

export { SimSetupError }
