// A guest's "Call a waiter" and what becomes of it (D122 §4; design `2026-10-21-service-data-design.md`
// §1; tickets #81, #180). A call has no text and no identity: the table, its sitting, what was
// asked for (`kinds`, from the venue's fixed list) and the time. One call is open per table: a
// later request is added to it (a repeat of a kind changes nothing). Staff mark it Handled
// (`alerts.answer`) once for all its kinds; one nobody answers lapses after the venue's time (15
// minutes by default) counted from its newest request, and one whose sitting ended lapses at
// once. Every step is a Log entry. A call is not located (D118, D122 §4): it needs the table open
// for phones, nothing more.
//
// Locks: the table's sitting and its order row first (the order's version rises, so every phone at
// the table sees the call's new state at its next poll), then the call row (lock-order.ts).

import { waiterCalls } from '@restro/db'
import { and, eq, sql } from 'drizzle-orm'

import { newId } from '../ids'
import { readOrderingSettings } from '../ordering-settings'
import {
  CALL_WAITER_KINDS,
  type CallWaiterKind,
  isCallWaiterKind,
  readGuestFeatures,
} from '../theme'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'

/** A waiter call row. */
export type WaiterCall = typeof waiterCalls.$inferSelect

/** Why a call lapsed (the Log's reason). */
type LapseReason = 'timeout' | 'sitting_ended'

/** When an open call lapses if nobody answers it: the venue's time after its newest request. */
export function waiterCallLapsesAt(lastCalledAt: Date, lapseMinutes: number): Date {
  return new Date(lastCalledAt.getTime() + lapseMinutes * 60_000)
}

/** The kinds of a call in the venue's list order, a value the list no longer holds left out. */
export function orderedKinds(kinds: readonly string[]): CallWaiterKind[] {
  const held = new Set(kinds.filter(isCallWaiterKind))
  return CALL_WAITER_KINDS.filter((kind) => held.has(kind))
}

/** Why an open call has lapsed at `nowMs`, or null while it is still live. */
function lapseReason(
  call: WaiterCall,
  openSittingId: string | null,
  nowMs: number,
  lapseMinutes: number,
): LapseReason | null {
  if (openSittingId !== call.sittingId) return 'sitting_ended'
  return waiterCallLapsesAt(call.lastCalledAt, lapseMinutes).getTime() <= nowMs ? 'timeout' : null
}

/** Makes the table's change visible to the phones at it, when it has an order row to bump. */
function touchTable(stx: ServiceTx, tableId: string): void {
  if (stx.rows.heldOrder(tableId) !== null) stx.rows.touch(tableId)
}

/** Locks the table's open call, or returns null. The table's sitting and order are held first. */
async function lockOpenCall(stx: ServiceTx, tableId: string): Promise<WaiterCall | null> {
  stx.rows.claim('waiter_call', [tableId])
  const [open] = await stx.tx
    .select()
    .from(waiterCalls)
    .where(and(eq(waiterCalls.tableId, tableId), eq(waiterCalls.state, 'open')))
    .for('update')
  return open ?? null
}

/** Ends an open call as lapsed, with its Log entry. */
async function lapse(stx: ServiceTx, call: WaiterCall, reason: LapseReason): Promise<void> {
  await stx.tx
    .update(waiterCalls)
    .set({ state: 'lapsed', ...stx.provenance, via: stx.via, updatedAt: sql`now()` })
    .where(eq(waiterCalls.id, call.id))
  await stx.log({
    kind: 'waiter_call.lapsed',
    tableId: call.tableId,
    sittingId: call.sittingId,
    fromState: 'open',
    toState: 'lapsed',
    reason,
    details: { waiterCallId: call.id, kinds: call.kinds.join(',') },
  })
  touchTable(stx, call.tableId)
}

/** The lock on a call of a known id: the table's rows first, then the call. */
async function lockCall(
  stx: ServiceTx,
  waiterCallId: string,
): Promise<{ readonly call: WaiterCall; readonly openSittingId: string | null } | null> {
  const [peek] = await stx.tx
    .select({ tableId: waiterCalls.tableId })
    .from(waiterCalls)
    .where(and(eq(waiterCalls.id, waiterCallId), eq(waiterCalls.venueId, stx.venueId)))
  if (peek === undefined) return null
  const sitting = await stx.rows.openSitting(peek.tableId)
  await stx.rows.tableOrder(peek.tableId)
  stx.rows.claim('waiter_call', [waiterCallId])
  const [call] = await stx.tx
    .select()
    .from(waiterCalls)
    .where(eq(waiterCalls.id, waiterCallId))
    .for('update')
  return call === undefined ? null : { call, openSittingId: sitting?.id ?? null }
}

/**
 * The guest's call for one `kind`. Refused `table_not_open` when the table has no open sitting,
 * `calls_off` when the venue has not switched "Call a waiter" on (the guest sees the still card
 * then, never a button) and `kind_not_offered` when the venue's list does not hold the kind. With
 * no open call it opens one; with one open it adds the kind when new (a repeat returns the call
 * unchanged) and restarts the venue's unanswered time. An open call whose time or sitting is past
 * lapses first, so the new group's request makes a new call.
 */
export async function callWaiter(
  stx: ServiceTx,
  command: {
    readonly tableId: string
    readonly actionId: string
    readonly kind: CallWaiterKind
  },
): Promise<ServiceResult> {
  const sitting = await stx.rows.openSitting(command.tableId)
  if (sitting === null) return refused(command.actionId, 'table_not_open')
  const { call_waiter: offered } = readGuestFeatures(stx.venue.settings)
  if (!offered.enabled) return refused(command.actionId, 'calls_off')
  if (!offered.kinds.includes(command.kind)) return refused(command.actionId, 'kind_not_offered')
  await stx.rows.tableOrder(command.tableId)
  const open = await lockOpenCall(stx, command.tableId)
  if (open !== null) {
    const reason = lapseReason(
      open,
      sitting.id,
      (await stx.dbNow()).getTime(),
      readOrderingSettings(stx.venue.settings).callLapseMinutes,
    )
    if (reason === null) {
      if (open.kinds.includes(command.kind)) {
        return accepted(command.actionId, {
          details: { waiterCallId: open.id, repeat: true, kinds: open.kinds.join(',') },
        })
      }
      const kinds = orderedKinds([...open.kinds, command.kind])
      await stx.tx
        .update(waiterCalls)
        .set({
          kinds,
          lastCalledAt: sql`now()`,
          ...stx.provenance,
          via: stx.via,
          updatedAt: sql`now()`,
        })
        .where(eq(waiterCalls.id, open.id))
      await stx.log({
        kind: 'waiter_call.called',
        tableId: command.tableId,
        sittingId: sitting.id,
        toState: 'open',
        details: { waiterCallId: open.id, kind: command.kind, kinds: kinds.join(',') },
      })
      touchTable(stx, command.tableId)
      return accepted(command.actionId, {
        details: { waiterCallId: open.id, repeat: false, kinds: kinds.join(',') },
      })
    }
    await lapse(stx, open, reason)
  }
  const id = newId('wc')
  const kinds = [command.kind]
  await stx.tx.insert(waiterCalls).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    tableId: command.tableId,
    sittingId: sitting.id,
    serviceDate: stx.serviceDate,
    kinds,
    via: stx.via,
    ...stx.provenance,
  })
  await stx.log({
    kind: 'waiter_call.called',
    tableId: command.tableId,
    sittingId: sitting.id,
    toState: 'open',
    details: { waiterCallId: id, kind: command.kind, kinds: kinds.join(',') },
  })
  touchTable(stx, command.tableId)
  return accepted(command.actionId, {
    details: { waiterCallId: id, repeat: false, kinds: kinds.join(',') },
  })
}

/**
 * Staff mark a call Handled (`alerts.answer`, checked by the engine). A repeat finds it done and
 * changes nothing; a call that lapsed first is refused `call_lapsed`, so the screen shows that
 * nobody had answered it in time.
 */
export async function waiterCallDone(
  stx: ServiceTx,
  command: { readonly waiterCallId: string },
): Promise<ServiceResult> {
  const held = await lockCall(stx, command.waiterCallId)
  if (held === null) return refused(null, 'call_missing')
  const { call } = held
  if (call.state === 'done') return accepted(null, { details: { state: 'done', changed: false } })
  if (call.state === 'lapsed') return refused(null, 'call_lapsed')
  await stx.tx
    .update(waiterCalls)
    .set({
      state: 'done',
      doneAt: sql`now()`,
      doneBy: stx.provenance.actor,
      via: stx.via,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(waiterCalls.id, call.id))
  await stx.log({
    kind: 'waiter_call.done',
    tableId: call.tableId,
    sittingId: call.sittingId,
    fromState: 'open',
    toState: 'done',
    details: { waiterCallId: call.id, kinds: call.kinds.join(',') },
  })
  touchTable(stx, call.tableId)
  return accepted(null, { details: { state: 'done', changed: true } })
}

/**
 * The worker's lapse of one call: when its time has passed or its sitting has ended. Decided under
 * the call's lock, so a run that races a Handled or another run changes nothing.
 */
export async function lapseWaiterCall(
  stx: ServiceTx,
  command: { readonly waiterCallId: string },
): Promise<ServiceResult> {
  const held = await lockCall(stx, command.waiterCallId)
  if (held === null) return refused(null, 'call_missing')
  const { call, openSittingId } = held
  if (call.state !== 'open') return accepted(null, { details: { changed: false } })
  const reason = lapseReason(
    call,
    openSittingId,
    (await stx.dbNow()).getTime(),
    readOrderingSettings(stx.venue.settings).callLapseMinutes,
  )
  if (reason === null) return accepted(null, { details: { changed: false } })
  await lapse(stx, call, reason)
  return accepted(null, { details: { changed: true } })
}
