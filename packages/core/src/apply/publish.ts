// The publisher (brief S3-01a; doc "Publishing and the snapshot contract", checks V10 and V11).
// Rule 1: only core/apply writes snapshots, the publish pointer and first-published dates. Each
// writer runs in one transaction, serialised per menu + venue by an advisory lock, and reads the
// document inside that transaction, so two publishes of one menu can never interleave or reuse
// a version. No files here: S3-01b writes `snap/<id>.json` and `current.json` from these rows.
//
// publishMenu: load → resolve with the venue edition → build → leak guard → V10 → same hash as
// the current snapshot = no-op → V11 (automatic publishes only: hiding more than 30% of the
// visible items holds the snapshot for a person) → insert, move the pointer, record the
// first-published date of every newly published item.
//
// Sold out tonight (D46, S3-08): a snapshot is resolved WITHOUT the service edition, so the
// manager's marks of one evening are never baked into a file that outlives it. Only `live.json`
// (the overlay: `loadLiveOverlay` / `loadDraft`) is resolved with today's service edition, and it
// is rebuilt as the day changes. Barsy's own off-sale flag is a base layer and stays in the
// snapshot.

import {
  assets,
  type DbPool,
  itemFirstPublished,
  menus,
  publishPointers,
  type ReadTx,
  type SnapshotHeldReason,
  type SnapshotRow,
  snapshots,
  sourceLinks,
  venues,
  withTenant,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { parseAssetVariants } from '../asset-variants'
import type { DesignValues } from '../design/contract'
import { designThemeOf, readDesign } from '../design/record'
import { FIELD_VALUE_SCHEMAS } from '../field-types/catalog'
import { type AssetId, idSchema, type NodeId, newId, type SnapshotId, type VenueId } from '../ids'
import { venueLanguages } from '../languages'
import { isLocale, type Locale, type LocalizedText, LocalizedTextSchema } from '../locales'
import { CURRENCIES, type Currency } from '../money'
import { compareVisibility, V11_MAX_HIDDEN_SHARE } from '../resolve/compare-visibility'
import { resolve } from '../resolve/resolve'
import type { IssueCode, ResolvedMenu } from '../resolve/types'
import { isoInTimeZone, liveEditions, serviceDate, snapshotEditions } from '../service-day'
import {
  type AssetVariantWidths,
  buildSnapshot,
  DEFAULT_THEME,
  type SnapshotAssetInput,
} from '../snapshot/build'
import { parseSnapshot, SnapshotError, type SnapshotProblem } from '../snapshot/errors'
import {
  assertSnapshotSafe,
  collectForbiddenValues,
  lookPublicStrings,
} from '../snapshot/leak-guard'
import { buildLiveOverlay } from '../snapshot/overlay'
import type { LiveOverlay, MenuSnapshot, SnapshotTheme } from '../snapshot/schema'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import {
  fontFamilyOf,
  type GuestFeatures,
  paletteList,
  readGuestFeatures,
  themePaletteOf,
  themeRolesOf,
  type VenueTheme,
} from '../theme'
import { readMenuDocument } from './load-document'
import { loadTagVocabulary } from './tags'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why a publish happens: a person pressed Publish, or a sync published on its own. */
export const PUBLISH_REASONS = ['manual', 'auto_sync'] as const
/** Why a publish happens. */
export type PublishReason = (typeof PUBLISH_REASONS)[number]

/** A snapshot row's status. */
export type SnapshotStatus = 'published' | 'held' | 'rejected'
/** Why a snapshot row exists. */
export type SnapshotReason = PublishReason | 'rollback'

/** Who acts: `system`, `user:<id>` or `integration:<id>` (the database checks the same). */
const ActorSchema = z
  .string()
  .regex(
    /^(?:system|(?:user|integration):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$/,
    'expected system, user:<id> or integration:<id>',
  )

const ScopeSchema = z.strictObject({ menuId: idSchema('nd'), venueId: idSchema('vn') })

const PublishMenuInputSchema = z
  .strictObject({
    menuId: idSchema('nd'),
    venueId: idSchema('vn'),
    reason: z.enum(PUBLISH_REASONS),
    actor: ActorSchema,
    /** A held snapshot (`sn_` id) this manual publish approves. */
    approveHold: idSchema('sn').optional(),
  })
  .refine(
    (input) => input.approveHold === undefined || input.reason === 'manual',
    'only a manual publish approves a held snapshot',
  )

/** What `publishMenu` needs. */
export type PublishMenuInput = z.input<typeof PublishMenuInputSchema>

const DecisionInputSchema = ScopeSchema.extend({
  snapshotId: idSchema('sn'),
  actor: ActorSchema,
})

/** What `rollbackTo` and `rejectHeld` need. */
export type SnapshotDecisionInput = z.input<typeof DecisionInputSchema>

/** Settings of one publish that tests and later tasks inject. */
export interface PublishOptions {
  /** The publish time (default: now). Decides the service day and the "new" badges. */
  readonly now?: Date
  /**
   * Which variant files a stored image has. Default: the ones recorded in `assets.variants`
   * (`asset.variants`, null until the `asset-variants` job ran); an image without variants is
   * shown as no image rather than as a broken link. Tests pass their own.
   */
  readonly assetVariants?: (asset: {
    readonly id: AssetId
    readonly width: number
    readonly height: number
    /** The record in `assets.variants`, or null when there is none (or it is malformed). */
    readonly variants: AssetVariantWidths | null
  }) => AssetVariantWidths | null
}

/** Why a publish, rollback or decision was refused. Nothing is written when one is thrown. */
export type PublishErrorCode =
  /** The input does not pass its checks. */
  | 'invalid_input'
  /** The tenant has no such menu, or the menu is not this venue's. */
  | 'menu_not_found'
  /** The venue was deleted (archived, D76): nothing of it is published until it is restored. */
  | 'venue_archived'
  /** The menu cannot be resolved for this venue (missing root, template, locales …). */
  | 'menu_blocked'
  /** V10: no item would be visible. */
  | 'no_visible_items'
  /** The snapshot failed the strict schema or the leak guard (rule 3). */
  | 'unsafe_snapshot'
  /** `approveHold` / `rejectHeld`: no held snapshot with that id for this menu + venue. */
  | 'held_not_found'
  /** `approveHold`: the document changed since the hold; review the current state instead. */
  | 'held_outdated'
  /** `rollbackTo`: nothing was ever published for this menu + venue. */
  | 'nothing_published'
  /** `rollbackTo`: the target is not a published snapshot of this menu + venue with a body. */
  | 'not_restorable'

/** Thrown by the publisher; `problems` lists the refused places (never their values). */
export class PublishError extends Error {
  override name = 'PublishError'
  readonly code: PublishErrorCode
  readonly issues: readonly IssueCode[]
  readonly problems: readonly SnapshotProblem[]

  constructor(
    code: PublishErrorCode,
    message: string,
    details: {
      issues?: readonly IssueCode[]
      problems?: readonly SnapshotProblem[]
      cause?: unknown
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.code = code
    this.issues = details.issues ?? []
    this.problems = details.problems ?? []
  }
}

/** One snapshot row, without its body. Timestamps are ISO 8601. */
export interface SnapshotRecord {
  readonly id: SnapshotId
  readonly menuId: NodeId
  readonly venueId: VenueId
  readonly version: number
  readonly hash: string
  readonly status: SnapshotStatus
  readonly reason: SnapshotReason
  readonly actor: string
  readonly heldReason: SnapshotHeldReason | null
  /** A rollback row: the snapshot the pointer moved back to. */
  readonly restoresSnapshotId: SnapshotId | null
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  /** A short code for the decision: `superseded` for a held row a later publish replaced. */
  readonly decisionNote: string | null
  readonly createdAt: string
  readonly publishedAt: string | null
}

/** A snapshot row with its body (null only for a rollback row). */
export interface SnapshotWithBody extends SnapshotRecord {
  readonly body: MenuSnapshot | null
}

/** What `publishMenu` did. */
export interface PublishResult {
  /**
   * `published`: the pointer moved to `snapshot`; `held`: V11 held it for a person (the pointer
   * stayed); `unchanged`: the document gives the current snapshot's content (nothing written).
   */
  readonly status: 'published' | 'held' | 'unchanged'
  readonly snapshot: SnapshotWithBody
  /** The snapshot that was current before the call (null before the first publish). */
  readonly previous: SnapshotWithBody | null
}

/** What `rollbackTo` did. */
export interface RollbackResult {
  /** `rolled_back`: the pointer moved; `unchanged`: the target was already current. */
  readonly status: 'rolled_back' | 'unchanged'
  /** The snapshot now current (the target). */
  readonly snapshot: SnapshotWithBody
  readonly previous: SnapshotWithBody
  /** The row that records the rollback (null when nothing changed). */
  readonly record: SnapshotRecord | null
}

/** A page of a menu + venue's snapshot history, newest first. */
export interface SnapshotPage {
  readonly snapshots: readonly SnapshotRecord[]
  /** Pass as `beforeVersion` for the next page; null on the last page. */
  readonly nextBeforeVersion: number | null
}

function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new PublishError('invalid_input', z.prettifyError(result.error))
  return result.data
}

const iso = (date: Date | null) => (date === null ? null : date.toISOString())

function recordOf(row: Omit<SnapshotRow, 'body'>): SnapshotRecord {
  return {
    id: row.id as SnapshotId,
    menuId: row.menuId as NodeId,
    venueId: row.venueId as VenueId,
    version: row.version,
    hash: row.hash,
    status: row.status as SnapshotStatus,
    reason: row.reason as SnapshotReason,
    actor: row.actor,
    heldReason: row.heldReason ?? null,
    restoresSnapshotId: (row.restoresSnapshotId ?? null) as SnapshotId | null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote ?? null,
    createdAt: row.createdAt.toISOString(),
    publishedAt: iso(row.publishedAt),
  }
}

function withBody(row: SnapshotRow): SnapshotWithBody {
  return { ...recordOf(row), body: row.body === null ? null : parseSnapshot(row.body) }
}

/** Serialises every publish, rollback and decision of one menu + venue until commit. */
async function lockPublish(tx: WriteTx, tenantId: string, menuId: string, venueId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`restro:publish:${tenantId}:${menuId}:${venueId}`}, 0))`,
  )
}

/**
 * Locks the venue (shared, `lockLiveVenue`) and refuses a deleted one, so a publish, a rollback or a
 * decision and the deletion of its venue never interleave. A venue the tenant does not have keeps
 * the refusal the writer gives it later (`menu_not_found`, `nothing_published`, …).
 */
async function refuseArchivedVenue(tx: WriteTx, venueId: string): Promise<void> {
  const locked = await lockLiveVenue(tx, venueId)
  if (locked.refused === 'venue_archived') {
    throw new PublishError('venue_archived', venueRefusalText(venueId, 'venue_archived'))
  }
}

const inScope = (menuId: string, venueId: string) =>
  and(eq(snapshots.menuId, menuId), eq(snapshots.venueId, venueId))

async function snapshotRow(
  tx: ReadTx,
  menuId: string,
  venueId: string,
  id: string,
): Promise<SnapshotRow | undefined> {
  const [row] = await tx
    .select()
    .from(snapshots)
    .where(and(inScope(menuId, venueId), eq(snapshots.id, id)))
  return row
}

async function currentRow(
  tx: ReadTx,
  menuId: string,
  venueId: string,
): Promise<SnapshotRow | undefined> {
  const [row] = await tx
    .select({ snapshot: snapshots })
    .from(publishPointers)
    .innerJoin(snapshots, eq(snapshots.id, publishPointers.currentSnapshotId))
    .where(and(eq(publishPointers.menuId, menuId), eq(publishPointers.venueId, venueId)))
  return row?.snapshot
}

async function nextVersion(tx: ReadTx, menuId: string, venueId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number | null>`max(${snapshots.version})` })
    .from(snapshots)
    .where(inScope(menuId, venueId))
  return Number(row?.last ?? 0) + 1
}

async function movePointer(
  tx: WriteTx,
  tenantId: string,
  menuId: string,
  venueId: string,
  snapshotId: string,
) {
  await tx
    .insert(publishPointers)
    .values({ tenantId, menuId, venueId, currentSnapshotId: snapshotId })
    .onConflictDoUpdate({
      target: [publishPointers.menuId, publishPointers.venueId],
      set: { currentSnapshotId: snapshotId },
    })
  await serveVenueAgain(tx, venueId)
}

/** A publish is the word to serve the venue again after an Unpublish (D86: Draft → Live). */
async function serveVenueAgain(tx: WriteTx, venueId: string): Promise<void> {
  await tx
    .update(venues)
    .set({ unpublishedAt: null })
    .where(and(eq(venues.id, venueId), isNotNull(venues.unpublishedAt)))
}

/** Records `at` as the first-published date of every item of `body` that has none yet. */
async function recordFirstPublished(tx: WriteTx, tenantId: string, body: MenuSnapshot, at: Date) {
  const itemIds = Object.keys(body.items)
  if (itemIds.length === 0) return
  await tx
    .insert(itemFirstPublished)
    .values(
      itemIds.map((nodeId) => ({
        tenantId,
        nodeId,
        menuId: body.snapshot.menu_id,
        venueId: body.snapshot.venue_id,
        firstPublishedAt: at,
      })),
    )
    .onConflictDoNothing()
}

/**
 * Turns down the snapshots still held for a menu + venue because a publish just succeeded: each
 * is `rejected`, decided by `system`, with the note `superseded`. They describe a state the menu
 * has moved past (approving one would fail with `held_outdated` anyway), so they must not pile up
 * in the review list. Runs inside the publish's own transaction, after the new row is written;
 * every held row is older than it (versions are allocated under the same lock).
 */
async function supersedeHeld(tx: WriteTx, menuId: string, venueId: string, at: Date) {
  await tx
    .update(snapshots)
    .set({ status: 'rejected', decidedBy: 'system', decidedAt: at, decisionNote: 'superseded' })
    .where(and(inScope(menuId, venueId), eq(snapshots.status, 'held')))
}

/**
 * The snapshot's theme (R13), from the look of the venue's design (`designThemeOf`, D129): the
 * palette of its colours (`themePaletteOf`: the tertiary, else the brand colour, else the default
 * palette), the eight roles per scheme (`themeRolesOf`, SH-01), its body font's family, the px
 * of its Corners and Depth words, its Screen, and the venue's logo. A design on Basic with no
 * colours publishes exactly `DEFAULT_THEME`. A logo that is not stored yet, or has no variant
 * files yet (the `asset-variants` job is still to run), is left out rather than shown broken; the
 * next publish picks it up.
 */
function snapshotThemeOf(
  theme: VenueTheme,
  snapshotAssets: Readonly<Record<AssetId, SnapshotAssetInput>>,
): SnapshotTheme {
  const logo = theme.logo_asset_id
  return {
    palette: paletteList(themePaletteOf(theme)),
    font: theme.font === undefined ? DEFAULT_THEME.font : fontFamilyOf(theme.font),
    radius: theme.radius ?? DEFAULT_THEME.radius,
    shadow: theme.shadow ?? DEFAULT_THEME.shadow,
    logo: logo !== null && Object.hasOwn(snapshotAssets, logo) ? logo : null,
    roles: themeRolesOf(theme),
    scheme: theme.scheme ?? 'auto',
  }
}

/** The template a menu is resolved with. Only `venue-menu@1` exists so far. */
const TEMPLATE = VENUE_MENU_TEMPLATE

interface Prepared {
  readonly snapshot: MenuSnapshot
  readonly resolved: ResolvedMenu
  /** The same document resolved with today's service edition too (the overlay's input). */
  readonly resolveTonight: () => ResolvedMenu
}

/** A menu loaded and resolved for one venue at one moment. */
interface Resolution {
  readonly doc: Awaited<ReturnType<typeof readMenuDocument>>
  /** Resolved with the venue edition only: what a snapshot is built from. */
  readonly resolved: ResolvedMenu
  /**
   * Resolved with the venue edition and the service edition of `day`: what the live overlay is
   * built from (the sold-out marks of the evening). Resolved on demand, since a publish needs
   * only `resolved`.
   */
  readonly resolveTonight: () => ResolvedMenu
  readonly defaultLocale: Locale
  readonly locales: Locale[]
  readonly currency: Currency
  readonly day: string
  readonly nowIso: string
  /** The look of the venue's design (`venues.settings.design`, D129; Basic when it has none). */
  readonly theme: VenueTheme
  /** The design's values (D129, D130), with the Layout and Guest switch of every menu. */
  readonly design: DesignValues
  /** The guest services (`venues.settings.guest_features`); the defaults when unset. */
  readonly features: GuestFeatures
  /** The menu's header name (`menus.name`, D92); null = none set. */
  readonly menuName: string | null
  /** The venue's display name (`venues.name`): the heading of a menu without one (D92). */
  readonly venueName: string
}

/**
 * Loads the document and the venue's context (languages, currency, service day, time zone) and
 * resolves the menu as of `now` with the edition `venue:<vn>` (a snapshot) and, on demand, with
 * `venue:<vn>` + `service:<day>` (the live overlay). Shared by the publisher, the draft and the
 * live overlay, so all three see the same document. Throws `menu_not_found` and `menu_blocked`
 * (an unknown locale or currency); resolver issues are for the caller to judge.
 */
async function resolveForVenue(
  tx: ReadTx,
  scope: { readonly menuId: NodeId; readonly venueId: VenueId },
  now: Date,
): Promise<Resolution> {
  const { menuId, venueId } = scope
  const [menu] = await tx.select().from(menus).where(eq(menus.id, menuId))
  if (menu === undefined || menu.venueId !== venueId) {
    throw new PublishError('menu_not_found', `this tenant has no menu ${menuId} for ${venueId}`)
  }
  const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId))
  if (venue === undefined) {
    throw new PublishError('menu_not_found', `this tenant has no venue ${venueId}`)
  }
  if (venue.archivedAt !== null) {
    throw new PublishError('venue_archived', venueRefusalText(venueId, 'venue_archived'))
  }
  const doc = await readMenuDocument(tx, menuId)
  // The venue's look (D129): one design for every menu of the venue, Basic until it saves one.
  const { design } = readDesign(venue.settings)

  // Context: the venue's languages (the one source every workflow uses, D77: its main language
  // first), its service day and time zone.
  const languages = venueLanguages(venue)
  const defaultLocale = languages.main
  const locales = [...languages.all]
  const currency = venue.currency as Currency
  if (!isLocale(venue.defaultLocale) || !(CURRENCIES as readonly string[]).includes(currency)) {
    throw new PublishError('menu_blocked', `venue ${venueId} has an unknown locale or currency`)
  }
  const day = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
  const nowIso = isoInTimeZone(now, venue.timezone)

  // "New" badges: recorded first-published dates; an item never published counts from now
  // (this publish is its first), so it is new in its very first snapshot.
  const recorded = await tx
    .select({ nodeId: itemFirstPublished.nodeId, at: itemFirstPublished.firstPublishedAt })
    .from(itemFirstPublished)
    .where(and(eq(itemFirstPublished.menuId, menuId), eq(itemFirstPublished.venueId, venueId)))
  const firstPublishedAt: Record<NodeId, string> = {}
  for (const node of doc.nodes) if (node.type === 'item') firstPublishedAt[node.id] = nowIso
  for (const row of recorded) firstPublishedAt[row.nodeId as NodeId] = row.at.toISOString()

  const resolveWith = (edition: readonly string[]) =>
    resolve(TEMPLATE, doc, {
      venueScope: `venue:${venueId}`,
      edition,
      locales,
      now: nowIso,
      firstPublishedAt,
    })
  return {
    doc,
    resolved: resolveWith(snapshotEditions(venueId)),
    resolveTonight: () => resolveWith(liveEditions(venueId, day)),
    defaultLocale,
    locales,
    currency,
    day,
    nowIso,
    theme: designThemeOf(design),
    design: design.values,
    features: readGuestFeatures(venue.settings),
    menuName: menu.name,
    venueName: venue.name,
  }
}

/**
 * Loads the document and everything around it, resolves it with the venue edition (not the
 * service edition: see the file header), builds the snapshot under `snapshotId` / `version` and
 * runs the leak guard and V10.
 */
async function prepareSnapshot(
  tx: ReadTx,
  scope: { readonly menuId: NodeId; readonly venueId: VenueId },
  snapshotId: SnapshotId,
  version: number,
  now: Date,
  options: PublishOptions,
): Promise<Prepared> {
  const { menuId, venueId } = scope
  const {
    doc,
    resolved,
    resolveTonight,
    defaultLocale,
    locales,
    currency,
    nowIso,
    theme: venueTheme,
    design,
    features,
    menuName,
    venueName,
  } = await resolveForVenue(tx, scope, now)
  const blocking = [
    ...new Set(
      resolved.issues.filter((issue) => issue.severity === 'block_menu').map((i) => i.code),
    ),
  ]
  if (blocking.some((code) => code !== 'V10')) {
    throw new PublishError('menu_blocked', `the menu cannot be published: ${blocking.join(', ')}`, {
      issues: blocking,
    })
  }
  if (blocking.includes('V10')) {
    throw new PublishError('no_visible_items', 'V10: the menu has no visible item', {
      issues: ['V10'],
    })
  }

  // Images: the stored assets the document's public image fields name.
  const imageKeys = new Set<string>()
  for (const [type, spec] of Object.entries(TEMPLATE.nodeTypes)) {
    for (const def of spec?.fields ?? []) {
      if (def.type === 'image' && def.visibility === 'public') imageKeys.add(`${type}:${def.key}`)
    }
  }
  const typeOf = new Map(doc.nodes.map((node) => [node.id, node.type]))
  const assetIds = new Set<string>()
  for (const row of doc.values) {
    if (!imageKeys.has(`${typeOf.get(row.nodeId)}:${row.fieldKey}`)) continue
    const image = FIELD_VALUE_SCHEMAS.image.safeParse(row.value)
    if (image.success) assetIds.add(image.data.asset_id)
  }
  // The venue's logo is an asset like any other: stored, with its variant files, or left out.
  if (venueTheme.logo_asset_id) assetIds.add(venueTheme.logo_asset_id)
  const assetRows =
    assetIds.size === 0
      ? []
      : await tx
          .select()
          .from(assets)
          .where(inArray(assets.id, [...assetIds]))
  const snapshotAssets: Record<AssetId, SnapshotAssetInput> = {}
  const backendOnly: string[] = []
  for (const row of assetRows) {
    if (row.storageKey !== null) backendOnly.push(row.storageKey)
    if (row.originRef !== null) backendOnly.push(row.originRef)
    if (row.status !== 'stored' || row.width === null || row.height === null) continue
    const stored = parseAssetVariants(row.variants)
    const variants = options.assetVariants
      ? options.assetVariants({
          id: row.id as AssetId,
          width: row.width,
          height: row.height,
          variants: stored,
        })
      : stored
    if (variants) snapshotAssets[row.id as AssetId] = { w: row.width, h: row.height, variants }
  }

  // Rule 3: the external ids of the document's nodes never reach the snapshot.
  const nodeIds = doc.nodes.map((node) => node.id)
  const externalIds =
    nodeIds.length === 0
      ? []
      : (
          await tx
            .select({ externalId: sourceLinks.externalId })
            .from(sourceLinks)
            .where(inArray(sourceLinks.nodeId, nodeIds))
        ).map((row) => row.externalId)

  const theme = snapshotThemeOf(venueTheme, snapshotAssets)
  // The venue's non-archived tags, in order (D60); items carry only ids that are in it.
  const tagVocabulary = await loadTagVocabulary(tx, venueId)
  const built = buildSnapshot(resolved, {
    template: TEMPLATE,
    snapshotId,
    version,
    publishedAt: nowIso,
    menuId,
    venueId,
    edition: ['master', ...snapshotEditions(venueId)],
    locales: { default: defaultLocale, available: locales },
    currency,
    theme,
    assets: snapshotAssets,
    tagVocabulary,
    features,
    design,
    menuName,
    venueName,
  })
  const forbidden = collectForbiddenValues({
    template: TEMPLATE,
    doc,
    externalIds,
    backendOnly,
    publicStrings: lookPublicStrings(theme),
  })
  let snapshot: MenuSnapshot
  try {
    // The heading is public by design (D92): the guard skips its place and nothing else, so an
    // internal value that reads like the header name is still refused anywhere else.
    snapshot = assertSnapshotSafe(built, forbidden, { exempt: [['menu', 'title']] })
  } catch (error) {
    if (!(error instanceof SnapshotError)) throw error
    throw new PublishError('unsafe_snapshot', `the snapshot was refused: ${error.message}`, {
      problems: error.problems,
      cause: error,
    })
  }
  if (Object.keys(snapshot.items).length === 0) {
    throw new PublishError('no_visible_items', 'V10: the menu has no visible item', {
      issues: ['V10'],
    })
  }
  return { snapshot, resolved, resolveTonight }
}

/**
 * Publishes one menu for one venue (see the file header). Returns what happened; throws a
 * `PublishError` (nothing written) when the input, the menu, V10 or the leak guard refuses.
 *
 * With `approveHold` (manual only), the held snapshot is approved: if the document still gives
 * exactly its content, it moves from `held` to `published` and becomes current; if the document
 * changed since, `held_outdated` is thrown and a person reviews the current state instead.
 */
export async function publishMenu(
  pool: DbPool,
  tenantId: string,
  input: PublishMenuInput,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const { menuId, venueId, reason, actor, approveHold } = parsed(PublishMenuInputSchema, input)
  const now = options.now ?? new Date()
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockPublish(tx, tenantId, menuId, venueId)
    await refuseArchivedVenue(tx, venueId)
    const version = await nextVersion(tx, menuId, venueId)
    const { snapshot } = await prepareSnapshot(
      tx,
      { menuId, venueId },
      newId('sn'),
      version,
      now,
      options,
    )
    const hash = snapshot.snapshot.hash
    const currentDbRow = await currentRow(tx, menuId, venueId)
    const previous = currentDbRow === undefined ? null : withBody(currentDbRow)

    if (approveHold !== undefined) {
      const held = await snapshotRow(tx, menuId, venueId, approveHold)
      if (held === undefined || held.status !== 'held') {
        throw new PublishError('held_not_found', `no held snapshot ${approveHold} for this menu`)
      }
      if (held.hash !== hash) {
        throw new PublishError(
          'held_outdated',
          'the menu changed since this publish was held; review the current state',
        )
      }
      const [approved] = await tx
        .update(snapshots)
        .set({ status: 'published', publishedAt: now, decidedBy: actor, decidedAt: now })
        .where(eq(snapshots.id, held.id))
        .returning()
      if (approved === undefined) throw new Error('the held snapshot vanished under the lock')
      const result = withBody(approved)
      await movePointer(tx, tenantId, menuId, venueId, approved.id)
      if (result.body !== null) await recordFirstPublished(tx, tenantId, result.body, now)
      await supersedeHeld(tx, menuId, venueId, now)
      return { status: 'published', snapshot: result, previous }
    }

    if (previous !== null && previous.hash === hash) {
      // Nothing new to publish, but "Publish" was said: an unpublished venue is served again.
      await serveVenueAgain(tx, venueId)
      return { status: 'unchanged', snapshot: previous, previous }
    }

    if (reason === 'auto_sync' && previous?.body) {
      const was = { items: Object.fromEntries(Object.keys(previous.body.items).map(visible)) }
      const next = { items: Object.fromEntries(Object.keys(snapshot.items).map(visible)) }
      const change = compareVisibility(was, next)
      if (change.hiddenShare > V11_MAX_HIDDEN_SHARE) {
        // The same content held already: keep that one instead of a second identical row.
        const [same] = await tx
          .select()
          .from(snapshots)
          .where(
            and(inScope(menuId, venueId), eq(snapshots.status, 'held'), eq(snapshots.hash, hash)),
          )
          .orderBy(desc(snapshots.version))
          .limit(1)
        if (same !== undefined) return { status: 'held', snapshot: withBody(same), previous }
        const heldReason: SnapshotHeldReason = {
          code: 'V11',
          hidden: change.hiddenItemIds.length,
          previously_visible: change.previouslyVisible,
          hidden_item_ids: [...change.hiddenItemIds],
        }
        const [row] = await tx
          .insert(snapshots)
          .values({
            ...rowValues(tenantId, snapshot, reason, actor),
            status: 'held',
            heldReason,
          })
          .returning()
        if (row === undefined) throw new Error('the held snapshot was not written')
        return { status: 'held', snapshot: withBody(row), previous }
      }
    }

    const [row] = await tx
      .insert(snapshots)
      .values({
        ...rowValues(tenantId, snapshot, reason, actor),
        status: 'published',
        publishedAt: now,
      })
      .returning()
    if (row === undefined) throw new Error('the snapshot was not written')
    await movePointer(tx, tenantId, menuId, venueId, row.id)
    await recordFirstPublished(tx, tenantId, snapshot, now)
    await supersedeHeld(tx, menuId, venueId, now)
    return { status: 'published', snapshot: withBody(row), previous }
  })
}

const visible = (id: string) => [id, { visible: true }] as const

function rowValues(tenantId: string, snapshot: MenuSnapshot, reason: PublishReason, actor: string) {
  return {
    id: snapshot.snapshot.id,
    tenantId,
    menuId: snapshot.snapshot.menu_id,
    venueId: snapshot.snapshot.venue_id,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
    body: snapshot as unknown as Record<string, unknown>,
    reason,
    actor,
  }
}

/**
 * Moves the pointer of a menu + venue back to an earlier published snapshot (one with a body),
 * and records that in a `rollback` row of its own (no new body). The next publish compares with
 * the restored snapshot, so a rollback lasts until the document's content is published again.
 */
export async function rollbackTo(
  pool: DbPool,
  tenantId: string,
  input: SnapshotDecisionInput,
  options: Pick<PublishOptions, 'now'> = {},
): Promise<RollbackResult> {
  const { menuId, venueId, snapshotId, actor } = parsed(DecisionInputSchema, input)
  const now = options.now ?? new Date()
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockPublish(tx, tenantId, menuId, venueId)
    await refuseArchivedVenue(tx, venueId)
    const current = await currentRow(tx, menuId, venueId)
    if (current === undefined) {
      throw new PublishError('nothing_published', 'this menu has never been published here')
    }
    const target = await snapshotRow(tx, menuId, venueId, snapshotId)
    if (target === undefined || target.status !== 'published' || target.body === null) {
      throw new PublishError(
        'not_restorable',
        `${snapshotId} is not a published snapshot of this menu with a body`,
      )
    }
    const previous = withBody(current)
    const restored = withBody(target)
    if (target.id === current.id) {
      return { status: 'unchanged', snapshot: restored, previous, record: null }
    }
    const [record] = await tx
      .insert(snapshots)
      .values({
        id: newId('sn'),
        tenantId,
        menuId,
        venueId,
        version: await nextVersion(tx, menuId, venueId),
        hash: target.hash,
        body: null,
        status: 'published',
        reason: 'rollback',
        actor,
        restoresSnapshotId: target.id,
        publishedAt: now,
      })
      .returning()
    if (record === undefined) throw new Error('the rollback was not recorded')
    await movePointer(tx, tenantId, menuId, venueId, target.id)
    if (restored.body !== null) await recordFirstPublished(tx, tenantId, restored.body, now)
    return { status: 'rolled_back', snapshot: restored, previous, record: recordOf(record) }
  })
}

/** Turns down a held snapshot: it stays in the history as `rejected`; the pointer never moves. */
export async function rejectHeld(
  pool: DbPool,
  tenantId: string,
  input: SnapshotDecisionInput,
  options: Pick<PublishOptions, 'now'> = {},
): Promise<SnapshotRecord> {
  const { menuId, venueId, snapshotId, actor } = parsed(DecisionInputSchema, input)
  const now = options.now ?? new Date()
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockPublish(tx, tenantId, menuId, venueId)
    await refuseArchivedVenue(tx, venueId)
    const held = await snapshotRow(tx, menuId, venueId, snapshotId)
    if (held === undefined || held.status !== 'held') {
      throw new PublishError('held_not_found', `no held snapshot ${snapshotId} for this menu`)
    }
    const [row] = await tx
      .update(snapshots)
      .set({ status: 'rejected', decidedBy: actor, decidedAt: now })
      .where(eq(snapshots.id, held.id))
      .returning()
    if (row === undefined) throw new Error('the held snapshot vanished under the lock')
    return recordOf(row)
  })
}

/** The snapshot a menu + venue shows now, with its body; null before the first publish. */
export async function loadCurrentSnapshot(
  pool: DbPool,
  tenantId: string,
  scope: { readonly menuId: string; readonly venueId: string },
): Promise<SnapshotWithBody | null> {
  const { menuId, venueId } = parsed(ScopeSchema, scope)
  const row = await withTenant(pool, tenantId, (tx) => currentRow(tx, menuId, venueId))
  return row === undefined ? null : withBody(row)
}

/** One snapshot of this tenant, with its body (null for a rollback row); null if unknown. */
export async function loadSnapshot(
  pool: DbPool,
  tenantId: string,
  snapshotId: string,
): Promise<SnapshotWithBody | null> {
  const id = parsed(idSchema('sn'), snapshotId)
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(snapshots).where(eq(snapshots.id, id)),
  )
  return row === undefined ? null : withBody(row)
}

/** The live overlay of the snapshot a menu + venue shows now. */
export interface LiveOverlayResult {
  /** The current snapshot the overlay was made for. */
  readonly snapshotId: SnapshotId
  readonly overlay: LiveOverlay
}

/**
 * The sold-out marks of the current snapshot's items, resolved with the service edition of
 * `options.now` (default: now), or null before the first publish. Read only: the overlay is a
 * file derived from the document, never a stored row (S3-01b writes `live.json` from it). It is
 * the only place a manager's "sold out tonight" mark (S3-08) reaches guests, so the same call
 * with a later `now` gives the overlay without yesterday's marks.
 */
export async function loadLiveOverlay(
  pool: DbPool,
  tenantId: string,
  scope: { readonly menuId: string; readonly venueId: string },
  options: Pick<PublishOptions, 'now'> = {},
): Promise<LiveOverlayResult | null> {
  const { menuId, venueId } = parsed(ScopeSchema, scope)
  const now = options.now ?? new Date()
  return withTenant(pool, tenantId, async (tx) => {
    const current = await currentRow(tx, menuId, venueId)
    if (current === undefined) return null
    const snapshot = withBody(current)
    if (snapshot.body === null) return null
    const { resolveTonight } = await resolveForVenue(tx, { menuId, venueId }, now)
    return { snapshotId: snapshot.id, overlay: buildLiveOverlay(resolveTonight(), snapshot.body) }
  })
}

/** A menu + venue that has a published snapshot, with the clock its service day runs by. */
export interface PublishedScope {
  readonly menuId: NodeId
  readonly venueId: VenueId
  /** The venue's IANA time zone. */
  readonly timezone: string
  /** When the venue's service day ends, `HH:MM` or `HH:MM:SS` (D45). */
  readonly dayEndsAt: string
}

/**
 * Every menu + venue of the tenant that has been published, with the venue's time zone and the end
 * of its service day: what a scheduler needs to notice that a service day changed and `live.json`
 * has to be remade without yesterday's sold-out marks (S3-08). Read only.
 */
export async function listPublishedScopes(
  pool: DbPool,
  tenantId: string,
): Promise<PublishedScope[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({
        menuId: publishPointers.menuId,
        venueId: publishPointers.venueId,
        timezone: venues.timezone,
        dayEndsAt: venues.serviceDayEndsAt,
      })
      .from(publishPointers)
      .innerJoin(venues, eq(venues.id, publishPointers.venueId))
      // A deleted venue has nothing to remake (D76).
      .where(isNull(venues.archivedAt))
      .orderBy(publishPointers.menuId, publishPointers.venueId),
  )
  return rows.map((row) => ({
    menuId: row.menuId as NodeId,
    venueId: row.venueId as VenueId,
    timezone: row.timezone,
    dayEndsAt: row.dayEndsAt,
  }))
}

/** A field with an override that barsy's value has outgrown, waiting for a person (V12). */
export interface StaleOverride {
  readonly nodeId: NodeId
  readonly fieldKey: string | null
  /** The node's name in the document (items), for the warning; null when it has none. */
  readonly name: LocalizedText | null
  /** True for an item, which the composer can open. */
  readonly isItem: boolean
}

/** What the next publish would contain, built in memory. */
export interface Draft {
  /**
   * The snapshot a publish right now would write, after the schema and the leak guard. Its id is
   * a fresh one that nothing stores and its version is the next free one: it is for showing and
   * comparing, never for writing.
   */
  readonly snapshot: MenuSnapshot
  /** The sold-out marks of today's service edition for that snapshot. */
  readonly overlay: LiveOverlay
  /** V12: stale overrides on fields whose policy is `review`. */
  readonly staleOverrides: readonly StaleOverride[]
}

/**
 * The draft of a menu + venue: the document resolved and built exactly as `publishMenu` would,
 * without writing anything (the Publish tab's preview and its "changes waiting"). Throws the same
 * `PublishError`s a publish would (`menu_not_found`, `menu_blocked`, `no_visible_items`,
 * `unsafe_snapshot`); V11 is not checked, it only concerns automatic publishes.
 */
export async function loadDraft(
  pool: DbPool,
  tenantId: string,
  scope: { readonly menuId: string; readonly venueId: string },
  options: PublishOptions = {},
): Promise<Draft> {
  const { menuId, venueId } = parsed(ScopeSchema, scope)
  const now = options.now ?? new Date()
  return withTenant(pool, tenantId, async (tx) => {
    const version = await nextVersion(tx, menuId, venueId)
    const { snapshot, resolved, resolveTonight } = await prepareSnapshot(
      tx,
      { menuId, venueId },
      newId('sn'),
      version,
      now,
      options,
    )
    const staleOverrides = resolved.issues
      .filter((issue) => issue.code === 'stale_override' && issue.nodeId !== undefined)
      .map((issue): StaleOverride => {
        const nodeId = issue.nodeId as NodeId
        const item = Object.hasOwn(resolved.items, nodeId) ? resolved.items[nodeId] : undefined
        const name = LocalizedTextSchema.safeParse(item?.fields.name?.value)
        return {
          nodeId,
          fieldKey: issue.fieldKey ?? null,
          name: name.success ? name.data : null,
          isItem: item !== undefined,
        }
      })
    return { snapshot, overlay: buildLiveOverlay(resolveTonight(), snapshot), staleOverrides }
  })
}

const ListInputSchema = ScopeSchema.extend({
  limit: z.int().min(1).max(100).default(20),
  beforeVersion: z.int().min(1).optional(),
})

/** The history of a menu + venue, newest first, without bodies; page with `beforeVersion`. */
export async function listSnapshots(
  pool: DbPool,
  tenantId: string,
  input: z.input<typeof ListInputSchema>,
): Promise<SnapshotPage> {
  const { menuId, venueId, limit, beforeVersion } = parsed(ListInputSchema, input)
  const { body: _body, ...withoutBody } = getTableColumns(snapshots)
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select(withoutBody)
      .from(snapshots)
      .where(
        and(
          inScope(menuId, venueId),
          beforeVersion === undefined ? undefined : lt(snapshots.version, beforeVersion),
        ),
      )
      .orderBy(desc(snapshots.version))
      .limit(limit + 1),
  )
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    snapshots: page.map(recordOf),
    nextBeforeVersion: rows.length > limit && last !== undefined ? last.version : null,
  }
}
