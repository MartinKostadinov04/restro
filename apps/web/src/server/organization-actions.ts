'use server'

// The organisation's name and address name (Settings › General, D84, D91): the one action behind
// both fields. The organisation IS Better Auth's `auth_organization` row (its name, and its slug
// = the first part of every guest address `/m/<organisation>/<venue>`, unique platform-wide), and
// renaming it over HTTP is switched off (`DISABLED_HTTP_PATHS` in auth.ts), so this calls the
// plugin's server API directly, like `switchOrganization` does for the active organisation.
// Zod first, then `requireTenant()` (the tenant is the person's organisation, never the
// request's), then the role (owners only), then:
//   1. the address name is checked free before anything is changed (`organizationSlugIsFree`:
//      not another organisation's current or earlier name);
//   2. Better Auth saves name and slug together (it checks the role and the slug once more);
//   3. core remembers the old address name, so `o/<old>.json` redirects, and keeps the tenant
//      row's copy of the name in step (`renameTenant`). If either fails, Better Auth is put back
//      as it was: no half-renamed organisation, no printed link left without its redirect;
//   4. a new address name is carried to the guest files by the worker: the organisation's index
//      and the redirect (`publish-organization-index`), every venue's table files
//      (`publish-table-tokens`) and the index of every live menu (`publish-files`). Failing to
//      queue is not a failed save: the answer says `filesQueued: false`.
import {
  isOrganizationSlug,
  JOB_NAMES,
  type NodeId,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  MAX_ORGANIZATION_NAME_LENGTH,
  type OrganizationAddress,
  organizationAddress,
  organizationSlugIsFree,
  ProvisionError,
  recordOrganizationSlug,
  renameTenant,
} from '@restro/core/apply'
import { isAPIError } from 'better-auth/api'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { getAuth } from './auth'
import { getPool } from './db'
import { enqueueJob } from './jobs'
import { logError } from './log'
import type { UpdateOrganizationResult } from './organization-actions-result'
import { canManageOrganization } from './roles'
import { requireTenant } from './session'
import { onSharedDevice } from './staff/shared-device'
import { listVenues } from './venues'

const UpdateOrganizationInput = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_ORGANIZATION_NAME_LENGTH).optional(),
    slug: z.string().refine(isOrganizationSlug).optional(),
  })
  .refine((input) => input.name !== undefined || input.slug !== undefined)

/** Better Auth's answer when the slug belongs to another organisation (a race with the check). */
const SLUG_TAKEN_CODE = 'ORGANIZATION_SLUG_ALREADY_TAKEN'

/** True when Better Auth refused the change because another organisation holds the slug. */
function isSlugTaken(error: unknown): boolean {
  return isAPIError(error) && error.body?.code === SLUG_TAKEN_CODE
}

/** Better Auth's update of the organisation, as the signed-in person. */
async function saveOrganization(
  organizationId: string,
  data: { readonly name?: string; readonly slug?: string },
): Promise<void> {
  await getAuth().api.updateOrganization({
    body: { organizationId, data: { ...data } },
    headers: await headers(),
  })
}

/**
 * Brings every guest file that carries the organisation's address name up to date. Every job is
 * tried even when one fails; false when any could not be queued.
 */
async function queueAddressFiles(tenantId: string): Promise<boolean> {
  let allQueued = true
  const tenant = tenantId as TenantId
  const attempt = async (what: string, queue: () => Promise<unknown>) => {
    try {
      await queue()
    } catch (error) {
      logError(`organization_${what}_not_queued`, error)
      allQueued = false
    }
  }
  await attempt('index', () => enqueueJob(JOB_NAMES.publishOrganizationIndex, { tenantId: tenant }))
  let live: Awaited<ReturnType<typeof listVenues>> = []
  try {
    live = await listVenues(tenantId)
  } catch (error) {
    // The change is saved: not reading the venues is a late file, not a failed save.
    logError('organization_venues_not_read', error)
    allQueued = false
  }
  for (const venue of live) {
    const venueId = venue.id as VenueId
    // The table files carry the organisation's name; the venue's index and menu files do too.
    await attempt('table_files', () =>
      enqueueJob(JOB_NAMES.publishTableTokens, { tenantId: tenant, venueId, retired: [] }),
    )
    if (venue.liveMenuId !== null) {
      const menuId = venue.liveMenuId as NodeId
      await attempt('venue_files', () =>
        enqueueJob(JOB_NAMES.publishFiles, { tenantId: tenant, menuId, venueId }),
      )
    }
  }
  return allQueued
}

/**
 * Changes the organisation's name and/or its address name. Owners only. Either field may be sent
 * alone; sending the values it has now saves nothing. The old address name keeps working: guests
 * who open it are sent to the new one once the worker has written the redirect.
 */
export async function updateOrganizationAction(input: {
  name?: string
  slug?: string
}): Promise<UpdateOrganizationResult> {
  const parsed = UpdateOrganizationInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { name, slug } = parsed.data
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageOrganization(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const pool = getPool()
    const tenantId = organization.id
    const before: OrganizationAddress | null = await organizationAddress(pool, tenantId)
    if (before === null) return { ok: false, error: 'invalid' }

    const slugChanged = slug !== undefined && slug !== before.slug
    if (slugChanged && !(await organizationSlugIsFree(pool, tenantId, slug))) {
      return { ok: false, error: 'taken' }
    }
    const nameChanged = name !== undefined && name !== before.name
    if (nameChanged || slugChanged) {
      try {
        await saveOrganization(tenantId, {
          ...(nameChanged ? { name } : {}),
          ...(slugChanged ? { slug } : {}),
        })
      } catch (error) {
        if (isSlugTaken(error)) return { ok: false, error: 'taken' }
        throw error
      }
    }

    try {
      if (slugChanged) {
        const recorded = await recordOrganizationSlug(pool, {
          organizationId: tenantId,
          previousSlug: before.slug,
        })
        if (!recorded.ok)
          throw new Error(`the old address name was not recorded: ${recorded.reason}`)
      }
      // The tenant row's copy follows the name (also repairs one that fell behind).
      if (name !== undefined) await renameTenant(pool, tenantId, name)
    } catch (error) {
      // Better Auth already saved: put it back, so no address changes without its redirect.
      if (nameChanged || slugChanged) {
        await saveOrganization(tenantId, { name: before.name, slug: before.slug }).catch(
          (revertError: unknown) => logError('organization_update_not_reverted', revertError),
        )
      }
      throw error
    }

    const filesQueued = slugChanged ? await queueAddressFiles(tenantId) : true
    revalidatePath('/', 'layout')
    return {
      ok: true,
      name: name ?? before.name,
      slug: slug ?? before.slug,
      filesQueued,
    }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    if (error instanceof ProvisionError && error.code === 'invalid_input') {
      return { ok: false, error: 'invalid' }
    }
    logError('organization_update_failed', error)
    return { ok: false, error: 'failed' }
  }
}
