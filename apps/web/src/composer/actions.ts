'use server'

// The composer's writes. Each is a server action: it checks who is asking (requireTenant), that
// the venue is theirs and that the menu it names is one of the venue's menus in use (the composer
// works on the menu in its URL, D88, brief S6), builds a manual change set (source `manual`,
// actor = the user, a fresh `jb_` job) from ./ops.ts or `@/server/composer/structure` and hands
// it to core's apply(): rule 1, no SQL here. Then it revalidates the venue page, so the client
// gets the fresh view in the same round trip. Every input is parsed with Zod first; ids are
// checked, never trusted.
//
// What each kind of venue may do (D66, D89, D90, D92): a hand-made venue creates, renames and
// deletes sections and items; a venue with a till moves and reorders, hides, creates and deletes
// its own sections, renames over the till's text, and never creates or deletes an item or deletes
// a section of the till (`till_venue`, `till_section`).
import {
  type ChangeSet,
  type ChangeSetOp,
  CurrencySchema,
  idSchema,
  isTillSource,
  LocaleSchema,
  type LocalizedText,
  mergeDocumentParts,
  type NodeId,
  newId,
  SECTION_LAYOUTS,
  SortKeySchema,
} from '@restro/core'
import { ApplyError, apply, loadMenuDocument, loadUnplacedItems } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { parseMoneyInput } from '@/fields/money-input'
import { menuInUse } from '@/server/composer/menu'
import { deleteSectionPlan, renamePlan } from '@/server/composer/structure'
import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { getNodeBasics, isNodeInMenu } from '@/server/menus'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { getVenue, venueHasTill } from '@/server/venues'

import type { ActionResult } from './action-result'
import {
  createItemOps,
  createSectionOps,
  moveSectionOps,
  placeItemOps,
  setItemHiddenOps,
  setSectionHiddenOps,
} from './ops'

const nodeId = idSchema('nd')
const venueIdSchema = idSchema('vn')
const Keys = z.array(z.strictObject({ id: nodeId, key: SortKeySchema })).max(2000)
/** Text per language, as a person types it: a title or a name. */
const Text = z.partialRecord(LocaleSchema, z.string().trim().min(1).max(120))

/** Every composer write names the venue and the menu it works on. */
const Scope = { venueId: venueIdSchema, menuId: nodeId }

const PlaceItemInput = z.strictObject({
  ...Scope,
  itemId: nodeId,
  fromSectionId: nodeId.nullable(),
  toSectionId: nodeId.nullable(),
  keys: Keys,
})
const MoveSectionInput = z.strictObject({
  ...Scope,
  sectionId: nodeId,
  parentId: nodeId.nullable(),
  keys: Keys,
})
const CreateSectionInput = z.strictObject({
  ...Scope,
  id: nodeId,
  parentId: nodeId.nullable(),
  title: Text,
  sortKey: SortKeySchema,
})
const CreateItemInput = z.strictObject({
  ...Scope,
  id: nodeId,
  sectionId: nodeId.nullable(),
  name: Text,
  // The price as the person typed it ("4.50" or "4,50"); core's money module converts it.
  price: z.string().max(12).optional(),
  sortKey: SortKeySchema,
})
const SetItemHiddenInput = z.strictObject({ ...Scope, itemId: nodeId, hidden: z.boolean() })
const SetSectionHiddenInput = z.strictObject({ ...Scope, sectionId: nodeId, hidden: z.boolean() })
const RenameSectionInput = z.strictObject({ ...Scope, sectionId: nodeId, title: Text })
const SectionInput = z.strictObject({ ...Scope, sectionId: nodeId })
const SetSectionLayoutInput = z.strictObject({
  ...Scope,
  sectionId: nodeId,
  layout: z.enum(SECTION_LAYOUTS),
})
const ItemInput = z.strictObject({ ...Scope, itemId: nodeId })
const RenameItemInput = z.strictObject({ ...Scope, itemId: nodeId, name: Text })

/** What a build step gets: who and where. */
interface Context {
  readonly tenantId: string
  readonly userId: string
  readonly venueId: string
  readonly menuId: NodeId
  readonly defaultLocale: string
  readonly enabledLocales: readonly string[]
  /** The venue's currency (`EUR`): prices typed in this venue are in it. */
  readonly currency: string
}

const INVALID: ActionResult = { ok: false, error: 'invalid' }
const NOT_FOUND: ActionResult = { ok: false, error: 'not_found' }
const NOT_ALLOWED: ActionResult = { ok: false, error: 'not_allowed' }
const TILL_VENUE: ActionResult = { ok: false, error: 'till_venue' }
const TILL_SECTION: ActionResult = { ok: false, error: 'till_section' }
/** Nothing to change: the request is fine and the menu already says so. */
const UNCHANGED: ActionResult = { ok: true }

/**
 * Runs one composer intent: checks the venue and its menu, builds the ops, applies them as one
 * atomic manual change set, and refreshes the page. `build` returns null for a request that makes
 * no sense (the intent is refused as invalid), or an answer of its own (an `ActionResult`: a
 * refusal, or `UNCHANGED`). With `ownersOnly`, a person who is not an owner or admin of the
 * organisation is refused with `not_allowed` before anything is read.
 */
async function perform(
  scope: { readonly venueId: string; readonly menuId: string },
  build: (
    context: Context,
  ) => Promise<ChangeSetOp[] | ActionResult | null> | ChangeSetOp[] | ActionResult | null,
  options: { readonly ownersOnly?: boolean } = {},
): Promise<ActionResult> {
  try {
    const { organization, user } = await requireTenant()
    if (options.ownersOnly && !canManageIntegration(organization.role)) return NOT_ALLOWED
    const venue = await getVenue(organization.id, scope.venueId)
    if (!venue) return NOT_FOUND
    // The menu the composer shows: one of this venue's menus in use (never a binned one, another
    // venue's or another organisation's).
    const menuId = await menuInUse(organization.id, venue.id, scope.menuId)
    if (!menuId) return NOT_FOUND
    const built = await build({
      tenantId: organization.id,
      userId: user.id,
      venueId: venue.id,
      menuId,
      defaultLocale: venue.defaultLocale,
      enabledLocales: venue.enabledLocales,
      currency: venue.currency,
    })
    if (built === null) return INVALID
    if (!Array.isArray(built)) return built
    const ops = built
    if (ops.length === 0) return INVALID

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

/** True when every section given (nulls skipped) is a section of this menu. */
async function inMenu(context: Context, ...ids: readonly (NodeId | null)[]): Promise<boolean> {
  for (const id of ids) {
    if (id !== null && !(await isNodeInMenu(context.tenantId, context.menuId, id))) return false
  }
  return true
}

/** A live (not deleted) section of this menu, or false. */
async function liveSection(context: Context, sectionId: NodeId): Promise<boolean> {
  const node = await getNodeBasics(context.tenantId, sectionId)
  if (node?.type !== 'section' || node.status === 'archived') return false
  return inMenu(context, sectionId)
}

/** The menu's document with its Unsorted items: everything the composer shows of it. */
async function composerDocument(context: Context) {
  const pool = getPool()
  const [doc, unplaced] = await Promise.all([
    loadMenuDocument(pool, context.tenantId, context.menuId),
    loadUnplacedItems(pool, context.tenantId, context.menuId),
  ])
  return mergeDocumentParts(doc, unplaced)
}

/** Puts an item in a section (or reorders it there), and takes it out of the section it left. */
export async function placeItemAction(input: unknown): Promise<ActionResult> {
  const parsed = PlaceItemInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, ...move } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    if (!(await inMenu(context, move.fromSectionId, move.toSectionId))) return null
    return placeItemOps(move)
  })
}

/** Moves a section under another (or to the top level) and/or to a new place among its siblings. */
export async function moveSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = MoveSectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, ...move } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    if (!(await inMenu(context, move.sectionId, move.parentId))) return null
    return moveSectionOps({ ...move, menuId: context.menuId })
  })
}

/** Creates a curated section (no till counterpart), titled in the venue's languages. */
export async function createSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = CreateSectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, ...section } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    const title = section.title as LocalizedText
    // A section needs a title in the venue's default language (check V3), and only in languages
    // the venue has enabled.
    const keys = Object.keys(title)
    if (!title[context.defaultLocale as keyof LocalizedText]) return null
    if (keys.some((locale) => !context.enabledLocales.includes(locale))) return null
    if (!(await inMenu(context, section.parentId))) return null
    return createSectionOps({ ...section, menuId: context.menuId, title })
  })
}

/**
 * Creates an item by hand (owner or admin): its name per language, an optional price and its
 * place at the end of a section (or none: it starts in Unsorted). It has no till link, so it is
 * display-only and stays off the ordering path (rule 5). The price arrives as the text the
 * person typed and is converted by core's money module (rule 8), never as a float.
 */
export async function createItemAction(input: unknown): Promise<ActionResult> {
  const parsed = CreateItemInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, ...item } = parsed.data
  return perform(
    { venueId, menuId },
    async (context) => {
      // A venue with a till gets its items from the till only (D66): hand-made items cannot reach
      // the POS. One check, here; a later setting for display-only items on a till venue flips it.
      if (await venueHasTill(context.tenantId, context.venueId)) return TILL_VENUE
      // The id is the client's: a new item, never an existing node (apply() would treat a repeated
      // createNode as done and go on to overwrite that node's name and price).
      if (await getNodeBasics(context.tenantId, item.id)) return null
      const name = item.name as LocalizedText
      // An item needs a name in the venue's default language (check V3), and only in languages
      // the venue has enabled.
      if (!name[context.defaultLocale as keyof LocalizedText]) return null
      if (Object.keys(name).some((locale) => !context.enabledLocales.includes(locale))) return null

      const currency = CurrencySchema.safeParse(context.currency)
      if (!currency.success) return null
      const price =
        item.price === undefined ? undefined : parseMoneyInput(item.price, currency.data)
      if (price === 'invalid') return null

      // The section must be a live section of THIS menu: an id from another menu (or another
      // venue's) is refused, never trusted.
      if (item.sectionId !== null && !(await liveSection(context, item.sectionId))) return null
      return createItemOps({
        id: item.id,
        sectionId: item.sectionId,
        name,
        price: price ?? null,
        sortKey: item.sortKey,
      })
    },
    { ownersOnly: true },
  )
}

/**
 * Hides or shows an item. Showing clears the builder's own hide only: an item that the till hides
 * stays hidden whatever is sent here (rule 5), so a forged request cannot un-hide it.
 */
export async function setItemHiddenAction(input: unknown): Promise<ActionResult> {
  const parsed = SetItemHiddenInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, itemId, hidden } = parsed.data
  return perform({ venueId, menuId }, async ({ tenantId }) => {
    const node = await getNodeBasics(tenantId, itemId)
    if (node?.type !== 'item' || node.status === 'archived') return null
    return setItemHiddenOps({ itemId, hidden, status: node.status })
  })
}

/** Hides or shows a section (its status). */
export async function setSectionHiddenAction(input: unknown): Promise<ActionResult> {
  const parsed = SetSectionHiddenInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, sectionId, hidden } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    if (!(await liveSection(context, sectionId))) return null
    return setSectionHiddenOps({ sectionId, hidden })
  })
}

/**
 * Lays a section out as a vertical list or a horizontal row (D92: the guest page draws a
 * horizontal section as its strip). Ours on every venue, for its own sections and the till's.
 */
export async function setSectionLayoutAction(input: unknown): Promise<ActionResult> {
  const parsed = SetSectionLayoutInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, sectionId, layout } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    if (!(await liveSection(context, sectionId))) return null
    return [
      {
        op: 'setField',
        node: { id: sectionId },
        fieldKey: 'layout',
        layer: 'manual',
        scope: 'master',
        value: layout,
      },
    ]
  })
}

/**
 * Renames a section in the languages given. A section of the venue's own gets our title; a
 * section that mirrors the till's category gets our name over the till's (the dictionary of a POS
 * venue, D90, D91), which a later sync never overwrites.
 */
export async function renameSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = RenameSectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, sectionId, title } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    if (!(await liveSection(context, sectionId))) return null
    const plan = renamePlan({
      doc: await loadMenuDocument(getPool(), context.tenantId, context.menuId),
      nodeId: sectionId,
      nodeType: 'section',
      venueId: context.venueId,
      text: title as LocalizedText,
      defaultLocale: context.defaultLocale,
      languages: context.enabledLocales,
    })
    if (!plan.ok) return null
    return plan.ops.length === 0 ? UNCHANGED : plan.ops
  })
}

/**
 * Deletes a section (owner or admin): it and the sections under it leave the menu, and their
 * items go to Unsorted unless they are placed elsewhere; the history keeps the record (rule 2).
 * A section that mirrors a category of the till is only ever hidden (`till_section`, D92).
 */
export async function deleteSectionAction(input: unknown): Promise<ActionResult> {
  const parsed = SectionInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, sectionId } = parsed.data
  return perform(
    { venueId, menuId },
    async (context) => {
      if (!(await liveSection(context, sectionId))) return null
      const plan = deleteSectionPlan(
        await loadMenuDocument(getPool(), context.tenantId, context.menuId),
        sectionId,
      )
      if (!plan.ok) return plan.error === 'till_section' ? TILL_SECTION : null
      return plan.ops
    },
    { ownersOnly: true },
  )
}

/**
 * An item of a venue without a till that this menu shows (placed in it, or in its Unsorted), or a
 * refusal: a venue with a till keeps its items as the till has them (`till_venue`, D66, D89).
 */
async function handMadeItem(context: Context, itemId: NodeId) {
  if (await venueHasTill(context.tenantId, context.venueId)) return TILL_VENUE
  const node = await getNodeBasics(context.tenantId, itemId)
  if (node?.type !== 'item' || node.status === 'archived') return null
  const doc = await composerDocument(context)
  if (!doc.nodes.some((candidate) => candidate.id === itemId)) return null
  if (doc.links.some((link) => link.nodeId === itemId && isTillSource(link.source))) return null
  return doc
}

/**
 * Renames an item made by hand, in the languages given (a venue without a till, D89). An item
 * of the till is named in its sheet, over the till's text.
 */
export async function renameItemAction(input: unknown): Promise<ActionResult> {
  const parsed = RenameItemInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, itemId, name } = parsed.data
  return perform({ venueId, menuId }, async (context) => {
    const doc = await handMadeItem(context, itemId)
    if (doc === null || !('nodes' in doc)) return doc
    const plan = renamePlan({
      doc,
      nodeId: itemId,
      nodeType: 'item',
      venueId: context.venueId,
      text: name as LocalizedText,
      defaultLocale: context.defaultLocale,
      languages: context.enabledLocales,
    })
    if (!plan.ok) return null
    return plan.ops.length === 0 ? UNCHANGED : plan.ops
  })
}

/**
 * Deletes an item made by hand (owner or admin, a venue without a till, D89): it leaves every
 * menu and the admin (status `archived`); the history keeps the record (rule 2).
 */
export async function deleteItemAction(input: unknown): Promise<ActionResult> {
  const parsed = ItemInput.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId, menuId, itemId } = parsed.data
  return perform(
    { venueId, menuId },
    async (context) => {
      const doc = await handMadeItem(context, itemId)
      if (doc === null || !('nodes' in doc)) return doc
      return [{ op: 'setNodeStatus', node: { id: itemId }, status: 'archived' }]
    },
    { ownersOnly: true },
  )
}
