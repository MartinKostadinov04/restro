// The two worker steps of the floor reading (ticket #71; verification, platform row 20): a table
// that vanishes from a complete floor reading pauses rather than ends its open sitting, and the
// pause lifts when a later complete reading lists the table again. Where the POS identifies a table
// by its number alone (a renumbering or an edited floor plan), ending the sitting at once would
// throw away a table's guests; pausing keeps the sitting and its order and stops new orders until a
// reading shows the table is there.
//
// The pause is a Restro pause (`restro_started`): it has no button, and it lifts by itself (D120,
// D122 §6). It is a `table`-scope pause with the cause `table_vanished`, one active at a time, so a
// repeated job changes nothing. A table with no open sitting has nothing to pause.

import { pauses } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { accepted } from './results'

/** The cause of the pause a vanished table gets. */
export const TABLE_VANISHED_CAUSE = 'table_vanished'

/** The reason a lifted pause records. */
export const TABLE_RETURNED_REASON = 'table_returned'

const tableId = idSchema('tb')

/** The active pause of this cause on the table, locked, or null. */
async function activePause(stx: ServiceTx, table: string) {
  stx.rows.claim('pause', [`table:${table}:${TABLE_VANISHED_CAUSE}`])
  const [row] = await stx.tx
    .select()
    .from(pauses)
    .where(
      and(
        eq(pauses.scope, 'table'),
        eq(pauses.targetId, table),
        eq(pauses.cause, TABLE_VANISHED_CAUSE),
        isNull(pauses.liftedAt),
      ),
    )
    .for('update')
  return row ?? null
}

/** The command a vanished table raises. */
export function tableVanished() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('floor.table_vanished'), tableId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const sitting = await stx.rows.openSitting(command.tableId, 'share')
      if (sitting === null) return accepted(null, { details: { paused: false } })
      if ((await activePause(stx, command.tableId)) !== null) {
        return accepted(null, { details: { paused: true, already: true } })
      }
      await stx.tx.insert(pauses).values({
        id: newId('pa'),
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        serviceDate: stx.serviceDate,
        scope: 'table',
        targetId: command.tableId,
        cause: TABLE_VANISHED_CAUSE,
        restroStarted: true,
        details: {},
        ...stx.provenance,
      })
      await stx.log({
        kind: 'pause.started',
        tableId: command.tableId,
        sittingId: sitting.id,
        reason: TABLE_VANISHED_CAUSE,
      })
      return accepted(null, { details: { paused: true, already: false } })
    },
  })
}

/** The command a table that is listed again raises. */
export function tableReturned() {
  return defineCommand({
    schema: z.strictObject({ type: z.literal('floor.table_returned'), tableId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      const pause = await activePause(stx, command.tableId)
      if (pause === null) return accepted(null, { details: { lifted: false } })
      await stx.tx
        .update(pauses)
        .set({
          liftedAt: sql`now()`,
          liftedBy: stx.provenance.actor,
          liftReason: TABLE_RETURNED_REASON,
          updatedAt: sql`now()`,
          ...stx.provenance,
        })
        .where(eq(pauses.id, pause.id))
      await stx.log({
        kind: 'pause.lifted',
        tableId: command.tableId,
        reason: TABLE_RETURNED_REASON,
      })
      return accepted(null, { details: { lifted: true } })
    },
  })
}
