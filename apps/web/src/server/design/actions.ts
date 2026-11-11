'use server'

// The Design page's server action (D129): a thin wrapper over service.ts. It checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that their role
// may change the design (owners and admins), that the device is their own, that the venue is theirs,
// checks the input with Zod and calls the service, which writes through `setDesign` in core/apply
// with the person as the actor. A change reaches guests with the next publish, like any hand edit.
import {
  DesignContentSchema,
  idSchema,
  PremadeStyleIdSchema,
  SavedStyleNameSchema,
  StyleStatusSchema,
  StyleValuesSchema,
} from '@restro/core'
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
import { type StyleSaveResult, saveStyle, setStyleStatus } from './styles'

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

/**
 * The organisation's saved Styles (D129, My styles). They belong to the organisation, not to a
 * venue, so these two take no venue; the checks are the design save's: the person's organisation,
 * a role that may change the design, and their own device, never a shared tablet.
 */
const StyleInput = z.strictObject({
  /** Null saves a new Style; an id replaces the name and values of that one. */
  styleId: idSchema('ds').nullable(),
  name: SavedStyleNameSchema,
  /** The premade Style the values came from. */
  style: PremadeStyleIdSchema,
  values: StyleValuesSchema,
})

const StyleStatusInput = z.strictObject({
  styleId: idSchema('ds'),
  status: StyleStatusSchema,
})

/** Saves a Style of the organisation: "Save as a style…", or "Update with this design". */
export async function saveStyleAction(input: unknown): Promise<StyleSaveResult> {
  const parsed = StyleInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return runStyleWrite((tenantId, actor) =>
    saveStyle(getPool(), tenantId, { ...parsed.data, actor }),
  )
}

/** Removes a Style of the organisation ("Delete style"), or puts it back (the toast's Undo). */
export async function setStyleStatusAction(input: unknown): Promise<StyleSaveResult> {
  const parsed = StyleStatusInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return runStyleWrite((tenantId, actor) =>
    setStyleStatus(getPool(), tenantId, { ...parsed.data, actor }),
  )
}

/**
 * The checks both Style writes share. Nothing is revalidated: the list is read by the Design page
 * itself, which refreshes after a write, and the Styles of the organisation's other venues are only
 * read when one of their pages is opened.
 */
async function runStyleWrite(
  write: (tenantId: string, actor: `user:${string}`) => Promise<StyleSaveResult>,
): Promise<StyleSaveResult> {
  try {
    const { organization, sessionId, user } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'forbidden' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'forbidden' }
    }
    return await write(organization.id, `user:${user.id}`)
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('design_style_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
