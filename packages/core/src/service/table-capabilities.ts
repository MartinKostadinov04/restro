// What the POS of a table declared (D122 §3), as the floor reading recorded it in
// `integrations.config.service_capabilities` (#78): the table's place names its POS instance.
// All false for a table no POS instance serves, or one whose instance recorded nothing readable.

import { integrations, places, type ReadTx } from '@restro/db'
import { and, eq, ne } from 'drizzle-orm'

import {
  type RecordedServiceCapabilities,
  readServiceCapabilities,
} from '../service-capabilities-config'

/** The recorded capabilities of the table's POS instance. */
export async function readTableCapabilities(
  tx: ReadTx,
  tableId: string,
): Promise<RecordedServiceCapabilities> {
  const [row] = await tx
    .select({ config: integrations.config })
    .from(places)
    .innerJoin(integrations, eq(integrations.id, places.integrationId))
    .where(and(eq(places.tableId, tableId), ne(places.state, 'deleted')))
    .limit(1)
  return readServiceCapabilities(row?.config)
}
