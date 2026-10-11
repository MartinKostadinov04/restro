'use server'

// The Design tab's server actions (brief SH-05a): thin wrappers over service.ts, in the shape of
// the old Appearance card's. Each checks who is asking (`requireTenant`: the tenant is the person's
// organisation, never the request's), that their role may change the look (owners and admins),
// that the venue is theirs, checks the input with Zod and calls the service, which writes through
// `setVenueTheme` / `setVenuePresentation` in core/apply. A change reaches guests with the next
// publish, like any hand edit.
import { FaceNameSchema, idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  chooseTemplate,
  FullThemeSchema,
  type LookResult,
  saveLook,
  type TemplateResult,
} from './service'

const LookInput = z.strictObject({
  venueId: idSchema('vn'),
  /** The WHOLE look: a partial theme is refused (`FullThemeSchema`). */
  theme: FullThemeSchema,
})

const TemplateInput = z.strictObject({
  venueId: idSchema('vn'),
  face: FaceNameSchema,
  /** The look options of the form, by key; the service keeps only the template's own. */
  lookOptions: z
    .record(z.string().max(32), z.union([z.string().max(32), z.boolean()]))
    .refine((options) => Object.keys(options).length <= 16, 'at most 16 options'),
})

/** Saves the venue's whole look: colours, font, corners, shadow, logo and light/dark policy. */
export async function saveLookAction(input: unknown): Promise<LookResult> {
  const parsed = LookInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await saveLook(getPool(), organization.id, parsed.data)
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_look_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Saves the template the venue chose and its look options (owners and admins). */
export async function chooseTemplateAction(input: unknown): Promise<TemplateResult> {
  const parsed = TemplateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await chooseTemplate(getPool(), organization.id, venue, parsed.data)
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_template_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
