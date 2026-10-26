// The worker's names for the first connector's tables (D82, D67): a venue of ours serves one till
// venue (`tillVenueLinks`). Platform code in the worker (the purge job) reads and erases the links
// under this name, so no vendor word reaches it; the columns are the connector's own. The same
// pair apps/web keeps in src/connectors/till-venues.ts and core in
// packages/core/src/connectors/till-venues.ts.

import type { NoticeProviders } from './jobs/provider-notices'

export { barsyVenues as tillVenueLinks } from '@restro/db'

// The payment providers the worker reads notices back from (#108), by kind. None yet: #107 adds
// the first real provider here, built from the worker's configuration. Until then a stored notice
// of a provider not listed waits (`provider-notices`), and the job logs it once it is a day old.
export function paymentProviders(): NoticeProviders {
  return new Map()
}
