'use server'

// The composer's writes. Each is a server action: it checks who is asking (requireTenant), that
// the venue is theirs, builds a manual change set (source `manual`, actor = the user, a fresh
// `jb_` job) from ./ops.ts and hands it to core's apply(): rule 1, no SQL here. Then it
// revalidates the venue page, so the client gets the fresh view in the same round trip. Every
// input is parsed with Zod first; ids are checked, never trusted.
import {
  type ChangeSet,
  type ChangeSetOp,
  idSchema,
  LocaleSchema,
  type LocalizedText,
  type NodeId,
  newId,
  SortKeySchema,
} from '@restro/core'
import { ApplyError, apply, provisionMenu } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { getNodeBasics, getVenueMenuId } from '@/server/menus'
import { requireTenant } from '@/server/session'
import { getVenue } from '@/server/venues'

import type { ActionResult } from './action-result'
import {
  createSectionOps,
  moveSectionOps,
  placeItemOps,
  setItemHiddenOps,
  setSectionHiddenOps,
} from './ops'

const nodeId = idSchema('nd')
const venueIdSchema = idSchema('vn')
const Keys = z.array(z.strictObject({ id: nodeId, key: SortKeySchema })).max(2000)

const PlaceItemInput = z.strictObject({
  venueId: venueIdSchema,
  itemId: nodeId,
  fromSectionId: nodeId.nullable(),
  toSectionId: nodeId.nullable(),
  keys: Keys,
})
const MoveSectionInput = z.strictObject({
  venueId: venueIdSchema,
  sectionId: nodeId,
  parentId: nodeId.nullable(),
  keys: Keys,
})
const CreateSectionInput = z.strictObject({
  venueId: venueIdSchema,
  id: nodeId,
  parentId: nodeId.nullable(),
  title: z.partialRecord(LocaleSchema, z.string().trim().min(1).max(120)),
  sortKey: SortKeySchema,
})
const SetItemHiddenInput = z.strictObject({
  venueId: venueIdSchema,
  itemId: nodeId,
  hidden: z.boolean(),
})
const SetSectionHiddenInput = z.strictObject({
  venueId: venueIdSchema,
  sectionId: nodeId,
  hidden: z.boolean(),
})
const VenueOnlyInput = z.strictObject({ venueId: venueIdSchema })

/** What a build step gets: who and where. */
interface Context {
  readonly tenantId: string
  readonly userId: string
  readonly venueId: string
  readonly menuId: NodeId
  readonly defaultLocale: string
  readonly enabledLocales: readonly string[]
}

const INVALID: ActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: ActionResult = { ok: false, error: 'not_found' }

/**
 * Runs one composer intent: finds the venue's menu, builds the ops, applies them as one atomic
 * manual change set, and refreshes the page. `build` returns null for a request that makes no
 * sense (the intent is refused as invalid).
 */
async function perform(
  venueId: string,
  build: (context: Context) => Promise<ChangeSetOp[] | null> | ChangeSetOp[] | null,
): Promise<ActionResult> {
  try {
    const { organization, user } = await requireTenant()
    const venue = await getVenue(organization.id, venueId)
    if (!venue) return NOT_FOUND
    const menuId = await getVenueMenuId(organization.id, venue.id)
    if (!menuId) return NOT_FOUND
    const ops = await build({
      tenantId: organization.id,
      userId: user.id,
      venueId: venue.id,
      menuId: menuId as NodeId,
      defaultLocale: venue.defaultLocale,
      enabledLocales: venue.enabledLocales,
    })
    if (!ops || ops.length === 0) return INVALID

    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: `user:${user.id}`,
      observedAt: new Date().toISOString(),
      ops,
    }
    try {
      await apply(getPool(), organization.id, changeSet, { atomic: true })
    } catch (error) {
      if (error instanceof ApplyError) {
        if (error.code === 'change_set_rejected') {
          const codes = error.rejected.map((rejection) => rejection.code).join(',')
          logError('composer_change_rejected', new Error(`rejected: ${codes}`))
          return { ok: false, error: 'rejected' }
        }
        return INVALID
      }
      throw error
    }
    revalidatePath(`/venues/${venue.id}`)
    return { ok: true }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('composer_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

/** Puts an item in a section (or reorders it there), and takes it out of the section it left. */
export async function placeItemAction(input: unknown): Promise<ActionResult> {
  const parsed = PlaceItemInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, ...move } = parsed.data
  return perform(venueId, () => placeItemOps(move))
}

/** Moves a section under another (or to the top level) and/or to a new place among its siblings. */
export async function moveSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = MoveSectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, ...move } = parsed.data
  return perform(venueId, ({ menuId }) => moveSectionOps({ ...move, menuId }))
}

/** Creates a curated section (no barsy counterpart), titled in the venue's languages. */
export async function createSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = CreateSectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, ...section } = parsed.data
  return perform(venueId, (context) => {
    const title = section.title as LocalizedText
    // A section needs a title in the venue's default language (check V3), and only in languages
    // the venue has enabled.
    const keys = Object.keys(title)
    if (!title[context.defaultLocale as keyof LocalizedText]) return null
    if (keys.some((locale) => !context.enabledLocales.includes(locale))) return null
    return createSectionOps({ ...section, menuId: context.menuId, title })
  })
}

/**
 * Hides or shows an item. Showing clears the builder's own hide only: an item that barsy hides
 * stays hidden whatever is sent here (rule 5), so a forged request cannot un-hide it.
 */
export async function setItemHiddenAction(input: unknown): Promise<ActionResult> {
  const parsed = SetItemHiddenInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, itemId, hidden } = parsed.data
  return perform(venueId, async ({ tenantId }) => {
    const node = await getNodeBasics(tenantId, itemId)
    if (node?.type !== 'item' || node.status === 'archived') return null
    return setItemHiddenOps({ itemId, hidden, status: node.status })
  })
}

/** Hides or shows a section (its status). */
export async function setSectionHiddenAction(input: unknown): Promise<ActionResult> {
  const parsed = SetSectionHiddenInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, sectionId, hidden } = parsed.data
  return perform(venueId, async ({ tenantId }) => {
    const node = await getNodeBasics(tenantId, sectionId)
    if (node?.type !== 'section' || node.status === 'archived') return null
    return setSectionHiddenOps({ sectionId, hidden })
  })
}

/** Creates the venue's (empty) menu if it has none yet. */
export async function createMenuAction(input: unknown): Promise<ActionResult> {
  const parsed = VenueOnlyInput.safeParse(input)
  if (!parsed.success) return INVALID
  try {
    const { organization } = await requireTenant()
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return NOT_FOUND
    await provisionMenu(getPool(), organization.id, venue.id)
    revalidatePath(`/venues/${venue.id}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('composer_create_menu_failed', error)
    return { ok: false, error: 'failed' }
  }
}
