'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAuth } from './auth'
import { requireAccess } from './session'
import { onSharedDevice } from './staff/shared-device'

/**
 * Makes `organizationId` the session's active organisation (tenant). Only an organisation the
 * signed-in person is a member of is accepted (checked against the database, not the request),
 * and Better Auth's own `setActiveOrganization` checks the membership once more. Better Auth's
 * `/organization/set-active` is closed over HTTP (auth.ts), so the two actions below are the only
 * ways in.
 */
async function setActiveOrganization(organizationId: unknown): Promise<boolean> {
  const access = await requireAccess()
  if (typeof organizationId !== 'string') return false
  if (!access.organizations.some((organization) => organization.id === organizationId)) {
    return false
  }
  // A shared device stays the device of its own organisation's venue (D122 §7): switching would
  // leave it a full sign-in of the account in another organisation (lane 6 step 0, S1).
  if (
    access.organization !== null &&
    (await onSharedDevice({ tenantId: access.organization.id, sessionId: access.sessionId }))
  ) {
    return false
  }
  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId },
  })
  return true
}

/** Switches the organisation the signed-in person works in, and opens its venues. */
export async function switchOrganization(organizationId: string): Promise<void> {
  if (!(await setActiveOrganization(organizationId))) return
  revalidatePath('/', 'layout')
  redirect('/venues')
}

/**
 * Puts a fresh sign-in back in the organisation the person was working in. A new session starts in
 * their first organisation (auth.ts), so the password prompt calls this before it retries a change
 * (C1); without it the change could land in another organisation.
 */
export async function returnToOrganization(organizationId: string): Promise<{ ok: boolean }> {
  return { ok: await setActiveOrganization(organizationId) }
}
