// Which barsy hosts this process may talk to (CLAUDE.md rule 9: staging config refuses production
// hosts). An integration's host comes from the database, typed by a manager, so it is checked
// against the worker's own settings before a client is built:
//
//   1. it must be a bare https host name (the stored host has no scheme; the client always uses
//      https, and a redirect is never followed);
//   2. it must end with one of BARSY_ALLOWED_HOST_SUFFIXES (default `.barsyonline.com`), so a
//      manager cannot point the worker, and the credentials it opens, at an arbitrary server;
//   3. outside production it must not be one of BARSY_PRODUCTION_HOSTS: a staging worker never
//      reads a live venue's till.

import { normaliseHost } from '@restro/barsy'

import type { BarsyPolicy } from '../config'
import { SyncError } from './errors'

/** Returns the normalised host, or throws `SyncError('host_refused')`. */
export function assertSyncHost(host: string, policy: BarsyPolicy): string {
  let normalised: string
  try {
    normalised = normaliseHost(host)
  } catch {
    throw new SyncError('host_refused', 'The barsy host is not a plain host name.')
  }
  const allowed = policy.allowedHostSuffixes.some(
    (suffix) => normalised.endsWith(suffix) && normalised.length > suffix.length,
  )
  if (!allowed) {
    throw new SyncError('host_refused', 'This barsy host is not allowed for this worker.')
  }
  if (policy.env !== 'production' && policy.productionHosts.includes(normalised)) {
    throw new SyncError(
      'host_refused',
      'This is a production barsy host; this environment may not use it.',
    )
  }
  return normalised
}
