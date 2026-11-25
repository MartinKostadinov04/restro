'use server'

// The venue's menus in Settings › General (brief S4; D88, D90, D91; adjustments M1): thin server
// actions over core's menu writers, in the shape of the venue actions (venues-actions.ts): Zod
// first, then `requireTenant()` (the tenant is the person's organisation, never the request's),
// then the role (owners and admins, `canManageIntegration`), then the writer. A writer's refusal
// comes back as its own code (`till_venue`: a POS venue's menus are the till's, D88: no add,
// delete, restore or import there; `menu_live`: the live menu is not binned).
//
// "Set live" moves the live pointer and then queues a publish of that menu (D90: switching the
// live menu publishes it), with the person as the actor, the way the Publish bar does.
import { idSchema, isId, MAX_MENU_NAME_LENGTH } from '@restro/core'
import {
  createMenu,
  deleteMenu,
  importMenu,
  listMenus,
  type MenuSummary,
  type MenuWriteError,
  moveMenu,
  renameMenu,
  restoreMenu,
  setLiveMenu,
} from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from './db'
import { enqueueJob } from './jobs'
import { logError } from './log'
import { publishNow } from './publish/service'
import { canManageIntegration, canPublishMenu } from './roles'
import { requireTenant } from './session'
import { onSharedDevice } from './staff/shared-device'
import { listVenues, venueHasTill } from './venues'

/** What every menu action answers. */
export type MenuActionResult =
  | { readonly ok: true; readonly menu: MenuSummary }
  | { readonly ok: false; readonly error: MenuWriteError | 'not_allowed' | 'invalid' | 'failed' }

/** What "Set live" answers: also whether the publish of the menu was queued. */
export type SetLiveMenuActionResult =
  | { readonly ok: true; readonly menu: MenuSummary; readonly queued: boolean }
  | Extract<MenuActionResult, { ok: false }>

const venueId = idSchema('vn')
const menuId = idSchema('nd')
/** A header name: blank means the venue's name (core trims and checks it again). */
const menuName = z.string().max(MAX_MENU_NAME_LENGTH * 4)

type Failure = Extract<MenuActionResult, { ok: false }>
type Success = Extract<MenuActionResult, { ok: true }>

/** Runs one writer for the signed-in person's organisation, if their role may manage menus. */
async function run<T extends { readonly ok: true }>(
  label: string,
  revalidate: string,
  write: (
    tenantId: string,
    actor: `user:${string}`,
    role: string,
  ) => Promise<T | { readonly ok: false; readonly error: MenuWriteError }>,
): Promise<T | Failure> {
  try {
    const { organization, user, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const result = await write(organization.id, `user:${user.id}`, organization.role)
    if (!result.ok) return { ok: false, error: result.error }
    revalidatePath(`/venues/${revalidate}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(label, error)
    return { ok: false, error: 'failed' }
  }
}

/** The summary core answers, without the writer's extra fields. */
const summary = <R extends { readonly ok: true; readonly menu: MenuSummary }>(result: R) => ({
  ok: true as const,
  menu: result.menu,
})

const CreateInput = z.strictObject({ venueId, name: menuName.optional() })

/** Adds a menu to a hand-made venue (D88); the venue's first menu becomes its live one. */
export async function createMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = CreateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, name } = parsed.data
  return run<Success>('menu_create_failed', venue, async (tenantId) => {
    const result = await createMenu(getPool(), tenantId, { venueId: venue, name: name ?? null })
    return result.ok ? summary(result) : result
  })
}

const RenameInput = z.strictObject({ venueId, menuId, name: menuName })

/** Sets a menu's header name (blank = the venue's name). */
export async function renameMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = RenameInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, menuId: menu, name } = parsed.data
  return run<Success>('menu_rename_failed', venue, async (tenantId) => {
    const result = await renameMenu(getPool(), tenantId, { venueId: venue, menuId: menu, name })
    return result.ok ? summary(result) : result
  })
}

const MoveInput = z.strictObject({
  venueId,
  menuId,
  position: z.union([z.literal('end'), z.strictObject({ before: menuId })]),
})

/** Moves a menu in the venue's order: to the end, or just before another menu. */
export async function moveMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = MoveInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, menuId: menu, position } = parsed.data
  return run<Success>('menu_move_failed', venue, async (tenantId) => {
    const result = await moveMenu(getPool(), tenantId, { venueId: venue, menuId: menu, position })
    return result.ok ? summary(result) : result
  })
}

const MenuInput = z.strictObject({ venueId, menuId })

/** Moves a hand-made venue's menu to the bin (D91); the live menu is refused (`menu_live`). */
export async function deleteMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = MenuInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, menuId: menu } = parsed.data
  return run<Success>('menu_delete_failed', venue, async (tenantId) => {
    const result = await deleteMenu(getPool(), tenantId, { venueId: venue, menuId: menu })
    return result.ok ? summary(result) : result
  })
}

/** Brings a binned menu back (hand-made venues). */
export async function restoreMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = MenuInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, menuId: menu } = parsed.data
  return run<Success>('menu_restore_failed', venue, async (tenantId) => {
    const result = await restoreMenu(getPool(), tenantId, { venueId: venue, menuId: menu })
    return result.ok ? summary(result) : result
  })
}

/**
 * Makes a menu the venue's live one and publishes it (D88, D90): the pointer moves first
 * (`setLiveMenu`), then a manual publish of the menu is queued, as "Publish" would. When the queue
 * is down the menu is live all the same (`queued: false`): the Publish bar then offers to publish
 * it. A menu that already is live publishes nothing.
 */
export async function setLiveMenuAction(input: unknown): Promise<SetLiveMenuActionResult> {
  const parsed = MenuInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId: venue, menuId: menu } = parsed.data
  return run<Extract<SetLiveMenuActionResult, { ok: true }>>(
    'menu_set_live_failed',
    venue,
    async (tenantId, actor, role) => {
      const pool = getPool()
      const result = await setLiveMenu(pool, tenantId, { venueId: venue, menuId: menu })
      if (!result.ok) return result
      if (!result.changed) return { ok: true as const, menu: result.menu, queued: false }
      const published = await publishNow(
        {
          pool,
          tenantId,
          venueId: venue as Parameters<typeof publishNow>[0]['venueId'],
          actor,
          canPublish: canPublishMenu(role),
        },
        { enqueue: enqueueJob },
        menu,
      )
      if (!published.ok) logError('menu_set_live_not_published', new Error(published.error))
      return { ok: true as const, menu: result.menu, queued: published.ok }
    },
  )
}

const ImportInput = z.strictObject({
  fromVenueId: venueId,
  fromMenuId: menuId,
  toVenueId: venueId,
  name: menuName.optional(),
})

/** Copies a hand-made venue's menu into another hand-made venue, once (D88, "Import menu"). */
export async function importMenuAction(input: unknown): Promise<MenuActionResult> {
  const parsed = ImportInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { fromVenueId, fromMenuId, toVenueId, name } = parsed.data
  return run<Success>('menu_import_failed', toVenueId, async (tenantId, actor) => {
    const result = await importMenu(getPool(), tenantId, {
      fromVenueId,
      fromMenuId,
      toVenueId,
      ...(name === undefined ? {} : { name }),
      actor,
    })
    return result.ok ? summary(result) : result
  })
}

/** A venue a menu can be imported from, with its menus in use. */
export interface ImportSource {
  readonly venueId: string
  readonly name: string
  readonly menus: readonly { readonly id: string; readonly name: string }[]
}

export type ImportSourcesResult =
  | { readonly ok: true; readonly venues: readonly ImportSource[] }
  | { readonly ok: false; readonly error: 'not_allowed' | 'invalid' | 'failed' }

/**
 * What "Import from another venue" offers (D88): the organisation's other hand-made venues that
 * have a menu, each with its menus in use (a menu without a header name shows the venue's name).
 * Venues fed by a till are left out: their menus cannot be copied.
 */
export async function listImportSourcesAction(toVenueId: unknown): Promise<ImportSourcesResult> {
  if (typeof toVenueId !== 'string' || !isId('vn', toVenueId)) {
    return { ok: false, error: 'invalid' }
  }
  try {
    const { organization, sessionId } = await requireTenant()
    if (!canManageIntegration(organization.role)) return { ok: false, error: 'not_allowed' }
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const pool = getPool()
    const sources: ImportSource[] = []
    for (const venue of await listVenues(organization.id)) {
      if (venue.id === toVenueId) continue
      if (await venueHasTill(organization.id, venue.id)) continue
      const menus = await listMenus(pool, organization.id, venue.id)
      if (menus.length === 0) continue
      sources.push({
        venueId: venue.id,
        name: venue.name,
        menus: menus.map((menu) => ({ id: menu.id, name: menu.name ?? venue.name })),
      })
    }
    return { ok: true, venues: sources }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('menu_import_sources_failed', error)
    return { ok: false, error: 'failed' }
  }
}
