// The web platform's names for the first connector's link table (D82): a venue of ours serves one
// till venue (`tillVenueLinks`). Platform code reads the links under these names, so no vendor
// word reaches it; the columns are the connector's own. The same pair core keeps for itself in
// `packages/core/src/connectors/till-venues.ts`.

export type { BarsyVenue as TillVenueLink } from '@restro/db'
export { barsyVenues as tillVenueLinks } from '@restro/db'
