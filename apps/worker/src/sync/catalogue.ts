// The catalogue sync: path C (the full pull) and path E's incremental run, on top of the pieces
// that carry the hard rules (all built and tested before this task; this file wires them):
//
//   rule 1  every change reaches the document through core's apply(), in chunks (chunk.ts);
//   rule 5  nothing here writes a node's status or a price of an orderable item: barsy's
//           hiding lives in link state and barsy-layer values (the mapper), the manager's in
//           the other layers;
//   rule 6  absence concludes only here, only after a complete full pull, through core's
//           `concludeFullPull`, and only when the integration has a single mapped venue;
//   rule 7  everything read from barsy goes through the read-only client.
//
// A pull is: fetch → map → store the source records → apply the change set in chunks → mark every
// link the pull saw (`setLinkState` with `seenAt` and the record's hash) → (full pull only)
// conclude what is absent → queue the photos. The incremental run is the same without the
// conclusion and for the changed articles only.

import {
  type Article,
  type ArticleDetailsGroup,
  BARSY_MAPPING_VERSION,
  BarsyAuthError,
  type CatalogueMapping,
  type CategoryTreeNode,
  type Language,
  type MappingConfig,
  type Modificator,
  mapCatalogue,
  mapModificators,
  mapPlaces,
  type SourceRecordDescriptor,
  type SupplementGroup,
} from '@restro/barsy'
import {
  type ChangeSetOp,
  canonicalJson,
  concludeFullPull,
  holdsNewItems,
  type IntegrationId,
  isLocale,
  JOB_NAMES,
  MAX_RETIRED_TOKENS,
  type NodeId,
  prepareJob,
  sha256Hex,
  type VenueId,
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
  picturesOfRecords,
  readLinks,
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
  /** True when the full pull did not conclude absence (a failed page, or several venues). */
  readonly deletionCheckSkipped: boolean
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
}

const isFlagSet = (value: unknown) => value === 1 || value === true

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

function mappingConfig(ctx: PullContext): MappingConfig {
  const { session, target } = ctx
  const config = session.integration.config
  return {
    integrationId: session.integration.id as IntegrationId,
    catalogueRootCatId: target.catalogueRootCatId,
    priceSource: config.price_source === 'current_price' ? 'current_price' : 'actual_price',
    mappingVersion: BARSY_MAPPING_VERSION,
    includeServices: false,
    jobId: ctx.runId,
    actor: `integration:${session.integration.id}`,
    observedAt: ctx.start.toISOString(),
    ...(config.allergen_detail_key ? { allergenDetailKey: config.allergen_detail_key } : {}),
    ...(isLocale(config.default_locale) ? { defaultLocale: config.default_locale } : {}),
  }
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
          if (error instanceof BarsyAuthError) throw error
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
          rootCatId: target.catalogueRootCatId,
          offset,
          length,
          ...(options.lastUpdateAfter ? { lastUpdateAfter: options.lastUpdateAfter } : {}),
        })
      ).data,
  })
  const supplements = await readSupplements(ctx, articleRead.items)
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
    // Option groups and options come from the combo article's supplements record.
    const recordKey = isOption
      ? `article_supplements:${intent.externalId.split(':')[0]}`
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

// --- the shared middle: map, record, apply, mark, conclude ----------------------------------

async function syncFetched(
  ctx: PullContext,
  fetched: Fetched,
  mode: 'full' | 'incremental',
): Promise<{
  counters: Record<string, number>
  notes: string[]
  deletionCheckSkipped: boolean
  totals: AppliedTotals
  complete: boolean
}> {
  const { env, session, target, start } = ctx
  const tenantId = session.tenantId
  const integrationId = session.integration.id as IntegrationId
  const startIso = start.toISOString()
  const notes: string[] = []
  let deletionCheckSkipped = false
  const counters: Record<string, number> = {}

  const menu = await provisionMenu(env.pool, tenantId, target.venueId)
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
  // `publish.new_items = hold`: the items this run creates are hidden for a manager to review.
  const holding = holdsNewItems(session.integration.config)
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
    const was = before.get(key)
    if (was && was.state !== 'active' && intent.state === 'active') reactivated += 1
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

  // Rule 6: absence concludes only after a complete full pull, only for one venue.
  const moves: ChangeSetOp[] = []
  let missing = 0
  let deleted = 0
  const complete = fetched.pagesOk.every((ok) => ok)
  if (mode === 'full') {
    if (target.mappedVenues !== 1) {
      deletionCheckSkipped = true
      notes.push(
        `deletion check skipped: ${target.mappedVenues} venues of this integration have a catalogue root (one venue for now)`,
      )
    } else if (!complete) {
      deletionCheckSkipped = true
      const failed = fetched.pagesOk.filter((ok) => !ok).length
      notes.push(`deletion check skipped: ${failed} of ${fetched.pagesOk.length} pages failed`)
    } else {
      const seen = new Set<string>()
      const deletedSeen = new Set<string>()
      for (const intent of mapping.linkStates) {
        ;(intent.state === 'active' ? seen : deletedSeen).add(
          `${intent.linkType}:${intent.externalId}`,
        )
      }
      const conclusion = concludeFullPull({
        pagesOk: fetched.pagesOk,
        seen,
        deletedSeen,
        links: [...after].map(([key, stored]) => ({
          key,
          state: stored.state,
          stateChangedAt: stored.stateChangedAt,
        })),
        now: env.now(),
      })
      let raced = 0
      for (const change of conclusion.changes) {
        // Revivals ride on the seen ops above.
        if (change.to === 'active') continue
        const stored = after.get(change.key)
        if (!stored) continue
        // An incremental run saw this link after this pull began: it is not absent.
        if (stored.lastSeenAt.getTime() > start.getTime()) {
          raced += 1
          continue
        }
        moves.push({
          op: 'setLinkState',
          link: link(stored.externalType, stored.externalId),
          state: change.to,
        })
        if (change.to === 'missing') missing += 1
        else deleted += 1
      }
      if (raced > 0) {
        notes.push(`${raced} link(s) seen by an incremental run meanwhile were left alone`)
      }
    }
  }

  const base = {
    source: `barsy:${integrationId}` as const,
    jobId: ctx.runId,
    actor: `integration:${integrationId}` as const,
    observedAt: startIso,
  }
  await applyOps(env, tenantId, base, [...seenOps, ...moves], totals)

  counters.categories_seen = mapping.counts.sections
  counters.articles_seen = fetched.articles.length
  counters.items_mapped = mapping.counts.items
  counters.created = created
  counters.updated = updated
  counters.unchanged = unchanged
  counters.missing = missing
  counters.deleted = deleted
  counters.reactivated = reactivated
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
  return { counters, notes, deletionCheckSkipped, totals, complete }
}

// --- the two runs ----------------------------------------------------------------------------

/** Path C, steps 2 to 9, for one venue. Throws for what retrying may fix; returns the outcome otherwise. */
export async function runFullPull(ctx: PullContext): Promise<PullOutcome> {
  const { env, session, target } = ctx
  const tree = (await session.reader.getCategoryTree(target.bid)).data
  const fetched = await fetchCatalogue(ctx, { full: true, tree })
  const result = await syncFetched(ctx, fetched, 'full')
  const notes = [...result.notes]

  // Places (tables): one call. A failure here is noted and does not touch the catalogue.
  try {
    const places = await session.reader.getPlaces(target.bid)
    const described = mapPlaces(places.data, {
      integrationId: session.integration.id as IntegrationId,
      venueId: target.venueId as VenueId,
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
      target.bid,
      described,
      { pagesOk: [true], now: env.now() },
    )
    result.counters.places_seen = described.length
    result.counters.places_created = stored.created
    result.counters.places_missing = stored.missing
    result.counters.places_deleted = stored.deleted
    // A table's code file says its name (barsy's number unless the manager chose one), and a table
    // barsy deleted lost its code: bring the venue's `t/<token>.json` files in line (S3-07). The
    // job is idempotent and writes only what differs, so queuing it for any change is cheap.
    if (stored.updated > 0 || stored.reactivated > 0 || stored.retiredTokens.length > 0) {
      try {
        const tokens = prepareJob(JOB_NAMES.publishTableTokens, {
          tenantId: session.tenantId,
          venueId: target.venueId,
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
  } catch (error) {
    if (error instanceof BarsyAuthError) throw error
    notes.push('places could not be read; they were left as they were')
    env.log.warn({ err: error }, 'the places could not be read')
  }

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
    refused: result.totals.rejected,
    complete: result.complete,
    treeHash: treeHashOf(tree),
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
    ...(kind === 'incremental' ? { last_incremental_at: iso } : {}),
  })
}

export { linkKeyOf }
