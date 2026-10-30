'use server'

// The Design tab's server actions (brief SH-05a, D129): thin wrappers over service.ts, in the shape
// of the old Appearance card's. Each checks who is asking (`requireTenant`: the tenant is the
// person's organisation, never the request's), that their role may change the look (owners and
// admins), that the venue is theirs, checks the input with Zod and calls the service, which writes
// through `setDesign` in core/apply with the person as the actor. A change reaches guests with the
// next publish, like any hand edit.
import { idSchema, SNAPSHOT_MENU_LAYOUTS } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getAssetStore } from '../assets'
import { getPool } from '../db'
import { logError } from '../log'
import { canManageIntegration } from '../roles'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  FullThemeSchema,
  type LayoutResult,
  type LookResult,
  saveLayout,
  saveLook,
} from './service'

const LookInput = z.strictObject({
  venueId: idSchema('vn'),
  /** The revision the tab loaded; another save since then refuses this one. */
  expectedRevision: z.int().min(0),
  /** The WHOLE look: a partial theme is refused (`FullThemeSchema`). */
  theme: FullThemeSchema,
})

const LayoutInput = z.strictObject({
  venueId: idSchema('vn'),
  layout: z.enum(SNAPSHOT_MENU_LAYOUTS),
  guestSwitch: z.boolean(),
})

/** Saves the venue's whole look: colours, font, corners, shadow, logo and light/dark policy. */
export async function saveLookAction(input: unknown): Promise<LookResult> {
  const parsed = LookInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization, user } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await saveLook(
      getPool(),
      organization.id,
      { ...parsed.data, actor: `user:${user.id}` },
      { store: getAssetStore, role: organization.role },
    )
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_look_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Saves the layout guests start in and whether they may switch it (owners and admins). */
export async function saveLayoutAction(input: unknown): Promise<LayoutResult> {
  const parsed = LayoutInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization, user } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false, error: 'unknown_venue' }
    const result = await saveLayout(getPool(), organization.id, {
      ...parsed.data,
      actor: `user:${user.id}`,
    })
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_layout_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
