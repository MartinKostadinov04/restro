// The closing hour (#82; D122 §4): at the venue's closing time every table closes for phones. The
// worker's minute tick sends `hours.close_tables`; the command decides again from the venue's own
// settings and the caller's clock, under the tables' locks, so a late or repeated run closes
// nothing it should not. Each table's sitting ends through `endSitting` with the reason
// `closing_hour`, which writes the table's Log entry.

import { readOrderingSettings } from '../ordering-settings'
import { serviceNightAt } from '../service-hours'
import type { ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'
import { closeOpenTables } from './sittings'

/** `hours.close_tables`: ends every open sitting once the closing time of tonight has come. */
export async function closeAtClosingHour(stx: ServiceTx): Promise<ServiceResult> {
  const settings = readOrderingSettings(stx.venue.settings)
  const night = serviceNightAt(stx.now, {
    timeZone: stx.venue.timezone,
    dayEndsAt: stx.venue.serviceDayEndsAt,
    hours: settings.serviceHours,
  })
  if (!night.tablesClosed) return accepted(null, { details: { closed: 0 } })
  return closeOpenTables(stx, 'closing_hour')
}
