'use server'

// The composer's "Guest features" writes (brief SH-05b, D71). Like the appearance action: each
// checks who is asking (`requireTenant`: the organisation is the person's, never the request's),
// that their role may change the venue (owners and admins, `canManageIntegration`), checks its
// input with Zod, and writes through core/apply (rule 1). The switches go through
// `setGuestFeatures`; the template's own feature options through `setVenuePresentation`, which
// keeps the look options the Design tab owns. The change reaches guests with the next publish.
import { GuestFeaturesSchema, idSchema, readPresentation } from '@restro/core'
import {
  GuestFeaturesError,
  setGuestFeatures,
  setVenuePresentation,
  VenuePresentationError,
} from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { faceEntry } from '@/faces/registry'
import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { getVenue } from '@/server/venues'

const venueId = idSchema('vn')

const SaveFeaturesInput = z.strictObject({
  venueId,
  features: GuestFeaturesSchema,
})

const SaveOptionsInput = z.strictObject({
  venueId,
  /** Option key to value; keys the face does not declare are dropped, not refused. */
  options: z
    .record(z.string().max(32), z.union([z.string().max(32), z.boolean()]))
    .refine((options) => Object.keys(options).length <= 32, 'too many options'),
})

const FORBIDDEN = { ok: false, error: 'forbidden' } as const
const INVALID = { ok: false, error: 'invalid' } as const
const FAILED = { ok: false, error: 'failed' } as const

/** Saves the venue's guest services: the switches and the request kinds. */
export async function saveGuestFeaturesAction(input: unknown) {
  const parsed = SaveFeaturesInput.safeParse(input)
  if (!parsed.success) return INVALID
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return FORBIDDEN
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

/**
 * Saves the template's own feature options (the switches the face declares with group `feature`).
 * Only declared keys with a value of their type are kept; the look options already stored, which
 * the Design tab owns, are left as they are.
 */
export async function saveFeatureOptionsAction(input: unknown) {
  const parsed = SaveOptionsInput.safeParse(input)
  if (!parsed.success) return INVALID
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return FORBIDDEN
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return INVALID
    const stored = readPresentation(venue.settings)
    // The face the guests get: the venue's, or the registry default (also for a name it lacks).
    const { id: face, manifest } = faceEntry(stored?.face)

    const kept: Record<string, string | boolean> = {}
    for (const [key, value] of Object.entries(parsed.data.options)) {
      if (!Object.hasOwn(manifest.options, key)) continue
      const option = manifest.options[key]
      if (option === undefined || option.group !== 'feature') continue
      if (option.type === 'boolean' && typeof value === 'boolean') kept[key] = value
      if (option.type === 'enum' && typeof value === 'string' && option.values.includes(value)) {
        kept[key] = value
      }
    }

    await setVenuePresentation(getPool(), organization.id, {
      venueId: venue.id,
      presentation: { face, options: { ...stored?.options, ...kept } },
    })
    revalidatePath(`/venues/${venue.id}`)
    return { ok: true } as const
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof VenuePresentationError) return INVALID
    logError('guest_feature_options_action_failed', error)
    return FAILED
  }
}
