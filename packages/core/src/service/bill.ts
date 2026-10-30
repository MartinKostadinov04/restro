// The table's bill as Restro keeps and shows it (D122 §1, §4, §6; ticket #74). A reading of the
// table's POS bills is stored in `bill_readings.bills`, one entry per POS bill, and shown to the
// phones through `billView`. Pure: no I/O.
//
// - Read (`TableReading`): what the worker hands to `reading.record`, the connector's reading
//   with its POS references as plain text (the service path never imports the connector side).
// - Stored (`StoredBill`): the reading plus our ids and the line's name from our own item. The
//   POS's references, its own text for a line and Restro's reference read back are *backend*:
//   they stay in the row for the send's choice of bill (D115, D124 §2, §3) and for part 2's
//   picks, and never leave it.
// - Shown (`BillView`): our ids, our name (null = "Other item", worded by the shell), the decimal
//   quantity and the POS's own signed amounts. A discount or a free line shows as the POS gives
//   it, and nothing marks a line as "from your phones".
// - Ids: `rd_` names one POS bill and `bn_` one line, each the first 128 bits of
//   `HMAC-SHA256(key, kind ‖ tenant ‖ POS row)`, so they are the same at every reading and say
//   nothing about the POS's ids without the key (`BILL_ID_KEY`, the worker's).
// - The end: a sitting ends when a complete reading shows its POS bills gone or empty after they
//   held lines, unless its lines sit on a payment table (`sittingEndsByReading`). A partial
//   reading concludes nothing (rule 6).

import { createHmac } from 'node:crypto'

import { z } from 'zod'

import { type BillId, type BillLineId, idFromBytes, idSchema, type NodeId } from '../ids'
import { LOCALES, type LocalizedText, LocalizedTextSchema } from '../locales'
import { CurrencySchema, sumSignedMinor } from '../money'
import { DecimalQuantitySchema } from '../quantity'

/** A reading older than this is read again when a guest opens the bill (D111). */
export const FRESH_READING_MS = 15_000

/** The shortest key `BILL_ID_KEY` may be. */
export const MIN_BILL_ID_KEY_LENGTH = 32

/** Checks the bill-id key and returns it. */
export function checkBillIdKey(key: string): string {
  if (key.trim().length < MIN_BILL_ID_KEY_LENGTH) {
    throw new Error(`BILL_ID_KEY needs ${MIN_BILL_ID_KEY_LENGTH} or more characters`)
  }
  return key
}

function derived<K extends 'rd' | 'bn'>(kind: K, key: string, parts: readonly string[]) {
  // Each part is length-prefixed, so no two different rows can make the same text.
  const hmac = createHmac('sha256', checkBillIdKey(key))
  hmac.update([kind, ...parts].map((part) => `${part.length}:${part}`).join('|'))
  return idFromBytes(kind, hmac.digest())
}

/** The `rd_` id of one POS bill of the tenant. */
export function billIdOf(key: string, tenantId: string, bill: string): BillId {
  return derived('rd', key, [tenantId, bill])
}

/** The `bn_` id of one line of one POS bill of the tenant. */
export function billLineIdOf(
  key: string,
  tenantId: string,
  bill: string,
  line: string,
): BillLineId {
  return derived('bn', key, [tenantId, bill, line])
}

// ---------------------------------------------------------------------------------------------
// Read: what the worker hands over

const PosIdSchema = z.string().min(1).max(200)
const InstantSchema = z.iso.datetime({ offset: true })

/**
 * One line of a POS bill as the worker hands it to `reading.record`: the connector's line with
 * its POS references as plain text (the service path never imports the connector side).
 */
export const ReadLineSchema = z.strictObject({
  /** *Backend*: the POS's line. */
  pos: PosIdSchema,
  /** *Backend*: the POS's item, or null for a line with no item. */
  itemPos: PosIdSchema.nullable(),
  /** *Backend*: the POS's own text for the line. */
  posName: z.string().max(500).nullable(),
  quantity: DecimalQuantitySchema,
  /** The POS's own line total, signed (a discount is negative); never recomputed (rule 8). */
  amountMinor: z.int(),
  /** *Backend*: who entered it, where the POS says. Never shown to a guest. */
  enteredBy: z.enum(['restro', 'staff']).nullable(),
  enteredAt: InstantSchema.nullable(),
  /** *Backend*: Restro's own reference read back, where the POS keeps one. */
  restroRef: PosIdSchema.nullable(),
})
export type ReadLine = z.output<typeof ReadLineSchema>

/** One open POS bill of the table as the worker hands it over. */
export const ReadBillSchema = z.strictObject({
  /** *Backend*: the POS's bill. */
  pos: PosIdSchema,
  /** The POS's own total, signed; not necessarily the sum of its lines. */
  totalMinor: z.int(),
  paidMinor: z.int().nonnegative(),
  openedAt: InstantSchema.nullable(),
  /** *Backend*: whether Restro's own login opened it (fix 25's fallback: join the oldest such). */
  openedByRestro: z.boolean().nullable(),
  /** The isolated bill of a payment in flight (part 2): shown as being paid. */
  paymentInFlight: z.boolean(),
  lines: z.array(ReadLineSchema),
})
export type ReadBill = z.output<typeof ReadBillSchema>

/** A reading of the table's POS bills; a partial one concludes nothing (rule 6). */
export const TableReadingSchema = z.discriminatedUnion('complete', [
  z.strictObject({
    complete: z.literal(true),
    currency: CurrencySchema,
    bills: z.array(ReadBillSchema),
  }),
  z.strictObject({ complete: z.literal(false), reason: z.string().max(500) }),
])
export type TableReading = z.output<typeof TableReadingSchema>

// ---------------------------------------------------------------------------------------------
// Stored

/** One line as `bill_readings.bills` keeps it: the line read, our id, our item and its name. */
export const StoredBillLineSchema = ReadLineSchema.extend({
  id: idSchema('bn'),
  /** Our item, through its till link; null when the POS item is not linked (or there is none). */
  itemId: idSchema('nd').nullable(),
  /** Our item's name, resolved when the reading was recorded; null shows as "Other item". */
  name: LocalizedTextSchema.nullable(),
})
export type StoredBillLine = z.output<typeof StoredBillLineSchema>

/** One POS bill as `bill_readings.bills` keeps it. */
export const StoredBillSchema = ReadBillSchema.extend({
  id: idSchema('rd'),
  currency: CurrencySchema,
  lines: z.array(StoredBillLineSchema),
})
export type StoredBill = z.output<typeof StoredBillSchema>

/** What `bill_readings.bills` holds. */
export const StoredBillsSchema = z.array(StoredBillSchema)

/** Our item and its name for a POS item, as the recorder found them. */
export interface LineItem {
  readonly itemId: NodeId
  readonly name: LocalizedText | null
}

/**
 * The reading's POS bills as Restro stores them: our ids beside the POS's references, and the
 * name of our item where the POS item is linked to one.
 */
export function storedBills(input: {
  readonly key: string
  readonly tenantId: string
  readonly currency: string
  readonly bills: readonly ReadBill[]
  /** Our item for a POS item id, where it is linked. */
  readonly itemOf: (pos: string) => LineItem | undefined
}): StoredBill[] {
  return StoredBillsSchema.parse(
    input.bills.map((bill) => ({
      ...bill,
      id: billIdOf(input.key, input.tenantId, bill.pos),
      currency: input.currency,
      lines: bill.lines.map((line) => {
        const item = line.itemPos === null ? undefined : input.itemOf(line.itemPos)
        return {
          ...line,
          id: billLineIdOf(input.key, input.tenantId, bill.pos, line.pos),
          itemId: item?.itemId ?? null,
          name: item?.name ?? null,
        }
      }),
    })),
  )
}

/** The stored bills of a row; a row that no longer parses shows as no bill (never a crash). */
export function parseStoredBills(value: unknown): StoredBill[] {
  const parsed = StoredBillsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

// ---------------------------------------------------------------------------------------------
// Shown

/** One line as a phone sees it. */
export interface BillLineView {
  readonly id: BillLineId
  /** Our item's name; null is "Other item", worded by the shell. */
  readonly name: LocalizedText | null
  /** Decimal text, as the POS gave it ("2", "0.5", "-1"). */
  readonly quantity: string
  /** The POS's own line amount, signed: a discount or a free line as the POS gives it. */
  readonly amountMinor: number
  /** The line is in a payment that isn't final (#110): no payer, amount or timer. */
  readonly beingPaid: boolean
}

/** One POS bill as a phone sees it. */
export interface BillPartView {
  readonly id: BillId
  /** A payment is under way on it (part 2). */
  readonly beingPaid: boolean
  readonly totalMinor: number
  readonly paidMinor: number
  readonly lines: readonly BillLineView[]
}

/**
 * A line's name as a payment line keeps it (#197): its non-empty texts per language, or null for
 * "Other item" (worded by the shell, D75). Never an empty object.
 */
export function paymentLineName(
  name: LocalizedText | null | undefined,
): Record<string, string> | null {
  const kept = Object.entries(name ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  )
  return kept.length === 0 ? null : Object.fromEntries(kept)
}

/**
 * A line paid in the app in this sitting (D127 1.2): the name the guest saw, the quantity and the
 * amount, and never who paid. It carries no id: nothing acts on it, and a POS line's id is backend.
 */
export interface PaidLineView {
  /** The line's name per language; null is "Other item", worded by the shell. */
  readonly name: Record<string, string> | null
  /** Decimal text ("2", "0.5"). */
  readonly quantity: string
  readonly amountMinor: number
}

/** The table's bill as a phone sees it. */
export interface BillView {
  /** When the bill shown was read. */
  readonly readAt: Date
  /** False when the latest reading failed: the bill shown is the last complete one. */
  readonly complete: boolean
  readonly currency: string | null
  /** What the POS's bills come to, what is paid, and what is left. */
  readonly totalMinor: number
  readonly paidMinor: number
  readonly owedMinor: number
  readonly bills: readonly BillPartView[]
  /** The sitting's captured payments' lines, oldest payment first; they stay until it ends. */
  readonly paidLines: readonly PaidLineView[]
}

/** The phones' view of stored bills: our ids and names, the POS's amounts, nothing backend. */
export function billView(input: {
  readonly readAt: Date
  readonly complete: boolean
  readonly bills: readonly StoredBill[]
  /** *Backend*: the POS lines a payment still claims (`payment_lines.open`). */
  readonly beingPaid?: ReadonlySet<string>
  /** The lines of the sitting's captured payments (`payment_lines`; never a payer). */
  readonly paidLines?: readonly PaidLineView[]
}): BillView {
  // The POS's amounts are signed (rule 8: through the money module).
  const totalMinor = sumSignedMinor(input.bills.map((bill) => bill.totalMinor))
  const paidMinor = sumSignedMinor(input.bills.map((bill) => bill.paidMinor))
  return {
    readAt: input.readAt,
    complete: input.complete,
    currency: input.bills[0]?.currency ?? null,
    totalMinor,
    paidMinor,
    owedMinor: sumSignedMinor([totalMinor, -paidMinor]),
    bills: input.bills.map((bill) => ({
      id: bill.id,
      beingPaid: bill.paymentInFlight,
      totalMinor: bill.totalMinor,
      paidMinor: bill.paidMinor,
      lines: bill.lines.map((line) => ({
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
        beingPaid: input.beingPaid?.has(line.pos) ?? false,
      })),
    })),
    paidLines: input.paidLines ?? [],
  }
}

/** Every key a `BillView` has. */
const VIEW_KEYS = [
  'readAt',
  'complete',
  'currency',
  'totalMinor',
  'paidMinor',
  'owedMinor',
  'bills',
  'paidLines',
  'id',
  'beingPaid',
  'lines',
  'name',
  'quantity',
  'amountMinor',
] as const

/**
 * The backend strings of stored bills (rule 3): the POS's references, its own line text and
 * Restro's reference read back. None of them may appear in what a phone gets. As in the
 * snapshot's leak guard, a string that is public anyway is left out: the POS's text for a line
 * is usually our item's name in one language (the till layer), a POS id may read like a
 * quantity ("2"), and the view's own field names and locale keys are ours.
 */
export function billBackendValues(bills: readonly StoredBill[]): Set<string> {
  const backend = new Set<string>()
  const shown = new Set<string>()
  for (const bill of bills) {
    backend.add(bill.pos)
    shown.add(bill.currency)
    for (const line of bill.lines) {
      backend.add(line.pos)
      if (line.itemPos !== null) backend.add(line.itemPos)
      if (line.posName !== null && line.posName !== '') backend.add(line.posName)
      if (line.restroRef !== null) backend.add(line.restroRef)
      shown.add(line.quantity)
      for (const text of Object.values(line.name ?? {})) if (text !== undefined) shown.add(text)
    }
  }
  // The view's own keys are ours too: a POS id that reads like one ("id") leaks nothing.
  for (const name of [...VIEW_KEYS, ...LOCALES]) shown.add(name)
  return new Set([...backend].filter((value) => !shown.has(value)))
}

/**
 * The forbidden-values walk: the paths of every string, value or key, in `value` that is one of
 * `forbidden`. Empty when nothing backend is in it. Paths name places, never the value.
 */
export function forbiddenPaths(value: unknown, forbidden: ReadonlySet<string>): string[] {
  const found: string[] = []
  const walk = (member: unknown, path: string) => {
    if (typeof member === 'string') {
      if (forbidden.has(member)) found.push(path)
    } else if (Array.isArray(member)) {
      for (const [index, item] of member.entries()) walk(item, `${path}[${index}]`)
    } else if (typeof member === 'object' && member !== null && !(member instanceof Date)) {
      for (const [key, item] of Object.entries(member)) {
        if (forbidden.has(key)) found.push(`${path}.<key>`)
        walk(item, `${path}.${key}`)
      }
    }
  }
  walk(value, '$')
  return found
}

// ---------------------------------------------------------------------------------------------
// The end of a sitting by a reading

/** What decides whether a reading ends the sitting. */
export interface EndFacts {
  /** The reading is complete: a partial one concludes nothing (rule 6). */
  readonly complete: boolean
  /** The sitting's POS bills held lines at an earlier reading (not for a table opened bare). */
  readonly hadBillLines: boolean
  /** The reading's POS bills; gone ones are simply not listed. */
  readonly bills: readonly { readonly lines: readonly unknown[] }[]
  /** Some of the sitting's lines sit on a payment table (part 2): the payment is not done. */
  readonly onPaymentTable: boolean
}

/**
 * True when the reading ends the sitting: complete, the bills held lines before, every POS bill
 * is gone or empty now, and nothing of the table sits on a payment table.
 */
export function sittingEndsByReading(facts: EndFacts): boolean {
  if (!facts.complete || !facts.hadBillLines || facts.onPaymentTable) return false
  return facts.bills.every((bill) => bill.lines.length === 0)
}

/** True when the bill shown is too old for a guest who opens it: read it again (D111). */
export function wantsFreshReading(readAt: Date | null, now: Date): boolean {
  return readAt === null || now.getTime() - readAt.getTime() > FRESH_READING_MS
}
