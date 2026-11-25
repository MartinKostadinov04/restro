// What the signed-in person holds at a venue, for the Settings tab to decide which sections it
// draws (#87). A read through the service read side; every command checks the rights again inside
// its own transaction.
import { type Permission, readVenueAccess } from '@restro/core/service'

import { getPool } from '../db'
import { isOperator } from '../staff/service'

/** What the Settings tab needs to know about the person. */
export interface SettingsAccess {
  /** The permissions held at this venue (empty when unknown). */
  readonly held: readonly Permission[]
  /** True on a shared device, where settings never open with a PIN (D122 §7). */
  readonly sharedDevice: boolean
  /** True for Restro's admin team. */
  readonly operator: boolean
}

/** The person's rights at the venue; none when the read is refused. */
export async function loadSettingsAccess(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly userId: string
  readonly sessionId: string
}): Promise<SettingsAccess> {
  const operator = await isOperator(input.userId)
  const access = await readVenueAccess(getPool(), {
    tenantId: input.tenantId,
    venueId: input.venueId,
    actor: operator
      ? { kind: 'operator', userId: input.userId }
      : { kind: 'user', userId: input.userId, sessionId: input.sessionId },
  })
  return access.ok
    ? { held: access.permissions, sharedDevice: access.device, operator }
    : { held: [], sharedDevice: false, operator }
}
