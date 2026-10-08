'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAuth } from './auth'
import { requireAccess } from './session'

/**
 * Switches the organisation (tenant) the signed-in person works in. Only an organisation they
 * are a member of is accepted (checked against the database, not the request), and Better
 * Auth's own `setActiveOrganization` checks the membership once more.
 */
export async function switchOrganization(organizationId: string): Promise<void> {
  const access = await requireAccess()
  if (typeof organizationId !== 'string') return
  if (!access.organizations.some((organization) => organization.id === organizationId)) return
  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId },
  })
  revalidatePath('/', 'layout')
  redirect('/venues')
}
