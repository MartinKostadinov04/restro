// One writer at a time per tenant document. apply() reads the current state, decides every op in
// memory and then writes; a second apply() for the same tenant in between would make those
// decisions stale (two 'end' placements computing the same key, two pulls creating the same
// node). A transaction-scoped advisory lock serialises them; it is released at commit or
// rollback. Traffic is low (D35), so tenants wait for each other's change sets, never for
// another tenant's.

import type { WriteTx } from '@restro/db/write'
import { sql } from 'drizzle-orm'

/** Takes the tenant's document lock for the rest of the transaction. */
export async function lockTenantDocument(tx: WriteTx, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`restro:document:${tenantId}`}, 0))`,
  )
}
