'use server'

// The composer's "Guest features" writes (brief SH-05b, D71). Like the appearance action: each
// checks who is asking (`requireTenant`: the organisation is the person's, never the request's),
// that their role may change the venue (owners and admins, `canManageIntegration`), checks its
// input with Zod, and writes through core/apply (rule 1): the switches go through
// `setGuestFeatures`. The change reaches guests with the next publish.
import { GuestFeaturesSchema, idSchema } from '@restro/core'
import { GuestFeaturesError, setGuestFeatures } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'

const venueId = idSchema('vn')

const SaveFeaturesInput = z.strictObject({
  venueId,
  features: GuestFeaturesSchema,
})

const FORBIDDEN = { ok: false, error: 'forbidden' } as const
const INVALID = { ok: false, error: 'invalid' } as const
const FAILED = { ok: false, error: 'failed' } as const

/** Saves the venue's guest services: the switches and the request kinds. */
export async function saveGuestFeaturesAction(input: unknown) {
  const parsed = SaveFeaturesInput.safeParse(input)
  if (!parsed.success) return INVALID
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return FORBIDDEN
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) return FORBIDDEN
    await setGuestFeatures(getPool(), organization.id, {
      venueId: parsed.data.venueId,
      features: parsed.data.features,
    })
    revalidatePath(`/venues/${parsed.data.venueId}`)
    return { ok: true } as const
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof GuestFeaturesError) return INVALID
    logError('guest_features_action_failed', error)
    return FAILED
  }
}
