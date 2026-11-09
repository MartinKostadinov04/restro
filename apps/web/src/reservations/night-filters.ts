// The filters over one night's list (#326), apart from the screen so their counts and their
// filtering can be tested without rendering anything. "All" is always there; every other filter is
// drawn only where the night holds at least one row behind it.
//
// The order is the order a night runs in, not the order of the status list: who is still to come,
// who is waiting, who is in, then how the evening ended for them.
import {
  RV_STATUSES,
  type RvCountsView,
  type RvRowView,
  type RvStatus,
} from '@/server/reservations/view'

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
