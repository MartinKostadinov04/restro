'use server'

// The Appearance card's server action (brief S3-03): a thin wrapper. It checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that the venue
// is theirs and that their role may change it, checks the input with Zod and calls service.ts,
// which writes through `setVenueTheme` in core/apply. The change reaches guests with the next
// publish, like any hand edit.
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import { type AppearanceResult, saveAppearance } from './service'

const Input = z.strictObject({
  venueId: idSchema('vn'),
  /** `#rrggbb`, either case. */
  brand: z.string().min(1).max(16),
  logoAssetId: idSchema('as').nullable(),
})

/** Saves the venue's brand colour and logo. */
export async function saveAppearanceAction(input: unknown): Promise<AppearanceResult> {
  const parsed = Input.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await saveAppearance(getPool(), organization.id, parsed.data)
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('appearance_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
