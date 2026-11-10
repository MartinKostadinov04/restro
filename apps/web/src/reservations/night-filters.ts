// The filters over one night's list (#326), apart from the screen so their counts and their
// filtering can be tested without rendering anything. "All" is always there; every other filter is
// drawn only where the night holds at least one row behind it.
//
// The order is the order a night runs in, not the order of the status list: who is still to come,
// who is waiting, who is in, then how the evening ended for them.
//
// The "Waiting" filter is the one that reads the other way round (#330): it is the queue, and the
// queue's order is its meaning, so `waitingQueue` puts the party that has waited longest at the
// top. It is the same rows under the same filter, in the order core read the queue in — never a
// second list.
import type { RvCountsView, RvRowView, RvStatus, RvWaitingView } from '@/server/reservations/view'

import { RV_STATUSES } from './statuses'

/** One filter: everything, the late ones, or one state. */
export type ReservationFilter = 'all' | 'late' | RvStatus

/**
 * The filters in the order they are drawn. Every state has one of its own, so no row is
 * unreachable (D138's eight states, not the seven the ticket names).
 */
export const RESERVATION_FILTERS: readonly ReservationFilter[] = ['all', 'late', ...RV_STATUSES]

/** The rows a filter leaves. */
export function filterRows(
  rows: readonly RvRowView[],
  filter: ReservationFilter,
): readonly RvRowView[] {
  if (filter === 'all') return rows
  if (filter === 'late') return rows.filter((row) => row.late)
  return rows.filter((row) => row.status === filter)
}

/** The number on a filter's chip. */
export function filterCount(counts: RvCountsView, filter: ReservationFilter): number {
  if (filter === 'all') return counts.all
  if (filter === 'late') return counts.late
  return counts.byStatus[filter] ?? 0
}

/** One waiting party as its row is drawn: the night's row, with what the queue adds to it. */
export interface WaitingLine {
  readonly row: RvRowView
  readonly party: RvWaitingView
}

/**
 * The waiting parties in the queue's own order, oldest first, each with its row of the night.
 *
 * The order is core's (the queue key, not the hour), so a party the hostess moved up the queue
 * stays where she put it. A party the night's rows do not carry is left out rather than drawn
 * without its row: the night's list is capped, and half a row would read as a missing one.
 */
export function waitingQueue(
  rows: readonly RvRowView[],
  waiting: readonly RvWaitingView[],
): readonly WaitingLine[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const lines: WaitingLine[] = []
  for (const party of waiting) {
    const row = byId.get(party.reservationId)
    if (row === undefined) continue
    lines.push({ row, party })
  }
  return lines
}
