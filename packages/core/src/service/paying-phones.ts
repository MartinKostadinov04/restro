// What an open phone is told about paying (RR-2). `readTableState` answers `unchanged` while the
// phone's version equals the table's, so a change to the venue's paying state or legal details has
// to raise the version of its tables, or a phone keeps showing Pay under the old name. The engine
// asks here around every command marked `payingState`: it holds the open tables' orders before the
// command (the fixed lock order, as a venue-wide pause does in `pauses.ts`) and touches them only
// when what a phone is told really moved, so an answer that changes nothing costs phones nothing.
//
// A table with no open sitting has no version to raise, and no bill to pay: the guest's first item
// opens a sitting, which raises the version, so the pay sheet always comes after a fresh state.

import { venues, venueTables } from '@restro/db'
import { eq } from 'drizzle-orm'

import { CARD_FLOOR_MINOR, readPayingSettings, smallestCardMinor } from '../paying-settings'
import type { ServiceTx } from './definition'
import { payingOffer } from './pay-first'

/** What a phone is told about paying at the venue, as one comparable string. */
async function payingFingerprint(stx: ServiceTx): Promise<string> {
  const offer = await payingOffer(stx.tx, { venueId: stx.venueId, paused: false })
  const [venue] = await stx.tx
    .select({ settings: venues.settings })
    .from(venues)
    .where(eq(venues.id, stx.venueId))
  const minCardMinor = smallestCardMinor(
    readPayingSettings(venue?.settings ?? {}),
    CARD_FLOOR_MINOR,
  )
  return JSON.stringify([offer.state, offer.provider, offer.legal, minCardMinor])
}

/**
 * Holds the venue's open tables and notes what a phone is told about paying. The answer, called
 * when the command has been accepted, touches those tables if that moved.
 */
export async function watchPayingState(stx: ServiceTx): Promise<() => Promise<void>> {
  const rows = await stx.tx
    .select({ id: venueTables.id })
    .from(venueTables)
    .where(eq(venueTables.venueId, stx.venueId))
  const tableIds = rows.map((row) => row.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (tableIds.length > 0) await stx.rows.tableOrders(tableIds)
  const before = await payingFingerprint(stx)
  return async () => {
    if ((await payingFingerprint(stx)) === before) return
    for (const tableId of tableIds) stx.rows.touch(tableId)
  }
}
