// Where a staff-only sign-in lands (plan §2, Q11): on Tonight of the venue they work at, so a bar
// tablet or a waiter's phone never shows the venues list. Staff-only means an account that is not
// an owner or admin of the organisation; it lands only when exactly one venue is theirs (a shared
// device's venue, or the one their staff assignment names).
import { sharedDevices, staffAssignments, staffMembers, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

import { getPool } from '../db'
import { canManageIntegration } from '../roles'

/** The one venue a staff-only sign-in works at, or null (then the venues list shows). */
export async function staffLandingVenue(input: {
  readonly tenantId: string
  readonly role: string
  readonly userId: string
  readonly sessionId: string
}): Promise<string | null> {
  if (canManageIntegration(input.role)) return null
  const venueIds = await withTenant(getPool(), input.tenantId, async (tx) => {
    const device = await tx
      .select({ venueId: sharedDevices.venueId })
      .from(sharedDevices)
      .where(and(eq(sharedDevices.sessionId, input.sessionId), isNull(sharedDevices.revokedAt)))
    if (device.length > 0) return device.map((row) => row.venueId)
    const assigned = await tx
      .select({ venueId: staffAssignments.venueId })
      .from(staffAssignments)
      .innerJoin(staffMembers, eq(staffMembers.id, staffAssignments.staffMemberId))
      .where(
        and(
          eq(staffMembers.userId, input.userId),
          isNull(staffMembers.archivedAt),
          isNull(staffAssignments.endedAt),
        ),
      )
    return assigned.map((row) => row.venueId)
  })
  const unique = [...new Set(venueIds)]
  return unique.length === 1 ? (unique[0] ?? null) : null
}
