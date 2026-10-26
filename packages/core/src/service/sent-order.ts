// A sent order's way to the POS (D115–D117, D120; ticket #77): the worker's three steps, each one
// short transaction through `applyService`. The POS calls happen between them, in the worker, never
// inside a transaction.
//
// - `sent_order.start`: takes the table's `order_slot` lease for its oldest waiting sent order
//   (one sent order in flight per table, D115). A lease whose holder died is the sweep's to
//   settle first (`busy`); a sent order whose sitting ended is Not sent (`table_closed`); one whose
//   table, bar or venue is paused is Not sent (`ordering_paused`) with its lines back.
// - `sent_order.transition`: moves the sent order the lease holder names, under its lease
//   (`lease_lost` when the fence moved on). States and the moves allowed (D116):
//     waiting  → sending | not_sent
//     sending  → checking | added | awaiting_approval | not_sent | unconfirmed
//     checking → added | awaiting_approval | unconfirmed
//   Repeating the state it is in changes nothing (a repeated job). A settled sent order releases
//   the lease. Not sent gives its lines back to the order ("your lines are back, Try again").
//   Unconfirmed pauses the table (D120: a Restro pause, lifted by staff's Resume, #79), raises the
//   venue alert (#83 delivers it) and settles the sent orders waiting behind it as Not sent with
//   their lines back: nothing more goes to the POS until a person has looked.
// - `sent_order.expire`: the sweep's, for a lease whose deadline passed (the worker died). A holder
//   that was sending or checking may have reached the POS: it is Unconfirmed (`check_timed_out`),
//   never retried. A holder still waiting never reached it: the lease is released and the sweep
//   queues the table again.
//
// Lock order (`lock-order.ts`): the table's order, the sent orders, the lease, the pause, the alert.

import { alerts, pauses, sentOrders } from '@restro/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { orderFromRow, returnSentLines, tidyOrder } from '../table-order'
import { defineCommand, type ServiceTx } from './definition'
import {
  holdsLease,
  type LeaseClaim,
  readLease,
  releaseLease,
  renewLease,
  takeLease,
} from './leases'
import { writeOrder } from './order'
import { accepted, refused, type ServiceResult } from './results'
import type { SentOrder } from './rows'
import { orderingPaused, sentOrderLinesOf, sentOrderNotesOf } from './send'
import { slotLeaseSeconds } from './send-timings'

const SLOT_LEASE = slotLeaseSeconds()
/** How long a start holds the table's slot: the read before the write, with its retries. */
export const SLOT_START_SECONDS = SLOT_LEASE.start
/** How long the slot is held from `sending`: the write, and its one more try. */
export const SLOT_SENDING_SECONDS = SLOT_LEASE.sending
/** How long the slot is held from `checking`: the read-back window and the last read. */
export const SLOT_CHECKING_SECONDS = SLOT_LEASE.checking

/** The cause of the table pause an Unconfirmed sent order raises. */
export const ORDER_UNCONFIRMED_CAUSE = 'order_unconfirmed'
/** The kind of the venue alert an Unconfirmed sent order raises. */
export const ORDER_UNCONFIRMED_ALERT = 'order_unconfirmed'

/** The states a sent order may move to from each state. */
const MOVES: Readonly<Record<string, readonly string[]>> = {
  waiting: ['sending', 'not_sent'],
  sending: ['checking', 'added', 'awaiting_approval', 'not_sent', 'unconfirmed'],
  checking: ['added', 'awaiting_approval', 'unconfirmed'],
}

/** The states a sent order ends in. */
export const SETTLED_STATES = ['added', 'awaiting_approval', 'not_sent', 'unconfirmed'] as const

/** The states a transition may name. */
const TRANSITION_STATES = ['sending', 'checking', ...SETTLED_STATES] as const

/** A short code: why a sent order was Not sent or is Unconfirmed. */
const ReasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const tableId = idSchema('tb')
const sentOrderId = idSchema('so')

/** The table's slot lease. */
function slotOf(table: string): { readonly scope: 'order_slot'; readonly key: string } {
  return { scope: 'order_slot', key: table }
}

/** The waiting sent orders of a table, oldest first (not locked). */
async function waitingOf(stx: ServiceTx, table: string): Promise<string[]> {
  const rows = await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(and(eq(sentOrders.tableId, table), eq(sentOrders.state, 'waiting')))
    .orderBy(asc(sentOrders.createdAt), asc(sentOrders.id))
  return rows.map((row) => row.id)
}

/**
 * Settles the sent order in `to` (or moves it on), with everything that goes with it. The caller
 * holds the table's order, the sent order (and, for Unconfirmed, the ones waiting behind it) and
 * the lease row, in that order.
 */
async function moveSentOrder(
  stx: ServiceTx,
  sent: SentOrder,
  change: {
    readonly to: string
    readonly reason: string | null
    readonly billBeforeMinor?: number
    readonly posBillRef?: string
    readonly matchedLines?: readonly string[]
  },
  claim: LeaseClaim | null,
  behind: readonly SentOrder[],
): Promise<void> {
  const { to, reason } = change
  const settles = (SETTLED_STATES as readonly string[]).includes(to)
  await stx.tx
    .update(sentOrders)
    .set({
      state: to,
      reason,
      ...(to === 'sending'
        ? { sentAt: sql`now()`, billBeforeMinor: change.billBeforeMinor ?? null }
        : {}),
      ...(change.posBillRef === undefined ? {} : { posBillRef: change.posBillRef }),
      ...(change.matchedLines === undefined ? {} : { matchedLines: [...change.matchedLines] }),
      ...(settles ? { settledAt: sql`now()` } : {}),
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(sentOrders.id, sent.id))
  await stx.log({
    kind: 'sent_order.state',
    sentOrderId: sent.id,
    tableId: sent.tableId,
    sittingId: sent.sittingId,
    fromState: sent.state,
    toState: to,
    ...(reason === null ? {} : { reason }),
  })
  if (to === 'not_sent') await giveLinesBack(stx, [sent])
  if (to === 'unconfirmed') {
    for (const waiting of behind) {
      await stx.tx
        .update(sentOrders)
        .set({
          state: 'not_sent',
          reason: 'ordering_paused',
          settledAt: sql`now()`,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(sentOrders.id, waiting.id))
      await stx.log({
        kind: 'sent_order.state',
        sentOrderId: waiting.id,
        tableId: waiting.tableId,
        sittingId: waiting.sittingId,
        fromState: waiting.state,
        toState: 'not_sent',
        reason: 'ordering_paused',
      })
    }
    await giveLinesBack(stx, behind)
  }
  if (to === 'checking' && claim !== null) {
    await renewLease(stx, { ...claim, seconds: SLOT_CHECKING_SECONDS })
  }
  if (to === 'sending' && claim !== null) {
    await renewLease(stx, { ...claim, seconds: SLOT_SENDING_SECONDS })
  }
  if (settles && claim !== null) await releaseLease(stx, claim)
  if (to === 'unconfirmed') await pauseAndAlert(stx, sent)
  stx.rows.touch(sent.tableId)
}

/**
 * Puts the lines of these sent orders back on the table's order, with their notes, when the order
 * is still their sitting's (a new group never gets the last group's lines).
 */
async function giveLinesBack(stx: ServiceTx, sent: readonly SentOrder[]): Promise<void> {
  if (sent.length === 0) return
  const table = sent[0]?.tableId
  if (table === undefined) return
  const row = stx.rows.heldOrder(table)
  if (row === null) return
  const ours = sent.filter((one) => one.sittingId === row.sittingId)
  if (ours.length === 0) return
  const notes = await sentOrderNotesOf(
    stx,
    ours.map((one) => one.id),
  )
  const now = (await stx.dbNow()).getTime()
  const current = tidyOrder(orderFromRow(row), now).order
  const lines = ours.flatMap((one) =>
    sentOrderLinesOf(one.lines).map((line) => ({ ...line, note: notes.get(line.id) ?? '' })),
  )
  await writeOrder(
    stx,
    row,
    returnSentLines(current, lines, now, () => newId('ol')),
  )
}

/** The table pause and the venue alert of an Unconfirmed sent order (one each). */
async function pauseAndAlert(stx: ServiceTx, sent: SentOrder): Promise<void> {
  stx.rows.claim('pause', [`table:${sent.tableId}:${ORDER_UNCONFIRMED_CAUSE}`])
  const [active] = await stx.tx
    .select({ id: pauses.id })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        eq(pauses.targetId, sent.tableId),
        eq(pauses.cause, ORDER_UNCONFIRMED_CAUSE),
        isNull(pauses.liftedAt),
      ),
    )
    .for('update')
  if (active === undefined) {
    await stx.tx.insert(pauses).values({
      id: newId('pa'),
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: stx.serviceDate,
      scope: 'table',
      targetId: sent.tableId,
      cause: ORDER_UNCONFIRMED_CAUSE,
      restroStarted: true,
      details: { sentOrderId: sent.id },
      ...stx.provenance,
    })
    await stx.log({
      kind: 'pause.started',
      tableId: sent.tableId,
      sittingId: sent.sittingId,
      sentOrderId: sent.id,
      reason: ORDER_UNCONFIRMED_CAUSE,
    })
  }

  stx.rows.claim('alert', [`${ORDER_UNCONFIRMED_ALERT}:${sent.id}`])
  const [open] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.kind, ORDER_UNCONFIRMED_ALERT), eq(alerts.subjectId, sent.id)))
    .for('update')
  if (open !== undefined) return
  const [row] = await stx.tx
    .select({ sentAt: sentOrders.sentAt, billBeforeMinor: sentOrders.billBeforeMinor })
    .from(sentOrders)
    .where(eq(sentOrders.id, sent.id))
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: ORDER_UNCONFIRMED_ALERT,
    audience: 'venue',
    subjectId: sent.id,
    permission: 'alerts.answer',
    // What a waiter needs at the till (D116): the reference, the items by the POS's names, the
    // time it was sent and the bill before it. Never a note.
    details: {
      reference: sent.reference,
      sentOrderId: sent.id,
      tableId: sent.tableId,
      items: sentOrderLinesOf(sent.lines).map((line) => ({
        name: line.name,
        options: line.optionNames,
        qty: line.qty,
      })),
      totalMinor: sent.totalMinor,
      sentAt: row?.sentAt?.toISOString() ?? null,
      billBeforeMinor: row?.billBeforeMinor ?? null,
    },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    tableId: sent.tableId,
    sittingId: sent.sittingId,
    sentOrderId: sent.id,
    reason: ORDER_UNCONFIRMED_ALERT,
    details: { alertId: id },
  })
}

/** Locks the table's order and these sent orders (with the ones waiting behind, when asked). */
async function lockAround(
  stx: ServiceTx,
  table: string,
  ids: readonly string[],
  withWaiting: boolean,
): Promise<{ readonly sent: Map<string, SentOrder>; readonly waiting: readonly string[] }> {
  await stx.rows.tableOrder(table)
  const waiting = withWaiting ? await waitingOf(stx, table) : []
  const sent = await stx.rows.sentOrders([...new Set([...ids, ...waiting])])
  return { sent, waiting: waiting.filter((id) => sent.get(id)?.state === 'waiting') }
}

/** `sent_order.start`. */
export async function startSentOrder(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  const table = command.tableId
  const order = await stx.rows.tableOrder(table)
  const [oldest] = await waitingOf(stx, table)
  if (oldest === undefined) return accepted(null, { details: { state: 'none' } })
  const sent = (await stx.rows.sentOrders([oldest])).get(oldest)
  if (sent === undefined || sent.state !== 'waiting') {
    return accepted(null, { details: { state: 'busy' } })
  }
  // The guests left: the sent order is the last group's (its lines went with their order).
  if (order === null || order.sittingId !== sent.sittingId) {
    await moveSentOrder(stx, sent, { to: 'not_sent', reason: 'table_closed' }, null, [])
    return accepted(null, { details: { state: 'settled', sentOrderId: sent.id } })
  }
  const lease = await readLease(stx.tx, slotOf(table))
  if (lease?.holder !== null && lease?.holder !== undefined) {
    // Another sent order is in flight, or its worker died and the sweep settles it first.
    return accepted(null, { details: { state: 'busy' } })
  }
  if (await orderingPaused(stx, table, sent.barId)) {
    await moveSentOrder(stx, sent, { to: 'not_sent', reason: 'ordering_paused' }, null, [])
    return accepted(null, { details: { state: 'settled', sentOrderId: sent.id } })
  }
  const taken = await takeLease(stx, {
    ...slotOf(table),
    holder: sent.id,
    seconds: SLOT_START_SECONDS,
  })
  if (!taken.taken) return accepted(null, { details: { state: 'busy' } })
  return accepted(null, {
    details: { state: 'taken', sentOrderId: sent.id, fence: taken.fence },
  })
}

/** The `sent_order.transition` command. */
export interface TransitionCommand {
  readonly sentOrderId: string
  readonly fence: number
  readonly to: (typeof TRANSITION_STATES)[number]
  readonly reason?: string | undefined
  readonly billBeforeMinor?: number | undefined
  readonly posBillRef?: string | undefined
  readonly matchedLines?: readonly string[] | undefined
}

/** `sent_order.transition`. */
export async function transitionSentOrder(
  stx: ServiceTx,
  command: TransitionCommand,
): Promise<ServiceResult> {
  const [found] = await stx.tx
    .select({ tableId: sentOrders.tableId })
    .from(sentOrders)
    .where(eq(sentOrders.id, command.sentOrderId))
  if (found === undefined) return refused(null, 'sent_order_missing')
  const { sent: locked, waiting } = await lockAround(
    stx,
    found.tableId,
    [command.sentOrderId],
    command.to === 'unconfirmed',
  )
  const sent = locked.get(command.sentOrderId)
  if (sent === undefined) return refused(null, 'sent_order_missing')
  if (sent.state === command.to) return accepted(null, { details: { changed: false } })
  if (!(MOVES[sent.state] ?? []).includes(command.to)) {
    return refused(null, 'sent_order_settled', { state: sent.state })
  }
  const claim: LeaseClaim = { ...slotOf(sent.tableId), holder: sent.id, fence: command.fence }
  if (!(await holdsLease(stx, claim))) return refused(null, 'lease_lost')
  const behind = waiting.flatMap((id) => {
    const one = locked.get(id)
    return one === undefined || one.id === sent.id ? [] : [one]
  })
  await moveSentOrder(
    stx,
    sent,
    {
      to: command.to,
      reason: command.reason ?? null,
      ...(command.billBeforeMinor === undefined
        ? {}
        : { billBeforeMinor: command.billBeforeMinor }),
      ...(command.posBillRef === undefined ? {} : { posBillRef: command.posBillRef }),
      ...(command.matchedLines === undefined ? {} : { matchedLines: command.matchedLines }),
    },
    claim,
    behind,
  )
  return accepted(null, { details: { changed: true, state: command.to } })
}

/** `sent_order.expire`: the sweep, for a table whose slot lease passed its deadline. */
export async function expireSentOrder(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  const table = command.tableId
  const lease = await readLease(stx.tx, slotOf(table))
  if (lease === null || lease.holder === null || !lease.expired) {
    return accepted(null, { details: { expired: false } })
  }
  const holder = lease.holder
  const { sent: locked, waiting } = await lockAround(stx, table, [holder], true)
  const claim: LeaseClaim = { ...slotOf(table), holder, fence: lease.fence }
  const sent = locked.get(holder)
  if (sent === undefined || sent.state === 'waiting' || !(sent.state in MOVES)) {
    // It never reached the POS (or is settled already): free the slot, the sweep queues it again.
    await releaseLease(stx, claim)
    return accepted(null, { details: { expired: true, released: true } })
  }
  const behind = waiting.flatMap((id) => {
    const one = locked.get(id)
    return one === undefined || one.id === sent.id ? [] : [one]
  })
  await moveSentOrder(stx, sent, { to: 'unconfirmed', reason: 'check_timed_out' }, claim, behind)
  return accepted(null, { details: { expired: true, released: true, sentOrderId: sent.id } })
}

/** The worker's sent order steps, for the registry. */
export const SENT_ORDER_COMMANDS = {
  'sent_order.start': defineCommand({
    schema: z.strictObject({ type: z.literal('sent_order.start'), tableId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: startSentOrder,
  }),
  'sent_order.transition': defineCommand({
    schema: z.strictObject({
      type: z.literal('sent_order.transition'),
      sentOrderId,
      fence: z.int().positive(),
      to: z.enum(TRANSITION_STATES),
      reason: ReasonSchema.optional(),
      billBeforeMinor: z.int().nonnegative().optional(),
      posBillRef: z.string().min(1).max(200).optional(),
      matchedLines: z.array(z.string().min(1).max(200)).max(200).optional(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: transitionSentOrder,
  }),
  'sent_order.expire': defineCommand({
    schema: z.strictObject({ type: z.literal('sent_order.expire'), tableId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: expireSentOrder,
  }),
} as const
