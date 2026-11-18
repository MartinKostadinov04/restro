// What is connected for a venue, as the composer's guest-feature notes need it (walk P3). Read from
// the database only: the web app never asks a POS (rule 7).
import { readPayingConnection, readVenueServesOrders } from '@restro/core/service'

import { getPool } from '../db'

export interface GuestConnectionsRead {
  /** A POS instance serves the venue's tables. */
  readonly pos: boolean
  /** The venue's payment account is connected (not connecting, lost or disconnected). */
  readonly card: boolean
}

export async function readGuestConnections(
  tenantId: string,
  venueId: string,
): Promise<GuestConnectionsRead> {
  const pool = getPool()
  const [pos, payment] = await Promise.all([
    readVenueServesOrders(pool, tenantId, venueId),
    readPayingConnection(pool, tenantId, venueId),
  ])
  return { pos, card: payment.state === 'connected' }
}
