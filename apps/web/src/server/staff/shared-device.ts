// Whether this sign-in is a shared tablet (D122 §7, RR-83). A shared device works Tonight; its
// session belongs to an account that may hold everything, so the menu's own actions and page ask
// here: the composer, its tags, the item sheet, the design and the Publish bar need the person's
// own sign-in. The session is a device at any venue of the organisation: a tablet of one venue
// doesn't become a person's sign-in by opening another venue's page.
import { sharedDevices, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { getPool } from '../db'

/** True when the session is a shared device of the organisation that has not been revoked. */
export async function onSharedDevice(input: {
  readonly tenantId: string
  readonly sessionId: string
}): Promise<boolean> {
  const rows = await withTenant(getPool(), input.tenantId, (tx) =>
    tx
      .select({ id: sharedDevices.id })
      .from(sharedDevices)
      .where(and(eq(sharedDevices.sessionId, input.sessionId), isNull(sharedDevices.revokedAt)))
      .limit(1),
  )
  return rows.length > 0
}
