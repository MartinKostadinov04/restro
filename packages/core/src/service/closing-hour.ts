// The closing hour (#82; D122 §4): at the venue's closing time every table closes for phones. The
// worker's minute tick sends `hours.close_tables`; the command decides again from the venue's own
// settings and the caller's clock, under the tables' locks, so a late or repeated run closes
// nothing it should not. A table with a payment still in progress is left for a later tick, and
// that tick may come after the service day ended (a manager's answer the morning after): a table
// kept for a payment of a service day whose closing has passed closes once its payment ended, not
// at the next open night (D122). Each table's sitting ends through `endSitting` with the reason
// `closing_hour`, which writes the table's Log entry.

import { payments, sittings } from '@restro/db'
import { and, eq, isNull, lt } from 'drizzle-orm'

import { readOrderingSettings } from '../ordering-settings'
import { closingHourPassed, type ServiceClock, serviceNightAt } from '../service-hours'
import type { ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'
import { closeOpenTables } from './sittings'

/** The open sittings that have a payment of an earlier service day whose closing has passed. */
async function sittingsKeptPastClosing(
  stx: ServiceTx,
  today: string,
  clock: ServiceClock,
): Promise<Set<string>> {
  const rows = await stx.tx
    .selectDistinct({ sittingId: payments.sittingId, serviceDate: payments.serviceDate })
    .from(payments)
    .innerJoin(sittings, eq(sittings.id, payments.sittingId))
    .where(
      and(
        eq(sittings.venueId, stx.venueId),
        isNull(sittings.endedAt),
        lt(payments.serviceDate, today),
      ),
    )
  return new Set(
    rows
      .filter((row) => closingHourPassed(row.serviceDate, stx.now, clock))
      .map((row) => row.sittingId),
  )
}

/**
 * `hours.close_tables`: ends every open sitting once the closing time of tonight has come, and any
 * time a sitting an earlier night's closing kept for its payment.
 */
export async function closeAtClosingHour(stx: ServiceTx): Promise<ServiceResult> {
  const settings = readOrderingSettings(stx.venue.settings)
  const clock: ServiceClock = {
    timeZone: stx.venue.timezone,
    dayEndsAt: stx.venue.serviceDayEndsAt,
    hours: settings.serviceHours,
  }
  const night = serviceNightAt(stx.now, clock)
  // A table with a payment in progress waits for a later tick (D122: end after close and capture).
  if (night.tablesClosed) return closeOpenTables(stx, 'closing_hour', { keepPaying: true })
  const kept = await sittingsKeptPastClosing(stx, night.serviceDate, clock)
  if (kept.size === 0) return accepted(null, { details: { closed: 0 } })
  return closeOpenTables(stx, 'closing_hour', { keepPaying: true, only: kept })
}
