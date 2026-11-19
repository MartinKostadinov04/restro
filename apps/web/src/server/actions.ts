'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAuth } from './auth'
import { requireAccess } from './session'
import { onSharedDevice } from './staff/shared-device'

/**
 * Switches the organisation (tenant) the signed-in person works in. Only an organisation they
 * are a member of is accepted (checked against the database, not the request), and Better
 * Auth's own `setActiveOrganization` checks the membership once more.
 */
export async function switchOrganization(organizationId: string): Promise<void> {
  const access = await requireAccess()
  if (typeof organizationId !== 'string') return
  if (!access.organizations.some((organization) => organization.id === organizationId)) return
  // A shared device stays the device of its own organisation's venue (D122 §7): switching would
  // leave it a full sign-in of the account in another organisation (lane 6 step 0, S1).
  if (
    access.organization !== null &&
    (await onSharedDevice({ tenantId: access.organization.id, sessionId: access.sessionId }))
  ) {
    return
  }
  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId },
  })
  revalidatePath('/', 'layout')
  redirect('/venues')
}
