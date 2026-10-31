'use server'

// The Design page's server action (D129): a thin wrapper over service.ts. It checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that their role
// may change the design (owners and admins), that the device is their own, that the venue is theirs,
// checks the input with Zod and calls the service, which writes through `setDesign` in core/apply
// with the person as the actor. A change reaches guests with the next publish, like any hand edit.
import { DesignContentSchema, idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getAssetStore } from '../assets'
import { getPool } from '../db'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { onSharedDevice } from '../staff/shared-device'
import { getVenue } from '../venues'
import { type DesignSaveResult, saveDesign } from './service'

const DesignInput = z.strictObject({
  venueId: idSchema('vn'),
  /** The revision the page loaded; another save since then refuses this one. */
  expectedRevision: z.int().min(0),
  /** The WHOLE design: Done never saves a part of one. */
  design: DesignContentSchema,
})

/** Saves the venue's whole design (Done on the Design page). */
export async function saveDesignAction(input: unknown): Promise<DesignSaveResult> {
  const parsed = DesignInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization, sessionId, user } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'forbidden' }
    }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await saveDesign(
      getPool(),
      organization.id,
      { ...parsed.data, actor: `user:${user.id}` },
      { store: getAssetStore, role: organization.role },
    )
    if (result.ok) {
      revalidatePath(`/venues/${venue.id}`)
      revalidatePath(`/venues/${venue.id}/design`)
    }
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_save_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
