'use server'

// Adding a venue to the organisation (CF-01, D64): the first production path that creates one.
// A server action in the shape of the composer's (../composer/actions.ts): Zod first, then
// `requireTenant()` (the tenant is the person's organisation, never the request's), then the
// role (owners and admins), then core's writers `provisionVenue` and `provisionMenu` (rule 1:
// no SQL here). The slug is the readable part of the public menu address; a permanent random
// code is added to it (D68, brief CF-14). `renameVenueSlugAction` changes that readable part
// later: the code, and so every link ever shared, stays.
import {
  idSchema,
  isVenueSlug,
  JOB_NAMES,
  LOCALES,
  LocaleSchema,
  MAX_RETIRED_TOKENS,
  menuPath,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  archiveVenue,
  MAX_VENUE_NAME_LENGTH,
  ProvisionError,
  provisionMenu,
  provisionVenue,
  renameVenue,
  renameVenueSlug,
  restoreVenue,
} from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from './db'
import { enqueueJob } from './jobs'
import { logError } from './log'
import { menuOfVenue } from './publish/load'
import { canDeleteVenue, canManageIntegration } from './roles'
import { requireTenant } from './session'
import { getVenueInAnyState } from './venues'
import {
  type CreateVenueResult,
  type DeleteVenueResult,
  NEW_VENUE_CURRENCY,
  NEW_VENUE_TIMEZONE,
  type RenameVenueResult,
  type RenameVenueSlugResult,
  type RestoreVenueResult,
} from './venues-result'

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
      // The venue exists and a retry would make a second one. The composer offers "Create the
      // menu" on a venue without one, so send the person there.
      logError('venue_menu_create_failed', error)
    }
    revalidatePath('/venues')
    return { ok: true, venueId: venue.id }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'invalid_input') return { ok: false, error: 'invalid' }
    }
    logError('venue_create_failed', error)
    return { ok: false, error: 'failed' }
  }
}

const RenameVenueSlugInput = z.strictObject({
  venueId: idSchema('vn'),
  slug: z.string().refine(isVenueSlug),
})

/**
 * Changes the readable part of a venue's public address (D68). Owners and admins only. The public
 * code stays, so old links, printed codes and shared addresses keep opening the menu; the guest
 * page shows the new slug once the published files carry it. The files are brought up to date by
 * the worker: the venue index `v/<code>.json` (`publish-files`, only if something is published)
 * and the table files `t/<token>.json` (`publish-table-tokens`). Failing to queue them is not a
 * failed rename: it is saved, the answer says `filesQueued: false`, and the next publish repairs
 * the index.
 */
export async function renameVenueSlugAction(input: unknown): Promise<RenameVenueSlugResult> {
  const parsed = RenameVenueSlugInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, slug } = parsed.data
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    const pool = getPool()
    const renamed = await renameVenueSlug(pool, organization.id, venueId, slug)

    let filesQueued = true
    try {
      const tenantId = organization.id as TenantId
      const menuId = await menuOfVenue(pool, organization.id, venueId)
      if (menuId !== null) {
        await enqueueJob(JOB_NAMES.publishFiles, { tenantId, menuId, venueId })
      }
      await enqueueJob(JOB_NAMES.publishTableTokens, {
        tenantId,
        venueId: venueId as VenueId,
        retired: [],
      })
    } catch (error) {
      logError('venue_slug_files_not_queued', error)
      filesQueued = false
    }

    revalidatePath('/venues')
    revalidatePath(`/venues/${venueId}`)
    return {
      ok: true,
      slug: renamed.slug,
      path: menuPath({ slug: renamed.slug, publicId: renamed.publicId }),
      filesQueued,
    }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      // Not one of this organisation's venues looks the same as one that does not exist.
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
    }
    logError('venue_slug_rename_failed', error)
    return { ok: false, error: 'failed' }
  }
}

// --- rename, delete, restore (CF-18, D76) ----------------------------------------------------
//
// The same shape as the actions above: Zod first, then `requireTenant()` (the tenant is the
// person's organisation, never the request's), then the role, then core's writer. The venue checks
// live in core (`lockLiveVenue`) and in the worker's jobs; the sign-in gate (`proxy.ts`) stays a
// cookie check. All three revalidate the layout, so the sidebar follows at once.

const RenameVenueInput = z.strictObject({
  venueId: idSchema('vn'),
  name: z.string().trim().min(1).max(MAX_VENUE_NAME_LENGTH),
})

/**
 * Changes a venue's name. Owners and admins. The name reaches guests with the next publish, so
 * nothing is queued here.
 */
export async function renameVenueAction(input: unknown): Promise<RenameVenueResult> {
  const parsed = RenameVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, name } = parsed.data
  try {
    const { organization } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    const renamed = await renameVenue(getPool(), organization.id, venueId, name)
    revalidatePath('/', 'layout')
    return { ok: true, name: renamed.name, changed: renamed.changed }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'venue_archived') return { ok: false, error: 'venue_archived' }
      // Not one of this organisation's venues looks the same as one that does not exist.
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
    }
    logError('venue_rename_failed', error)
    return { ok: false, error: 'failed' }
  }
}

const DeleteVenueInput = z.strictObject({
  venueId: idSchema('vn'),
  /** The venue's name as the person typed it; checked here against the stored name. */
  confirmName: z.string().max(400),
})

/**
 * Deletes a venue: it is archived, nothing is erased (D76). Owners only, and the server itself
 * checks that `confirmName` (trimmed) is the venue's name, whatever the dialog did. After the
 * commit the worker is asked to take the venue's guest files out: the venue index (publish-files)
 * and the table files (publish-table-tokens, with the codes the deletion reported, since the till
 * link that found them is gone). Failing to queue is logged and said (`filesQueued: false`): the
 * venue is deleted all the same.
 */
export async function deleteVenueAction(input: unknown): Promise<DeleteVenueResult> {
  const parsed = DeleteVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, confirmName } = parsed.data
  try {
    const { organization } = await requireTenant()
    if (!canDeleteVenue(organization.role)) return { ok: false, error: 'not_allowed' }
    const pool = getPool()
    const venue = await getVenueInAnyState(organization.id, venueId)
    if (venue === null) return { ok: false, error: 'invalid' }
    if (venue.archivedAt !== null) return { ok: false, error: 'venue_archived' }
    if (confirmName.trim() !== venue.name) return { ok: false, error: 'name_mismatch' }

    const archived = await archiveVenue(pool, organization.id, venueId)

    let filesQueued = true
    try {
      const tenantId = organization.id as TenantId
      const menuId = await menuOfVenue(pool, organization.id, venueId)
      if (menuId !== null) {
        await enqueueJob(JOB_NAMES.publishFiles, { tenantId, menuId, venueId: venueId as VenueId })
      }
      // The codes go in batches the job accepts; at least one job, so the venue's own state is
      // looked at even when it had no table codes.
      const tokens = [...archived.tableTokens]
      do {
        await enqueueJob(JOB_NAMES.publishTableTokens, {
          tenantId,
          venueId: venueId as VenueId,
          retired: tokens.splice(0, MAX_RETIRED_TOKENS),
        })
      } while (tokens.length > 0)
    } catch (error) {
      logError('venue_delete_files_not_queued', error)
      filesQueued = false
    }

    revalidatePath('/', 'layout')
    return { ok: true, filesQueued }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'venue_archived') return { ok: false, error: 'venue_archived' }
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
    }
    logError('venue_delete_failed', error)
    return { ok: false, error: 'failed' }
  }
}

const RestoreVenueInput = z.strictObject({ venueId: idSchema('vn') })

/**
 * Brings a deleted venue back. Owners only. It comes back without a till link and unpublished (the
 * owner links the till again in Settings > Integrations and publishes); its public code and table
 * codes are the ones it had. The table files job is queued so the codes come back as soon as the
 * venue is linked and published again.
 */
export async function restoreVenueAction(input: unknown): Promise<RestoreVenueResult> {
  const parsed = RestoreVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId } = parsed.data
  try {
    const { organization } = await requireTenant()
    if (!canDeleteVenue(organization.role)) return { ok: false, error: 'not_allowed' }
    const venue = await getVenueInAnyState(organization.id, venueId)
    if (venue === null) return { ok: false, error: 'invalid' }
    await restoreVenue(getPool(), organization.id, venueId)

    let filesQueued = true
    try {
      await enqueueJob(JOB_NAMES.publishTableTokens, {
        tenantId: organization.id as TenantId,
        venueId: venueId as VenueId,
        retired: [],
      })
    } catch (error) {
      logError('venue_restore_files_not_queued', error)
      filesQueued = false
    }

    revalidatePath('/', 'layout')
    return { ok: true, name: venue.name, filesQueued }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
    }
    logError('venue_restore_failed', error)
    return { ok: false, error: 'failed' }
  }
}
