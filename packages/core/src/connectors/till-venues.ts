// The integration layer's names for the first connector's link tables (brief CF-03, D82): a venue
// of ours serves one till venue (`tillVenueLinks`), and a till venue's places are mirrored into
// the platform's `tables` (`tillPlaces`, D95). Platform code reads them under these names, so no
// vendor word reaches it; the columns are the connector package's own.
import { barsyVenues, integrations, venues } from '@restro/db'
import { and, eq } from 'drizzle-orm'

import { mirrorTillVenueIn } from '../apply/barsy-venues'

export { barsyVenues as tillVenueLinks, places as tillPlaces } from '@restro/db'

/** The till venue a venue of ours served before it was deleted (`venues.settings.till_before_delete`). */
export interface TillLink {
  readonly integration_id: string
  readonly bid: number
}

/** True for a stored till link. */
export function isTillLink(value: unknown): value is TillLink {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TillLink).integration_id === 'string' &&
    Number.isSafeInteger((value as TillLink).bid)
  )
}

/** What a relink on restore found. */
export type RelinkOutcome =
  | { readonly status: 'linked' }
  /** Another venue of ours serves the till venue now; its name for the refusal. */
  | { readonly status: 'taken'; readonly holder: { readonly id: string; readonly name: string } }
  /**
   * The till venue is not listed any more (its instance changed or went), or its instance was
   * removed (D81; its data waits for the purge, D91): nothing to link.
   */
  | { readonly status: 'missing' }

/**
 * Links a restored venue to the till venue it served before (adjustments V1), inside the
 * caller's transaction: when the till venue is still free the link is made and its places are
 * mirrored again; when another venue holds it the caller refuses the restore, naming that venue.
 * A removed instance is never linked again: the venue comes back unlinked, as for a till venue
 * that is not listed any more. The instance row is held `FOR SHARE` until the caller commits, so
 * a removal already under way is waited for and seen.
 */
export async function relinkTillVenue(
  tx: Parameters<typeof mirrorTillVenueIn>[0],
  tenantId: string,
  venueId: string,
  link: TillLink,
): Promise<RelinkOutcome> {
  const [instance] = await tx
    .select({ removedAt: integrations.removedAt })
    .from(integrations)
    .where(eq(integrations.id, link.integration_id))
    .for('share')
  if (instance === undefined || instance.removedAt !== null) return { status: 'missing' }
  const [row] = await tx
    .select({ venueId: barsyVenues.venueId })
    .from(barsyVenues)
    .where(and(eq(barsyVenues.integrationId, link.integration_id), eq(barsyVenues.bid, link.bid)))
    .for('update')
  if (row === undefined) return { status: 'missing' }
  if (row.venueId !== null && row.venueId !== venueId) {
    const [holder] = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, row.venueId))
    return { status: 'taken', holder: holder ?? { id: row.venueId, name: row.venueId } }
  }
  if (row.venueId === null) {
    await tx
      .update(barsyVenues)
      .set({ venueId, updatedAt: new Date() })
      .where(and(eq(barsyVenues.integrationId, link.integration_id), eq(barsyVenues.bid, link.bid)))
  }
  await mirrorTillVenueIn(tx, tenantId, link.integration_id, link.bid, new Date())
  return { status: 'linked' }
}
