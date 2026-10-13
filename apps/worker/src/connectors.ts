// The worker's names for the first connector's tables (D82, D67): a venue of ours serves one till
// venue (`tillVenueLinks`). Platform code in the worker (the purge job) reads and erases the links
// under this name, so no vendor word reaches it; the columns are the connector's own. The same
// pair apps/web keeps in src/connectors/till-venues.ts and core in
// packages/core/src/connectors/till-venues.ts.

export { barsyVenues as tillVenueLinks } from '@restro/db'
