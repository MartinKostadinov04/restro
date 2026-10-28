// Pay-first items (#113; D113, D117, D122 §5 and §8, D127; design §5.2, §5.3): the guest pays for
// a round before it reaches the bar. A Send with pay-first lines sends its on-the-bill lines as
// before (`send.ts`); the pay-first lines become a payment of kind `pay_first` with its own sent
// order, and the route enters them on a free payment table once the card is held:
//
//   requested ─price─▶ priced ─▶ awaiting_guest ─▶ held ─claim_table─▶ queued ─entered─▶ entered
//        ─pay_first_checked─▶ checked ─closed─▶ closed ─captured─▶ captured
//
// - Offered only where the table's POS declares `firstItemsOpenBill` (an `addLines` that opens a
//   bill names it) and paying is on (`payFirstState`); elsewhere the line reads "Order this from
//   your waiter". Whether pay-first applies at a table, and an item's default mode, are the
//   venue's settings (`pay-first-settings.ts`).
// - Until `entered`, a failure releases the hold and frees the lines on the order (`release`).
// - After `entered` (the round is on the POS, or may be), nothing releases on its own: a POS total
//   lower than the lines captures the POS's amount where the provider captures less; a higher
//   total, any failed check, or an entry whose outcome stays unknown is `unconfirmed`, for a
//   manager's answer.

import { paymentLines, payments, publishPointers, type ReadTx, snapshots } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { resolveRoutesIn } from '../apply/menu-routes'
import { idSchema, newId, type TableId } from '../ids'
import { addMinor } from '../money'
import { readPayingSettings } from '../paying-settings'
import { DecimalQuantitySchema } from '../quantity'
import type { RecordedServiceCapabilities } from '../service-capabilities-config'
import {
  dropHeldLines,
  holdPayFirstLines,
  orderFromRow,
  type SendRequestLine,
  type TableOrderDraft,
  type TableOrderLine,
} from '../table-order'
import type { PaymentMode } from '../templates/venue-menu'
import { PAYMENT_UNCONFIRMED_KIND } from './alert-rules'
import type { AlertLocale } from './alert-text'
import { defineCommand, type ServiceTx } from './definition'
import { writeOrder } from './order'
import {
  closeAttempted,
  enterAttempted,
  quantityKey,
  signedSumMinor,
  TABLE_OPEN_PAYMENTS,
  type TipSchema,
  tipOf,
} from './pay'
import { movePayFirstSentOrder } from './pay-first-sent-order'
import {
  at,
  CodeSchema,
  type Locked,
  lockRoute,
  MinorSchema,
  move,
  PosRefSchema,
  raise,
  refusedLock,
} from './pay-route'
import { payingPaused, payingPausedAt } from './paying-pause'
import { loadPayingConnection, type PayingConnection } from './payment-connection'
import { lineAvailable, type PricedLine, priceSentLines, type SendMenu } from './send-menu'
import { readTableCapabilities, readVenueCapabilities } from './table-capabilities'

/** Whether a table offers pay-first items now, as a phone is told it (no ids, #114). */
export type PayFirstState = 'on' | 'paused' | 'off'

/**
 * Whether the table offers pay-first items, from what its POS declared and the venue's paying:
 * `off` where the POS can't open a bill that names itself, or paying is off; `paused` while the
 * venue's account lost access, or `paused` says so (ordering paused at the table, or the
 * provider's breaker pausing paying, #112).
 */
export function payFirstStateOf(
  capabilities: Pick<RecordedServiceCapabilities, 'firstItemsOpenBill'>,
  connection: Pick<PayingConnection, 'state' | 'providerKind' | 'readiness'>,
  paused: boolean,
): PayFirstState {
  if (!capabilities.firstItemsOpenBill) return 'off'
  if (connection.state === 'lost_access') return 'paused'
  if (!connection.readiness.on || connection.providerKind === null) return 'off'
  return paused ? 'paused' : 'on'
}

/**
 * Whether pay-first can apply anywhere at the venue (D122 §8): paying is offered (connected, or
 * paused while the account lost access) and a POS of its tables opens a bill that names itself.
 * Elsewhere the composer leaves the item's `payment_mode` out: it could not take effect.
 */
export async function payFirstPossibleAt(tx: ReadTx, venueId: string): Promise<boolean> {
  const connection = await loadPayingConnection(tx, venueId)
  const offered =
    connection.providerKind !== null &&
    (connection.readiness.on || connection.state === 'lost_access')
  if (!offered) return false
  return (await readVenueCapabilities(tx, venueId)).some((pos) => pos.firstItemsOpenBill)
}

/** `payFirstStateOf` for a table, read in the caller's transaction. */
export async function payFirstState(
  tx: ReadTx,
  input: { readonly venueId: string; readonly tableId: string; readonly paused: boolean },
): Promise<PayFirstState> {
  const capabilities = await readTableCapabilities(tx, input.tableId)
  if (!capabilities.firstItemsOpenBill) return 'off'
  const connection = await loadPayingConnection(tx, input.venueId)
  const paused = input.paused || (await payingPausedAt(tx, input.venueId))
  return payFirstStateOf(capabilities, connection, paused)
}

/**
 * The items of the table's menu (its route, else the live menu) that are paid first: their own
 * `payment_mode`, else the venue's default (`itemMode`). Read from the published snapshot, as the
 * phone sees it.
 */
export async function payFirstItems(
  tx: ReadTx,
  input: { readonly venueId: string; readonly tableId: string; readonly itemMode: PaymentMode },
): Promise<ReadonlySet<string>> {
  const routes = await resolveRoutesIn(tx, input.venueId)
  const menuId = routes.tables.get(input.tableId as TableId) ?? routes.live
  if (menuId === null) return new Set()
  const rows = await tx.execute<{ id: string }>(sql`
    select item.key as id
    from ${publishPointers}
    join ${snapshots} on ${snapshots.id} = ${publishPointers.currentSnapshotId}
    cross join lateral jsonb_each(${snapshots.body} -> 'items') as item(key, value)
    where ${publishPointers.menuId} = ${menuId}
      and ${publishPointers.venueId} = ${input.venueId}
      and coalesce(item.value ->> 'payment_mode', ${input.itemMode}) = 'pay_first'`)
  return new Set(rows.rows.map((row) => row.id))
}

// ---------------------------------------------------------------------------------------------
// The Send

/** The tip of a Send's pay-first part, as `pay.start` takes it. */
export type PayFirstTip = z.output<typeof TipSchema>

/** A Send's pay-first part, as its schema parses it (the guest API adds the handle's hash). */
export interface PayFirstSendPart {
  readonly lines: readonly SendRequestLine[]
  readonly tip: PayFirstTip
  readonly handleHash: string
}

/** Why a Send's pay-first part was refused, beside the Send's own codes. */
export const PAY_FIRST_SEND_REFUSALS = [
  /** The venue's account lost access (#114). */
  'paying_paused',
  /** The table's POS can't take a pay-first round, or paying is off: order from the waiter. */
  'paying_not_offered',
  /** The round and its tip are below the venue's card minimum. */
  'below_minimum',
] as const

/** The pay-first part of a Send, checked and priced: what `insertPayFirst` writes. */
export interface PayFirstPrepared {
  readonly paymentId: string
  /** The order with the pay-first lines held by the payment. */
  readonly order: TableOrderDraft
  readonly lines: readonly TableOrderLine[]
  readonly priced: readonly PricedLine[]
  readonly totalMinor: number
  readonly tipMinor: number
  readonly providerKind: string
}

/**
 * Checks and prices a Send's pay-first part (#113) inside the Send's transaction, after its
 * on-the-bill part took its lines. The lines must be some of the order's live, unheld pay-first
 * lines (`order_changed`); they are priced from the published menu (rule 5); the POS must take a
 * pay-first round and paying be on (`paying_not_offered`, `paying_paused`). No cap, pace or repeat
 * guard: the guest pays before the round goes anywhere.
 */
export async function preparePayFirst(
  stx: ServiceTx,
  input: {
    readonly tableId: string
    readonly order: TableOrderDraft
    readonly part: PayFirstSendPart
    readonly menu: SendMenu
    readonly isPayFirst: (line: { readonly itemId: string }) => boolean
  },
): Promise<
  | ({ readonly ok: true } & PayFirstPrepared)
  | { readonly ok: false; readonly code: string; readonly details?: Record<string, string> }
> {
  const { menu, tableId } = input
  const capabilities = await readTableCapabilities(stx.tx, tableId)
  // The account row is locked `FOR SHARE`, as `pay.start` does: no disconnect between the check
  // and the payment. Ordering's pauses were checked by the Send; the provider's breaker pauses
  // paying alone (#112).
  const connection = await loadPayingConnection(stx.tx, stx.venueId, 'share')
  const state = payFirstStateOf(capabilities, connection, await payingPaused(stx))
  if (state === 'paused') return { ok: false, code: 'paying_paused' }
  if (state === 'off' || connection.providerKind === null) {
    return { ok: false, code: 'paying_not_offered' }
  }

  const paymentId = newId('py')
  const held = holdPayFirstLines(
    input.order,
    input.part.lines,
    (line) => input.isPayFirst(line) && lineAvailable(menu, line),
    paymentId,
  )
  if (!held.ok) return { ok: false, code: held.code }
  const priced = priceSentLines(menu, held.lines)
  if (!priced.ok) return { ok: false, code: priced.code, details: { itemId: priced.itemId } }
  if (!capabilities.notesReachTicket) {
    const waiter = held.lines.find(
      (line) =>
        line.optionIds.length > 0 ||
        line.note.trim() !== '' ||
        menu.items.get(line.itemId)?.requiredOptions === true,
    )
    if (waiter !== undefined) {
      return { ok: false, code: 'order_from_waiter', details: { itemId: waiter.itemId } }
    }
  }

  const tipMinor = tipOf(input.part.tip, priced.totalMinor)
  // A tip given as an amount stops at the lines' own amount (100 %, as a percent tip does); and
  // none where the POS can't put it on the receipt (D127): the phone was told no tip is possible.
  if (input.part.tip.kind === 'amount' && tipMinor > priced.totalMinor) {
    return { ok: false, code: 'invalid_command' }
  }
  if (tipMinor > 0 && !capabilities.recordTipOnClose) return { ok: false, code: 'invalid_command' }
  // The venue's own floor here; the provider's minimum is checked when the worker prices it.
  const floor = readPayingSettings(stx.venue.settings).minCardMinor ?? 0
  if (addMinor(priced.totalMinor, tipMinor) < Math.max(floor, 1)) {
    return { ok: false, code: 'below_minimum' }
  }
  const open = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.tableId, tableId), isNull(payments.settledAt)))
  if (open.length >= TABLE_OPEN_PAYMENTS) return { ok: false, code: 'rate_limited' }

  return {
    ok: true,
    paymentId,
    order: held.order,
    lines: held.lines,
    priced: priced.lines,
    totalMinor: priced.totalMinor,
    tipMinor,
    providerKind: connection.providerKind,
  }
}

/**
 * Writes the pay-first payment (`requested`) and its lines, after its sent order (the payment
 * names it). Its lines carry no POS reference: the round is not on the POS yet. Their amounts are
 * the prices the guest saw.
 */
export async function insertPayFirst(
  stx: ServiceTx,
  prepared: PayFirstPrepared,
  input: {
    readonly tableId: string
    readonly sittingId: string
    readonly barId: string | null
    readonly sentOrderId: string
    readonly actionId: string
    readonly handleHash: string
    readonly currency: string
  },
): Promise<void> {
  await stx.tx.insert(payments).values({
    id: prepared.paymentId,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    tableId: input.tableId,
    sittingId: input.sittingId,
    barId: input.barId,
    serviceDate: stx.serviceDate,
    kind: 'pay_first',
    sentOrderId: input.sentOrderId,
    state: 'requested',
    handleHash: input.handleHash,
    actionId: input.actionId,
    tipMinor: prepared.tipMinor,
    currency: input.currency,
    providerKind: prepared.providerKind,
    ...stx.provenance,
  })
  await stx.tx.insert(paymentLines).values(
    prepared.lines.map((line, index) => {
      const price = prepared.priced[index]
      if (price === undefined) throw new Error('a priced line is missing')
      return {
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        paymentId: prepared.paymentId,
        position: index + 1,
        posLineRef: null,
        quantity: String(line.qty),
        posAmountMinor: price.totalMinor,
        displayName: price.name,
        ...stx.provenance,
      }
    }),
  )
}

// ---------------------------------------------------------------------------------------------
// The route after the hold

const paymentId = idSchema('py')

/** What a refusal of the entry means for the guest (the template words each). */
function enterRefusalReason(code: string | null): string {
  // Another bill on the payment table (a waiter's), or the POS said it is busy: the queue's answer.
  if (code === 'payment_table_busy' || code === 'busy') return 'busy'
  if (code === 'line_refused' || code === 'item_unavailable') return 'item_unavailable'
  return 'enter_refused'
}

/** Drops the payment's lines from the order: they are on the POS now, or may be. */
async function dropLines(stx: ServiceTx, locked: Locked): Promise<void> {
  const row = stx.rows.heldOrder(locked.payment.tableId)
  if (row === null) return
  const order = orderFromRow(row)
  if (!order.lines.some((line) => line.heldBy === locked.payment.id)) return
  await writeOrder(stx, row, dropHeldLines(order, locked.payment.id, (await stx.dbNow()).getTime()))
}

/**
 * `payment.entered`: the outcome of entering the round on the payment's payment table. `entered`
 * (the POS took it, or a read back found it there) → `entered`, its sent order `added`; `refused`
 * (nothing written) → cancelled and the hold released; `unknown` (not found after the read-back
 * window) → `unconfirmed`, for a manager: the round may still be on the POS.
 *
 * Once an entry was attempted (D127 3.13) nothing releases the hold on its own: a refusal after it
 * (the POS place gone, the payment table read busy with what may be the round) is `unknown` too.
 * A cancel that finds an entry attempted is turned `unknown` the same way (from `cancelling`).
 */
export function paymentEntered() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.entered'),
      paymentId,
      outcome: z.enum(['entered', 'refused', 'unknown']),
      /** The POS bill the round opened, when the POS named it; kept in the row (rule 3). */
      billRef: PosRefSchema.nullable(),
      code: CodeSchema.nullable(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_UNCONFIRMED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (payment.kind !== 'pay_first') return at(payment, payment.state, false)
      const attempted = await enterAttempted(stx, payment.id)
      // A cancel the worker was about to carry out, with an entry attempted and no manager's answer.
      const cancelled =
        payment.state === 'cancelling' &&
        command.outcome === 'unknown' &&
        attempted &&
        payment.reason !== 'no_receipt' &&
        payment.reason !== 'not_on_till'
      const queued = payment.state === 'queued' && payment.paymentTableId !== null
      if (!queued && !cancelled) return at(payment, payment.state, false)
      if (command.outcome === 'entered') {
        await move(stx, locked, 'entered')
        await movePayFirstSentOrder(stx, payment, ['waiting'], 'added', {
          posBillRef: command.billRef,
        })
        await dropLines(stx, locked)
        return at(payment, 'entered', true)
      }
      if (command.outcome === 'refused' && !attempted) {
        await move(stx, locked, 'cancelling', { reason: enterRefusalReason(command.code) })
        return at(payment, 'cancelling', true)
      }
      await move(stx, locked, 'unconfirmed', { reason: 'enter_unknown' }, { code: command.code })
      await raise(stx, locked, PAYMENT_UNCONFIRMED_KIND, 'money.follow_up', {}, true)
      await movePayFirstSentOrder(stx, payment, ['waiting'], 'unconfirmed', {
        reason: 'enter_unknown',
      })
      await dropLines(stx, locked)
      return at(payment, 'unconfirmed', true)
    },
  })
}

/**
 * The note on a pay-first round's first line, where notes reach the ticket: the guest's table, so
 * the bar takes the round there although it is entered on a payment table ("for Table 7").
 */
export function payFirstTableNote(locale: AlertLocale, label: string): string {
  return locale === 'bg' ? `за ${label}` : `for ${label}`
}

/** One line of the payment table's bill, as a reading gives it: its POS item kept in the backend. */
const ReadLineSchema = z.strictObject({
  item: z.string().min(1).max(200).nullable(),
  quantity: DecimalQuantitySchema,
  amountMinor: z.int(),
})

/** One line of the round, as it was entered: its POS item, quantity and the price the guest saw. */
export interface RoundLine {
  readonly item: string
  readonly quantity: string
  readonly amountMinor: number
}

/**
 * True when a bill is the round (#113): every line of it is one of the round's lines, the same POS
 * item, no more of it and for no more. Lines the POS dropped or lowered are allowed (the check
 * captures the lower total); anything else (a waiter's line, a line of another item, a higher
 * amount) is someone else's bill.
 */
export function billIsRound(
  round: readonly RoundLine[],
  bill: readonly {
    readonly item: string | null
    readonly quantity: string
    readonly amountMinor: number
  }[],
): boolean {
  if (bill.length === 0) return false
  const left = [...round]
  for (const line of bill) {
    const item = line.item
    if (item === null) return false
    const quantity = quantityKey(line.quantity)
    const index = left.findIndex(
      (own) =>
        own.item === item &&
        quantity > 0n &&
        quantity <= quantityKey(own.quantity) &&
        line.amountMinor >= 0 &&
        line.amountMinor <= own.amountMinor,
    )
    if (index < 0) return false
    left.splice(index, 1)
  }
  return true
}

/** The outcome of the pay-first check: what to capture, or why not. */
export type PayFirstCheck =
  | { readonly ok: true; readonly amountMinor: number; readonly lowered: boolean }
  | { readonly ok: false; readonly why: string }

/**
 * The check before the close (#113), pure: the payment table holds one open, unpaid bill, its total
 * its lines. Its total equal to the round's priced lines closes for the hold; lower (the POS's own
 * prices, a line it dropped) closes for the POS's amount, only where the provider captures less;
 * higher, never: the guest agreed to the held amount. The amount must still be held.
 */
export function payFirstCheck(input: {
  /** The round's lines as priced at Send, or null where they can't be named on the POS now. */
  readonly round: readonly RoundLine[] | null
  readonly tipMinor: number
  readonly bill: {
    readonly bills: number
    readonly totalMinor: number
    readonly paidMinor: number
    readonly lines: readonly {
      readonly item: string | null
      readonly quantity: string
      readonly amountMinor: number
    }[]
  } | null
  readonly partialCapture: boolean
  readonly heldMinor: number
}): PayFirstCheck {
  const bill = input.bill
  if (bill === null || bill.lines.length === 0) return { ok: false, why: 'no_bill' }
  if (bill.bills > 1) return { ok: false, why: 'several_bills' }
  if (input.round === null) return { ok: false, why: 'round_unknown' }
  if (!billIsRound(input.round, bill.lines)) return { ok: false, why: 'not_the_round' }
  const linesMinor = signedSumMinor(input.round.map((line) => line.amountMinor)) ?? 0
  if (bill.paidMinor > 0) return { ok: false, why: 'part_paid' }
  if (signedSumMinor(bill.lines.map((line) => line.amountMinor)) !== bill.totalMinor) {
    return { ok: false, why: 'total_changed' }
  }
  if (bill.totalMinor <= 0) return { ok: false, why: 'no_lines' }
  if (bill.totalMinor > linesMinor) return { ok: false, why: 'pos_higher' }
  const lowered = bill.totalMinor < linesMinor
  if (lowered && !input.partialCapture) return { ok: false, why: 'partial_not_supported' }
  const amountMinor = addMinor(bill.totalMinor, input.tipMinor)
  if (input.heldMinor < amountMinor) return { ok: false, why: 'hold_lost' }
  return { ok: true, amountMinor, lowered }
}

/**
 * `payment.pay_first_checked`: the worker's reading of the payment table after the round was
 * entered. `entered` → `checked` (the amount lowered to the POS's), or `unconfirmed`
 * (`entered_check_failed`) with a staff alert: the round is on the POS, so the hold is never
 * released on its own.
 */
export function paymentPayFirstChecked() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('payment.pay_first_checked'),
      paymentId,
      bill: z
        .strictObject({
          bills: z.int().positive().max(100),
          totalMinor: z.int(),
          paidMinor: MinorSchema,
          lines: z.array(ReadLineSchema).max(500),
        })
        .nullable(),
      /**
       * The POS item of each of the round's lines, in their order, as the worker enters them; null
       * where one has no POS link now. The amounts are the payment's own.
       */
      items: z.array(z.string().min(1).max(200)).max(100).nullable(),
      /** The provider captures less than the hold (`capabilities.partialCapture`). */
      partialCapture: z.boolean(),
      /** What the provider holds now; zero for a hold no longer `held`. */
      heldMinor: MinorSchema,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const locked = await lockRoute(stx, command.paymentId, {
        alertKinds: [PAYMENT_UNCONFIRMED_KIND],
      })
      if (refusedLock(locked)) return locked
      const { payment } = locked
      if (payment.kind !== 'pay_first') return at(payment, payment.state, false)
      // Again from `checked` while no close was attempted: a run that died between the check and
      // the close checks once more before it closes.
      const again = payment.state === 'checked' && !(await closeAttempted(stx, payment.id))
      if (!again && payment.state !== 'entered') return at(payment, payment.state, false)
      const lines = await stx.tx
        .select({ quantity: paymentLines.quantity, amountMinor: paymentLines.posAmountMinor })
        .from(paymentLines)
        .where(eq(paymentLines.paymentId, payment.id))
        .orderBy(paymentLines.position)
      const items = command.items
      const round =
        items === null || items.length !== lines.length
          ? null
          : lines.map((line, index) => ({
              item: items[index] ?? '',
              quantity: line.quantity,
              amountMinor: line.amountMinor,
            }))
      const check = payFirstCheck({
        round,
        tipMinor: payment.tipMinor,
        bill: command.bill,
        partialCapture: command.partialCapture,
        heldMinor: command.heldMinor,
      })
      if (!check.ok) {
        await move(
          stx,
          locked,
          'unconfirmed',
          { reason: 'entered_check_failed' },
          { why: check.why },
        )
        await raise(stx, locked, PAYMENT_UNCONFIRMED_KIND, 'money.follow_up', {}, true)
        return at(payment, 'unconfirmed', true, { reason: 'entered_check_failed', why: check.why })
      }
      const lowered = check.amountMinor !== payment.amountMinor
      if (again && !lowered)
        return at(payment, 'checked', false, { amountMinor: check.amountMinor })
      await move(
        stx,
        locked,
        'checked',
        lowered ? { amountMinor: check.amountMinor } : {},
        lowered ? { heldMinor: payment.amountMinor, amountMinor: check.amountMinor } : undefined,
      )
      return at(payment, 'checked', true, { amountMinor: check.amountMinor })
    },
  })
}

/** The pay-first route's commands, for the registry. */
export const PAY_FIRST_COMMANDS = {
  'payment.entered': paymentEntered(),
  'payment.pay_first_checked': paymentPayFirstChecked(),
} as const
