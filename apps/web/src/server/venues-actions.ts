'use server'

// Adding a venue to the organisation (CF-01, D64; two steps since D85): the first production path
// that creates one. A server action in the shape of the composer's (../composer/actions.ts): Zod
// first, then `requireTenant()` (the tenant is the person's organisation, never the request's),
// then the role (owners and admins), then whether this sign-in is a shared tablet, which never
// runs these (RR-84), then core's writers (rule 1: no SQL here). The source is fixed here for good
// (D87): a connected POS instance and one of its venues, or by hand.
//   - From a POS nothing is typed: the name is the POS venue's, the address is made from it
//     (`addVenueFromTillVenue` makes the venue, its menu and the link in one transaction), the
//     main language is the instance's. The languages then follow the next reads (D77).
//   - By hand: name, address name and languages come from the form (`provisionVenue` and
//     `provisionMenu`). The address name is the venue part of `/m/<organisation>/<venue>` (D84).
// `renameVenueSlugAction` changes the address name later; the old one keeps redirecting.
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
  addVenueFromTillVenue,
  archiveVenue,
  MAX_VENUE_NAME_LENGTH,
  ProvisionError,
  provisionMenu,
  provisionVenue,
  renameVenue,
  renameVenueSlug,
  restoreVenue,
  unpublishVenue,
} from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { suggestSlug } from '@/lib/slug'

import { getPool } from './db'
import { enqueueJob } from './jobs'
import { logError } from './log'
import { menuOfVenue } from './publish/load'
import { canDeleteVenue, canManageIntegration } from './roles'
import { requireTenant } from './session'
import { onSharedDevice } from './staff/shared-device'
import { getVenueInAnyState, listNewVenueSources, loadTillVenueToAdd } from './venues'
import {
  type CreateVenueResult,
  type DeleteVenueResult,
  NEW_VENUE_CURRENCY,
  NEW_VENUE_TIMEZONE,
  type NewVenueSourcesResult,
  type PurgeVenueResult,
  type RenameVenueResult,
  type RenameVenueSlugResult,
  type RestoreVenueResult,
  type UnpublishVenueResult,
} from './venues-result'

const CreateVenueSource = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('instance'),
    integrationId: idSchema('in'),
    bid: z.int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('hand') }),
])

const CreateVenueLanguages = z
  .strictObject({
    main: LocaleSchema,
    enabled: z.array(LocaleSchema).min(1).max(LOCALES.length),
  })
  .refine(
    (languages) =>
      new Set(languages.enabled).size === languages.enabled.length &&
      languages.enabled.includes(languages.main),
    'the main language must be one of the chosen languages, each at most once',
  )

const CreateVenueInput = z
  .strictObject({
    source: CreateVenueSource,
    name: z.string().trim().min(1).max(MAX_VENUE_NAME_LENGTH).optional(),
    slug: z.string().refine(isVenueSlug).optional(),
    languages: CreateVenueLanguages.optional(),
  })
  .refine(
    (input) =>
      input.source.kind === 'hand'
        ? input.name !== undefined && input.slug !== undefined && input.languages !== undefined
        : input.name === undefined && input.slug === undefined && input.languages === undefined,
    'a hand-made venue needs a name, an address name and languages; one made from a POS takes none of them',
  )

type CreateVenueData = z.output<typeof CreateVenueInput>

/** Another address name to try when the one made from a POS venue's name is taken (-2, -3, …). */
const MAX_ADDRESS_ATTEMPTS = 20

/** A hand-made venue and its empty menu; the address name is the person's. */
async function createByHand(tenantId: string, data: CreateVenueData): Promise<CreateVenueResult> {
  const { name, slug, languages } = data
  if (name === undefined || slug === undefined || languages === undefined) {
    return { ok: false, error: 'invalid' }
  }
  const pool = getPool()
  const venue = await provisionVenue(pool, tenantId, {
    name,
    slug,
    timezone: NEW_VENUE_TIMEZONE,
    currency: NEW_VENUE_CURRENCY,
    defaultLocale: languages.main,
    enabledLocales: languages.enabled,
  })
  try {
    await provisionMenu(pool, tenantId, venue.id)
  } catch (error) {
    // The venue exists and a retry would make a second one. The composer offers "Create the
    // menu" on a venue without one, so send the person there.
    logError('venue_menu_create_failed', error)
  }
  return { ok: true, venueId: venue.id }
}

/**
 * A venue made from a venue of a connected POS instance (D85): its name, its address name made
 * from that name (the next free one when it is taken: nothing is typed), its main language the
 * instance's; the languages the POS offers join it after the next read. The venue, its menu and
 * the link are one transaction, so a POS venue that got linked meanwhile (`link_taken`) leaves
 * nothing behind.
 */
async function createFromTillVenue(
  tenantId: string,
  source: { readonly integrationId: string; readonly bid: number },
): Promise<CreateVenueResult> {
  const pool = getPool()
  const till = await loadTillVenueToAdd(pool, tenantId, source.integrationId, source.bid)
  if (till === null) return { ok: false, error: 'invalid' }
  if (till.linked) return { ok: false, error: 'link_taken' }
  const name = Array.from(till.name.trim()).slice(0, MAX_VENUE_NAME_LENGTH).join('').trim()
  const base = suggestSlug(name) || 'venue'
  for (let attempt = 1; attempt <= MAX_ADDRESS_ATTEMPTS; attempt += 1) {
    try {
      const added = await addVenueFromTillVenue(pool, tenantId, source.integrationId, source.bid, {
        name,
        slug: attempt === 1 ? base : `${base}-${attempt}`,
        timezone: NEW_VENUE_TIMEZONE,
        currency: NEW_VENUE_CURRENCY,
        defaultLocale: till.defaultLocale,
        enabledLocales: [till.defaultLocale],
      })
      if (!added.ok) {
        return { ok: false, error: added.error === 'link_taken' ? 'link_taken' : 'invalid' }
      }
      return { ok: true, venueId: added.venue.id }
    } catch (error) {
      // The transaction was rolled back: try the next name.
      if (error instanceof ProvisionError && error.code === 'slug_taken') continue
      throw error
    }
  }
  return { ok: false, error: 'taken' }
}

/**
 * Creates a venue and its (empty) menu for the signed-in person's organisation, from a connected
 * POS instance's venue or by hand (D85), and answers with the venue's id; the dialog then opens
 * it. Only owners and admins. A venue made from a POS takes no name, address name or languages:
 * sending them is refused.
 */
export async function createVenueAction(input: unknown): Promise<CreateVenueResult> {
  const parsed = CreateVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const { source } = parsed.data
    const created =
      source.kind === 'instance'
        ? await createFromTillVenue(organization.id, source)
        : await createByHand(organization.id, parsed.data)
    if (created.ok) revalidatePath('/venues')
    return created
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'invalid_input') return { ok: false, error: 'invalid' }
      if (error.code === 'slug_taken') return { ok: false, error: 'taken' }
    }
    logError('venue_create_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/**
 * What the New venue dialog lists when it opens (D85): the organisation's active POS instances
 * with their venues, and the organisation's address name for the preview. Only owners and
 * admins, who are the ones who can create a venue.
 */
export async function loadNewVenueSourcesAction(): Promise<NewVenueSourcesResult> {
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    return { ok: true, sources: await listNewVenueSources(getPool(), organization.id) }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('venue_sources_failed', error)
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
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
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
      if (error.code === 'slug_taken') return { ok: false, error: 'taken' }
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
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
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
    const { organization, sessionId } = await requireTenant()
    if (!canDeleteVenue(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
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
 * Brings a deleted venue back. Owners only. It comes back unpublished (D86), with the till venue
 * it served linked again when that is still free (adjustments V1; `till_taken` names the venue
 * that holds it now, and nothing changes); its public code and table codes are the ones it had,
 * and the publish brings them back to guests, so no file job is queued here.
 */
export async function restoreVenueAction(input: unknown): Promise<RestoreVenueResult> {
  const parsed = RestoreVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId } = parsed.data
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canDeleteVenue(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const venue = await getVenueInAnyState(organization.id, venueId)
    if (venue === null) return { ok: false, error: 'invalid' }
    const restored = await restoreVenue(getPool(), organization.id, venueId)

    revalidatePath('/', 'layout')
    return { ok: true, name: venue.name, relinked: restored.relinked }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
      if (error.code === 'till_taken') {
        return { ok: false, error: 'till_taken', holder: error.details.holder ?? '' }
      }
    }
    logError('venue_restore_failed', error)
    return { ok: false, error: 'failed' }
  }
}

const UnpublishVenueInput = z.strictObject({ venueId: idSchema('vn') })

/**
 * Takes a venue off guests' phones (D86: back to Draft). Owners and admins only. Nothing is
 * deleted: the next publish of any of its menus brings it back. The worker withdraws its guest
 * files: the venue index and its place in the organisation's index (`publish-files`, for its
 * live menu) and the table files (`publish-table-tokens`).
 */
export async function unpublishVenueAction(input: unknown): Promise<UnpublishVenueResult> {
  const parsed = UnpublishVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId } = parsed.data
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const pool = getPool()
    const venue = await getVenueInAnyState(organization.id, venueId)
    if (venue === null) return { ok: false, error: 'invalid' }
    if (venue.archivedAt !== null) return { ok: false, error: 'venue_archived' }
    const unpublished = await unpublishVenue(pool, organization.id, venueId)

    let filesQueued = true
    try {
      const tenantId = organization.id as TenantId
      const menuId = await menuOfVenue(pool, organization.id, venueId)
      if (menuId !== null) {
        await enqueueJob(JOB_NAMES.publishFiles, { tenantId, menuId, venueId: venueId as VenueId })
      } else {
        await enqueueJob(JOB_NAMES.publishOrganizationIndex, { tenantId })
      }
      // The table files go too (D86): the job withdraws the codes the writer reported.
      await enqueueJob(JOB_NAMES.publishTableTokens, {
        tenantId,
        venueId: venueId as VenueId,
        retired: [...unpublished.tableTokens],
      })
    } catch (error) {
      logError('venue_unpublish_files_not_queued', error)
      filesQueued = false
    }

    revalidatePath('/', 'layout')
    return { ok: true, name: venue.name, filesQueued }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError) {
      if (error.code === 'venue_archived') return { ok: false, error: 'venue_archived' }
      if (error.code === 'invalid_input' || error.code === 'venue_missing') {
        return { ok: false, error: 'invalid' }
      }
    }
    logError('venue_unpublish_failed', error)
    return { ok: false, error: 'failed' }
  }
}

const PurgeVenueInput = z.strictObject({
  venueId: idSchema('vn'),
  confirmName: z.string().max(MAX_VENUE_NAME_LENGTH + 10),
})

/**
 * "Delete permanently" (D83): queues the purge of a venue that is in the bin, for an owner who
 * typed its name. The web app erases nothing itself (the app role cannot delete venue data);
 * the worker's purge job does, through its own role, and tombstones the public code and the
 * table tokens. Without this, the daily purge erases the venue 30 days after its deletion.
 */
export async function purgeVenueAction(input: unknown): Promise<PurgeVenueResult> {
  const parsed = PurgeVenueInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, confirmName } = parsed.data
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canDeleteVenue(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const venue = await getVenueInAnyState(organization.id, venueId)
    if (venue === null) return { ok: false, error: 'invalid' }
    if (venue.archivedAt === null) return { ok: false, error: 'not_deleted' }
    if (confirmName.trim() !== venue.name) return { ok: false, error: 'name_mismatch' }
    let queued = true
    try {
      await enqueueJob(JOB_NAMES.purgeVenue, {
        tenantId: organization.id as TenantId,
        venueId: venueId as VenueId,
      })
    } catch (error) {
      logError('venue_purge_not_queued', error)
      queued = false
    }
    revalidatePath('/', 'layout')
    return { ok: true, name: venue.name, queued }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('venue_purge_failed', error)
    return { ok: false, error: 'failed' }
  }
}
