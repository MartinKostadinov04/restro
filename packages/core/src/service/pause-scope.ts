// Which pauses stop ordering where (D120; ticket #79). A table's ordering stops while the table,
// its bar, its venue or the POS connection its venue orders through has an active pause.
//
// A connection pause is the POS instance's (its target is the `in_` id), so two venues on one
// instance share it. The platform knows no POS and never reads a connector's rows, so the pause
// row itself names the venues it covers (`details.venueIds`): the worker, which knows the
// instance's venues, adds each one (`connection.pause`). A venue orders through one instance: a
// connection pause covers all of its tables.

import { pauses } from '@restro/db'
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'

import type { ServiceTx } from './definition'

/** The details key that lists the venues a connection pause covers. */
export const COVERED_VENUES_KEY = 'venueIds'

/** An active or lifted connection pause that covers this venue. */
export function connectionCovers(venueId: string): SQL {
  return and(
    eq(pauses.scope, 'connection'),
    sql`coalesce(${pauses.details} -> ${COVERED_VENUES_KEY}, '[]'::jsonb) ? ${venueId}`,
  ) as SQL
}

/** The pauses that stop ordering at the venue: its own, and its connection's. */
export function pausesOfVenue(venueId: string): SQL {
  return or(eq(pauses.venueId, venueId), connectionCovers(venueId)) as SQL
}

/** The active pauses that stop ordering at this table. */
export function activePausesOfTable(table: {
  readonly id: string
  readonly venueId: string
  readonly barId: string | null
}): SQL {
  const targets = [table.id, table.venueId, ...(table.barId === null ? [] : [table.barId])]
  return and(
    isNull(pauses.liftedAt),
    or(
      and(eq(pauses.venueId, table.venueId), inArray(pauses.targetId, targets)),
      connectionCovers(table.venueId),
    ),
  ) as SQL
}

/**
 * True when ordering at this table is paused: the table itself, its bar, the whole venue, or the
 * POS connection the venue orders through (#79).
 */
export async function orderingPaused(
  stx: ServiceTx,
  tableId: string,
  barId: string | null,
): Promise<boolean> {
  const [active] = await stx.tx
    .select({ id: pauses.id })
    .from(pauses)
    .where(activePausesOfTable({ id: tableId, venueId: stx.venueId, barId }))
    .limit(1)
  return active !== undefined
}
