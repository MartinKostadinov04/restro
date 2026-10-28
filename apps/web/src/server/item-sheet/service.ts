// The item sheet's reads and saves (brief S2-06b), as plain functions of a database pool, so tests
// can run them against Postgres without a request. `actions.ts` wraps them as server actions with
// the signed-in person's tenant, id and the asset store.
//
// Reads (U4): the menu document through core's read side, resolved with the venue's languages;
// the sheet's data is the resolver's answer plus the stored layers it needs to route a save.
// Writes (rule 1): every save is one change set (source `manual`, the person as actor) handed to
// `apply()`; nothing here touches a table. A refused write comes back as an error and changes
// nothing; a save that would change nothing never reaches `apply()`.

import { ADMIN_URL_TTL_SECONDS, type AssetStore } from '@restro/assets'
import {
  type ChangeSet,
  combineField,
  FIELD_TYPES,
  type FieldDefinition,
  isLocale,
  isTillSource,
  type Layer,
  LOCALES,
  type Locale,
  type LocalizedText,
  liveEditions,
  newId,
  type ResolvedField,
  type ResolvedItem,
  readsLayer,
  resolve,
  saleStateOf,
  serviceDate,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import { apply, ItemNotFoundError, loadItemDocument } from '@restro/core/apply'
import { payFirstPossibleAt } from '@restro/core/service'
import { assets, type DbPool, events, venues, withTenant } from '@restro/db'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'

import { readNameFallbackNodeIds } from '@/connectors/sync-reads'
import { tillTextShown } from '@/fields/name-fallback'
import { liveMenuOf, menuInUse } from '@/server/composer/menu'
import { logError } from '../log'
import { loadTillLabels, tillLabelOf } from '../till-label'

import { type LayerView, layerMap, layerView } from './layers'
import {
  fieldAccess,
  type Plan,
  type PlanContext,
  type PlannedWrite,
  planFieldSave,
  planKeepOverride,
  planRevert,
  planTranslation,
} from './plan'
import type {
  HistoryEntry,
  HistoryPage,
  ItemSheetData,
  SheetErrorCode,
  SheetField,
  SheetImage,
  SheetProvenance,
  SheetResult,
  TranslationCell,
  TranslationRow,
} from './types'

/** Which item of which venue, for which tenant. */
export interface SheetScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: string
  readonly itemId: string
  /**
   * The menu the composer has open (brief S6: a venue has several, D88); absent = the venue's live
   * menu. A menu that is not one of the venue's menus in use finds no item.
   */
  readonly menuId?: string
  /** The person may mark the item sold out tonight (owner or admin, D46); default: no. */
  readonly canMarkSoldOut?: boolean
}

/** What the sheet needs besides the database. */
export interface SheetServices {
  readonly store: AssetStore
  /** Names of people by user id, for the history; absent = names stay unknown. */
  readonly userNames?: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
}

const ITEM_FIELDS = VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []
const HISTORY_PAGE_SIZE = 20

function isBlank(text: string | undefined | null): boolean {
  return text === undefined || text === null || text.trim() === ''
}

function textOf(value: unknown): LocalizedText {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LocalizedText)
    : {}
}

/** Everything one read of the item gathers; the sheet's data and every save start from it. */
interface ItemState {
  readonly venue: typeof venues.$inferSelect
  readonly venueScope: `venue:${string}`
  readonly locales: readonly Locale[]
  readonly doc: Awaited<ReturnType<typeof loadItemDocument>>
  readonly item: ResolvedItem
  /** The item has a till link (source `till:<integration>`), in any state. */
  readonly linked: boolean
  readonly linkState: ItemSheetData['linkState']
  /** The name of the item's till; '' for a hand-made item. */
  readonly tillLabel: string
  /** The name shown is the till's own, standing in for a missing public one (D75). */
  readonly nameFromTill: boolean
  readonly revision: number
}

/** The venue's languages, its default first. */
function venueLocales(venue: typeof venues.$inferSelect): Locale[] {
  const enabled = venue.enabledLocales.filter(isLocale)
  const first = isLocale(venue.defaultLocale) ? venue.defaultLocale : (enabled[0] ?? 'bg_BG')
  return [first, ...enabled.filter((locale) => locale !== first)]
}

async function readState(scope: SheetScope): Promise<ItemState | null> {
  const { pool, tenantId, venueId, itemId } = scope
  // A deleted venue (D76) has no item sheet: it reads as no venue.
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select()
      .from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.archivedAt))),
  )
  if (!venue) return null
  const menuId =
    scope.menuId === undefined
      ? await liveMenuOf(tenantId, venueId, pool)
      : await menuInUse(tenantId, venueId, scope.menuId, pool)
  if (!menuId) return null
  let doc: ItemState['doc']
  try {
    doc = await loadItemDocument(pool, tenantId, menuId, itemId)
  } catch (error) {
    if (error instanceof ItemNotFoundError) return null
    throw error
  }
  const venueScope = `venue:${venue.id}` as const
  const locales = venueLocales(venue)
  const now = new Date()
  const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
    venueScope,
    // Tonight's sold-out marks count, and no earlier evening's (D46): the editions of the live menu.
    edition: liveEditions(venue.id, serviceDate(now, venue.timezone, venue.serviceDayEndsAt)),
    locales,
    now: now.toISOString(),
  })
  const item = resolved.items[itemId as keyof typeof resolved.items]
  if (!item) return null
  // Linked to the till = a till link (`till:<integration>`), whichever connector feeds it (A4-F4).
  const tillLinks = doc.links.filter((link) => link.nodeId === itemId && isTillSource(link.source))
  const broken = tillLinks.find((link) => link.state !== 'active')
  const tillLabel =
    tillLinks.length === 0
      ? ''
      : tillLabelOf(doc.links, await loadTillLabels(pool, tenantId), itemId)
  // The till's own name stands in for a missing public one (D75), and nothing typed here replaces it.
  const nameFromTill =
    tillLinks.length > 0 &&
    tillTextShown(item.fields.name) &&
    (await withTenant(pool, tenantId, (tx) => readNameFallbackNodeIds(tx, [itemId]))).length > 0
  return {
    venue,
    venueScope,
    locales,
    doc,
    item,
    linked: tillLinks.length > 0,
    linkState: tillLinks.length === 0 ? 'none' : (broken?.state ?? 'active'),
    tillLabel,
    nameFromTill,
    revision: doc.nodes.find((node) => node.id === itemId)?.revision ?? 1,
  }
}

function contextFor(state: ItemState, itemId: string, definition: FieldDefinition): PlanContext {
  return {
    definition,
    linkedToTill: state.linked,
    layers: layerView(state.doc, itemId, definition.key, state.venueScope),
  }
}

/** The resolver's answer for a field; an internal field, which it leaves out, is combined here. */
function resolvedFieldOf(
  state: ItemState,
  definition: FieldDefinition,
  view: LayerView,
): ResolvedField {
  const known = state.item.fields[definition.key]
  if (known) return known
  const layers = new Map(
    [...layerMap(view)].filter(([layer]) => readsLayer(definition, state.linked, layer as Layer)),
  )
  return combineField({
    definition,
    layers,
    linkedToTill: state.linked,
    locales: state.locales,
  }).field
}

function provenanceOf(value: string): SheetProvenance {
  return value as SheetProvenance
}

function buildField(state: ItemState, itemId: string, definition: FieldDefinition): SheetField {
  const context = contextFor(state, itemId, definition)
  const resolved = resolvedFieldOf(state, definition, context.layers)
  const override = context.layers.override
  const till = context.layers.till
  const localeProvenance = resolved.locales
    ? (Object.fromEntries(
        Object.entries(resolved.locales).map(([locale, info]) => [
          locale,
          provenanceOf(info.provenance),
        ]),
      ) as SheetField['localeProvenance'])
    : undefined
  const access = fieldAccess(context, resolved)
  const stale =
    resolved.provenance === 'stale' ||
    Object.values(localeProvenance ?? {}).some((provenance) => provenance === 'stale')
  return {
    key: definition.key,
    definition,
    value: resolved.value,
    provenance: provenanceOf(resolved.provenance),
    layer: resolved.layer,
    conflict: resolved.conflict === true,
    ...(localeProvenance ? { localeProvenance } : {}),
    access,
    canRevert: access.kind === 'edit' && override !== undefined,
    canKeep: access.kind === 'edit' && override !== undefined && till !== undefined && stale,
    tillValue: till?.value ?? null,
  }
}

function buildTranslations(
  state: ItemState,
  itemId: string,
  fields: readonly SheetField[],
): TranslationRow[] {
  const reviews = new Set(
    state.item.issues
      .filter((issue) => issue.code === 'translation_review' && issue.locale !== undefined)
      .map((issue) => `${issue.fieldKey}:${issue.locale}`),
  )
  return fields
    .filter((field) => field.definition.type === 'localized_text')
    .map((field) => {
      const { definition } = field
      const layers = layerView(state.doc, itemId, definition.key, state.venueScope)
      const tillText = textOf(layers.till?.value)
      const manualText = textOf(layers.manual?.value)
      const current = textOf(field.value)
      const cells: Partial<Record<Locale, TranslationCell>> = {}
      for (const locale of state.locales) {
        const text = isBlank(current[locale]) ? null : (current[locale] ?? null)
        cells[locale] = {
          text,
          provenance: field.localeProvenance?.[locale] ?? 'none',
          ourText: isBlank(manualText[locale]) ? null : (manualText[locale] ?? null),
          // The till's own text of a till-owned field is read-only; a builder-owned field is ours.
          editable: definition.owner === 'builder' || isBlank(tillText[locale]),
          missing: text === null,
          review: reviews.has(`${definition.key}:${locale}`),
        }
      }
      return { fieldKey: definition.key, definition, cells }
    })
}

async function buildImage(
  state: ItemState,
  itemId: string,
  fields: readonly SheetField[],
  scope: SheetScope,
  services: SheetServices,
): Promise<SheetImage | null> {
  const field = fields.find((candidate) => candidate.definition.type === 'image')
  const value = field?.value as
    | { asset_id: string; alt: LocalizedText; focal: { x: number; y: number } | null }
    | null
    | undefined
  if (!field || !value) return null
  const [row] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx.select().from(assets).where(eq(assets.id, value.asset_id)),
  )
  let url: string | null = null
  if (row?.storageKey && row.status === 'stored') {
    try {
      url = await services.store.getUrl(row.storageKey, ADMIN_URL_TTL_SECONDS)
    } catch (error) {
      logError('asset_url_failed', error)
    }
  }
  const view = layerView(state.doc, itemId, field.key, state.venueScope)
  return {
    assetId: value.asset_id,
    url,
    width: row?.width ?? null,
    height: row?.height ?? null,
    contentType: row?.contentType ?? null,
    alt: value.alt,
    focal: value.focal,
    provenance: field.provenance,
    canRemove: view.manual !== undefined,
  }
}

function titleOf(fields: readonly SheetField[], locales: readonly Locale[]): string {
  const name = textOf(fields.find((field) => field.key === 'name')?.value)
  for (const locale of [...locales, ...LOCALES]) {
    if (!isBlank(name[locale])) return name[locale] ?? ''
  }
  return ''
}

/** The data of the item sheet, or null when the venue or the item is not this tenant's. */
export async function loadItemSheet(
  scope: SheetScope,
  services: SheetServices,
): Promise<ItemSheetData | null> {
  const state = await readState(scope)
  if (!state) return null
  // An item's payment mode shows only where pay-first can take effect (D122 §8, #113).
  const payFirst = await withTenant(scope.pool, scope.tenantId, (tx) =>
    payFirstPossibleAt(tx, scope.venueId),
  )
  const fields = ITEM_FIELDS.filter(
    (definition) => payFirst || definition.key !== 'payment_mode',
  ).map((definition) => buildField(state, scope.itemId, definition))
  return {
    itemId: scope.itemId,
    venueId: scope.venueId,
    title: titleOf(fields, state.locales),
    linkedToTill: state.linked,
    tillLabel: state.tillLabel,
    linkState: state.linkState,
    revision: state.revision,
    defaultLocale: state.locales[0] ?? 'bg_BG',
    enabledLocales: state.locales,
    currency: state.venue.currency,
    timezone: state.venue.timezone,
    visible: state.item.visible,
    sale: { ...saleStateOf(state.item.fields.for_sale), canMark: scope.canMarkSoldOut === true },
    nameFromTill: state.nameFromTill,
    fields,
    issues: state.item.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      ...(issue.fieldKey !== undefined ? { fieldKey: issue.fieldKey } : {}),
      ...(issue.locale !== undefined ? { locale: issue.locale } : {}),
    })),
    translations: buildTranslations(state, scope.itemId, fields),
    image: await buildImage(state, scope.itemId, fields, scope, services),
  }
}

// --- saves -------------------------------------------------------------------------------------

/** Who is saving. */
export interface SheetActor {
  /** The signed-in person's user id (recorded as `user:<id>`). */
  readonly userId: string
}

const failed = (error: SheetErrorCode, detail?: string): SheetResult => ({
  ok: false,
  error,
  ...(detail !== undefined ? { detail } : {}),
})

function refusalToError(plan: Extract<Plan, { ok: false }>): SheetErrorCode {
  switch (plan.refusal) {
    case 'locked':
      return 'locked'
    case 'read_only':
      return 'read_only'
    case 'nothing_to_revert':
      return 'nothing_to_revert'
    case 'no_basis':
      return 'no_basis'
  }
}

/** The change-set ops for planned writes to one field of the item. */
function opsFor(itemId: string, fieldKey: string, writes: readonly PlannedWrite[]) {
  return writes.map((write) => {
    const node = { id: itemId as `nd_${string}` }
    if (write.kind === 'clear') {
      return {
        op: 'clearField' as const,
        node,
        fieldKey,
        layer: write.layer,
        scope: 'master' as const,
      }
    }
    return {
      op: 'setField' as const,
      node,
      fieldKey,
      layer: write.layer,
      scope: 'master' as const,
      value: write.value as never,
      ...(write.layer === 'override' ? { basis: write.basis as never } : {}),
    }
  })
}

/** Checks every value a plan would write against the field's type before `apply()` sees it. */
function plannedValuesAreValid(definition: FieldDefinition, writes: readonly PlannedWrite[]) {
  const spec = FIELD_TYPES[definition.type]
  return writes.every(
    (write) =>
      write.kind === 'clear' ||
      (spec.validate(write.value, definition).ok &&
        (write.layer !== 'override' || spec.validate(write.basis, definition).ok)),
  )
}

/** Plans, checks and applies one field's writes, then returns the refreshed sheet. */
async function commit(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  definition: FieldDefinition,
  plan: Plan,
): Promise<SheetResult> {
  if (!plan.ok) return failed(refusalToError(plan))
  if (!plannedValuesAreValid(definition, plan.writes)) return failed('invalid_value')
  if (plan.writes.length > 0) {
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: `user:${actor.userId}`,
      observedAt: new Date().toISOString(),
      ops: opsFor(scope.itemId, definition.key, plan.writes),
    }
    try {
      const result = await apply(scope.pool, scope.tenantId, changeSet)
      const refused = result.rejected[0]
      if (refused) return failed('refused', refused.code)
    } catch (error) {
      logError('item_sheet_save_failed', error)
      return failed('failed')
    }
  }
  const data = await loadItemSheet(scope, services)
  return data ? { ok: true, data } : failed('not_found')
}

async function definitionAndContext(scope: SheetScope, fieldKey: string) {
  const state = await readState(scope)
  const definition = ITEM_FIELDS.find((candidate) => candidate.key === fieldKey)
  if (!state || !definition) return null
  return { state, definition, context: contextFor(state, scope.itemId, definition) }
}

/** Saves the whole value of a field from the field editor (`null` = the person cleared it). */
export async function saveField(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  input: { readonly fieldKey: string; readonly value: unknown | null },
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, input.fieldKey)
  if (!found) return failed('not_found')
  // An image has a file behind it: it is attached on the Media tab, with the upload.
  if (found.definition.type === 'image') return failed('read_only')
  const edited = input.value === null ? undefined : input.value
  if (
    edited !== undefined &&
    !FIELD_TYPES[found.definition.type].validate(edited, found.definition).ok
  ) {
    return failed('invalid_value')
  }
  return commit(scope, services, actor, found.definition, planFieldSave(found.context, edited))
}

/** Removes our override of a field: revert, or take the till's value instead of ours. */
export async function revertField(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  input: { readonly fieldKey: string },
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, input.fieldKey)
  if (!found) return failed('not_found')
  return commit(scope, services, actor, found.definition, planRevert(found.context))
}

/** Keeps our override although the till changed since: its current value becomes the basis. */
export async function keepOverride(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  input: { readonly fieldKey: string },
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, input.fieldKey)
  if (!found) return failed('not_found')
  return commit(scope, services, actor, found.definition, planKeepOverride(found.context))
}

/** Saves one language of a localized field from the Translations grid (the manual layer, D24). */
export async function saveTranslation(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  input: { readonly fieldKey: string; readonly locale: string; readonly text: string | null },
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, input.fieldKey)
  if (!found) return failed('not_found')
  if (!isLocale(input.locale) || !found.state.locales.includes(input.locale)) {
    return failed('invalid_value')
  }
  return commit(
    scope,
    services,
    actor,
    found.definition,
    planTranslation(found.context, input.locale, input.text ?? undefined),
  )
}

/** Attaches an uploaded asset to the item as its picture (or updates its alt text and focal point). */
export async function setImage(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
  input: {
    readonly assetId: string
    readonly alt: LocalizedText
    readonly focal: { readonly x: number; readonly y: number } | null
  },
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, 'image')
  if (!found) return failed('not_found')
  const [asset] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx.select({ status: assets.status }).from(assets).where(eq(assets.id, input.assetId)),
  )
  if (asset?.status !== 'stored') return failed('asset_not_found')
  const alt: LocalizedText = {}
  for (const locale of LOCALES) {
    const text = input.alt[locale]?.trim()
    if (text) alt[locale] = text
  }
  const value = {
    asset_id: input.assetId,
    alt,
    focal: input.focal === null ? null : { x: input.focal.x, y: input.focal.y },
  }
  if (!FIELD_TYPES.image.validate(value, found.definition).ok) return failed('invalid_value')
  return commit(scope, services, actor, found.definition, planFieldSave(found.context, value))
}

/** Takes our own picture off the item (the till's photo, if there is one, shows again). */
export async function removeImage(
  scope: SheetScope,
  services: SheetServices,
  actor: SheetActor,
): Promise<SheetResult> {
  const found = await definitionAndContext(scope, 'image')
  if (!found) return failed('not_found')
  return commit(scope, services, actor, found.definition, planFieldSave(found.context, undefined))
}

// --- history -----------------------------------------------------------------------------------

function actorOf(actor: string): { kind: 'user' | 'integration' | 'system'; id: string | null } {
  if (actor.startsWith('user:')) return { kind: 'user', id: actor.slice(5) }
  if (actor.startsWith('integration:')) return { kind: 'integration', id: actor.slice(12) }
  return { kind: 'system', id: null }
}

/**
 * The item's own events, newest first, `HISTORY_PAGE_SIZE` at a time: pass the last `seq` seen as
 * `before` for the next page. Reads the append-only `events` table (rule 2).
 */
export async function loadHistory(
  scope: SheetScope,
  services: SheetServices,
  before?: number,
): Promise<HistoryPage> {
  const rows = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select()
      .from(events)
      .where(
        before === undefined
          ? eq(events.nodeId, scope.itemId)
          : and(eq(events.nodeId, scope.itemId), lt(events.seq, before)),
      )
      .orderBy(desc(events.seq))
      .limit(HISTORY_PAGE_SIZE + 1),
  )
  const page = rows.slice(0, HISTORY_PAGE_SIZE)
  const userIds = [
    ...new Set(
      page
        .map((row) => actorOf(row.actor))
        .flatMap((a) => (a.kind === 'user' && a.id ? [a.id] : [])),
    ),
  ]
  const names =
    userIds.length > 0 && services.userNames
      ? await services.userNames(userIds)
      : new Map<string, string>()
  const entries: HistoryEntry[] = page.map((row) => {
    const who = actorOf(row.actor)
    return {
      seq: row.seq,
      at: row.at.toISOString(),
      fieldKey: row.fieldKey,
      definition: ITEM_FIELDS.find((definition) => definition.key === row.fieldKey) ?? null,
      layer: row.layer,
      scope: row.scope,
      oldValue: row.oldValue ?? null,
      newValue: row.newValue ?? null,
      kind:
        row.op !== 'setField' && row.op !== 'clearField'
          ? 'structure'
          : row.oldValue == null
            ? 'set'
            : row.newValue == null
              ? 'cleared'
              : 'changed',
      op: row.op,
      actor: { kind: who.kind, name: who.id ? (names.get(who.id) ?? null) : null },
      source: row.source,
    }
  })
  const last = page.at(-1)
  return { entries, nextBefore: rows.length > HISTORY_PAGE_SIZE && last ? last.seq : null }
}
