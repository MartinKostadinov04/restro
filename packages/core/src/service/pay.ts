// Paying on the bill, from Pay to a held card (#110; D127 §Where things run, §Limits; design §3,
// §4, §5.1 steps 1–4, §9). The guest's three commands and the worker's steps, each a
// compare-and-set on `payments.state` under the payment's row lock:
//
//   requested ──payment.price──▶ priced ──payment.hold_created──▶ awaiting_guest ──payment.check──▶ held
//       │                          │                                   │
//       └── released ◀── payment.settle ◀── cancelling ◀── pay.cancel / a deadline ┘
//
// - `pay.start` checks the phone's knock against the latest stored reading, refuses a line that is
//   already in an open payment, and records the payment `requested` with its lines: from then on
//   the lines read `beingPaid` on every phone. The database keeps a POS line in one open payment
//   (`payment_lines_open_line_unique`, migration 0032), so two friends picking the same line can't
//   both win, whatever the timing; the table's order row lock makes the loser a clean refusal.
// - The worker reads the table fresh and prices it (`payment.price`): the POS's own line amounts
//   plus the tip, never price × quantity (rule 8). A picked line that changed or went is
//   `bill_changed`; the provider's minimum is `below_minimum`.
// - Every provider write is a `payment.step` row `attempting` before the call (D127 3.9); the hold
//   it made is `payment.hold_created`, which keeps the card form's values (`form_values`) while the
//   payment awaits the guest and nowhere else.
// - `payment.check` takes the provider's reading after `pay.returned` or a notice: a hold for
//   exactly the amount is `held`; anything else stays until the deadline (2 minutes to confirm, 10
//   for the provider's session), when the payment is cancelled.
// - Leaving `awaiting_guest` clears `form_values` in the same update, whatever the next state.
//
// The service path imports nothing under connectors/ (no-outbound.test.ts): the provider's reading
// and the form's values are restated here in the database's words. No payer, phone or handle is
// stored: only the handle's sha-256 (`handle_hash`).

import {
  billReadings,
  paymentLines,
  paymentSteps,
  payments,
  sentOrders,
  venueTables,
} from '@restro/db'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { addMinor, percentOfMinor, sumSignedMinor } from '../money'
import { readPayingSettings } from '../paying-settings'
import { DecimalQuantitySchema } from '../quantity'
import { orderFromRow, releaseHeldLines } from '../table-order'
import { parseStoredBills, paymentLineName, type StoredBill, type StoredBillLine } from './bill'
import { defineCommand, type ServiceTx } from './definition'
import { recordRetainUntil } from './log'
import { writeOrder } from './order'
import { orderingPaused } from './pause-scope'
import { movePayFirstSentOrder } from './pay-first-sent-order'
import { payingPaused } from './paying-pause'
import { loadPayingConnection } from './payment-connection'
import { accepted, refused, type ServiceResult } from './results'
import { readTableCapabilities } from './table-capabilities'

/** Why a guest's pay command was refused (design §3; the template words each, #45). */
export const PAY_REFUSALS = [
  /** The venue takes no card payments in the app (no connected account). */
  'paying_not_offered',
  /** The venue's paying is paused (its account lost access). */
  'paying_paused',
  /** A picked line is in another payment that isn't final. */
  'being_paid',
  /** A picked line changed or went since the phone saw it (the knock, D111). */
  'bill_changed',
  /** Below the venue's smallest card payment. */
  'below_minimum',
  /** A tip where the POS can't put one on the receipt (D127; the phone hears `ordering.tips`). */
  'tip_not_offered',
  /** Only a waiter can split this: a whole-bill discount, a part-paid bill, part of a line. */
  'ask_waiter_to_split',
  /** Turnstile said no. */
  'turnstile',
  /** Too many payments: this phone's or the table's. */
  'rate_limited',
  /** The table has no open sitting. */
  'sitting_ended',
  /** The hold was made: a cancel comes too late. */
  'too_late',
  /** No payment of this table has that handle. */
  'unknown_payment',
] as const

/** How long the guest has to confirm once the form's values reach the phone (design §6). */
export const PAYMENT_CONFIRM_MS = 2 * 60_000
/** How long the provider's session lasts from then (design §6). */
export const PAYMENT_SESSION_MS = 10 * 60_000
/** At most this many payments that aren't final per table (design §9). */
export const TABLE_OPEN_PAYMENTS = 3
/** How long a held payment waits for a free payment table (design §6: 60 seconds from `held`). */
export const PAYMENT_QUEUE_MS = 60_000

/** The payment states before a hold is made: a cancel still wins. */
const BEFORE_HOLD = ['requested', 'priced', 'awaiting_guest'] as const
/** The final states (`PAYMENT_FINAL_STATES` in `@restro/db`). */
const FINAL = new Set(['captured', 'released', 'unconfirmed', 'stranded', 'capture_failed'])

const tableId = idSchema('tb')
const actionId = z.uuid()
const paymentId = idSchema('py')
/** The sha-256 of the phone's payment handle, made by the guest API; never the handle. */
const handleHash = z.string().regex(/^[0-9a-f]{64}$/)
/** A whole amount in minor units (rule 8). */
const MinorSchema = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** A short code (a reason, a step's answer): the database's name pattern. */
const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
/** *Backend*: a provider's id, in the database's pattern. */
const ProviderRefTextSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/)
/** *Backend*: a POS reference as the reading gives it. */
const PosRefSchema = z.string().min(1).max(200)

/**
 * *Backend*: the lines read on a payment table right before a move back (`undoIsolate`), by POS
 * reference, quantity and the POS's amount (rule 3: never past the backend). A later run proves
 * them back on the real table from these, never from lines it did not read (#153).
 */
export const PaymentStepLinesSchema = z
  .array(
    z.strictObject({ pos: PosRefSchema, quantity: DecimalQuantitySchema, amountMinor: z.int() }),
  )
  .min(1)
  .max(500)
export type PaymentStepLines = z.output<typeof PaymentStepLinesSchema>

/**
 * The card form's values (`ProviderFormValuesSchema` in the payment seam, restated): opaque, never
 * read, held only while the payment awaits the guest.
 */
const FormValuesSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.string().min(1).max(2000))
  .refine((values) => Object.keys(values).length <= 16)

/** One line as the phone saw it (the knock): our id, its quantity and the POS's amount. */
const SeenLineSchema = z.strictObject({
  lineId: idSchema('bn'),
  quantity: DecimalQuantitySchema,
  amountMinor: z.int(),
})

/** What a phone picks: whole lines of the bill, or the whole bill. */
const PickSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('lines'),
    lines: z
      .array(z.strictObject({ lineId: idSchema('bn'), quantity: DecimalQuantitySchema }))
      .min(1)
      .max(200),
  }),
  z.strictObject({ kind: z.literal('whole') }),
])

/** The tip: none, an amount, or a whole percent of the lines (rounded half-up, rule 8). */
export const TipSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('amount'), minor: MinorSchema }),
  z.strictObject({ kind: z.literal('percent'), percent: z.int().min(1).max(100) }),
])

// ---------------------------------------------------------------------------------------------
// Pure helpers

/** A decimal quantity as a scaled integer (6 places), so "2", "2.0" and "2.000000" compare equal. */
export function quantityKey(quantity: string): bigint {
  const negative = quantity.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? quantity.slice(1) : quantity).split('.')
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0')
  return negative ? -scaled : scaled
}

/** True when two decimal quantities are the same number. */
export function sameQuantity(a: string, b: string): boolean {
  return quantityKey(a) === quantityKey(b)
}

/**
 * The sum of signed POS amounts (a discount line is negative), through the money module. Null
 * when it would be below zero.
 */
export function signedSumMinor(amounts: readonly number[]): number | null {
  const sum = sumSignedMinor(amounts)
  return sum < 0 ? null : sum
}

/** The tip in minor units for lines worth `linesMinor`. */
export function tipOf(tip: z.output<typeof TipSchema>, linesMinor: number): number {
  if (tip.kind === 'none') return 0
  if (tip.kind === 'amount') return tip.minor
  return percentOfMinor(linesMinor, tip.percent)
}

/** The hold: the POS's own amounts for the picked lines plus the tip (D127 3.2), or null below 0. */
export function holdAmountMinor(lineAmounts: readonly number[], tipMinor: number): number | null {
  const lines = signedSumMinor(lineAmounts)
  return lines === null ? null : addMinor(lines, tipMinor)
}

/** The display name a payment line keeps: our item's name, else "Other item" (D75). */
function displayNameOf(line: StoredBillLine): string {
  const name = Object.values(line.name ?? {}).find((text) => text !== undefined && text !== '')
  return (name ?? 'Other item').slice(0, 200)
}

// ---------------------------------------------------------------------------------------------
// Reads under the transaction

export type PaymentRow = typeof payments.$inferSelect

/** The payment, locked; the table's order row first (lock order), so a change can touch the table. */
async function lockPayment(
  stx: ServiceTx,
  where: { readonly id: string } | { readonly handleHash: string; readonly tableId: string },
): Promise<{ readonly payment: PaymentRow; readonly tableOpen: boolean } | null> {
  const condition =
    'id' in where
      ? eq(payments.id, where.id)
      : and(eq(payments.handleHash, where.handleHash), eq(payments.tableId, where.tableId))
  // The table never changes on a payment, so it is read before the locks it decides.
  const [found] = await stx.tx
    .select({ id: payments.id, tableId: payments.tableId, sentOrderId: payments.sentOrderId })
    .from(payments)
    .where(and(condition, eq(payments.venueId, stx.venueId)))
  if (found === undefined) return null
  const order = await stx.rows.tableOrder(found.tableId)
  // A pay-first payment's sent order, in its place in the lock order (#113): `release` ends it.
  if (found.sentOrderId !== null) await lockSentOrder(stx, found.sentOrderId)
  stx.rows.claim('payment', [found.id])
  const [payment] = await stx.tx
    .select()
    .from(payments)
    .where(eq(payments.id, found.id))
    .for('update')
  if (payment === undefined) return null
  return { payment, tableOpen: order !== null }
}

/** Locks a pay-first payment's sent order (`sent_order` rank: after the order, before the payment). */
export async function lockSentOrder(stx: ServiceTx, id: string): Promise<void> {
  stx.rows.claim('sent_order', [id])
  await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(eq(sentOrders.id, id))
    .for('update')
}

/** The stored bills of the table's latest reading, when it was read in this sitting. */
async function storedBillsOf(
  stx: ServiceTx,
  table: string,
  sittingOpenedAt: Date,
): Promise<StoredBill[] | null> {
  const [reading] = await stx.tx
    .select({ readAt: billReadings.readAt, bills: billReadings.bills })
    .from(billReadings)
    .where(eq(billReadings.tableId, table))
  if (reading === undefined || reading.readAt < sittingOpenedAt) return null
  return parseStoredBills(reading.bills)
}

/**
 * Settles a payment `released` (or another final state: the route's `stranded`), the trigger
 * closes its lines, and ungreys them for every phone. Logged.
 */
export async function release(
  stx: ServiceTx,
  payment: PaymentRow,
  tableOpen: boolean,
  reason: string,
  state: 'released' | 'stranded' = 'released',
): Promise<void> {
  await stx.tx
    .update(payments)
    .set({
      state,
      reason,
      formValues: null,
      settledAt: sql`now()`,
      retainUntil: recordRetainUntil(await stx.dbNow()),
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(payments.id, payment.id))
  if (tableOpen) stx.rows.touch(payment.tableId)
  await logPayment(stx, payment, state, reason)
  if (payment.kind === 'pay_first') await endPayFirstBeforePos(stx, payment, reason)
}

/**
 * A pay-first payment that ended before its round reached the POS (#113): its lines are free on the
 * order again, and its sent order, still waiting, is Not sent. Once the round was entered or may
 * have been, the sent order and the lines stay as the route left them.
 */
export async function endPayFirstBeforePos(
  stx: ServiceTx,
  payment: Pick<PaymentRow, 'id' | 'tableId' | 'sentOrderId'>,
  reason: string,
): Promise<void> {
  const row = stx.rows.heldOrder(payment.tableId)
  if (row !== null) {
    const order = orderFromRow(row)
    if (order.lines.some((line) => line.heldBy === payment.id)) {
      await writeOrder(stx, row, releaseHeldLines(order, payment.id))
    }
  }
  await movePayFirstSentOrder(stx, payment, ['waiting'], 'not_sent', { reason })
}

/** The Log's line of a payment's step on its route (#111): a money record, kept 18 months. */
export async function logPayment(
  stx: ServiceTx,
  payment: Pick<PaymentRow, 'id' | 'tableId' | 'sittingId' | 'state'>,
  to: string,
  reason: string | null = null,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await stx.log({
    kind: 'payment.state',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    fromState: payment.state,
    toState: to,
    ...(reason === null ? {} : { reason }),
    ...(details === undefined ? {} : { details: { ...details } }),
  })
}

/** An accepted answer that names the payment and where it stands. */
function at(
  command: object,
  payment: { readonly id: string },
  state: string,
  changed: boolean,
): ServiceResult {
  // The worker's commands have no action id; the guest's do.
  const actionId =
    'actionId' in command && typeof command.actionId === 'string' ? command.actionId : null
  return accepted(actionId, {
    details: { paymentId: payment.id, state, changed },
  })
}

// ---------------------------------------------------------------------------------------------
// Guest commands

/** `pay.start`: the guest pays picked lines, or the whole bill (design §3). */
export function payStart() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('pay.start'),
      tableId,
      actionId,
      ageMs: z
        .int()
        .nonnegative()
        .max(24 * 60 * 60_000),
      handleHash,
      pick: PickSchema,
      /** The knock: every picked line as the phone saw it. */
      seen: z.array(SeenLineSchema).min(1).max(200),
      tip: TipSchema,
    }),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const refuse = (code: (typeof PAY_REFUSALS)[number]) => refused(command.actionId, code)
      // The table's order row serialises every payment of the table: the second of two friends
      // sees the first one's lines.
      const order = await stx.rows.tableOrder(command.tableId)

      // A repeat of the same tap finds its payment. The phone that repeats never got the first
      // answer (or lost it), so the handle it holds now is the new one: the hash is replaced.
      const [repeat] = await stx.tx
        .select({ id: payments.id, state: payments.state, tableId: payments.tableId })
        .from(payments)
        .where(eq(payments.actionId, command.actionId))
      if (repeat !== undefined) {
        if (repeat.tableId !== command.tableId) return refuse('unknown_payment')
        await stx.tx
          .update(payments)
          .set({ handleHash: command.handleHash, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(payments.id, repeat.id))
        return at(command, repeat, repeat.state, false)
      }

      // Paying is on only when the account is connected and every check of D125 2.3 passes; a
      // lost account pauses it (D125 2.4). The account row is locked `FOR SHARE`, so a disconnect
      // cannot land between this check and the payment.
      const connection = await loadPayingConnection(stx.tx, stx.venueId, 'share')
      if (connection.state === 'lost_access') return refuse('paying_paused')
      if (!connection.readiness.on || connection.providerKind === null) {
        return refuse('paying_not_offered')
      }
      // The provider's breaker (#112): paying pauses alone, ordering goes on.
      if (await payingPaused(stx)) return refuse('paying_paused')
      const account = { providerKind: connection.providerKind }

      if (order === null) return refuse('sitting_ended')
      const sitting = await stx.rows.openSitting(command.tableId)
      if (sitting === null) return refuse('sitting_ended')
      const [table] = await stx.tx
        .select({ barId: venueTables.barId })
        .from(venueTables)
        .where(eq(venueTables.id, command.tableId))
      // Paying pauses with ordering: the table's, its bar's, the venue's or the connection's (#111).
      if (await orderingPaused(stx, command.tableId, table?.barId ?? null)) {
        return refuse('paying_paused')
      }
      const bills = await storedBillsOf(stx, command.tableId, sitting.openedAt)
      if (bills === null) return refuse('bill_changed')

      // The lines picked, each with its POS bill, from the latest reading.
      const all = bills.flatMap((bill) => bill.lines.map((line) => ({ bill, line })))
      const lines: { readonly bill: StoredBill; readonly line: StoredBillLine }[] = []
      if (command.pick.kind === 'whole') {
        // The whole bill must be exactly what the phone saw: one line more or less changed it.
        if (all.length === 0 || all.length !== command.seen.length) return refuse('bill_changed')
        lines.push(...all)
      } else {
        const byId = new Map(all.map((entry) => [entry.line.id, entry]))
        for (const pick of command.pick.lines) {
          const found = byId.get(pick.lineId)
          if (found === undefined) return refuse('bill_changed')
          // Part of a line: the POS's own amount for it is known only once a waiter splits it.
          if (!sameQuantity(pick.quantity, found.line.quantity)) {
            return refuse('ask_waiter_to_split')
          }
          lines.push(found)
        }
        if (new Set(lines.map(({ line }) => line.id)).size !== lines.length) {
          return refused(command.actionId, 'invalid_command')
        }
      }
      // The knock (D111): each picked line as the phone saw it, unchanged.
      const seen = new Map(command.seen.map((line) => [line.lineId, line]))
      for (const { line } of lines) {
        const saw = seen.get(line.id)
        if (
          saw === undefined ||
          !sameQuantity(saw.quantity, line.quantity) ||
          saw.amountMinor !== line.amountMinor
        ) {
          return refuse('bill_changed')
        }
      }
      // A bill a payment already isolated is being paid; a part-paid bill, or a bill whose total
      // isn't its lines (a bill-level discount, D122 §8), only a waiter can split: the hold is the
      // picked lines' amounts, so any pick from it, the whole bill too, would charge too much.
      for (const bill of new Set(lines.map(({ bill }) => bill))) {
        if (bill.paymentInFlight) return refuse('being_paid')
        if (bill.paidMinor > 0) return refuse('ask_waiter_to_split')
        if (signedSumMinor(bill.lines.map((line) => line.amountMinor)) !== bill.totalMinor) {
          return refuse('ask_waiter_to_split')
        }
      }

      // The grey: a line in a payment that isn't final.
      const refs = lines.map(({ line }) => line.pos)
      const greyed = await stx.tx
        .select({ ref: paymentLines.posLineRef })
        .from(paymentLines)
        .where(
          and(
            eq(paymentLines.venueId, stx.venueId),
            eq(paymentLines.open, true),
            inArray(paymentLines.posLineRef, refs),
          ),
        )
      if (greyed.length > 0) return refuse('being_paid')
      const open = await stx.tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.tableId, command.tableId), isNull(payments.settledAt)))
      if (open.length >= TABLE_OPEN_PAYMENTS) return refuse('rate_limited')

      const linesMinor = signedSumMinor(lines.map(({ line }) => line.amountMinor))
      if (linesMinor === null || linesMinor === 0) return refuse('ask_waiter_to_split')
      const tipMinor = tipOf(command.tip, linesMinor)
      // A tip given as an amount stops at the lines' own amount (100 %, as a percent tip does).
      if (command.tip.kind === 'amount' && tipMinor > linesMinor) {
        return refused(command.actionId, 'invalid_command')
      }
      // No tip where the POS can't put it on the receipt (D127): the phone was told none is possible.
      if (
        tipMinor > 0 &&
        !(await readTableCapabilities(stx.tx, command.tableId)).recordTipOnClose
      ) {
        return refuse('tip_not_offered')
      }
      const amountMinor = addMinor(linesMinor, tipMinor)
      // The venue's own floor here; the provider's minimum is checked when the worker prices it.
      const floor = readPayingSettings(stx.venue.settings).minCardMinor ?? 0
      if (amountMinor < floor) return refuse('below_minimum')

      const id = newId('py')
      const currency = lines[0]?.bill.currency ?? 'EUR'
      await stx.tx.insert(payments).values({
        id,
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        tableId: command.tableId,
        sittingId: sitting.id,
        barId: table?.barId ?? null,
        serviceDate: stx.serviceDate,
        kind: 'on_bill',
        state: 'requested',
        handleHash: command.handleHash,
        actionId: command.actionId,
        tipMinor,
        currency,
        providerKind: account.providerKind,
        ...stx.provenance,
      })
      const made = await stx.tx
        .insert(paymentLines)
        .values(
          lines.map(({ line }, index) => ({
            tenantId: stx.tenantId,
            venueId: stx.venueId,
            paymentId: id,
            position: index + 1,
            posLineRef: line.pos,
            quantity: line.quantity,
            posAmountMinor: line.amountMinor,
            displayName: displayNameOf(line),
            name: paymentLineName(line.name),
            ...stx.provenance,
          })),
        )
        .onConflictDoNothing()
        .returning({ position: paymentLines.position })
      // The database's word on the grey (`payment_lines_open_line_unique`): refused, rolled back.
      if (made.length !== lines.length) return refuse('being_paid')
      stx.rows.touch(command.tableId)
      return at(command, { id }, 'requested', true)
    },
  })
}

/** `pay.returned` and `pay.cancel` name their payment by its handle. */
function byHandle<T extends 'pay.returned' | 'pay.cancel'>(type: T) {
  return z.strictObject({
    type: z.literal(type),
    tableId,
    actionId,
    ageMs: z
      .int()
      .nonnegative()
      .max(24 * 60 * 60_000),
    handleHash,
  })
}

/**
 * `pay.returned`: the phone is back from the card form. A nudge, never a fact: the guest API
 * queues the worker's check, which reads the provider.
 */
export function payReturned() {
  return defineCommand({
    schema: byHandle('pay.returned'),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const [payment] = await stx.tx
        .select({ id: payments.id, state: payments.state })
        .from(payments)
        .where(
          and(
            eq(payments.handleHash, command.handleHash),
            eq(payments.tableId, command.tableId),
            eq(payments.venueId, stx.venueId),
          ),
        )
      if (payment === undefined) return refused(command.actionId, 'unknown_payment')
      return at(command, payment, payment.state, false)
    },
  })
}

/** `pay.cancel`: only before the hold (design §3); the worker then cancels the provider's payment. */
export function payCancel() {
  return defineCommand({
    schema: byHandle('pay.cancel'),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const locked = await lockPayment(stx, {
        handleHash: command.handleHash,
        tableId: command.tableId,
      })
      if (locked === null) return refused(command.actionId, 'unknown_payment')
      const { payment, tableOpen } = locked
      if (payment.state === 'cancelling' || payment.state === 'released') {
        return at(command, payment, payment.state, false)
      }
      if (!(BEFORE_HOLD as readonly string[]).includes(payment.state)) {
        return refused(command.actionId, 'too_late')
      }
      if (payment.state === 'requested') {
        // No provider call is made before `priced`: nothing to cancel there.
        await release(stx, payment, tableOpen, 'cancelled')
        return at(command, payment, 'released', true)
      }
      await stx.tx
        .update(payments)
        .set({
          state: 'cancelling',
          reason: 'cancelled',
          formValues: null,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id))
      return at(command, payment, 'cancelling', true)
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Worker steps

/** One line of the fresh reading, as the worker hands it over (backend references). */
const FreshLineSchema = z.strictObject({
  pos: PosRefSchema,
  quantity: DecimalQuantitySchema,
  amountMinor: z.int(),
})

/**
 * `payment.price`: the fresh reading of the table, the provider's minimum, and whether the
 * connector records a tip on the close. `requested` → `priced`, or released with a reason.
 */
export function paymentPrice() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.price'),
      paymentId,
      /** Every line of the table's open POS bills, read now (a complete reading only). */
      lines: z.array(FreshLineSchema).max(2000),
      providerMinimumMinor: MinorSchema,
      /** The connector declares `recordTipOnClose`: a tip can reach the fiscal receipt. */
      tipAllowed: z.boolean(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockPayment(stx, { id: command.paymentId })
      if (locked === null) return refused(null, 'payment_missing')
      const { payment, tableOpen } = locked
      if (payment.state !== 'requested') return at(command, payment, payment.state, false)
      const picked = await stx.tx
        .select({
          posLineRef: paymentLines.posLineRef,
          quantity: paymentLines.quantity,
          posAmountMinor: paymentLines.posAmountMinor,
        })
        .from(paymentLines)
        .where(eq(paymentLines.paymentId, payment.id))
      const fresh = new Map(command.lines.map((line) => [line.pos, line]))
      // A pay-first payment's lines are not on the POS yet: priced from the published menu at
      // Send (on a POS venue, the POS's own prices; rule 5), never from a reading.
      const changed =
        payment.kind === 'on_bill' &&
        picked.some((line) => {
          const now = line.posLineRef === null ? undefined : fresh.get(line.posLineRef)
          return (
            now === undefined ||
            !sameQuantity(now.quantity, line.quantity) ||
            now.amountMinor !== line.posAmountMinor
          )
        })
      const releaseFor = async (reason: string) => {
        await release(stx, payment, tableOpen, reason)
        return at(command, payment, 'released', true)
      }
      // Only the picked lines are compared here: the bill-level checks (a part-paid bill, a whole-bill
      // discount) are made at `pay.start` only; a bill changed since is for #111's check of the moved lines.
      if (changed || picked.length === 0) return releaseFor('bill_changed')
      if (payment.tipMinor > 0 && !command.tipAllowed) return releaseFor('paying_not_offered')
      const amountMinor = holdAmountMinor(
        picked.map((line) => line.posAmountMinor),
        payment.tipMinor,
      )
      const floor = Math.max(
        readPayingSettings(stx.venue.settings).minCardMinor ?? 0,
        command.providerMinimumMinor,
        1,
      )
      if (amountMinor === null || amountMinor < floor) return releaseFor('below_minimum')
      await stx.tx
        .update(payments)
        .set({ state: 'priced', amountMinor, ...stx.provenance, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id))
      return accepted(null, {
        details: { paymentId: payment.id, state: 'priced', changed: true, amountMinor },
      })
    },
  })
}

/**
 * `payment.hold_created`: the provider made the hold. `priced` → `awaiting_guest` with the form's
 * values and the deadlines; a payment the guest cancelled meanwhile keeps only the provider's
 * reference, for the worker to release it.
 */
export function paymentHoldCreated() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.hold_created'),
      paymentId,
      providerPaymentRef: ProviderRefTextSchema,
      formValues: FormValuesSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockPayment(stx, { id: command.paymentId })
      if (locked === null) return refused(null, 'payment_missing')
      const { payment } = locked
      if (
        payment.providerPaymentRef !== null &&
        payment.providerPaymentRef !== command.providerPaymentRef
      ) {
        return refused(null, 'payment_mismatch', { reason: 'another_provider_payment' })
      }
      if (payment.state === 'priced') {
        const now = (await stx.dbNow()).getTime()
        await stx.tx
          .update(payments)
          .set({
            state: 'awaiting_guest',
            providerPaymentRef: command.providerPaymentRef,
            formValues: command.formValues,
            confirmBy: new Date(now + PAYMENT_CONFIRM_MS),
            sessionEndsAt: new Date(now + PAYMENT_SESSION_MS),
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(payments.id, payment.id))
        return at(command, payment, 'awaiting_guest', true)
      }
      if (payment.state === 'cancelling' && payment.providerPaymentRef === null) {
        await stx.tx
          .update(payments)
          .set({
            providerPaymentRef: command.providerPaymentRef,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(payments.id, payment.id))
        return at(command, payment, 'cancelling', true)
      }
      return at(command, payment, payment.state, false)
    },
  })
}

/**
 * `payment.check`: the provider's reading of the payment, after `pay.returned` or a notice. A hold
 * for exactly the amount → `held`. A payment the provider cancelled → released. Past the deadline
 * → `cancelling`. Anything else stays: whichever of the notice and `pay.returned` comes second
 * finds the payment held and changes nothing.
 */
export function paymentCheck() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.check'),
      paymentId,
      /** The provider's reading, restated (`ProviderPayment`). */
      reading: z.strictObject({
        ref: ProviderRefTextSchema,
        status: z.enum(['awaiting_guest', 'held', 'captured', 'released', 'failed']),
        needsGuestAction: z.boolean(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        amountMinor: MinorSchema,
        heldMinor: MinorSchema,
        captureBefore: z.iso.datetime({ offset: true }).nullable(),
        threeDs: CodeSchema.nullable(),
        authorisationCode: z.string().min(1).max(64).nullable(),
      }),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockPayment(stx, { id: command.paymentId })
      if (locked === null) return refused(null, 'payment_missing')
      const { payment, tableOpen } = locked
      if (payment.state !== 'awaiting_guest') return at(command, payment, payment.state, false)
      const read = command.reading
      if (payment.providerPaymentRef !== read.ref) {
        return refused(null, 'payment_mismatch', { reason: 'another_provider_payment' })
      }
      if (
        read.status === 'held' &&
        read.heldMinor === payment.amountMinor &&
        read.amountMinor === payment.amountMinor &&
        read.currency === payment.currency
      ) {
        // The wait for a payment table starts here (design §6, #111).
        const heldAt = (await stx.dbNow()).getTime()
        await stx.tx
          .update(payments)
          .set({
            state: 'held',
            queueEndsAt: new Date(heldAt + PAYMENT_QUEUE_MS),
            formValues: null,
            captureBefore: read.captureBefore === null ? null : new Date(read.captureBefore),
            threeDsResult: read.threeDs,
            authorisationCode: read.authorisationCode,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(payments.id, payment.id))
        await logPayment(stx, payment, 'held')
        return at(command, payment, 'held', true)
      }
      if (read.status === 'released') {
        await release(stx, payment, tableOpen, 'expired')
        return at(command, payment, 'released', true)
      }
      // Not held (yet): the deadlines decide (design §6). While the guest's bank asks for a step,
      // the confirm deadline stretches to the session's end.
      const now = (await stx.dbNow()).getTime()
      const sessionOver = payment.sessionEndsAt !== null && now >= payment.sessionEndsAt.getTime()
      const confirmOver = payment.confirmBy !== null && now >= payment.confirmBy.getTime()
      if (sessionOver || (confirmOver && !read.needsGuestAction)) {
        await stx.tx
          .update(payments)
          .set({
            state: 'cancelling',
            reason: 'expired',
            formValues: null,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(payments.id, payment.id))
        return at(command, payment, 'cancelling', true)
      }
      if (confirmOver && read.needsGuestAction && payment.sessionEndsAt !== null) {
        await stx.tx
          .update(payments)
          .set({ confirmBy: payment.sessionEndsAt, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(payments.id, payment.id))
      }
      return at(command, payment, 'awaiting_guest', false)
    },
  })
}

/**
 * `payment.settle`: the worker releases a payment that holds nothing at the provider (any more):
 * a cancel it carried out, or a hold the provider refused. Only from the states named. A payment
 * whose close was attempted is never released (#111), unless a manager or owner answered "No
 * receipt"; one whose lines could not move back settles `stranded`.
 */
export function paymentSettle() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.settle'),
      paymentId,
      from: z.enum(['priced', 'cancelling']),
      reason: CodeSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockPayment(stx, { id: command.paymentId })
      if (locked === null) return refused(null, 'payment_missing')
      const { payment, tableOpen } = locked
      if (payment.state !== command.from) return at(command, payment, payment.state, false)
      const reason = payment.reason ?? command.reason
      // `stranded` comes only from `payment.undone`, which keeps the same rule itself;
      // `not_on_till` is a manager's answer that a pay-first round is not on the till (#113).
      const answered = reason === 'no_receipt' || reason === 'stranded' || reason === 'not_on_till'
      if (!answered && (await closeAttempted(stx, payment.id))) {
        return refused(null, 'close_attempted')
      }
      // A pay-first round entered on the POS, or that may have been: never released on its own.
      if (!answered && (await enterAttempted(stx, payment.id))) {
        return refused(null, 'enter_attempted')
      }
      const state = reason === 'stranded' ? 'stranded' : 'released'
      await release(stx, payment, tableOpen, reason, state)
      return at(command, payment, state, true)
    },
  })
}

/**
 * `payment.hold_unknown`: the hold's call was made before and its outcome is unknown (a timeout, a
 * server error, a worker that died after recording it, design §5.3, D127 3.15). The key is never
 * sent again: `priced` → `cancelling` with "Try again" (`hold_refused`), and the worker finds
 * whatever the call made by the payment's id and releases it. No card form reached a phone, so a
 * leftover payment at the provider holds nothing.
 */
export function paymentHoldUnknown() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('payment.hold_unknown'), paymentId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockPayment(stx, { id: command.paymentId })
      if (locked === null) return refused(null, 'payment_missing')
      const { payment } = locked
      if (payment.state !== 'priced') return at(command, payment, payment.state, false)
      await stx.tx
        .update(payments)
        .set({
          state: 'cancelling',
          reason: 'hold_refused',
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id))
      await logPayment(stx, payment, 'cancelling', 'hold_refused')
      return at(command, payment, 'cancelling', true)
    },
  })
}

/** The POS and provider writes a payment records (D127 3.9; #111 adds the POS's and capture). */
export const PAYMENT_STEP_NAMES = [
  'createHold',
  'findByPaymentId',
  'release',
  'isolateLines',
  'undoIsolate',
  'payAndClose',
  'capture',
  // Pay-first (#113): the round entered on a payment table.
  'addLines',
] as const

/** The POS writes a payment makes once: a second `attempting` is refused (#113). */
const ONCE_STEPS: readonly string[] = ['payAndClose', 'addLines']

/**
 * True once a pay-first payment's round may be on the POS (#113): its `addLines` landed, or its
 * outcome is not known. A refused `addLines` wrote nothing.
 */
export async function enterAttempted(stx: ServiceTx, id: string): Promise<boolean> {
  const steps = await stx.tx
    .select({ outcome: paymentSteps.outcome })
    .from(paymentSteps)
    .where(and(eq(paymentSteps.paymentId, id), eq(paymentSteps.step, 'addLines')))
    .orderBy(desc(paymentSteps.seq))
  const [latest] = steps
  return (
    latest?.outcome === 'attempting' ||
    steps.some((step) => step.outcome === 'done' || step.outcome === 'unknown')
  )
}

/** True once a close of the payment's bill was attempted: from then on it is never undone (#111). */
export async function closeAttempted(stx: ServiceTx, id: string): Promise<boolean> {
  const [step] = await stx.tx
    .select({ seq: paymentSteps.seq })
    .from(paymentSteps)
    .where(and(eq(paymentSteps.paymentId, id), eq(paymentSteps.step, 'payAndClose')))
    .limit(1)
  return step !== undefined
}

/**
 * `payment.step`: one POS or provider write, recorded `attempting` before the call and with its outcome
 * after (append-only, D127 3.9). The answer is a short code, never the provider's response; the
 * form's values never go here. A move back's `attempting` row carries the lines it moves (#153).
 */
export function paymentStep() {
  return defineCommand({
    schema: z
      .strictObject({
        type: z.literal('payment.step'),
        paymentId,
        step: z.enum(PAYMENT_STEP_NAMES),
        outcome: z.enum(['attempting', 'done', 'refused', 'unknown']),
        answer: CodeSchema.nullable(),
        idempotencyKey: ProviderRefTextSchema,
        lines: PaymentStepLinesSchema.nullable().default(null),
      })
      .refine(
        (command) =>
          command.lines === null ||
          (command.step === 'undoIsolate' && command.outcome === 'attempting'),
        { message: 'lines go only on a move back, before the call' },
      ),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      // Locked: two runs that both try to start a close or an entry are taken one at a time.
      const [payment] = await stx.tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.id, command.paymentId), eq(payments.venueId, stx.venueId)))
        .for('update')
      if (payment === undefined) return refused(null, 'payment_missing')
      if (command.outcome === 'attempting' && ONCE_STEPS.includes(command.step)) {
        // A close is sent once; an entry once unless the POS refused it (nothing written). A run
        // that finds another's attempt backs off before it calls the POS (#113).
        const [latest] = await stx.tx
          .select({ outcome: paymentSteps.outcome })
          .from(paymentSteps)
          .where(and(eq(paymentSteps.paymentId, payment.id), eq(paymentSteps.step, command.step)))
          .orderBy(desc(paymentSteps.seq))
          .limit(1)
        if (
          latest !== undefined &&
          (command.step === 'payAndClose' || latest.outcome !== 'refused')
        ) {
          return refused(null, 'step_attempted', { step: command.step })
        }
      }
      await stx.tx.insert(paymentSteps).values({
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        paymentId: payment.id,
        step: command.step,
        outcome: command.outcome,
        answer: command.answer,
        idempotencyKey: command.idempotencyKey,
        lines: command.lines,
        ...stx.provenance,
      })
      return accepted(null, { details: { paymentId: payment.id } })
    },
  })
}

/** True for a state no command moves on from. */
export function isFinalPaymentState(state: string): boolean {
  return FINAL.has(state)
}
