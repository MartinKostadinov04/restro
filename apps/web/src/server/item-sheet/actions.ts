'use server'

// The item sheet's server actions (brief S2-06b): thin wrappers that check the person is signed
// in, take the tenant from their organisation (never from the request), check every argument
// with Zod, and call the service. Every write is a change set through `apply()` (U4); after one,
// the venue page is revalidated so the composer behind the sheet shows the new values.
import { FIELD_KEY_PATTERN, isId, LOCALES, LocalizedTextSchema, type VenueId } from '@restro/core'
import { itemsOfVenue } from '@restro/core/apply'
import { authMember, authUser } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getAssetStore } from '../assets'
import { getAuthDb, getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { canMarkSoldOut } from '../roles'
import { requireTenant } from '../session'
import { setItemsSoldOut } from '../sold-out/service'
import { onSharedDevice } from '../staff/shared-device'
import { venueHasTill } from '../venues'
import {
  keepOverride,
  loadHistory,
  loadItemSheet,
  removeImage,
  revertField,
  type SheetActor,
  type SheetScope,
  type SheetServices,
  saveField,
  saveTranslation,
  setImage,
} from './service'
import type { HistoryPage, ItemSheetData, SheetErrorCode, SheetResult, SheetTarget } from './types'

const Ids = z.object({
  venueId: z.string().refine((id) => isId('vn', id), 'expected a venue id'),
  itemId: z.string().refine((id) => isId('nd', id), 'expected an item id'),
  // The menu the composer has open (brief S6); absent = the venue's live menu.
  menuId: z
    .string()
    .refine((id) => isId('nd', id), 'expected a menu id')
    .optional(),
})

/** The ids of a request: the target (a venue id, or the venue and its open menu) and the item. */
function idsOf(target: SheetTarget, itemId: string) {
  const where = typeof target === 'string' ? { venueId: target } : target
  return Ids.safeParse(typeof where === 'object' && where !== null ? { ...where, itemId } : null)
}
const FieldKey = z.string().regex(FIELD_KEY_PATTERN)
// A language of the 11 barsy keys; whether the venue enabled it is checked by the service.
const LocaleKey = z.enum(LOCALES)
const Focal = z
  .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .nullable()

const BAD_REQUEST: SheetResult = { ok: false, error: 'failed', detail: 'bad_request' }

interface Session {
  readonly scope: SheetScope
  readonly services: SheetServices
  readonly actor: SheetActor
}

/** Names of the organisation's people by user id, for the history. */
async function userNames(
  tenantId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const rows = await getAuthDb()
    .select({ id: authUser.id, name: authUser.name })
    .from(authUser)
    .innerJoin(authMember, eq(authMember.userId, authUser.id))
    .where(and(eq(authMember.organizationId, tenantId), inArray(authUser.id, [...userIds])))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * The sheet's session, or why there is none: a shared tablet never edits the menu (D122 §7, RR-83),
 * and an item of another venue is not this venue's sheet (RR-72; the tenant's rows are all the
 * database hides).
 */
async function session(ids: z.infer<typeof Ids>): Promise<Session | 'not_allowed' | 'not_found'> {
  const { user, organization, sessionId } = await requireTenant()
  if (await onSharedDevice({ tenantId: organization.id, sessionId })) return 'not_allowed'
  const ours = await itemsOfVenue(getPool(), organization.id, ids.venueId, [ids.itemId])
  if (!ours.has(ids.itemId)) return 'not_found'
  return {
    scope: {
      pool: getPool(),
      tenantId: organization.id,
      ...ids,
      // On a POS venue the POS says what ran out: no sold-out switch (D124 §6, #80).
      canMarkSoldOut:
        canMarkSoldOut(organization.role) && !(await venueHasTill(organization.id, ids.venueId)),
    },
    services: {
      store: await getAssetStore(),
      userNames: (userIds) => userNames(organization.id, userIds),
    },
    actor: { userId: user.id },
  }
}

/** Runs a save and revalidates the venue page when it changed something. */
async function save(
  ids: z.infer<typeof Ids>,
  run: (session: Session) => Promise<SheetResult>,
): Promise<SheetResult> {
  try {
    const opened = await session(ids)
    if (typeof opened === 'string') return { ok: false, error: opened }
    const result = await run(opened)
    if (result.ok) revalidatePath(`/venues/${ids.venueId}`)
    return result
  } catch (error) {
    // A redirect (not signed in) must reach Next.js; anything else is logged without its values.
    if (error instanceof Error && 'digest' in error) throw error
    logError('item_sheet_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/**
 * The data of the item sheet; null when the item is not in this venue of the person's tenant, or
 * the menu named is not one of the venue's menus in use.
 */
export async function loadItemSheetAction(
  target: SheetTarget,
  itemId: string,
): Promise<ItemSheetData | null> {
  const ids = idsOf(target, itemId)
  if (!ids.success) return null
  const opened = await session(ids.data)
  if (typeof opened === 'string') return null
  return loadItemSheet(opened.scope, opened.services)
}

/** The next page of the item's history, newest first (`before` = the last `seq` already shown). */
export async function loadItemHistoryAction(
  target: SheetTarget,
  itemId: string,
  before?: number,
): Promise<HistoryPage> {
  const ids = idsOf(target, itemId)
  const cursor = z.int().positive().optional().safeParse(before)
  if (!ids.success || !cursor.success) return { entries: [], nextBefore: null }
  const opened = await session(ids.data)
  if (typeof opened === 'string') return { entries: [], nextBefore: null }
  return loadHistory(opened.scope, opened.services, cursor.data)
}

/** Saves the whole value of a field from the field editor (`null` = cleared). */
export async function saveItemFieldAction(
  target: SheetTarget,
  itemId: string,
  fieldKey: string,
  value: unknown,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const key = FieldKey.safeParse(fieldKey)
  if (!ids.success || !key.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) =>
    saveField(scope, services, actor, { fieldKey: key.data, value: value ?? null }),
  )
}

/** Removes our override of a field: revert, or take the till's value instead of ours. */
export async function revertItemFieldAction(
  target: SheetTarget,
  itemId: string,
  fieldKey: string,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const key = FieldKey.safeParse(fieldKey)
  if (!ids.success || !key.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) =>
    revertField(scope, services, actor, { fieldKey: key.data }),
  )
}

/** Keeps our override although the till changed since. */
export async function keepItemOverrideAction(
  target: SheetTarget,
  itemId: string,
  fieldKey: string,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const key = FieldKey.safeParse(fieldKey)
  if (!ids.success || !key.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) =>
    keepOverride(scope, services, actor, { fieldKey: key.data }),
  )
}

/** Saves one language of a localized field from the Translations grid. */
export async function saveItemTranslationAction(
  target: SheetTarget,
  itemId: string,
  fieldKey: string,
  locale: string,
  text: string | null,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const key = FieldKey.safeParse(fieldKey)
  const language = LocaleKey.safeParse(locale)
  const value = z.string().max(5000).nullable().safeParse(text)
  if (!ids.success || !key.success || !language.success || !value.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) =>
    saveTranslation(scope, services, actor, {
      fieldKey: key.data,
      locale: language.data,
      text: value.data,
    }),
  )
}

/** Attaches an uploaded asset as the item's picture, or updates its alt text and focal point. */
export async function setItemImageAction(
  target: SheetTarget,
  itemId: string,
  assetId: string,
  alt: unknown,
  focal: unknown,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const asset = z
    .string()
    .refine((id) => isId('as', id))
    .safeParse(assetId)
  const altText = LocalizedTextSchema.safeParse(alt ?? {})
  const point = Focal.safeParse(focal ?? null)
  if (!ids.success || !asset.success || !altText.success || !point.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) =>
    setImage(scope, services, actor, { assetId: asset.data, alt: altText.data, focal: point.data }),
  )
}

/**
 * Marks the item sold out tonight (`soldOut`), or takes OUR mark off (owner or admin, D46). There
 * is no way to put an item back on sale that the till has off sale: "back on sale" removes the mark
 * and nothing else (rule 5). The sheet comes back refreshed.
 */
export async function setItemSoldOutAction(
  target: SheetTarget,
  itemId: string,
  soldOut: boolean,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  const flag = z.boolean().safeParse(soldOut)
  if (!ids.success || !flag.success) return BAD_REQUEST
  return save(ids.data, async ({ scope, services, actor }) => {
    const outcome = await setItemsSoldOut(
      {
        pool: scope.pool,
        tenantId: scope.tenantId,
        venueId: scope.venueId as VenueId,
        actor: `user:${actor.userId}`,
        canMark: scope.canMarkSoldOut === true,
      },
      { enqueue: enqueueJob },
      { itemIds: [scope.itemId], soldOut: flag.data },
    )
    if (!outcome.ok) {
      const error: SheetErrorCode =
        outcome.error === 'not_allowed' || outcome.error === 'not_found'
          ? outcome.error
          : outcome.error === 'rejected'
            ? 'refused'
            : 'failed'
      return { ok: false, error }
    }
    const data = await loadItemSheet(scope, services)
    return data ? { ok: true, data } : { ok: false, error: 'not_found' }
  })
}

/** Takes our own picture off the item. */
export async function removeItemImageAction(
  target: SheetTarget,
  itemId: string,
): Promise<SheetResult> {
  const ids = idsOf(target, itemId)
  if (!ids.success) return BAD_REQUEST
  return save(ids.data, ({ scope, services, actor }) => removeImage(scope, services, actor))
}
