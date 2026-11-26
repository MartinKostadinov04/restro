// A group payment (D160 §3, model (a); #543): guests share the ticked lines by amount, each guest's
// card is a hold of its own (`payment_holds`, one manual-capture provider payment each), and the
// bill closes once, with one card payment per hold and one fiscal receipt. Then every hold is
// captured. The payment itself has no card: it is an on-bill payment with a shared amount
// (`payments.shared_minor`), and its holds are what the provider holds.
//
//   payment: requested ──payment.price──▶ awaiting_guest (gathering) ──cover──▶ held ─▶ today's route
//                                              │ expiry · staff cancel · last hold withdrawn · bill changed
//                                              ▼
//                                          cancelling ──every hold let go──▶ released ("Nothing was charged")
//
//   hold:    requested ──share.hold_created──▶ awaiting_guest ──share.hold_check──▶ held ──close──▶ captured
//               │                                    │                               │         └─▶ capture_failed
//               └──────────────── releasing ◀────────┴───────────────────────────────┘
//                                     └──share.hold_settle──▶ released
//
// - Every command locks the payment's tables, then the payment (`lockShare`, the paying route's
//   lock order). The holds are only ever written under the payment's row lock, so the payment's
//   lock is theirs too: two phones covering at once, a cover against the expiry, a withdrawal or a
//   staff cancel are taken one at a time, and the second finds what the first did.
// - The limits are the money module's (`sharePartProblem`, rule 8): the parts of the holds that are
//   not let go never exceed the shared amount, none is below the smallest card payment, and none
//   leaves a rest below it. "The rest" is one call (`rest: true`).
// - The share is covered when the parts of the held holds sum to the shared amount: the payment is
//   `held`, its amount the shared amount plus every guest's tip, and today's route takes it on.
// - Gathering ends with every hold let go: 10 minutes after the first hold (`share.expire`), staff's
//   "Cancel sharing" (`share.cancel`), the last hold withdrawn, or a shared line voided or changed
//   in a reading (`share.bill_check`). The lines come back once every hold is released.
// - Once a close was attempted no hold is released (D127 3.10): `share.hold_settle` refuses.
// - A capture refused after the close is tried again by the worker; then the hold is
//   `capture_failed` and the owners are alerted with that hold's amount (D127 3.14).
//
// The service path imports nothing under connectors/ (no-outbound.test.ts): the provider's reading
// is restated here. No payer, phone or handle is stored: a hold keeps only its handle's sha-256.

import {
  alerts,
  billReadings,
  paymentHolds,
  paymentLines,
  paymentSteps,
  payments,
} from '@restro/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import {
  addMinor,
  SHARE_PART_PROBLEMS,
  sharePartProblem,
  shareRestMinor,
  subtractMinor,
  sumSignedMinor,
} from '../money'
import { CARD_FLOOR_MINOR, readPayingSettings, smallestCardMinor } from '../paying-settings'
import { PAYMENT_CAPTURE_FAILED_KIND } from './alert-rules'
import { parseStoredBills } from './bill'
import { defineCommand, type ServiceTx } from './definition'
import { lockPaymentTables, paymentTablesOf, touchPaymentTables } from './group-pay'
import {
  closeAttempted,
  isFinalHold,
  logPayment,
  PAYMENT_CONFIRM_MS,
  PAYMENT_QUEUE_MS,
  type PaymentRow,
  release,
  SHARE_GATHERING_MS,
  sameQuantity,
  TipSchema,
  tipOf,
} from './pay'
import { type Locked, move } from './pay-route'
import { accepted, refused, type ServiceResult } from './results'
import { readTableCapabilities } from './table-capabilities'

/** Why a phone's share command was refused (the guest screens word each, D160 §3). */
export const SHARE_REFUSALS = [
  ...SHARE_PART_PROBLEMS,
  /** The share is not gathering any more: covered, or let go. */
  'share_over',
  /** No group payment of this table has that id, or no hold that handle. */
  'unknown_payment',
  /** A tip where the POS can't put one on the receipt. */
  'tip_not_offered',
  /** The share was covered: a hold can no longer be withdrawn, nor the share cancelled. */
  'too_late',
] as const
export type ShareRefusal = (typeof SHARE_REFUSALS)[number]

/** Why every hold of a share was let go (`payments.reason`, `payment_holds.reason`). */
export const SHARE_END_REASONS = ['expired', 'cancelled', 'withdrawn', 'bill_changed'] as const

/** The hold states that hold, or may come to hold, part of the shared amount. */
export const SHARE_ACTIVE_HOLD_STATES: readonly string[] = ['requested', 'awaiting_guest', 'held']
/** The payment states while a share gathers its holds. */
const GATHERING: readonly string[] = ['requested', 'awaiting_guest']
/** How many refused captures of one hold the worker sees before the owners are alerted. */
export const SHARE_CAPTURE_TRIES = 3

const tableId = idSchema('tb')
const actionId = z.uuid()
const paymentId = idSchema('py')
const holdId = idSchema('ph')
const handleHash = z.string().regex(/^[0-9a-f]{64}$/)
const MinorSchema = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const ProviderRefTextSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/)
const FormValuesSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.string().min(1).max(2000))
  .refine((values) => Object.keys(values).length <= 16)
const ageMs = z
  .int()
  .nonnegative()
  .max(24 * 60 * 60_000)

export type HoldRow = typeof paymentHolds.$inferSelect

// ---------------------------------------------------------------------------------------------
// Reads and locks

/** A share and its holds, locked (the payment's tables, its alerts, then the payment). */
interface LockedShare {
  readonly locked: Locked
  readonly payment: PaymentRow
  readonly holds: HoldRow[]
}

/**
 * Locks a group payment: every table it covers (lock order), the alerts of the holds named, then
 * the payment, and reads its holds under the payment's lock. Null for no group payment of the
 * venue with that id.
 */
async function lockShare(
  stx: ServiceTx,
  id: string,
  alertHolds: readonly string[] = [],
): Promise<LockedShare | null> {
  const [found] = await stx.tx
    .select({ id: payments.id, tableId: payments.tableId, sharedMinor: payments.sharedMinor })
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.venueId, stx.venueId)))
  if (found === undefined || found.sharedMinor === null) return null
  await lockPaymentTables(stx, found)
  const open = new Map<string, { readonly id: string; readonly doneAt: Date | null }>()
  if (alertHolds.length > 0) {
    stx.rows.claim(
      'alert',
      alertHolds.map((hold) => `${PAYMENT_CAPTURE_FAILED_KIND}:${hold}`),
    )
    const rows = await stx.tx
      .select({ id: alerts.id, subjectId: alerts.subjectId, doneAt: alerts.doneAt })
      .from(alerts)
      .where(
        and(
          eq(alerts.kind, PAYMENT_CAPTURE_FAILED_KIND),
          inArray(alerts.subjectId, [...alertHolds]),
        ),
      )
      .orderBy(alerts.subjectId)
      .for('update')
    for (const row of rows) open.set(row.subjectId, row)
  }
  stx.rows.claim('payment', [found.id])
  const [payment] = await stx.tx
    .select()
    .from(payments)
    .where(eq(payments.id, found.id))
    .for('update')
  if (payment === undefined) return null
  const holds = await holdsOf(stx, payment.id)
  return { locked: { payment, leases: new Map(), alerts: open }, payment, holds }
}

/** A payment's holds, oldest first. */
async function holdsOf(stx: ServiceTx, id: string): Promise<HoldRow[]> {
  return stx.tx
    .select()
    .from(paymentHolds)
    .where(eq(paymentHolds.paymentId, id))
    .orderBy(asc(paymentHolds.createdAt), asc(paymentHolds.id))
}

/** True for a hold that holds, or may come to hold, part of the shared amount. */
function isActive(hold: Pick<HoldRow, 'state'>): boolean {
  return SHARE_ACTIVE_HOLD_STATES.includes(hold.state)
}

/** A hold's part of the shared amount: its amount without its tip. */
export function partOf(hold: Pick<HoldRow, 'amountMinor' | 'tipMinor'>): number {
  return subtractMinor(hold.amountMinor, hold.tipMinor)
}

/** The parts of the active holds: what is claimed of the shared amount. */
function claimedOf(holds: readonly HoldRow[]): number {
  return sumSignedMinor(holds.filter(isActive).map(partOf))
}

/** The parts of the held holds: what is held of the shared amount. */
function heldOf(holds: readonly HoldRow[]): number {
  return sumSignedMinor(holds.filter((hold) => hold.state === 'held').map(partOf))
}

/** True once a provider step was recorded for the hold: a provider payment may exist. */
async function holdTouched(stx: ServiceTx, hold: string): Promise<boolean> {
  const [step] = await stx.tx
    .select({ seq: paymentSteps.seq })
    .from(paymentSteps)
    .where(eq(paymentSteps.holdId, hold))
    .limit(1)
  return step !== undefined
}

/**
 * True when no provider payment can stand for a `requested` hold: no provider step touched it, or
 * its only provider steps are its `createHold`, the last of them refused.
 */
async function neverMade(stx: ServiceTx, hold: string): Promise<boolean> {
  const steps = await stx.tx
    .select({ step: paymentSteps.step, outcome: paymentSteps.outcome })
    .from(paymentSteps)
    .where(eq(paymentSteps.holdId, hold))
    .orderBy(desc(paymentSteps.seq))
  if (steps.length === 0) return true
  return steps.every((row) => row.step === 'createHold') && steps[0]?.outcome === 'refused'
}

/** The hold's state as stored now (after a command wrote it). */
async function holdStateOf(stx: ServiceTx, hold: string): Promise<string | null> {
  const [row] = await stx.tx
    .select({ state: paymentHolds.state })
    .from(paymentHolds)
    .where(eq(paymentHolds.id, hold))
  return row?.state ?? null
}

/** The smallest card payment at the venue: its own floor, else the platform's (the provider's). */
function minimumOf(stx: ServiceTx): number {
  return smallestCardMinor(readPayingSettings(stx.venue.settings), CARD_FLOOR_MINOR)
}

/** An accepted answer that names the share, the hold and where they stand. */
function at(
  command: object,
  payment: { readonly id: string },
  state: string,
  changed: boolean,
  more: Readonly<Record<string, string | number | boolean | null>> = {},
): ServiceResult {
  const id = 'actionId' in command && typeof command.actionId === 'string' ? command.actionId : null
  return accepted(id, { details: { paymentId: payment.id, state, changed, ...more } })
}

// ---------------------------------------------------------------------------------------------
// Writes

/** Moves one hold (with more columns), settling it where the state is final. */
async function setHold(
  stx: ServiceTx,
  hold: Pick<HoldRow, 'id'>,
  state: string,
  set: Partial<typeof paymentHolds.$inferInsert> = {},
): Promise<void> {
  const final = isFinalHold(state)
  await stx.tx
    .update(paymentHolds)
    .set({
      state,
      ...(state === 'awaiting_guest' ? {} : { formValues: null }),
      ...(final ? { settledAt: sql`now()` } : {}),
      ...set,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentHolds.id, hold.id))
}

/** The Log's line of a hold's step: a money record, under its payment. */
async function logHold(
  stx: ServiceTx,
  payment: PaymentRow,
  hold: Pick<HoldRow, 'id' | 'state' | 'amountMinor'>,
  to: string,
  reason: string | null = null,
): Promise<void> {
  await stx.log({
    kind: 'payment.hold',
    paymentId: payment.id,
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    fromState: hold.state,
    toState: to,
    ...(reason === null ? {} : { reason }),
    details: { holdId: hold.id, amountMinor: hold.amountMinor },
  })
}

/**
 * Lets one hold go: a hold no provider step touched is released at once; any other is `releasing`
 * for the worker, which releases its provider payment and settles it (`share.hold_settle`).
 */
async function letGo(
  stx: ServiceTx,
  payment: PaymentRow,
  hold: HoldRow,
  reason: string,
): Promise<void> {
  if (!isActive(hold)) return
  const untouched = hold.state === 'requested' && !(await holdTouched(stx, hold.id))
  const to = untouched ? 'released' : 'releasing'
  await setHold(stx, hold, to, { reason })
  await logHold(stx, payment, hold, to, reason)
}

/**
 * Releases the payment once every hold is final (`cancelling` → `released`): its lines come back
 * on every phone. Never once a close was attempted (D127 3.10).
 */
async function settleIfLetGo(stx: ServiceTx, payment: PaymentRow): Promise<boolean> {
  if (payment.state !== 'cancelling') return false
  const holds = await holdsOf(stx, payment.id)
  if (holds.some((hold) => !isFinalHold(hold.state))) return false
  if (!answered(payment) && (await closeAttempted(stx, payment.id))) return false
  const stranded = payment.reason === 'stranded'
  await release(stx, payment, payment.reason ?? 'cancelled', stranded ? 'stranded' : 'released')
  return true
}

/**
 * A manager's or owner's answer lets the holds go after a close was attempted: "No receipt", or
 * lines stranded on the payment table (`payment.settle`'s rule, #111, #153).
 */
function answered(payment: Pick<PaymentRow, 'reason'>): boolean {
  return payment.reason === 'no_receipt' || payment.reason === 'stranded'
}

/**
 * Ends a gathering share with everything let go ("Nothing was charged", D160 2.5, 2.10): every
 * hold is let go and the payment is `cancelling` until the worker released them, or released at
 * once where none reached the provider. Only while the share gathers.
 */
export async function endShare(
  stx: ServiceTx,
  share: { readonly payment: PaymentRow; readonly holds: readonly HoldRow[] },
  reason: (typeof SHARE_END_REASONS)[number],
): Promise<'cancelling' | 'released'> {
  const { payment } = share
  for (const hold of share.holds) await letGo(stx, payment, hold, reason)
  await stx.tx
    .update(payments)
    .set({ state: 'cancelling', reason, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(payments.id, payment.id))
  await logPayment(stx, payment, 'cancelling', reason)
  await touchPaymentTables(stx, payment)
  const cancelling: PaymentRow = { ...payment, state: 'cancelling', reason }
  return (await settleIfLetGo(stx, cancelling)) ? 'released' : 'cancelling'
}

/**
 * The share is covered when the parts of its held holds sum to the shared amount: the payment is
 * `held` for today's route, its amount the shared amount plus every tip (D160 §3, 2.6), its
 * capture deadline the earliest hold's.
 */
async function coverIfHeld(stx: ServiceTx, payment: PaymentRow): Promise<boolean> {
  if (payment.state !== 'awaiting_guest' || payment.sharedMinor === null) return false
  const holds = await holdsOf(stx, payment.id)
  if (heldOf(holds) !== payment.sharedMinor) return false
  const held = holds.filter((hold) => hold.state === 'held')
  const tipMinor = sumSignedMinor(held.map((hold) => hold.tipMinor))
  const deadlines = held
    .map((hold) => hold.captureBefore?.getTime() ?? null)
    .filter((time): time is number => time !== null)
  const heldAt = (await stx.dbNow()).getTime()
  await stx.tx
    .update(payments)
    .set({
      state: 'held',
      amountMinor: addMinor(payment.sharedMinor, tipMinor),
      tipMinor,
      queueEndsAt: new Date(heldAt + PAYMENT_QUEUE_MS),
      captureBefore: deadlines.length === 0 ? null : new Date(Math.min(...deadlines)),
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(payments.id, payment.id))
  await logPayment(stx, payment, 'held', null, { holds: held.length })
  await touchPaymentTables(stx, payment)
  return true
}

// ---------------------------------------------------------------------------------------------
// The guests' commands

/** The group payment a phone names: one of its table, or of a table its lines are on. */
async function shareOfTable(
  stx: ServiceTx,
  table: string,
  id: string,
  alertHolds: readonly string[] = [],
): Promise<LockedShare | null> {
  const share = await lockShare(stx, id, alertHolds)
  if (share === null) return null
  const tables = await paymentTablesOf(stx.tx, share.payment)
  return tables.includes(table) ? share : null
}

/**
 * `share.hold`: a guest's part of the shared amount, any amount or "the rest", and their own tip
 * (D160 2.2, 2.6, 2.11, 2.12). The hold is `requested`; the worker asks the provider for it and
 * the phone holding the handle gets the card form. The first hold starts the 10 minutes.
 */
export function shareHold() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('share.hold'),
      tableId,
      actionId,
      ageMs,
      /** The sha-256 of the hold's handle, made by the guest API; never the handle. */
      handleHash,
      paymentId,
      /** The guest's part, without the tip; or `rest: true` for whatever is left. */
      part: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('amount'), minor: MinorSchema }),
        z.strictObject({ kind: z.literal('rest') }),
      ]),
      tip: TipSchema,
    }),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const refuse = (code: ShareRefusal, details?: Record<string, number>) =>
        refused(command.actionId, code, details)
      const share = await shareOfTable(stx, command.tableId, command.paymentId)
      if (share === null) return refuse('unknown_payment')
      const { payment, holds } = share
      // A repeat of the same tap finds its hold, with the handle the phone holds now.
      const repeat = holds.find((hold) => hold.actionId === command.actionId)
      if (repeat !== undefined) {
        await stx.tx
          .update(paymentHolds)
          .set({ handleHash: command.handleHash, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(paymentHolds.id, repeat.id))
        return at(command, payment, payment.state, false, {
          holdId: repeat.id,
          holdState: repeat.state,
        })
      }
      const now = await stx.dbNow()
      const over = payment.gatheringEndsAt !== null && now >= payment.gatheringEndsAt
      if (!GATHERING.includes(payment.state) || over || payment.sharedMinor === null) {
        return refuse('share_over')
      }
      const claimed = claimedOf(holds)
      const left = shareRestMinor(payment.sharedMinor, claimed)
      const partMinor = command.part.kind === 'rest' ? left : command.part.minor
      const minimumMinor = minimumOf(stx)
      const problem = sharePartProblem({
        sharedMinor: payment.sharedMinor,
        claimedMinor: claimed,
        partMinor,
        minimumMinor,
      })
      if (problem !== null) return refuse(problem, { leftMinor: left, minimumMinor })
      const tipMinor = tipOf(command.tip, partMinor)
      // A tip given as an amount stops at the part's own amount (100 %, as a percent tip does).
      if (command.tip.kind === 'amount' && tipMinor > partMinor) {
        return refused(command.actionId, 'invalid_command')
      }
      if (
        tipMinor > 0 &&
        !(await readTableCapabilities(stx.tx, payment.tableId)).recordTipOnClose
      ) {
        return refuse('tip_not_offered')
      }
      const id = newId('ph')
      await stx.tx.insert(paymentHolds).values({
        id,
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        paymentId: payment.id,
        state: 'requested',
        handleHash: command.handleHash,
        actionId: command.actionId,
        amountMinor: addMinor(partMinor, tipMinor),
        tipMinor,
        currency: payment.currency,
        providerKind: payment.providerKind,
        ...stx.provenance,
      })
      // The 10 minutes run from the first hold (D160 2.5).
      const first = holds.length === 0
      if (first) {
        await stx.tx
          .update(payments)
          .set({
            gatheringEndsAt: new Date(now.getTime() + SHARE_GATHERING_MS),
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(payments.id, payment.id))
      }
      await logHold(
        stx,
        payment,
        { id, state: 'requested', amountMinor: partMinor + tipMinor },
        'requested',
      )
      await touchPaymentTables(stx, payment)
      return at(command, payment, payment.state, true, { holdId: id, holdState: 'requested' })
    },
  })
}

/** The phone's own hold, by its handle, locked with its share. */
async function holdByHandle(
  stx: ServiceTx,
  table: string,
  hash: string,
): Promise<{ readonly share: LockedShare; readonly hold: HoldRow } | null> {
  const [found] = await stx.tx
    .select({ paymentId: paymentHolds.paymentId })
    .from(paymentHolds)
    .where(and(eq(paymentHolds.handleHash, hash), eq(paymentHolds.venueId, stx.venueId)))
  if (found === undefined) return null
  const share = await shareOfTable(stx, table, found.paymentId)
  const hold = share?.holds.find((row) => row.handleHash === hash)
  return share === null || hold === undefined ? null : { share, hold }
}

/** `share.withdraw` and `share.returned` name the phone's hold by its handle. */
function byHandle<T extends 'share.withdraw' | 'share.returned'>(type: T) {
  return z.strictObject({ type: z.literal(type), tableId, actionId, ageMs, handleHash })
}

/**
 * `share.withdraw`: a guest takes back their own part before the share is covered (D160 2.7). The
 * hold is let go; the last one withdrawn ends the share with everything let go.
 */
export function shareWithdraw() {
  return defineCommand({
    schema: byHandle('share.withdraw'),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const found = await holdByHandle(stx, command.tableId, command.handleHash)
      if (found === null) return refused(command.actionId, 'unknown_payment')
      const { share, hold } = found
      const { payment } = share
      if (!isActive(hold)) {
        return at(command, payment, payment.state, false, {
          holdId: hold.id,
          holdState: hold.state,
        })
      }
      if (!GATHERING.includes(payment.state)) return refused(command.actionId, 'too_late')
      const others = share.holds.filter((row) => row.id !== hold.id && isActive(row))
      // The answer names the hold's state as written: `released` where nothing reached the
      // provider (or the share ended with it), else `releasing`.
      if (others.length === 0) {
        const state = await endShare(stx, share, 'withdrawn')
        return at(command, payment, state, true, {
          holdId: hold.id,
          holdState: await holdStateOf(stx, hold.id),
        })
      }
      await letGo(stx, payment, hold, 'withdrawn')
      await touchPaymentTables(stx, payment)
      return at(command, payment, payment.state, true, {
        holdId: hold.id,
        holdState: await holdStateOf(stx, hold.id),
      })
    },
  })
}

/**
 * `share.returned`: the phone is back from its card form. A nudge, never a fact: the guest API
 * queues the worker's check, which reads the provider.
 */
export function shareReturned() {
  return defineCommand({
    schema: byHandle('share.returned'),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    async handle(stx, command) {
      const found = await holdByHandle(stx, command.tableId, command.handleHash)
      if (found === null) return refused(command.actionId, 'unknown_payment')
      const { share, hold } = found
      return at(command, share.payment, share.payment.state, false, {
        holdId: hold.id,
        holdState: hold.state,
      })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Staff and the worker

/**
 * `share.cancel`: staff's "Cancel sharing" on Tonight (D160 §3, 2.16), by the permission that
 * opens and closes a table. Only while the share gathers: once covered, the route has it.
 */
export function shareCancel() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('share.cancel'), tableId, paymentId }),
    origins: ['staff'],
    permission: 'tables.open_close',
    // As closing a table is: nothing is charged, so the tablet needs no PIN for it (#545, the lead).
    quickOnSharedDevice: true,
    idempotency: 'by_state',
    async handle(stx, command) {
      const share = await shareOfTable(stx, command.tableId, command.paymentId)
      if (share === null) return refused(null, 'unknown_payment')
      const { payment } = share
      if (payment.state === 'cancelling' || payment.state === 'released') {
        return at(command, payment, payment.state, false)
      }
      if (!GATHERING.includes(payment.state)) return refused(null, 'too_late')
      return at(command, payment, await endShare(stx, share, 'cancelled'), true)
    },
  })
}

/** `share.expire`: the worker at the end of gathering; nothing where it is covered or not over. */
export function shareExpire() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('share.expire'), paymentId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const share = await lockShare(stx, command.paymentId)
      if (share === null) return refused(null, 'payment_missing')
      const { payment } = share
      const now = await stx.dbNow()
      const over = payment.gatheringEndsAt !== null && now >= payment.gatheringEndsAt
      if (!GATHERING.includes(payment.state) || !over) {
        return at(command, payment, payment.state, false)
      }
      return at(command, payment, await endShare(stx, share, 'expired'), true)
    },
  })
}

/**
 * `share.bill_check`: the worker compares a gathering share's lines with the latest complete
 * reading of each table they are on (D160 2.10). A line voided or changed there ends the share
 * with everything let go: "The bill changed. Nothing was charged." A table whose latest reading
 * failed concludes nothing (rule 6). The reading's own command cannot do this: it holds the
 * table's reading, which ranks after the tables a share locks first (`lock-order.ts`).
 */
export function shareBillCheck() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('share.bill_check'), paymentId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const share = await lockShare(stx, command.paymentId)
      if (share === null) return refused(null, 'payment_missing')
      const { payment } = share
      if (!GATHERING.includes(payment.state)) return at(command, payment, payment.state, false)
      const lines = await stx.tx
        .select({
          tableId: paymentLines.tableId,
          ref: paymentLines.posLineRef,
          quantity: paymentLines.quantity,
          amountMinor: paymentLines.posAmountMinor,
        })
        .from(paymentLines)
        .where(eq(paymentLines.paymentId, payment.id))
      const tables = [...new Set(lines.map((line) => line.tableId))]
      const readings =
        tables.length === 0
          ? []
          : await stx.tx
              .select({
                tableId: billReadings.tableId,
                complete: billReadings.complete,
                readAt: billReadings.readAt,
                bills: billReadings.bills,
              })
              .from(billReadings)
              .where(inArray(billReadings.tableId, tables))
      const fresh = new Map<string, Map<string, { quantity: string; amountMinor: number }>>()
      for (const reading of readings) {
        // Only a complete reading made since the share started says what is on the bill now.
        if (!reading.complete || reading.readAt < payment.createdAt) continue
        const byRef = new Map<string, { quantity: string; amountMinor: number }>()
        for (const bill of parseStoredBills(reading.bills)) {
          for (const line of bill.lines) byRef.set(line.pos, line)
        }
        fresh.set(reading.tableId, byRef)
      }
      const changed = lines.some((line) => {
        const table = fresh.get(line.tableId)
        if (table === undefined) return false
        const now = line.ref === null ? undefined : table.get(line.ref)
        return (
          now === undefined ||
          !sameQuantity(now.quantity, line.quantity) ||
          now.amountMinor !== line.amountMinor
        )
      })
      if (!changed) return at(command, payment, payment.state, false)
      return at(command, payment, await endShare(stx, share, 'bill_changed'), true)
    },
  })
}

/** A worker command about one hold of a share. */
async function lockHold(
  stx: ServiceTx,
  payment: string,
  hold: string,
  alertHolds: readonly string[] = [],
): Promise<{ readonly share: LockedShare; readonly hold: HoldRow } | ServiceResult> {
  const share = await lockShare(stx, payment, alertHolds)
  if (share === null) return refused(null, 'payment_missing')
  const found = share.holds.find((row) => row.id === hold)
  if (found === undefined) return refused(null, 'payment_missing', { reason: 'hold_missing' })
  return { share, hold: found }
}

const isResult = (value: object): value is ServiceResult => 'status' in value

/**
 * `share.hold_created`: the provider made the hold's payment. `requested` → `awaiting_guest` with
 * the form's values and the guest's deadline (2 minutes to confirm, and never past the gathering's
 * end). A hold let go meanwhile keeps only the provider's reference, for the worker to release it.
 */
export function shareHoldCreated() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('share.hold_created'),
      paymentId,
      holdId,
      providerPaymentRef: ProviderRefTextSchema,
      formValues: FormValuesSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId)
      if (isResult(found)) return found
      const { share, hold } = found
      const { payment } = share
      if (
        hold.providerPaymentRef !== null &&
        hold.providerPaymentRef !== command.providerPaymentRef
      ) {
        return refused(null, 'payment_mismatch', { reason: 'another_provider_payment' })
      }
      if (hold.state === 'requested' && GATHERING.includes(payment.state)) {
        const now = (await stx.dbNow()).getTime()
        const ends = payment.gatheringEndsAt?.getTime() ?? now + PAYMENT_CONFIRM_MS
        await setHold(stx, hold, 'awaiting_guest', {
          providerPaymentRef: command.providerPaymentRef,
          formValues: command.formValues,
          confirmBy: new Date(Math.min(now + PAYMENT_CONFIRM_MS, ends)),
        })
        await logHold(stx, payment, hold, 'awaiting_guest')
        return at(command, payment, payment.state, true, { holdState: 'awaiting_guest' })
      }
      if (hold.providerPaymentRef === null) {
        await stx.tx
          .update(paymentHolds)
          .set({
            providerPaymentRef: command.providerPaymentRef,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(paymentHolds.id, hold.id))
      }
      // A hold asked for in time whose share ended meanwhile is let go with it.
      if (hold.state === 'requested') await letGo(stx, payment, hold, payment.reason ?? 'cancelled')
      return at(command, payment, payment.state, true, { holdState: 'releasing' })
    },
  })
}

/** The provider's reading of a hold's payment, restated (`ProviderPayment`). */
const HoldReadingSchema = z.strictObject({
  ref: ProviderRefTextSchema,
  status: z.enum(['awaiting_guest', 'held', 'captured', 'released', 'failed']),
  needsGuestAction: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: MinorSchema,
  heldMinor: MinorSchema,
  captureBefore: z.iso.datetime({ offset: true }).nullable(),
  threeDs: CodeSchema.nullable(),
  authorisationCode: z.string().min(1).max(64).nullable(),
})

/**
 * `share.hold_check`: the provider's reading of a hold at the card form. A hold for exactly its
 * amount → `held`, and the share is covered once the held parts sum to the shared amount. A hold
 * the provider dropped → released. Past its deadline with no step asked of the guest → let go:
 * the other guests may still cover the share in its 10 minutes.
 */
export function shareHoldCheck() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('share.hold_check'),
      paymentId,
      holdId,
      reading: HoldReadingSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId)
      if (isResult(found)) return found
      const { share, hold } = found
      const { payment } = share
      if (hold.state !== 'awaiting_guest') {
        return at(command, payment, payment.state, false, { holdState: hold.state })
      }
      const read = command.reading
      if (hold.providerPaymentRef !== read.ref) {
        return refused(null, 'payment_mismatch', { reason: 'another_provider_payment' })
      }
      if (
        read.status === 'held' &&
        read.heldMinor === hold.amountMinor &&
        read.amountMinor === hold.amountMinor &&
        read.currency === hold.currency
      ) {
        if (!GATHERING.includes(payment.state)) {
          // Held after the share ended: let go with it.
          await letGo(stx, payment, hold, payment.reason ?? 'cancelled')
          return at(command, payment, payment.state, true, { holdState: 'releasing' })
        }
        await setHold(stx, hold, 'held', {
          captureBefore: read.captureBefore === null ? null : new Date(read.captureBefore),
          threeDsResult: read.threeDs,
          authorisationCode: read.authorisationCode,
        })
        await logHold(stx, payment, hold, 'held')
        const covered = await coverIfHeld(stx, payment)
        if (!covered) await touchPaymentTables(stx, payment)
        return at(command, payment, covered ? 'held' : payment.state, true, { holdState: 'held' })
      }
      if (read.status === 'released' || read.status === 'failed') {
        await setHold(stx, hold, 'released', { reason: 'expired' })
        await logHold(stx, payment, hold, 'released', 'expired')
        await touchPaymentTables(stx, payment)
        await settleIfLetGo(stx, payment)
        return at(command, payment, payment.state, true, { holdState: 'released' })
      }
      const now = (await stx.dbNow()).getTime()
      const ends = payment.gatheringEndsAt?.getTime() ?? Number.POSITIVE_INFINITY
      const confirmOver = hold.confirmBy !== null && now >= hold.confirmBy.getTime()
      // While the guest's bank asks for a step, the deadline stretches to the gathering's end.
      if (now >= ends || (confirmOver && !read.needsGuestAction)) {
        await letGo(stx, payment, hold, 'expired')
        await touchPaymentTables(stx, payment)
        return at(command, payment, payment.state, true, { holdState: 'releasing' })
      }
      if (confirmOver && read.needsGuestAction && payment.gatheringEndsAt !== null) {
        await stx.tx
          .update(paymentHolds)
          .set({ confirmBy: payment.gatheringEndsAt, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(paymentHolds.id, hold.id))
      }
      return at(command, payment, payment.state, false, { holdState: 'awaiting_guest' })
    },
  })
}

/**
 * `share.hold_unknown`: the hold's provider call has an unknown outcome (D127 3.15). Never asked
 * again with its key: the hold is let go, and the worker finds what the call made by the hold's id
 * and releases it.
 */
export function shareHoldUnknown() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('share.hold_unknown'), paymentId, holdId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId)
      if (isResult(found)) return found
      const { share, hold } = found
      if (hold.state !== 'requested') {
        return at(command, share.payment, share.payment.state, false, { holdState: hold.state })
      }
      await setHold(stx, hold, 'releasing', { reason: 'hold_refused' })
      await logHold(stx, share.payment, hold, 'releasing', 'hold_refused')
      await touchPaymentTables(stx, share.payment)
      return at(command, share.payment, share.payment.state, true, { holdState: 'releasing' })
    },
  })
}

/**
 * `share.hold_settle`: the worker released a hold's provider payment, or found none, or the
 * provider refused to make it: the hold is `released`. Any hold of a share that ended may settle
 * so; then the payment is released once every hold is final. Never once a close was attempted
 * (D127 3.10).
 */
export function shareHoldSettle() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('share.hold_settle'),
      paymentId,
      holdId,
      reason: CodeSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId)
      if (isResult(found)) return found
      const { share, hold } = found
      const { payment } = share
      if (isFinalHold(hold.state)) {
        return at(command, payment, payment.state, false, { holdState: hold.state })
      }
      // A `releasing` hold was let go while the share gathered, so no close ever named it (a close
      // carries only the held holds): it is released whatever the close did. Any other hold is
      // never released once a close was attempted (D127 3.10).
      if (
        hold.state !== 'releasing' &&
        !answered(payment) &&
        (await closeAttempted(stx, payment.id))
      ) {
        return refused(null, 'close_attempted')
      }
      // A hold the share still counts on is let go only through `releasing`, or with its share.
      const ending = payment.state === 'cancelling'
      if (hold.state !== 'releasing' && !(ending || hold.state === 'requested')) {
        return refused(null, 'hold_not_releasing')
      }
      // A `requested` hold a provider call touched may stand at the provider: only its release
      // (`share.hold_unknown` makes it `releasing`) settles it, unless the provider refused it.
      if (hold.state === 'requested' && !(await neverMade(stx, hold.id))) {
        return refused(null, 'hold_not_releasing')
      }
      const reason = hold.reason ?? command.reason
      await setHold(stx, hold, 'released', { reason })
      await logHold(stx, payment, hold, 'released', reason)
      await touchPaymentTables(stx, payment)
      // The last hold let go after the close ends the share's captures.
      const finished = await finishCaptures(stx, share.locked, payment)
      const released = finished === null && (await settleIfLetGo(stx, payment))
      return at(command, payment, finished ?? (released ? 'released' : payment.state), true, {
        holdState: 'released',
      })
    },
  })
}

/**
 * `share.hold_captured`: one hold's capture after the proven close. Captured, the hold keeps what
 * was taken. Refused after the worker's tries (`SHARE_CAPTURE_TRIES`), it is `capture_failed` and
 * the owners are alerted with that hold's amount (D127 3.14). The last hold to end ends the
 * payment: `captured` with what every hold took, or `capture_failed` where one failed.
 */
export function shareHoldCaptured() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('share.hold_captured'),
      paymentId,
      holdId,
      outcome: z.enum(['captured', 'refused']),
      capturedMinor: MinorSchema.nullable(),
      code: CodeSchema.nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId, [command.holdId])
      if (isResult(found)) return found
      const { share, hold } = found
      const { payment, locked } = share
      const capturable =
        payment.state === 'closed' ||
        (payment.state === 'unconfirmed' && payment.reason === 'receipt_printed')
      if (!capturable || hold.state !== 'held') {
        return at(command, payment, payment.state, false, { holdState: hold.state })
      }
      if (command.outcome === 'captured') {
        const captured = command.capturedMinor
        if (captured === null || captured > hold.amountMinor) {
          return refused(null, 'payment_mismatch', { reason: 'captured_amount' })
        }
        await setHold(stx, hold, 'captured', { capturedMinor: captured })
        await logHold(stx, payment, hold, 'captured')
      } else {
        const reason = command.code ?? 'capture_refused'
        await setHold(stx, hold, 'capture_failed', { reason })
        await logHold(stx, payment, hold, 'capture_failed', reason)
        await raiseHoldAlert(stx, locked, hold)
      }
      const finished = await finishCaptures(stx, locked, payment)
      if (finished === null) {
        return at(command, payment, payment.state, true, { holdState: command.outcome })
      }
      return at(command, payment, finished, true)
    },
  })
}

/**
 * Ends a closed share once every hold is final (`share.hold_captured`, `share.hold_settle`):
 * `captured` with what every hold took, or `capture_failed` where one failed. Never while a hold
 * is still held or still to be let go: a hold let go before the cover is released first, so no
 * guest's card stays held behind a payment that reads as done. Null while one is left.
 */
async function finishCaptures(
  stx: ServiceTx,
  locked: Locked,
  payment: PaymentRow,
): Promise<'captured' | 'capture_failed' | null> {
  const capturable =
    payment.state === 'closed' ||
    (payment.state === 'unconfirmed' && payment.reason === 'receipt_printed')
  if (!capturable) return null
  const holds = await holdsOf(stx, payment.id)
  if (holds.some((row) => !isFinalHold(row.state))) return null
  const capturedMinor = sumSignedMinor(holds.map((row) => row.capturedMinor ?? 0))
  if (holds.some((row) => row.state === 'capture_failed')) {
    await move(stx, locked, 'capture_failed', { reason: 'capture_refused', capturedMinor })
    return 'capture_failed'
  }
  // One fiscal receipt for the share, no emailed one (2.19): the waiter brings paper (#200).
  await move(
    stx,
    locked,
    'captured',
    { capturedMinor, receiptToBringAt: await stx.dbNow() },
    { receiptToBring: true },
  )
  return 'captured'
}

/** The owners' alert for one hold whose capture failed: that hold's amount (D127 3.14). */
async function raiseHoldAlert(stx: ServiceTx, locked: Locked, hold: HoldRow): Promise<void> {
  if (locked.alerts.has(hold.id)) return
  const { payment } = locked
  await stx.tx.insert(alerts).values({
    id: newId('al'),
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: PAYMENT_CAPTURE_FAILED_KIND,
    audience: 'venue',
    subjectId: hold.id,
    permission: 'money.follow_up',
    // What staff need: the table and this hold's amounts. Never a POS id or a guest's data.
    details: {
      paymentId: payment.id,
      holdId: hold.id,
      tableId: payment.tableId,
      amountMinor: hold.amountMinor,
      tipMinor: hold.tipMinor,
      currency: hold.currency,
      captureBefore: hold.captureBefore?.toISOString() ?? null,
    },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    tableId: payment.tableId,
    sittingId: payment.sittingId,
    reason: PAYMENT_CAPTURE_FAILED_KIND,
  })
}

/**
 * `share.hold_gone`: the provider shows a held hold gone (it ran out, or the provider dropped it)
 * while the covered share waits for its payment table: nothing moved on the POS yet. The share
 * cannot close for its amount any more, so every other hold is let go with it, as at the end of
 * gathering (`payment.expired`'s rule for one card, #112). Once the lines moved, the route's last
 * check finds the hold short and the route runs to its end.
 */
export function shareHoldGone() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('share.hold_gone'), paymentId, holdId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const found = await lockHold(stx, command.paymentId, command.holdId)
      if (isResult(found)) return found
      const { share, hold } = found
      const { payment } = share
      const waiting =
        (payment.state === 'held' || payment.state === 'queued') && payment.paymentTableId === null
      if (!waiting || hold.state !== 'held') {
        return at(command, payment, payment.state, false, { holdState: hold.state })
      }
      await setHold(stx, hold, 'released', { reason: 'expired' })
      await logHold(stx, payment, hold, 'released', 'expired')
      const holds = await holdsOf(stx, payment.id)
      return at(command, payment, await endShare(stx, { payment, holds }, 'expired'), true)
    },
  })
}

/** Every group payment command, for the registry. */
export const SHARE_COMMANDS = {
  'share.hold': shareHold(),
  'share.withdraw': shareWithdraw(),
  'share.returned': shareReturned(),
  'share.cancel': shareCancel(),
  'share.expire': shareExpire(),
  'share.hold_created': shareHoldCreated(),
  'share.hold_check': shareHoldCheck(),
  'share.hold_unknown': shareHoldUnknown(),
  'share.hold_settle': shareHoldSettle(),
  'share.hold_captured': shareHoldCaptured(),
  'share.hold_gone': shareHoldGone(),
  'share.bill_check': shareBillCheck(),
} as const
