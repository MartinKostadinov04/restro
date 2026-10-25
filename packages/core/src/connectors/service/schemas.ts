// The shapes that cross the service seam (spec #64, Implementation Decisions 1; #51 design §1;
// the connector-fitness verification of 10-22). Zod at the boundary: a connector's answer is
// parsed with these before the platform acts on it, and the conformance kit parses every answer.
//
// Two rules belong to the interface, not only its types:
//   - a timeout is always `unknown`: never `refused`, never a reason to write again (D115);
//   - a reading with any failed part is `complete: false` and concludes nothing (rule 6, D122 §6).

import { z } from 'zod'

import { CurrencySchema } from '../../money'
import { DecimalQuantitySchema } from '../../quantity'
import { PosRefSchema } from './pos-ref'

// ---------------------------------------------------------------------------------------------
// Values

/** A quantity as the POS sent it, as decimal text (`quantity.ts`, shared with the bill). */
export { DecimalQuantitySchema }

/** A quantity Restro sends: decimal text above zero. */
export const OrderQuantitySchema = DecimalQuantitySchema.refine(
  (value) => !value.startsWith('-') && /[1-9]/.test(value),
  'a quantity Restro sends is above zero',
)

/** A signed amount in minor units: discounts and negative lines exist (verification fix 30). */
export const SignedMinorSchema = z.int()

/** A non-negative amount in minor units. */
export const MinorSchema = z.int().nonnegative()

/** A moment with its offset, as ISO 8601 text. */
export const InstantSchema = z.iso.datetime({ offset: true })

// ---------------------------------------------------------------------------------------------
// Refusals and outcomes

/**
 * How far a refusal reaches (verification fix 55+56): this line or item, this POS bill, the whole
 * POS login, or the whole venue. The first `login` or `venue` refusal starts a connection pause
 * at once (D120, D122 §6).
 */
export const REFUSAL_SCOPES = ['line', 'bill', 'login', 'venue'] as const
export type RefusalScope = (typeof REFUSAL_SCOPES)[number]

/**
 * Why the POS said a definite "no" (#51 design §1; D120's outright refusals; C46, C47). A
 * connector maps its POS's answer to one of these only where the POS's docs or a recording say
 * so; anything else that is not a clear yes is `unknown`.
 */
export const REFUSAL_CODES = [
  /** The chosen POS bill is closed (D115: read the table again and use the next one). */
  'bill_closed',
  /** The chosen POS bill is locked by staff. */
  'bill_locked',
  /** No POS bill to join and the connector may not open one (D122 §4, D124 §2). */
  'needs_first_item',
  /** An item cannot be sold now (C47); the refusal names its line. */
  'item_unavailable',
  /** The POS refused one line for another reason it names. */
  'line_refused',
  /** The amount does not match what the POS expects (a close). */
  'amount_mismatch',
  /** The step was already done (a second close of the same bill). */
  'already_done',
  /** The POS is busy with this bill (another device holds it). */
  'busy',
  /** The POS login's credentials are refused. */
  'credentials',
  /** The POS login lacks a right this step needs. */
  'no_rights',
  /** Restro's cash desk, or its equivalent, is missing (D120). */
  'cash_desk_missing',
  /** The POS's cash period or day is closed (D120). */
  'period_closed',
  /** The fiscal device refuses (verification fix 55+56: a close pause). */
  'fiscal_device',
  /** The connector does not offer this step: its capability is not declared. */
  'not_supported',
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** A definite "no", with its reach. `line` is the index of the refused line where scope is `line`. */
export const RefusalSchema = z
  .strictObject({
    code: z.enum(REFUSAL_CODES),
    scope: z.enum(REFUSAL_SCOPES),
    line: z.int().nonnegative().nullable(),
    /** The POS's own words, for the Restro team's Log only: never shown to a guest (rule 3). */
    detail: z.string().max(500).nullable(),
  })
  .refine((refusal) => (refusal.scope === 'line') === (refusal.line !== null), {
    message: 'a line refusal names its line, and only a line refusal does',
  })
export type Refusal = z.output<typeof RefusalSchema>

/**
 * What a write step answers: done, a definite "no", or `unknown` (a timeout: read back, D115).
 * The payment provider seam reuses it with its own refusal (`connectors/payment`).
 */
export function writeOutcomeSchema<R extends z.ZodType>(
  result: R,
): ReturnType<typeof outcomeSchema<R, typeof RefusalSchema>>
export function writeOutcomeSchema<R extends z.ZodType, F extends z.ZodType>(
  result: R,
  refusal: F,
): ReturnType<typeof outcomeSchema<R, F>>
export function writeOutcomeSchema(result: z.ZodType, refusal: z.ZodType = RefusalSchema) {
  return outcomeSchema(result, refusal)
}

function outcomeSchema<R extends z.ZodType, F extends z.ZodType>(result: R, refusal: F) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('done'), result }),
    z.strictObject({ kind: z.literal('refused'), refusal }),
    z.strictObject({ kind: z.literal('unknown'), reason: z.string().max(500) }),
  ])
}
export type WriteOutcome<R, F = Refusal> =
  | { readonly kind: 'done'; readonly result: R }
  | { readonly kind: 'refused'; readonly refusal: F }
  | { readonly kind: 'unknown'; readonly reason: string }

/** What a read answers. An incomplete reading concludes nothing (rule 6), never a shorter list. */
export function readingSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('complete', [
    z.strictObject({ complete: z.literal(true), value }),
    z.strictObject({ complete: z.literal(false), reason: z.string().max(500) }),
  ])
}
export type Reading<T> =
  | { readonly complete: true; readonly value: T }
  | { readonly complete: false; readonly reason: string }

// ---------------------------------------------------------------------------------------------
// The probe (D120's "cheap POS read", D122 §6, D124 §5)

/**
 * The probe's answer. It never writes (rule 7). Beside "it answered", it carries the POS's current
 * mode where the POS reports one (training mode pauses a live connection at once, D124 §5),
 * whether the POS says it is degraded, and the fiscal device's state where readable. `null` means
 * the POS does not say.
 */
export const ProbeResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('answered'),
    mode: z.enum(['live', 'training']).nullable(),
    degraded: z.boolean().nullable(),
    fiscalDevice: z.enum(['ok', 'fault']).nullable(),
  }),
  z.strictObject({ kind: z.literal('refused'), refusal: RefusalSchema }),
  z.strictObject({ kind: z.literal('unknown'), reason: z.string().max(500) }),
])
export type ProbeResult = z.output<typeof ProbeResultSchema>

// ---------------------------------------------------------------------------------------------
// The floor (D122 §1, D124 §1)

/** A bar, where the POS knows bars. Never made up (D124 §1). */
export const FloorBarSchema = z.strictObject({
  ref: PosRefSchema,
  name: z.string().min(1).max(200),
})
export type FloorBar = z.output<typeof FloorBarSchema>

/** A table as the POS lists it. */
export const FloorTableSchema = z.strictObject({
  ref: PosRefSchema,
  /** The table's public label as the POS shows it ("7", "VIP"). */
  name: z.string().min(1).max(200),
  /** The table's area (a hall) as the POS names it, or null. */
  area: z.string().min(1).max(200).nullable(),
  /** The bar that serves it, or null where the POS has none or can't say (D124 §1). */
  bar: PosRefSchema.nullable(),
  /** Whether the POS marks it a payment table; null where the POS has no such mark. */
  paymentTable: z.boolean().nullable(),
})
export type FloorTable = z.output<typeof FloorTableSchema>

/** The floor: tables, payment tables among them, and the bars where the POS knows them. */
export const FloorSchema = z
  .strictObject({
    tables: z.array(FloorTableSchema),
    bars: z.array(FloorBarSchema),
  })
  .superRefine((floor, ctx) => {
    const bars = new Set(floor.bars.map((bar) => bar.ref.pos))
    const tables = new Set<string>()
    for (const [index, table] of floor.tables.entries()) {
      if (tables.has(table.ref.pos)) {
        ctx.addIssue({
          code: 'custom',
          message: 'a table is listed twice',
          path: ['tables', index],
        })
      }
      tables.add(table.ref.pos)
      if (table.bar !== null && !bars.has(table.bar.pos)) {
        ctx.addIssue({
          code: 'custom',
          message: 'a table names a bar the floor does not list',
          path: ['tables', index, 'bar'],
        })
      }
    }
    if (bars.size !== floor.bars.length) {
      ctx.addIssue({ code: 'custom', message: 'a bar is listed twice', path: ['bars'] })
    }
  })
export type Floor = z.output<typeof FloorSchema>

// ---------------------------------------------------------------------------------------------
// A table's reading, grouped per POS bill (D115, D122 §1; verification fixes 7+8, 17+31, 18,
// 28+29, 30, 37)

/** One line of a POS bill, as the POS gives it. */
export const BillLineSchema = z.strictObject({
  ref: PosRefSchema,
  /** The POS item, or null for a line with no item (a charge the POS adds). */
  item: PosRefSchema.nullable(),
  /** The POS's own text for the line, for D75's fallback; never used where our own name exists. */
  name: z.string().max(500).nullable(),
  quantity: DecimalQuantitySchema,
  /** The POS's own line total, signed; never quantity × price recomputed (rule 8). */
  amountMinor: SignedMinorSchema,
  /** Who entered it, where `whoEnteredLine` is declared; else null. */
  enteredBy: z.enum(['restro', 'staff']).nullable(),
  /** When it was entered, where the POS says; else null. */
  enteredAt: InstantSchema.nullable(),
  /** Restro's own reference read back, where `ownLineReference` is declared; else null. */
  restroRef: z.string().min(1).max(200).nullable(),
})
export type BillLine = z.output<typeof BillLineSchema>

/** One open POS bill on the table. */
export const PosBillSchema = z.strictObject({
  ref: PosRefSchema,
  /** The POS's own total for this bill, signed; not necessarily the sum of its lines (fix 17+31). */
  totalMinor: SignedMinorSchema,
  /** What is already paid against it (fix 18: a part-paid bill is not payable in the app). */
  paidMinor: MinorSchema,
  /** When the POS opened it, where `billOpeningTime` is declared; else null (D124 §2). */
  openedAt: InstantSchema.nullable(),
  /** Whether Restro's own POS login opened it, where the POS says; else null (D124 §3). */
  openedByRestro: z.boolean().nullable(),
  /** The isolated bill of a payment still in flight (part 2): never "the oldest" for a send. */
  paymentInFlight: z.boolean(),
  lines: z.array(BillLineSchema),
})
export type PosBill = z.output<typeof PosBillSchema>

/** A table's open POS bills, oldest first as the POS orders them. */
export const TableBillsSchema = z.strictObject({
  table: PosRefSchema,
  currency: CurrencySchema,
  bills: z.array(PosBillSchema),
})
export type TableBills = z.output<typeof TableBillsSchema>

/** The isolated bill of a payment (part 2): one POS bill, or nothing left to read. */
export const IsolatedBillSchema = z.strictObject({
  currency: CurrencySchema,
  bill: PosBillSchema.nullable(),
})
export type IsolatedBill = z.output<typeof IsolatedBillSchema>

/** The item-availability read (D122 §4, Stock), only where `itemAvailability` is declared. */
export const AvailabilitySchema = z.strictObject({
  items: z.array(z.strictObject({ item: PosRefSchema, available: z.boolean() })),
})
export type Availability = z.output<typeof AvailabilitySchema>

// ---------------------------------------------------------------------------------------------
// Write requests

/** A line Restro sends: an item, a quantity, its options and a note. Never a price (rule 5). */
export const OrderLineSchema = z.strictObject({
  item: PosRefSchema,
  quantity: OrderQuantitySchema,
  options: z.array(PosRefSchema).max(50),
  /** Sent only where `notesReachTicket` is declared (D122 §4). */
  note: z.string().max(200).nullable(),
})
export type OrderLine = z.output<typeof OrderLineSchema>

/** Restro's reference for one write (a sent order's or a payment step's). */
export const WriteRefSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** "Put these lines on this table's bill" (D115): the connector chooses the POS bill. */
export const AddLinesRequestSchema = z.strictObject({
  table: PosRefSchema,
  lines: z.array(OrderLineSchema).min(1).max(100),
  ref: WriteRefSchema,
  /** The start of the venue's current service day: never join a bill opened before it (D124 §2). */
  serviceDayStartsAt: InstantSchema,
  /** POS bills the platform has under payment: never joined by a send (fix 7+8). */
  excludeBills: z.array(PosRefSchema),
})
export type AddLinesRequest = z.output<typeof AddLinesRequestSchema>

/** Which POS bill the lines went onto, where the POS says. */
export const AddLinesResultSchema = z.strictObject({
  /**
   * Null only where the POS doesn't say. Where `firstItemsOpenBill` is declared, a round that
   * opened a bill always names it: pay-first finds its round by it (D127, #113; the kit checks).
   */
  bill: PosRefSchema.nullable(),
  opened: z.boolean(),
})
export type AddLinesResult = z.output<typeof AddLinesResultSchema>

/** A picked line and how much of it (part 2: what a guest pays). */
export const LinePickSchema = z.strictObject({
  bill: PosRefSchema,
  line: PosRefSchema,
  quantity: OrderQuantitySchema,
})
export type LinePick = z.output<typeof LinePickSchema>

/**
 * What the POS made when it isolated the picks (fix 7+8): opaque to the platform, stored as a
 * backend fact of the moment. A payment table at a one-bill POS, a split-off POS bill elsewhere.
 */
export const IsolatedHandleSchema = z.strictObject({
  ref: PosRefSchema,
  table: PosRefSchema,
})
export type IsolatedHandle = z.output<typeof IsolatedHandleSchema>

/** Isolate the picks (D122 §8 step 3), onto `paymentTable` where the POS moves lines to a table. */
export const IsolateLinesRequestSchema = z.strictObject({
  table: PosRefSchema,
  picks: z.array(LinePickSchema).min(1).max(100),
  paymentTable: PosRefSchema.nullable(),
  ref: WriteRefSchema,
})
export type IsolateLinesRequest = z.output<typeof IsolateLinesRequestSchema>

export const IsolateLinesResultSchema = z.strictObject({ isolated: IsolatedHandleSchema })
export type IsolateLinesResult = z.output<typeof IsolateLinesResultSchema>

/** Close the isolated bill with its payment (D122 §8 step 4). */
export const PayAndCloseRequestSchema = z
  .strictObject({
    isolated: IsolatedHandleSchema,
    /** The whole payment: the isolated bill's own amount plus the tip (D127 §The route). */
    amountMinor: MinorSchema,
    /**
     * The tip inside `amountMinor`, 0 for none. It goes on the same bill and fiscal receipt where
     * `recordTipOnClose` is declared; elsewhere a tip above 0 is refused before any write (D127).
     */
    tipMinor: MinorSchema,
    /** The POS's payment type, where `closeWithPaymentType` is declared; else null. */
    paymentType: PosRefSchema.nullable(),
    ref: WriteRefSchema,
  })
  .refine((request) => request.tipMinor <= request.amountMinor, {
    message: 'the tip is inside the amount, never above it',
    path: ['tipMinor'],
  })
export type PayAndCloseRequest = z.output<typeof PayAndCloseRequestSchema>

export const PayAndCloseResultSchema = z.strictObject({
  /** Where `receiptNumberOnClose` is declared; else null. Backend only. */
  receiptNumber: z.string().min(1).max(100).nullable(),
})
export type PayAndCloseResult = z.output<typeof PayAndCloseResultSchema>

/** Put isolated lines back on the real table (D122 §8: a declined card, a failed last check). */
export const UndoIsolateRequestSchema = z.strictObject({
  isolated: IsolatedHandleSchema,
  table: PosRefSchema,
  ref: WriteRefSchema,
})
export type UndoIsolateRequest = z.output<typeof UndoIsolateRequestSchema>

export const EmptyResultSchema = z.strictObject({})
export type EmptyResult = z.output<typeof EmptyResultSchema>
