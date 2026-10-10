'use server'

// Adding a venue to the organisation (CF-01, D64): the first production path that creates one.
// A server action in the shape of the composer's (../composer/actions.ts): Zod first, then
// `requireTenant()` (the tenant is the person's organisation, never the request's), then the
// role (owners and admins), then core's writers `provisionVenue` and `provisionMenu` (rule 1:
// no SQL here). The slug is the readable part of the public menu address; a permanent random
// code is added to it (D68, brief CF-14).
import { isVenueSlug, LOCALES, LocaleSchema } from '@restro/core'
import { ProvisionError, provisionMenu, provisionVenue } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from './db'
import { logError } from './log'
import { canManageIntegration } from './roles'
import { requireTenant } from './session'
import { type CreateVenueResult, NEW_VENUE_CURRENCY, NEW_VENUE_TIMEZONE } from './venues-result'

const CreateVenueInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    slug: z.string().refine(isVenueSlug),
    defaultLocale: LocaleSchema,
    enabledLocales: z.array(LocaleSchema).min(1).max(LOCALES.length),
  })
  .refine(
    (input) =>
      new Set(input.enabledLocales).size === input.enabledLocales.length &&
      input.enabledLocales.includes(input.defaultLocale),
    'the main language must be one of the chosen languages, each at most once',
  )

/**
 * Creates a venue and its (empty) menu for the signed-in person's organisation, and answers with
 * the venue's id; the dialog then opens it. Only owners and admins.
 */
export async function createVenueAction(input: unknown): Promise<CreateVenueResult> {
  const parsed = CreateVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    const pool = getPool()
    const venue = await provisionVenue(pool, organization.id, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      timezone: NEW_VENUE_TIMEZONE,
      currency: NEW_VENUE_CURRENCY,
      defaultLocale: parsed.data.defaultLocale,
      enabledLocales: parsed.data.enabledLocales,
    })
    try {
      await provisionMenu(pool, organization.id, venue.id)
    } catch (error) {
      // The venue exists, so its address is taken and a retry could not succeed. The composer
      // offers "Create the menu" on a venue without one, so send the person there.
      logError('venue_menu_create_failed', error)
    }
    revalidatePath('/venues')
    return { ok: true, venueId: venue.id }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'slug_taken') return { ok: false, error: 'slug_taken' }
      if (error.code === 'invalid_input') return { ok: false, error: 'invalid' }
    }
    logError('venue_create_failed', error)
    return { ok: false, error: 'failed' }
  }
}
