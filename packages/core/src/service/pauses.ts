// Pauses (D120, D122 §6; ticket #79): what stops ordering, and what lifts it. A pause is a
// `pauses` row; ordering stops at a table while its table, its bar, its venue or its POS
// connection has an active one.
//
// - **Connection pause** (scope `connection`, the POS instance's `in_` id): the breaker's
//   (`breaker.ts`), a Restro pause the worker starts (`connection.pause`), moves on each probe and
//   lifts (`pause.transition`). It is the instance's, so two venues on one instance share it: the
//   row names the venues it covers (`pause-scope.ts`). A venue orders through one instance, so it
//   is the venue pause too. Its breaker state rides on the row's details, so a worker restart
//   neither lifts nor doubles it.
// - **Staff pause** (`ordering.pause`): all bars (scope `venue`) or one (scope `bar`); a manager
//   lifts it (`ordering.lift`). A pause Restro started has no button: only Restro's admin team
//   lifts one by hand.
// - **Table pause**, two kinds besides the vanished table (`floor-pause.ts`):
//   - Unconfirmed (`order_unconfirmed`, D120): lifts at a waiter's act in the POS (where the
//     connector declares who entered a line), a staff resume (`table.resume`), all its POS bills
//     closed, or 15 minutes (`sweep`);
//   - a tripped guard (#78): lifts only at a staff resume or the sitting's end.
//   The sitting's end lifts every table pause but the vanished table's.
// When a venue, bar or connection pauses, its waiting sent orders become Not sent with their
// lines back; one in Sending or Checking finishes its read-back (D120).
//
// Locks, in the fixed order: the tables' sittings and orders, their waiting sent orders, then the
// pause, then the alert.

import { alerts, bars, pauses, venueTables } from '@restro/db'
import { and, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { TABLE_VANISHED_CAUSE } from './floor-pause'
import { COVERED_VENUES_KEY } from './pause-scope'
import { accepted, refused, type ServiceResult } from './results'
import { ORDER_UNCONFIRMED_CAUSE, settleWaiting } from './sent-order'

/** The cause of a staff pause. */
export const STAFF_PAUSE_CAUSE = 'staff'
/** How long an Unconfirmed sent order pauses its table at most (D120). */
export const UNCONFIRMED_PAUSE_MS = 15 * 60_000
/** The alert to Restro's admin team when a connection pauses for the third time in 30 minutes. */
export const CONNECTION_UNSTABLE_ALERT = 'connection_unstable'

/** Why a pause lifted. */
export const LIFT_REASONS = {
  probesGood: 'probes_good',
  staffResumed: 'staff_resumed',
  lifted: 'lifted',
  timedOut: 'timed_out',
  billsClosed: 'bills_closed',
  waiterActed: 'waiter_acted',
  sittingEnded: 'sitting_ended',
} as const

/** Table pauses that a resume and the sitting's end leave alone: they lift by themselves. */
const KEPT_TABLE_CAUSES = [TABLE_VANISHED_CAUSE]

const Cause = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
/** The breaker's state as the row keeps it (`breaker.ts` checks it). */
const BreakerJson = z.record(z.string(), z.unknown())

/** The venue's tables, all or one bar's. */
async function tablesOf(stx: ServiceTx, barId: string | null = null): Promise<string[]> {
  const rows = await stx.tx
    .select({ id: venueTables.id })
    .from(venueTables)
    .where(
      and(
        eq(venueTables.venueId, stx.venueId),
        ...(barId === null ? [] : [eq(venueTables.barId, barId)]),
      ),
    )
  return rows.map((row) => row.id)
}

/** The venues a connection pause covers, as its row lists them. */
function coveredVenues(details: Record<string, unknown>): string[] {
  const listed = details[COVERED_VENUES_KEY]
  return Array.isArray(listed) ? listed.filter((id): id is string => typeof id === 'string') : []
}

/** Locks the orders of these tables' open sittings, in key order; returns the tables locked. */
async function holdTables(stx: ServiceTx, tableIds: readonly string[]): Promise<string[]> {
  const sorted = [...new Set(tableIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (sorted.length === 0) return []
  await stx.rows.tableOrders(sorted)
  return sorted
}

/** Touches every held table, so its phones see the change at their next poll. */
function touchAll(stx: ServiceTx, tableIds: readonly string[]): void {
  for (const tableId of tableIds) stx.rows.touch(tableId)
}

/**
 * Lifts the table's active pauses (all but the vanished table's, or only `causes`), with a Log
 * entry each. The caller holds the table's order. Returns how many lifted.
 */
export async function liftTablePauses(
  stx: ServiceTx,
  tableId: string,
  reason: string,
  causes: readonly string[] | null = null,
): Promise<number> {
  const conditions = [
    eq(pauses.scope, 'table'),
    eq(pauses.targetId, tableId),
    isNull(pauses.liftedAt),
    notInArray(pauses.cause, KEPT_TABLE_CAUSES),
    ...(causes === null ? [] : [inArray(pauses.cause, [...causes])]),
  ]
  const found = await stx.tx
    .select({ cause: pauses.cause })
    .from(pauses)
    .where(and(...conditions))
  if (found.length === 0) return 0
  stx.rows.claim(
    'pause',
    found.map((row) => `table:${tableId}:${row.cause}`),
  )
  const locked = await stx.tx
    .select({ id: pauses.id, cause: pauses.cause, details: pauses.details })
    .from(pauses)
    .where(and(...conditions))
    .orderBy(pauses.cause)
    .for('update')
  for (const pause of locked) {
    await stx.tx
      .update(pauses)
      .set({
        liftedAt: sql`now()`,
        liftedBy: stx.provenance.actor,
        liftReason: reason,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(pauses.id, pause.id))
    const sentOrderId = pause.details.sentOrderId
    await stx.log({
      kind: 'pause.lifted',
      tableId,
      ...(typeof sentOrderId === 'string' ? { sentOrderId } : {}),
      reason,
      details: { pauseId: pause.id, cause: pause.cause },
    })
  }
  if (locked.length > 0) stx.rows.touch(tableId)
  return locked.length
}

/** Inserts an active staff pause (the caller claimed its key and found none). */
async function insertStaffPause(
  stx: ServiceTx,
  scope: 'venue' | 'bar',
  targetId: string,
): Promise<string> {
  const id = newId('pa')
  await stx.tx.insert(pauses).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    scope,
    targetId,
    cause: STAFF_PAUSE_CAUSE,
    restroStarted: false,
    details: {},
    ...stx.provenance,
  })
  return id
}

/** `ordering.pause`: staff pause all bars (`barId` null) or one bar. */
export function pauseOrdering() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('ordering.pause'), barId: idSchema('br').nullable() }),
    origins: ['staff'],
    permission: 'ordering.pause',
    idempotency: 'by_nature',
    async handle(stx, command) {
      const barId = command.barId
      if (barId !== null) {
        const [bar] = await stx.tx
          .select({ id: bars.id })
          .from(bars)
          .where(and(eq(bars.id, barId), eq(bars.venueId, stx.venueId), isNull(bars.archivedAt)))
        if (bar === undefined) return refused(null, 'bar_missing')
      }
      const scope = barId === null ? 'venue' : 'bar'
      const targetId = barId ?? stx.venueId
      const held = await holdTables(stx, await tablesOf(stx, barId))
      const settled = await settleWaiting(stx, held)
      stx.rows.claim('pause', [`${scope}:${targetId}:${STAFF_PAUSE_CAUSE}`])
      const [active] = await stx.tx
        .select({ id: pauses.id })
        .from(pauses)
        .where(
          and(
            eq(pauses.scope, scope),
            eq(pauses.targetId, targetId),
            eq(pauses.cause, STAFF_PAUSE_CAUSE),
            isNull(pauses.liftedAt),
          ),
        )
        .for('update')
      if (active !== undefined) {
        return accepted(null, { details: { pauseId: active.id, already: true, settled } })
      }
      const pauseId = await insertStaffPause(stx, scope, targetId)
      await stx.log({
        kind: 'pause.started',
        reason: STAFF_PAUSE_CAUSE,
        details: { pauseId, scope, barId },
      })
      touchAll(stx, held)
      return accepted(null, { details: { pauseId, already: false, settled } })
    },
  })
}

/**
 * `ordering.lift`: a manager lifts a staff pause; a pause Restro started has no button at the
 * venue, and only Restro's admin team (an operator) lifts it by hand.
 */
export function liftOrdering() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('ordering.lift'), pauseId: idSchema('pa') }),
    origins: ['staff'],
    permission: 'ordering.lift',
    idempotency: 'by_nature',
    async handle(stx, command) {
      const [pause] = await stx.tx.select().from(pauses).where(eq(pauses.id, command.pauseId))
      if (pause === undefined) return refused(null, 'pause_missing')
      // A pause of another venue (a connection pause is every venue's it covers).
      const ours =
        pause.scope === 'connection'
          ? pause.venueId === stx.venueId || coveredVenues(pause.details).includes(stx.venueId)
          : pause.venueId === stx.venueId
      if (!ours) return refused(null, 'pause_missing')
      const tables =
        pause.scope === 'table'
          ? [pause.targetId]
          : await tablesOf(stx, pause.scope === 'bar' ? pause.targetId : null)
      if (pause.liftedAt !== null) {
        return accepted(null, { details: { pauseId: pause.id, lifted: false, already: true } })
      }
      if (pause.restroStarted && stx.actor.kind !== 'operator') {
        return refused(null, 'restro_pause')
      }
      const held = await holdTables(stx, tables)
      stx.rows.claim('pause', [`${pause.scope}:${pause.targetId}:${pause.cause}`])
      const [locked] = await stx.tx
        .select({ liftedAt: pauses.liftedAt })
        .from(pauses)
        .where(eq(pauses.id, pause.id))
        .for('update')
      if (locked === undefined || locked.liftedAt !== null) {
        return accepted(null, { details: { pauseId: pause.id, lifted: false, already: true } })
      }
      await stx.tx
        .update(pauses)
        .set({
          liftedAt: sql`now()`,
          liftedBy: stx.provenance.actor,
          liftReason: LIFT_REASONS.lifted,
          nextProbeAt: null,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(pauses.id, pause.id))
      await stx.log({
        kind: 'pause.lifted',
        ...(pause.scope === 'table' ? { tableId: pause.targetId } : {}),
        reason: LIFT_REASONS.lifted,
        details: { pauseId: pause.id, scope: pause.scope, cause: pause.cause },
      })
      touchAll(stx, held)
      return accepted(null, { details: { pauseId: pause.id, lifted: true, already: false } })
    },
  })
}

/** `table.resume`: staff lift the table's Unconfirmed and guard pauses (never a vanished table's). */
export async function resumeTable(
  stx: ServiceTx,
  command: { readonly tableId: string },
): Promise<ServiceResult> {
  await stx.rows.tableOrder(command.tableId)
  const lifted = await liftTablePauses(stx, command.tableId, LIFT_REASONS.staffResumed)
  return accepted(null, { details: { lifted } })
}

/** The connection's active pause, locked (the caller claimed `connection:<in_>`), or null. */
async function activeConnectionPause(stx: ServiceTx, integrationId: string) {
  const [row] = await stx.tx
    .select({ id: pauses.id, cause: pauses.cause, details: pauses.details })
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'connection'),
        eq(pauses.targetId, integrationId),
        isNull(pauses.liftedAt),
      ),
    )
    .for('update')
  return row ?? null
}

/**
 * `connection.pause`: the breaker paused the instance's connection. The worker runs it once for
 * each venue on the instance: the first starts the pause, each later one adds its venue to the
 * venues it covers; each settles its own waiting sent orders and touches its tables. The third
 * automatic pause in 30 minutes also alerts Restro's admin team.
 */
export function pauseConnection() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('connection.pause'),
      integrationId: idSchema('in'),
      cause: Cause,
      unstable: z.boolean(),
      nextProbeAt: z.iso.datetime({ offset: true }),
      breaker: BreakerJson,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const held = await holdTables(stx, await tablesOf(stx))
      const settled = await settleWaiting(stx, held)
      stx.rows.claim('pause', [`connection:${command.integrationId}`])
      touchAll(stx, held)
      let active = await activeConnectionPause(stx, command.integrationId)
      if (active === null) {
        const id = newId('pa')
        // Another venue of the instance may start it at the same moment: the one active pause per
        // target (a unique index) lets one insert win, and this one joins it.
        const [inserted] = await stx.tx
          .insert(pauses)
          .values({
            id,
            tenantId: stx.tenantId,
            venueId: stx.venueId,
            serviceDate: stx.serviceDate,
            scope: 'connection',
            targetId: command.integrationId,
            cause: command.cause,
            restroStarted: true,
            nextProbeAt: new Date(command.nextProbeAt),
            details: {
              breaker: command.breaker,
              unstable: command.unstable,
              [COVERED_VENUES_KEY]: [stx.venueId],
            },
            ...stx.provenance,
          })
          .onConflictDoNothing()
          .returning({ id: pauses.id })
        if (inserted !== undefined) {
          await stx.log({
            kind: 'pause.started',
            reason: command.cause,
            details: { pauseId: id, scope: 'connection', unstable: command.unstable },
          })
          if (command.unstable) await alertUnstable(stx, command.integrationId, id)
          return accepted(null, { details: { pauseId: id, already: false, settled } })
        }
        active = await activeConnectionPause(stx, command.integrationId)
        if (active === null) throw new Error(`the pause of ${command.integrationId} vanished`)
      }
      const venues = coveredVenues(active.details)
      if (!venues.includes(stx.venueId)) {
        await stx.tx
          .update(pauses)
          .set({
            details: { ...active.details, [COVERED_VENUES_KEY]: [...venues, stx.venueId] },
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(pauses.id, active.id))
        await stx.log({
          kind: 'pause.started',
          reason: active.cause,
          details: { pauseId: active.id, scope: 'connection' },
        })
      }
      return accepted(null, { details: { pauseId: active.id, already: true, settled } })
    },
  })
}

/** One open alert to Restro's admin team per unstable connection. */
async function alertUnstable(stx: ServiceTx, integrationId: string, pauseId: string) {
  stx.rows.claim('alert', [`${CONNECTION_UNSTABLE_ALERT}:${integrationId}`])
  const [open] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.kind, CONNECTION_UNSTABLE_ALERT),
        eq(alerts.subjectId, integrationId),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  if (open !== undefined) return
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: CONNECTION_UNSTABLE_ALERT,
    audience: 'restro',
    subjectId: integrationId,
    permission: null,
    details: { pauseId },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    reason: CONNECTION_UNSTABLE_ALERT,
    details: { alertId: id, pauseId },
  })
}

/**
 * `pause.transition`: the breaker probed a paused connection. It records the probe's progress
 * (its state, the good probes in a row, when it probes next) or lifts the pause. A lift touches
 * this venue's tables of the instance even when another venue's command lifted it first. A pause
 * already lifted (by Restro's admin team) answers `lifted`, and the worker closes its breaker.
 */
export function transitionPause() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('pause.transition'),
      pauseId: idSchema('pa'),
      probeCount: z.int().nonnegative(),
      nextProbeAt: z.iso.datetime({ offset: true }).nullable(),
      breaker: BreakerJson,
      lift: z.boolean(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const [pause] = await stx.tx.select().from(pauses).where(eq(pauses.id, command.pauseId))
      if (pause === undefined) return refused(null, 'pause_missing')
      if (pause.scope !== 'connection') return refused(null, 'not_a_connection_pause')
      if (pause.venueId !== stx.venueId && !coveredVenues(pause.details).includes(stx.venueId)) {
        return refused(null, 'pause_missing')
      }
      const held = command.lift ? await holdTables(stx, await tablesOf(stx)) : []
      stx.rows.claim('pause', [`connection:${pause.targetId}`])
      const [locked] = await stx.tx
        .select({ liftedAt: pauses.liftedAt, details: pauses.details })
        .from(pauses)
        .where(eq(pauses.id, pause.id))
        .for('update')
      if (locked === undefined || locked.liftedAt !== null) {
        touchAll(stx, held)
        return accepted(null, { details: { lifted: true, already: true } })
      }
      const details = { ...locked.details, breaker: command.breaker }
      if (!command.lift) {
        await stx.tx
          .update(pauses)
          .set({
            probeCount: command.probeCount,
            nextProbeAt: command.nextProbeAt === null ? null : new Date(command.nextProbeAt),
            details,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(pauses.id, pause.id))
        return accepted(null, { details: { lifted: false, already: false } })
      }
      await stx.tx
        .update(pauses)
        .set({
          liftedAt: sql`now()`,
          liftedBy: stx.provenance.actor,
          liftReason: LIFT_REASONS.probesGood,
          probeCount: command.probeCount,
          nextProbeAt: null,
          details,
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(pauses.id, pause.id))
      await stx.log({
        kind: 'pause.lifted',
        reason: LIFT_REASONS.probesGood,
        details: { pauseId: pause.id, scope: 'connection', cause: pause.cause },
      })
      touchAll(stx, held)
      return accepted(null, { details: { lifted: true, already: false } })
    },
  })
}

/** `sweep`: the worker's minute tick lifts the venue's Unconfirmed pauses older than 15 minutes. */
export function sweepPauses() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('sweep') }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx) {
      const due = await stx.tx
        .select({ tableId: pauses.targetId })
        .from(pauses)
        .where(
          and(
            eq(pauses.venueId, stx.venueId),
            eq(pauses.scope, 'table'),
            eq(pauses.cause, ORDER_UNCONFIRMED_CAUSE),
            isNull(pauses.liftedAt),
            lte(pauses.startedAt, sql`now() - make_interval(secs => ${UNCONFIRMED_PAUSE_MS / 1000})`),
          ),
        )
      const tables = await holdTables(
        stx,
        due.map((row) => row.tableId),
      )
      let lifted = 0
      for (const tableId of tables) {
        lifted += await liftTablePauses(stx, tableId, LIFT_REASONS.timedOut, [
          ORDER_UNCONFIRMED_CAUSE,
        ])
      }
      return accepted(null, { details: { lifted } })
    },
  })
}
