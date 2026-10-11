// The catalogue sync: path C (the full pull) and path E's incremental run, on top of the pieces
// that carry the hard rules (all built and tested before this task; this file wires them):
//
//   rule 1  every change reaches the document through core's apply(), in chunks (chunk.ts);
//   rule 5  nothing here writes a node's status or a price of an orderable item: barsy's
//           hiding lives in link state and till-layer values (the mapper), the manager's in
//           the other layers;
//   rule 6  absence concludes only here, only after a complete full pull, through core's
//           `concludeVenuePull` (brief CF-16): per catalogue for items (from a read of the WHOLE
//           catalogue the venue sells from, so an item another venue's root holds is never
//           concluded absent), per venue for its sections and for items its root no longer holds
//           (hidden in that venue only). A read that found nothing, or would hide most of a
//           catalogue or of a venue's menu, concludes nothing for it (`absenceHold`, T62): the
//           pull says so and a person looks;
//   rule 7  everything read from barsy goes through the read-only client.
//
// A pull is: fetch → map → store the source records → apply the change set in chunks → mark every
// link the pull saw (`setLinkState` with `seenAt` and the record's hash) → (full pull only)
// conclude what is absent → queue the photos. The incremental run is the same without the
// conclusion and for the changed articles only.
//
// Several venues on one installation (CF-16): items are the installation's, one per article;
// sections are each venue's own (`qualifiedSections`: a single venue keeps exactly its keys);
// price and for-sale are written per venue, read in the venue's own context (`?bid=`).

import {
  type Article,
  type ArticleDetailsGroup,
  BarsyAuthError as AuthRefused,
  type CatalogueMapping,
  type CategoryTreeNode,
  DEFAULT_MAPPING_LOCALE,
  inMenuOf,
  type Language,
  BARSY_MAPPING_VERSION as MAPPING_VERSION,
  type MappingConfig,
  type Modificator,
  mapCatalogue,
  mapModificators,
  mapPlaces,
  parseSectionLinkId,
  qualifiedSections,
  type SourceRecordDescriptor,
  type SupplementGroup,
  sectionLinksOfMenu,
  type VenueHide,
  venueHideOps,
} from '@restro/barsy'
import {
  type AbsenceHeld,
  type CatalogueItemLink,
  type ChangeSetOp,
  type ChildLink,
  canonicalJson,
  concludeVenuePull,
  type IntegrationId,
  isLocale,
  JOB_NAMES,
  MAX_RETIRED_TOKENS,
  type NodeId,
  prepareJob,
  type ScopedHold,
  type ScopedLink,
  sha256Hex,
  tillSource,
  type VenueId,
  venueHoldsNewItems,
} from '@restro/core'
import {
  type ApplyRejection,
  appendSourceRecords,
  provisionMenu,
  storeCachedTree,
  updateSyncState,
  upsertPlaces,
} from '@restro/core/apply'

import { type AppliedTotals, applyMapped, applyOps, emptyTotals } from './apply-chunks'
import type { IntegrationSession, SyncEnvironment } from './context'
import {
  articlesWithPhoto,
  linkKeyOf,
  type MappedVenue,
  picturesOfRecords,
  readArticleCatalogues,
  readLinks,
  readMenuArticles,
  readSectionOwners,
  readVenueHidden,
  recordIdsOfLinks,
  type StoredLink,
  type VenueTarget,
} from './data'
import { SyncError } from './errors'
import { readPages } from './paging'

const ARTICLE_PAGE_LENGTH = 500
const ARTICLE_PAGE_FLOOR = 25
const MODIFICATOR_PAGE_LENGTH = 50
/** Combo articles asked about per group of calls. */
export const SUPPLEMENT_CHUNK = 10

/** What a pull tells the job that ran it. */
export interface PullOutcome {
  readonly counters: Record<string, number>
  /** Lines for the job run's text: what was skipped and why. */
  readonly notes: string[]
  /** True when the full pull did not conclude absence fully (a failed page, no catalogue, or a hold). */
  readonly deletionCheckSkipped: boolean
  /** Set when a complete read was held back from concluding absence (T62): why, and how much. */
  readonly absenceHeld?: AbsenceHeld
  readonly refused: ApplyRejection[]
  /** True when every page was read (the cursor may advance). */
  readonly complete: boolean
  readonly treeHash: string
}

/** What one run of one venue works with. */
export interface PullContext {
  readonly env: SyncEnvironment
  readonly session: IntegrationSession
  readonly target: VenueTarget
  /** The `jb_` id of this run: every change set it writes carries it. */
  readonly runId: string
  readonly start: Date
}

interface Fetched {
  readonly tree: CategoryTreeNode
  readonly details: readonly ArticleDetailsGroup[]
  readonly languages: readonly Language[]
  readonly articles: readonly Article[]
  readonly supplements: Record<string, readonly SupplementGroup[]>
  readonly modificators: readonly Modificator[]
  /** One entry per article page, supplement call and modificator page. */
  readonly pagesOk: boolean[]
  readonly articlePages: number
  /** True when the articles are the venue's whole catalogue (`menu_id`), not only its root. */
  readonly wholeCatalogue: boolean
}

const isFlagSet = (value: unknown) => value === 1 || value === true

/** The till price a venue's menu shows: its own setting, else the integration's, else the base price. */
export function priceSourceOf(
  target: Pick<MappedVenue, 'priceSource'>,
  config: { readonly price_source?: unknown },
): 'actual_price' | 'current_price' {
  const chosen = target.priceSource ?? config.price_source
  return chosen === 'current_price' ? 'current_price' : 'actual_price'
}

/** SHA-256 of the public tree: a changed tree means a full pull. */
export function treeHashOf(tree: CategoryTreeNode): string {
  return sha256Hex(canonicalJson(tree))
}

/** The tree reduced to what the catalogue-root picker shows (the virtual root is left out). */
export function cachedTreeOf(tree: CategoryTreeNode, fetchedAt: Date) {
  const categories: { cat_id: number; parent_id: number | null; name: string }[] = []
  const walk = (node: CategoryTreeNode, parent: number | null) => {
    const id = node.category.cat_id
    let next = parent
    if (id !== null) {
      const publicName = node.category.cat_name_public?.trim()
      categories.push({
        cat_id: id,
        parent_id: parent,
        name: publicName ? publicName : node.category.cat_name,
      })
      next = id
    }
    for (const child of node.categories) walk(child, next)
  }
  walk(tree, null)
  return { fetched_at: fetchedAt.toISOString(), categories }
}

/** What the mapping is configured with by the integration and the venue, not by the run. */
function mappingSettings(
  session: IntegrationSession,
  target: VenueTarget,
): Omit<MappingConfig, 'jobId' | 'actor' | 'observedAt'> {
  const config = session.integration.config
  return {
    integrationId: session.integration.id as IntegrationId,
    catalogueRootCatId: target.catalogueRootCatId,
    priceSource: priceSourceOf(target, config),
    mappingVersion: MAPPING_VERSION,
    includeServices: false,
    ...(config.allergen_detail_key ? { allergenDetailKey: config.allergen_detail_key } : {}),
    ...(isLocale(config.default_locale) ? { defaultLocale: config.default_locale } : {}),
  }
}

function mappingConfig(ctx: PullContext): MappingConfig {
  return {
    ...mappingSettings(ctx.session, ctx.target),
    jobId: ctx.runId,
    actor: `integration:${ctx.session.integration.id}`,
    observedAt: ctx.start.toISOString(),
  }
}

/**
 * SHA-256 of the scope a full pull reads: the barsy venue, the menu category and every setting
 * that changes what the mapping writes (B1-Q2). It is stored with the cursor after a successful
 * complete full pull, and the incremental compares it with the scope as configured now: a
 * difference means the cursor belongs to another scope, so a full pull runs instead of a partial
 * one. Built from the same settings the pull maps with (`mappingSettings`), with the mapping's
 * default language applied, so an unset language and an explicit default hash alike.
 */
export function scopeHashOf(session: IntegrationSession, target: VenueTarget): string {
  const settings = mappingSettings(session, target)
  return sha256Hex(
    canonicalJson({
      bid: target.bid,
      catalogueRootCatId: settings.catalogueRootCatId,
      priceSource: settings.priceSource,
      allergenKey: settings.allergenDetailKey ?? null,
      defaultLocale: settings.defaultLocale ?? DEFAULT_MAPPING_LOCALE,
      includeServices: settings.includeServices,
      mappingVersion: settings.mappingVersion,
    }),
  )
}

// --- fetching --------------------------------------------------------------------------------

/**
 * Supplements of the combo articles, `SUPPLEMENT_CHUNK` at a time. barsy's multi-method request
 * is an object keyed by method name, so one request cannot hold ten `Articlesupplements_get`
 * calls; they go out one by one through the installation's limiter (two at a time).
 */
async function readSupplements(ctx: PullContext, articles: readonly Article[]) {
  const { session, target, env } = ctx
  const combos = articles.filter((article) => isFlagSet(article.has_supplements))
  const byArticle: Record<string, readonly SupplementGroup[]> = {}
  const pagesOk: boolean[] = []
  for (let start = 0; start < combos.length; start += SUPPLEMENT_CHUNK) {
    if (env.signal?.aborted) throw new SyncError('aborted', 'The worker is shutting down.')
    const group = combos.slice(start, start + SUPPLEMENT_CHUNK)
    await Promise.all(
      group.map(async (article) => {
        try {
          const result = await session.reader.getSupplements(target.bid, article.article_id)
          byArticle[String(article.article_id)] = result.data
          pagesOk.push(true)
        } catch (error) {
          if (error instanceof AuthRefused) throw error
          pagesOk.push(false)
          env.log.warn({ err: error }, 'the supplements of an article could not be read')
        }
      }),
    )
  }
  return { byArticle, pagesOk }
}

async function fetchCatalogue(
  ctx: PullContext,
  options: {
    readonly full: boolean
    readonly lastUpdateAfter?: string
    readonly tree: CategoryTreeNode
  },
): Promise<Fetched> {
  const { session, target, env } = ctx
  const bid = target.bid
  // A full pull reads the whole catalogue the venue sells from (CF-16): only a complete read of
  // it may conclude that an item is gone. Without a known catalogue it reads the venue's root.
  const catalogueId = options.full ? target.catalogueId : null
  const scope = catalogueId !== null ? { catalogueId } : { rootCatId: target.catalogueRootCatId }
  // The menu test first: a root that is not in the tree fails before anything else is read.
  const inMenu = inMenuOf(options.tree, target.catalogueRootCatId)
  const details = (await session.reader.getArticleDetailsTree()).data
  const languages = (await session.reader.getLanguages()).data
  const articleRead = await readPages({
    what: 'articles',
    startLength: ARTICLE_PAGE_LENGTH,
    minLength: ARTICLE_PAGE_FLOOR,
    log: env.log,
    signal: env.signal,
    fetchPage: async (offset, length) =>
      (
        await session.reader.getArticlesPage(bid, {
          ...scope,
          offset,
          length,
          ...(options.lastUpdateAfter ? { lastUpdateAfter: options.lastUpdateAfter } : {}),
        })
      ).data,
  })
  // Only the combos this venue maps: another venue's combos are read in its own context.
  const supplements = await readSupplements(ctx, articleRead.items.filter(inMenu))
  const pagesOk = [...articleRead.pagesOk, ...supplements.pagesOk]
  let modificators: Modificator[] = []
  if (options.full) {
    const read = await readPages({
      what: 'modificators',
      startLength: MODIFICATOR_PAGE_LENGTH,
      minLength: ARTICLE_PAGE_FLOOR,
      log: env.log,
      signal: env.signal,
      fetchPage: async (offset, length) =>
        (await session.reader.getModificatorsPage(bid, { offset, length })).data,
    })
    modificators = read.items
    pagesOk.push(...read.pagesOk)
  }
  return {
    tree: options.tree,
    details,
    languages,
    articles: articleRead.items,
    supplements: supplements.byArticle,
    modificators,
    pagesOk,
    articlePages: articleRead.pagesOk.length,
    wholeCatalogue: catalogueId !== null,
  }
}

// --- link state ------------------------------------------------------------------------------

/** The content hash each link of the mapping stands for. */
function hashesByLink(mapping: CatalogueMapping): Map<string, string> {
  const byRecord = new Map(
    mapping.sourceRecords.map((record) => [
      `${record.externalType}:${record.externalId}`,
      record.contentHash,
    ]),
  )
  const hashes = new Map<string, string>()
  for (const intent of mapping.linkStates) {
    const isOption = intent.linkType === 'supplement_group' || intent.linkType === 'supplement'
    // Option groups and options come from the combo article's supplements record; a venue's
    // section from barsy's category record (shared by every venue that shows it, CF-16).
    const category =
      intent.linkType === 'category' ? parseSectionLinkId(intent.externalId)?.catId : undefined
    const recordKey = isOption
      ? `article_supplements:${intent.externalId.split(':')[0]}`
      : category !== undefined
        ? `category:${category}`
        : `${intent.linkType}:${intent.externalId}`
    const hash = byRecord.get(recordKey)
    if (hash !== undefined) hashes.set(`${intent.linkType}:${intent.externalId}`, hash)
  }
  return hashes
}

// --- photos ----------------------------------------------------------------------------------

/**
 * Queues a photo download for each article whose picture is new or changed, or whose item has no
 * barsy photo yet (an earlier download failed). An unchanged article with its photo is left
 * alone. Returns how many were queued.
 */
async function queuePhotos(
  ctx: PullContext,
  mapping: CatalogueMapping,
  before: ReadonlyMap<string, StoredLink>,
  hashes: ReadonlyMap<string, string>,
): Promise<{ queued: number; elsewhere: number }> {
  const { env, session } = ctx
  if (mapping.assetRequests.length === 0) return { queued: 0, elsewhere: 0 }
  const tenantId = session.tenantId
  const integrationId = session.integration.id
  const withPhoto = await articlesWithPhoto(env, tenantId, integrationId)
  const previous = await picturesOfRecords(
    env,
    tenantId,
    integrationId,
    mapping.assetRequests.flatMap((request) => {
      const stored = before.get(`article:${request.articleExternalId}`)
      return stored?.lastHash ? [stored.lastHash] : []
    }),
  )
  let queued = 0
  let elsewhere = 0
  const ownOrigin = new URL(`https://${session.host}`).origin
  for (const request of mapping.assetRequests) {
    // Only pictures on the integration's own host are fetched (the job refuses the rest too).
    // The demo has a few on a Cloudflare Images host: they are counted, not queued over and over.
    let origin: string | null = null
    try {
      origin = new URL(request.url).origin
    } catch {
      origin = null
    }
    if (origin !== ownOrigin) {
      elsewhere += 1
      continue
    }
    const id = request.articleExternalId
    const stored = before.get(`article:${id}`)
    const current = hashes.get(`article:${id}`)
    const unchanged = stored?.lastHash !== null && stored?.lastHash === current
    const samePicture =
      stored?.lastHash != null && previous.get(stored.lastHash) === request.pictureName
    const needed = stored === undefined || !withPhoto.has(id) || (!unchanged && !samePicture)
    if (!needed) continue
    let job: ReturnType<typeof prepareJob<typeof JOB_NAMES.assetFetch>>
    try {
      job = prepareJob(JOB_NAMES.assetFetch, {
        tenantId,
        integrationId,
        articleExternalId: id,
        pictureName: request.pictureName,
        url: request.url,
      })
    } catch {
      // An address or file name the job's payload cannot carry: not worth failing the pull for.
      elsewhere += 1
      continue
    }
    const jobId = await env.enqueue(JOB_NAMES.assetFetch, job.data, {
      singletonKey: job.singletonKey,
    })
    if (jobId !== null) queued += 1
  }
  return { queued, elsewhere }
}

// --- holding a suspicious conclusion (T62) ----------------------------------------------------

const percentOf = (part: number, whole: number) =>
  whole === 0 ? 100 : Math.round((100 * part) / whole)

/**
 * The run note for a held conclusion (read in the Integration tab's run history): the catalogue's
 * items, the venue's sections, or the items of the venue's menu its root no longer holds.
 */
function heldNote(held: ScopedHold): string {
  const thing =
    held.what === 'sections'
      ? 'menu sections'
      : held.scope === 'venue'
        ? 'items of this venue’s menu'
        : 'items'
  if (held.reason === 'empty_read') {
    return `deletion check held: the read found no ${thing} but ${held.active} are on the menu; nothing was hidden`
  }
  const share = percentOf(held.wouldHide, held.active)
  return `deletion check held: the read would hide ${held.wouldHide} of ${held.active} ${thing} (${share}%); nothing was hidden`
}

/** The run note for a held conclusion about the tables. */
function heldPlacesNote(held: AbsenceHeld): string {
  if (held.reason === 'empty_read') {
    return `table check held: the read found no tables but ${held.active} are stored; none was marked missing or deleted`
  }
  const share = percentOf(held.wouldHide, held.active)
  return `table check held: the read would mark ${held.wouldHide} of ${held.active} tables missing (${share}%); none was marked missing or deleted`
}

// --- the shared middle: map, record, apply, mark, conclude ----------------------------------

async function syncFetched(
  ctx: PullContext,
  fetched: Fetched,
  mode: 'full' | 'incremental',
): Promise<{
  counters: Record<string, number>
  notes: string[]
  deletionCheckSkipped: boolean
  absenceHeld: AbsenceHeld | undefined
  totals: AppliedTotals
  complete: boolean
}> {
  const { env, session, target, start } = ctx
  const tenantId = session.tenantId
  const integrationId = session.integration.id as IntegrationId
  const startIso = start.toISOString()
  const notes: string[] = []
  let deletionCheckSkipped = false
  let absenceHeld: AbsenceHeld | undefined
  const counters: Record<string, number> = {}

  const menu = await provisionMenu(env.pool, tenantId, target.venueId)
  const menuId = menu.rootNodeId as string
  // Which section keys this venue uses, and which sections are its own (CF-16).
  const owners = await readSectionOwners(env, tenantId, integrationId)
  const qualified = qualifiedSections(target.venueId, menuId, owners)
  const ownSections = sectionLinksOfMenu(menuId, owners)
  // What the venue's menu showed before this run (for the absence of items in this venue).
  const hidden = await readVenueHidden(env, tenantId, integrationId, target.venueId)
  const onMenu =
    mode === 'full' ? await readMenuArticles(env, tenantId, integrationId, menuId) : null
  const before = await readLinks(env, tenantId, integrationId)

  const mapping = mapCatalogue(
    {
      venueId: target.venueId as VenueId,
      bid: target.bid,
      menuId: menu.rootNodeId as NodeId,
      tree: fetched.tree,
      articles: fetched.articles,
      supplementsByArticle: fetched.supplements,
      detailsTree: fetched.details,
      languages: fetched.languages,
      qualifiedSections: qualified,
      venueHiddenArticles: hidden,
    },
    mappingConfig(ctx),
  )

  // Tier 1 first: every barsy write cites one of these records.
  const descriptors: SourceRecordDescriptor[] = [...mapping.sourceRecords]
  if (mode === 'full') {
    descriptors.push(...mapModificators(fetched.modificators, { integrationId }))
  }
  const appended = await appendSourceRecords(
    env.pool,
    tenantId,
    integrationId,
    descriptors.map((record) => ({
      id: record.id,
      externalType: record.externalType,
      externalId: record.externalId,
      scope: record.scope,
      raw: record.raw,
      payload: record.payload,
    })),
  )
  counters.records_new = appended.filter((record) => record.created).length

  const totals = emptyTotals()
  // The venue's rule `new_items = hold` (CF-09b; a venue with none reads the integration's): the
  // items this run creates are hidden for a manager to review.
  const holding = venueHoldsNewItems(target.venueSettings, session.integration.config)
  await applyMapped(
    env,
    tenantId,
    mapping.changeSet,
    totals,
    holding ? { runId: ctx.runId, observedAt: startIso } : undefined,
  )

  // Mark what this run saw. Only links that exist can be marked (a `delete_flag` article that
  // was never linked has none).
  const hashes = hashesByLink(mapping)
  const articleRecords = new Map<string, SourceRecordDescriptor>()
  for (const record of mapping.sourceRecords) {
    if (record.externalType === 'article') articleRecords.set(record.externalId, record)
  }
  const after = await readLinks(env, tenantId, integrationId)
  const intents = mapping.linkStates.filter((intent) =>
    mode === 'full' ? true : intent.state === 'active' && intent.linkType !== 'category',
  )
  const link = (type: string, id: string) => ({
    integration: integrationId,
    externalType: type,
    externalId: id,
  })
  const seenOps: ChangeSetOp[] = []
  const marked = new Set<string>()
  let reactivated = 0
  for (const intent of intents) {
    const key = `${intent.linkType}:${intent.externalId}`
    const stored = after.get(key)
    if (!stored) continue
    const hash = hashes.get(key)
    seenOps.push({
      op: 'setLinkState',
      link: link(intent.linkType, intent.externalId),
      state: intent.state,
      seenAt: startIso,
      ...(hash !== undefined ? { hash } : {}),
    })
    marked.add(key)
    const was = before.get(key)
    if (was && was.state !== 'active' && intent.state === 'active') reactivated += 1
  }

  // The articles of the whole catalogue: one listed is there, whichever venue's root holds it.
  const listed = new Set<string>()
  const deletedListed = new Set<string>()
  if (fetched.wholeCatalogue) {
    for (const article of firstOfEachId(fetched.articles)) {
      const key = `article:${article.article_id}`
      ;(isFlagSet(article.delete_flag) ? deletedListed : listed).add(key)
    }
    for (const key of listed) {
      const stored = after.get(key)
      if (!stored || marked.has(key)) continue
      const hash = articleRecords.get(stored.externalId)?.contentHash
      seenOps.push({
        op: 'setLinkState',
        link: link('article', stored.externalId),
        state: 'active',
        seenAt: startIso,
        ...(hash !== undefined ? { hash } : {}),
      })
    }
  }

  // Article counters: created, updated, unchanged (against the hash stored before this run).
  let created = 0
  let updated = 0
  let unchanged = 0
  for (const intent of mapping.linkStates) {
    if (intent.linkType !== 'article' || intent.state !== 'active') continue
    const key = `article:${intent.externalId}`
    const was = before.get(key)
    if (!was) created += 1
    else if (was.lastHash === hashes.get(key)) unchanged += 1
    else updated += 1
  }

  // Rule 6: absence concludes only after a complete full pull: per catalogue for items, per
  // venue for its sections and its menu (CF-16), each held when the read looks wrong (T62).
  const moves: ChangeSetOp[] = []
  let hideOps: ChangeSetOp[] = []
  let missing = 0
  let deleted = 0
  let hiddenHere = 0
  const complete = fetched.pagesOk.every((ok) => ok)
  if (mode === 'full') {
    if (!complete) {
      deletionCheckSkipped = true
      const failed = fetched.pagesOk.filter((ok) => !ok).length
      notes.push(`deletion check skipped: ${failed} of ${fetched.pagesOk.length} pages failed`)
    } else {
      const catalogueId = fetched.wholeCatalogue ? target.catalogueId : null
      const catalogues =
        catalogueId !== null ? await readArticleCatalogues(env, tenantId, integrationId) : null
      const scoped = (key: string, stored: StoredLink): ScopedLink => ({
        key,
        state: stored.state,
        stateChangedAt: stored.stateChangedAt,
        lastSeenAt: stored.lastSeenAt,
      })
      const items: CatalogueItemLink[] = []
      const children: ChildLink[] = []
      const sections: ScopedLink[] = []
      for (const [key, stored] of after) {
        if (stored.externalType === 'article') {
          items.push({
            ...scoped(key, stored),
            catalogueId: catalogues?.get(stored.externalId) ?? null,
          })
        } else if (
          stored.externalType === 'supplement_group' ||
          stored.externalType === 'supplement'
        ) {
          const parentKey = `article:${stored.externalId.split(':')[0]}`
          children.push({ ...scoped(key, stored), parentKey })
        } else if (stored.externalType === 'category' && ownSections.has(stored.externalId)) {
          sections.push(scoped(key, stored))
        }
      }
      const activeIntents = (types: readonly string[]) =>
        new Set(
          mapping.linkStates
            .filter((intent) => intent.state === 'active' && types.includes(intent.linkType))
            .map((intent) => `${intent.linkType}:${intent.externalId}`),
        )
      const shown = new Set(
        [...(onMenu ?? [])]
          .filter((id) => before.get(`article:${id}`)?.state === 'active' && !hidden.has(id))
          .map((id) => `article:${id}`),
      )
      const conclusion = concludeVenuePull({
        pagesOk: fetched.pagesOk,
        now: env.now(),
        start,
        catalogue:
          catalogueId === null
            ? null
            : { catalogueId, items, seen: listed, deletedSeen: deletedListed },
        venue: {
          sections,
          sectionsSeen: activeIntents(['category']),
          shown,
          inRoot: activeIntents(['article']),
        },
        children,
        childrenSeen: activeIntents(['supplement_group', 'supplement']),
      })
      if (catalogueId === null) {
        deletionCheckSkipped = true
        notes.push(
          'deletion check skipped for items: the catalogue of this barsy venue is not known yet (the venue list could not be read)',
        )
      }
      for (const held of conclusion.held) notes.push(heldNote(held))
      const first = conclusion.held[0]
      if (first !== undefined) {
        // A complete read that found nothing, or would hide most of a catalogue or a menu, is far
        // more likely a changed scope than a menu deleted at the till. Nothing it held is moved:
        // the links the read did see were marked above.
        deletionCheckSkipped = true
        absenceHeld = { reason: first.reason, wouldHide: first.wouldHide, active: first.active }
      }
      for (const move of conclusion.moves) {
        const stored = after.get(move.key)
        if (!stored || (move.to !== 'missing' && move.to !== 'deleted')) continue
        moves.push({
          op: 'setLinkState',
          link: link(stored.externalType, stored.externalId),
          state: move.to,
        })
        if (move.to === 'missing') missing += 1
        else deleted += 1
      }
      if (conclusion.raced > 0) {
        notes.push(
          `${conclusion.raced} link(s) seen by an incremental run meanwhile were left alone`,
        )
      }
      // Hidden in this venue only: its root no longer holds them, its catalogue (or another)
      // still does. The write cites the article's record of this read, or its last one.
      const hideIds = conclusion.venueHides.map((key) => key.slice('article:'.length))
      const fromLinks = await recordIdsOfLinks(
        env,
        tenantId,
        integrationId,
        hideIds.filter((id) => !articleRecords.has(id)),
      )
      const hides: VenueHide[] = []
      for (const id of hideIds) {
        const recordId = articleRecords.get(id)?.id ?? fromLinks.get(id)
        if (recordId !== undefined) hides.push({ articleExternalId: id, sourceRecordId: recordId })
      }
      hideOps = venueHideOps(integrationId, target.venueId, hides)
      hiddenHere = hides.length
    }
  }

  const base = {
    source: tillSource(integrationId),
    jobId: ctx.runId,
    actor: `integration:${integrationId}` as const,
    observedAt: startIso,
  }
  await applyOps(env, tenantId, base, [...seenOps, ...moves, ...hideOps], totals)

  counters.categories_seen = mapping.counts.sections
  counters.articles_seen = fetched.articles.length
  counters.items_mapped = mapping.counts.items
  counters.created = created
  counters.updated = updated
  counters.unchanged = unchanged
  counters.missing = missing
  counters.deleted = deleted
  counters.reactivated = reactivated
  if (mode === 'full') counters.hidden_here = hiddenHere
  counters.failed_pages = fetched.pagesOk.filter((ok) => !ok).length
  counters.nodes_created = totals.createdNodes
  if (holding) counters.items_held = totals.held
  counters.ops_applied = totals.applied
  counters.ops_unchanged = totals.unchanged
  counters.ops_skipped = totals.skipped
  counters.warnings = mapping.warnings.length
  const photos = await queuePhotos(ctx, mapping, before, hashes)
  counters.photos_queued = photos.queued
  counters.photos_elsewhere = photos.elsewhere
  return { counters, notes, deletionCheckSkipped, absenceHeld, totals, complete }
}

/** The first article of each id, in id order (as the mapping reads a list). */
function firstOfEachId(articles: readonly Article[]): Article[] {
  const seen = new Set<number>()
  const result: Article[] = []
  for (const article of [...articles].sort((a, b) => a.article_id - b.article_id)) {
    if (seen.has(article.article_id)) continue
    seen.add(article.article_id)
    result.push(article)
  }
  return result
}

// --- the two runs ----------------------------------------------------------------------------

/** Path C, steps 2 to 9, for one venue. Throws for what retrying may fix; returns the outcome otherwise. */
export async function runFullPull(ctx: PullContext): Promise<PullOutcome> {
  const { env, session, target } = ctx
  const tree = (await session.reader.getCategoryTree(target.bid)).data
  const fetched = await fetchCatalogue(ctx, { full: true, tree })
  const result = await syncFetched(ctx, fetched, 'full')
  const notes = [...result.notes]

  const places = await syncPlaces({ env, session, venue: target, now: ctx.start })
  notes.push(...places.notes)
  Object.assign(result.counters, places.counters)

  await storeCachedTree(
    env.pool,
    session.tenantId,
    session.integration.id,
    target.bid,
    cachedTreeOf(tree, ctx.start),
  )
  return {
    counters: result.counters,
    notes,
    deletionCheckSkipped: result.deletionCheckSkipped,
    ...(result.absenceHeld !== undefined ? { absenceHeld: result.absenceHeld } : {}),
    refused: result.totals.rejected,
    complete: result.complete,
    treeHash: treeHashOf(tree),
  }
}

/**
 * Places (tables) of one venue: one call (brief CF-16, T67: read as soon as the venue is mapped,
 * root or not; and with every full pull). A failure here is noted and touches nothing. The
 * evidence of the read is what the call really did: `Places_getlist` is not paged, so it is one
 * entry, true once the list came back valid. An empty or sharply smaller list is held inside
 * `upsertPlaces` (T62): no table goes missing or deleted and no code is retired. A successful
 * read is recorded in the venue's sync state (`places_read_at`).
 */
export async function syncPlaces(target: {
  readonly env: SyncEnvironment
  readonly session: IntegrationSession
  readonly venue: Pick<MappedVenue, 'venueId' | 'bid'>
  readonly now: Date
}): Promise<{ counters: Record<string, number>; notes: string[]; read: boolean }> {
  const { env, session, venue } = target
  const counters: Record<string, number> = {}
  const notes: string[] = []
  const placesPagesOk: boolean[] = []
  try {
    const places = await session.reader.getPlaces(venue.bid)
    placesPagesOk.push(true)
    const described = mapPlaces(places.data, {
      integrationId: session.integration.id as IntegrationId,
      venueId: venue.venueId as VenueId,
    })
    await appendSourceRecords(
      env.pool,
      session.tenantId,
      session.integration.id,
      described.map(({ sourceRecord: record }) => ({
        id: record.id,
        externalType: record.externalType,
        externalId: record.externalId,
        scope: record.scope,
        raw: record.raw,
        payload: record.payload,
      })),
    )
    const stored = await upsertPlaces(
      env.pool,
      session.tenantId,
      session.integration.id,
      venue.bid,
      described,
      { pagesOk: placesPagesOk, now: env.now() },
    )
    if (stored.held !== null) notes.push(heldPlacesNote(stored.held))
    counters.places_seen = described.length
    counters.places_created = stored.created
    counters.places_missing = stored.missing
    counters.places_deleted = stored.deleted
    await updateSyncState(env.pool, session.tenantId, session.integration.id, venue.bid, {
      places_read_at: target.now.toISOString(),
    })
    // A table's code file says its name (barsy's number unless the manager chose one), and a table
    // barsy deleted lost its code: bring the venue's `t/<token>.json` files in line (S3-07). The
    // job is idempotent and writes only what differs, so queuing it for any change is cheap.
    if (stored.updated > 0 || stored.reactivated > 0 || stored.retiredTokens.length > 0) {
      try {
        const tokens = prepareJob(JOB_NAMES.publishTableTokens, {
          tenantId: session.tenantId,
          venueId: venue.venueId,
          retired: stored.retiredTokens.slice(0, MAX_RETIRED_TOKENS),
        })
        await env.enqueue(JOB_NAMES.publishTableTokens, tokens.data, {
          singletonKey: tokens.singletonKey,
        })
      } catch (error) {
        // The places are stored; only the files are late. Say so, apart from a places failure.
        notes.push(
          'the table code files could not be updated; they follow the next change to a table',
        )
        env.log.error({ err: error }, 'the table token job could not be queued')
      }
    }
    return { counters, notes, read: true }
  } catch (error) {
    if (error instanceof AuthRefused) throw error
    notes.push('places could not be read; they were left as they were')
    env.log.warn({ err: error }, 'the places could not be read')
    return { counters, notes, read: false }
  }
}

/** Path E: the articles changed since `lastUpdateAfter`. Never concludes anything is gone. */
export async function runIncremental(
  ctx: PullContext,
  tree: CategoryTreeNode,
  lastUpdateAfter: string,
): Promise<PullOutcome> {
  const fetched = await fetchCatalogue(ctx, { full: false, tree, lastUpdateAfter })
  const result = await syncFetched(ctx, fetched, 'incremental')
  return {
    counters: result.counters,
    notes: result.notes,
    deletionCheckSkipped: result.deletionCheckSkipped,
    refused: result.totals.rejected,
    complete: result.complete,
    treeHash: treeHashOf(tree),
  }
}

/** Marks the venue's sync state after a successful run. */
export async function recordSuccess(
  ctx: PullContext,
  outcome: PullOutcome,
  kind: 'full' | 'incremental',
): Promise<void> {
  const { env, session, target, start } = ctx
  const iso = start.toISOString()
  await updateSyncState(env.pool, session.tenantId, session.integration.id, target.bid, {
    tree_hash: outcome.treeHash,
    // The cursor moves only when every page was read: otherwise the next run looks further back.
    ...(outcome.complete ? { cursor: iso } : {}),
    ...(kind === 'full' && outcome.complete ? { last_full_pull_at: iso } : {}),
    // The scope this complete full pull read (venue, menu category, mapping settings): the
    // incremental queues a full pull when the scope as configured now is another one (B1-Q2).
    ...(kind === 'full' && outcome.complete
      ? { scope_hash: scopeHashOf(ctx.session, ctx.target) }
      : {}),
    ...(kind === 'incremental' ? { last_incremental_at: iso } : {}),
  })
}

export { linkKeyOf }
