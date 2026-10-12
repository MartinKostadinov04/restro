// Everything the Publish tab shows, read in one go (brief S3-05). Reads only: the writes are the
// actions in actions.ts / service.ts, and the publisher is the worker's job. Every query runs in
// `withTenant`, so row-level security keeps it to the signed-in organisation.
//
//   live       the snapshot the pointer names (its number, who and when), or null before the first publish
//   draft      the document resolved and built exactly as a publish would (`loadDraft`), compared with
//              the live snapshot (`diffSnapshots`): the changes waiting, and V12's stale overrides
//   held       the newest automatic publish V11 held, with the names of what it would hide
//   paused     the integration's `publish.auto_paused` (set by a return to an older version)
//   history    the versions, newest first, 20 to a page, each with what it changed
//   busy/run   a publish or a files job of this menu is queued or running; how the last publish run ended
import { readVenueIndex } from '@restro/assets'
import {
  diffSnapshots,
  JOB_NAMES,
  type MenuSnapshot,
  type NodeId,
  parseSnapshot,
  venueAutoPublishPaused,
  venueOwnPublishRules,
  venuePublishRules,
} from '@restro/core'
import {
  type Draft,
  listSnapshots,
  loadCurrentSnapshot,
  loadDraft,
  PublishError,
} from '@restro/core/apply'
import {
  authMember,
  authUser,
  barsyVenues,
  type DbPool,
  integrations,
  jobRuns,
  menus,
  type SnapshotRow,
  snapshots,
  venues,
  withTenant,
} from '@restro/db'
import { and, desc, eq, getTableColumns, inArray, lt, sql } from 'drizzle-orm'

import { getAuthDb } from '../db'
import { getTokenSource } from './table-token'
import {
  type ActorView,
  type BusyView,
  type ChangesView,
  type DraftView,
  type HeldView,
  type HistoryPage,
  type LiveView,
  type NamedItem,
  type PublishRulesView,
  type PublishView,
  percentOf,
  toPublishRunView,
  type VersionCounts,
  type VersionEntry,
  type VersionReason,
} from './view'

/** How many versions a page of the history holds. */
export const HISTORY_PAGE_SIZE = 20

/** The most hidden items a held publish names in the tab (the count is always whole). */
const MAX_HELD_NAMES = 100

/** Who is asking, for which venue. `canPublish` comes from the organisation role. */
export interface ViewScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venue: {
    readonly id: string
    readonly slug: string
    readonly publicId: string
    readonly timezone: string
  }
  readonly canPublish: boolean
}

/**
 * Whether the venue's address is out: `v/<public code>.json` is in the published files and names
 * this venue. Read the way the guest page reads it (the local store, else the CDN). When the files
 * cannot be read at all (no store configured, the CDN not answering) the address counts as served,
 * so the tab behaves as it did before this check existed.
 */
async function venueIndexServed(venue: { readonly id: string; readonly publicId: string }) {
  try {
    const source = await getTokenSource()
    if (source === null) return true
    const index = await readVenueIndex(source, venue.publicId)
    return index !== null && index.venue_id === venue.id
  } catch {
    return true
  }
}

/** What the view needs from outside the tenant's tables. */
export interface ViewDeps {
  /** Whether the venue's address is out (default: read the published files). */
  readonly addressServed?: (venue: {
    readonly id: string
    readonly publicId: string
  }) => Promise<boolean>
  /** The names of the organisation's people by user id (default: the auth tables). */
  readonly personNames?: (
    tenantId: string,
    userIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>
  /** The moment the draft is built for (default: now). */
  readonly now?: Date
}

/** The people of the organisation among `userIds`, by id. People who left are not in it. */
async function authPersonNames(
  tenantId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await getAuthDb()
    .select({ id: authUser.id, name: authUser.name })
    .from(authMember)
    .innerJoin(authUser, eq(authUser.id, authMember.userId))
    .where(and(eq(authMember.organizationId, tenantId), inArray(authUser.id, [...userIds])))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** `user:<id>` ids among actor texts. */
function userIdsOf(actors: readonly string[]): string[] {
  return [
    ...new Set(
      actors.flatMap((actor) => (actor.startsWith('user:') ? [actor.slice('user:'.length)] : [])),
    ),
  ]
}

/** An actor text (`user:<id>`, `integration:<id>`, `system`) as the tab shows it. */
export function actorView(actor: string, names: ReadonlyMap<string, string>): ActorView {
  if (actor.startsWith('integration:')) return { kind: 'sync' }
  if (actor.startsWith('user:')) {
    return { kind: 'person', name: names.get(actor.slice('user:'.length)) ?? null }
  }
  return { kind: 'system' }
}

async function resolveNames(
  scope: ViewScope,
  deps: ViewDeps,
  actors: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ids = userIdsOf(actors)
  if (ids.length === 0) return new Map()
  try {
    return await (deps.personNames ?? authPersonNames)(scope.tenantId, ids)
  } catch {
    // A name is a nicety: the tab then says "a team member".
    return new Map()
  }
}

/** The venue's menu (its root node's id), or null before it has one. */
export async function menuOfVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<NodeId | null> {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: menus.id }).from(menus).where(eq(menus.venueId, venueId)).limit(1),
  )
  return (row?.id as NodeId | undefined) ?? null
}

const iso = (date: Date | null) => (date === null ? null : date.toISOString())

// --- the draft and its changes -------------------------------------------------------------------

function changesOf(live: MenuSnapshot | null, draft: MenuSnapshot): ChangesView {
  const diff = diffSnapshots(live, draft)
  const named = (item: { id: string; name: NamedItem['name'] }): NamedItem => ({
    id: item.id,
    name: item.name,
  })
  return {
    total: diff.total,
    identical: live !== null && live.snapshot.hash === draft.snapshot.hash,
    added: diff.added.map(named),
    hidden: diff.hidden.map(named),
    priceChanged: diff.priceChanged.map((item) => ({
      ...named(item),
      from: item.from,
      to: item.to,
    })),
    renamed: diff.renamed.map((item) => ({ id: item.id, from: item.from, to: item.to })),
    otherChanged: diff.otherChanged.map(named),
    areas: diff.areas,
  }
}

type DraftOutcome =
  | { readonly kind: 'built'; readonly draft: Draft }
  | { readonly kind: 'refused'; readonly view: DraftView }

async function buildDraft(scope: ViewScope, menuId: NodeId, deps: ViewDeps): Promise<DraftOutcome> {
  try {
    const draft = await loadDraft(
      scope.pool,
      scope.tenantId,
      { menuId, venueId: scope.venue.id },
      deps.now === undefined ? {} : { now: deps.now },
    )
    return { kind: 'built', draft }
  } catch (error) {
    if (error instanceof PublishError) {
      if (error.code === 'no_visible_items') {
        return { kind: 'refused', view: { state: 'nothing_visible' } }
      }
      if (error.code === 'menu_blocked') return { kind: 'refused', view: { state: 'blocked' } }
    }
    return { kind: 'refused', view: { state: 'unavailable' } }
  }
}

// --- the held publish ----------------------------------------------------------------------------

const { body: _body, ...WITHOUT_BODY } = getTableColumns(snapshots)

/** The snapshots V11 is holding for a person, newest first. */
export async function loadHeldRows(
  pool: DbPool,
  tenantId: string,
  target: { readonly menuId: string; readonly venueId: string },
): Promise<Omit<SnapshotRow, 'body'>[]> {
  return withTenant(pool, tenantId, (tx) =>
    tx
      .select(WITHOUT_BODY)
      .from(snapshots)
      .where(
        and(
          eq(snapshots.menuId, target.menuId),
          eq(snapshots.venueId, target.venueId),
          eq(snapshots.status, 'held'),
        ),
      )
      .orderBy(desc(snapshots.version)),
  )
}

function heldViewOf(
  row: Omit<SnapshotRow, 'body'>,
  live: MenuSnapshot | null,
  draftHash: string | null,
): HeldView | null {
  const reason = row.heldReason
  if (reason === null || reason === undefined) return null
  const items: NamedItem[] = []
  for (const id of reason.hidden_item_ids.slice(0, MAX_HELD_NAMES)) {
    const item =
      live !== null && Object.hasOwn(live.items, id) ? live.items[id as NodeId] : undefined
    if (item !== undefined) items.push({ id, name: item.name })
  }
  return {
    snapshotId: row.id,
    hidden: reason.hidden,
    previouslyVisible: reason.previously_visible,
    percent: percentOf(reason.hidden, reason.previously_visible),
    items,
    at: row.createdAt.toISOString(),
    // Approving compares the held content with the document as it is now.
    outdated: draftHash === null || draftHash !== row.hash,
  }
}

// --- the history ---------------------------------------------------------------------------------

const countsOf = (before: MenuSnapshot, after: MenuSnapshot): VersionCounts => {
  const diff = diffSnapshots(before, after)
  return {
    total: diff.total,
    added: diff.added.length,
    hidden: diff.hidden.length,
    priceChanged: diff.priceChanged.length,
    renamed: diff.renamed.length,
    otherChanged: diff.otherChanged.length,
    areas: diff.areas.length,
  }
}

/** A published version that has a body (a rollback row has none). */
const hasBody = (row: { status: string; reason: string }) =>
  row.status === 'published' && row.reason !== 'rollback'

/**
 * One page of the history, newest first: every version with who and why, and for the published
 * ones what they changed compared with what guests had just before (a version after a return is
 * compared with the version the menu was returned to).
 */
export async function loadHistoryPage(
  scope: ViewScope,
  menuId: NodeId,
  options: { readonly beforeVersion?: number } = {},
  deps: ViewDeps = {},
): Promise<HistoryPage> {
  const target = { menuId, venueId: scope.venue.id }
  const page = await listSnapshots(scope.pool, scope.tenantId, {
    ...target,
    limit: HISTORY_PAGE_SIZE,
    ...(options.beforeVersion === undefined ? {} : { beforeVersion: options.beforeVersion }),
  })
  const records = page.snapshots

  // What guests had just before each version: the snapshot the pointer named. A published version
  // moves the pointer to itself, a return moves it to the version it went back to, and a held or
  // rejected one does not move it. So a version after a return is compared with the version the
  // menu had been returned to, not with the one that merely has the number before it.
  const oldest = records.at(-1)
  const [earlier] =
    oldest === undefined
      ? []
      : await withTenant(scope.pool, scope.tenantId, (tx) =>
          tx
            .select({ id: snapshots.id, restores: snapshots.restoresSnapshotId })
            .from(snapshots)
            .where(
              and(
                eq(snapshots.menuId, menuId),
                eq(snapshots.venueId, scope.venue.id),
                eq(snapshots.status, 'published'),
                lt(snapshots.version, oldest.version),
              ),
            )
            .orderBy(desc(snapshots.version))
            .limit(1),
        )
  let liveBefore: string | null = earlier ? (earlier.restores ?? earlier.id) : null
  const previousOf = new Map<string, string | null>()
  for (const record of [...records].reverse()) {
    previousOf.set(record.id, liveBefore)
    if (record.status === 'published') liveBefore = record.restoresSnapshotId ?? record.id
  }

  const withBodies = records.filter(hasBody)
  const bodyIds = [
    ...new Set([
      ...withBodies.map((record) => record.id as string),
      ...withBodies.flatMap((record) => {
        const previous = previousOf.get(record.id)
        return previous ? [previous] : []
      }),
    ]),
  ]
  const bodies = new Map<string, MenuSnapshot>()
  if (bodyIds.length > 0) {
    const rows = await withTenant(scope.pool, scope.tenantId, (tx) =>
      tx
        .select({ id: snapshots.id, body: snapshots.body })
        .from(snapshots)
        .where(inArray(snapshots.id, bodyIds)),
    )
    for (const row of rows) {
      try {
        if (row.body !== null) bodies.set(row.id, parseSnapshot(row.body))
      } catch {
        // A body that no longer parses is shown without counts rather than breaking the tab.
      }
    }
  }

  // The version number a return went back to.
  const restoredIds = [
    ...new Set(
      records.flatMap((record) => (record.restoresSnapshotId ? [record.restoresSnapshotId] : [])),
    ),
  ]
  const restoredVersions = new Map<string, number>()
  if (restoredIds.length > 0) {
    const rows = await withTenant(scope.pool, scope.tenantId, (tx) =>
      tx
        .select({ id: snapshots.id, version: snapshots.version })
        .from(snapshots)
        .where(inArray(snapshots.id, restoredIds)),
    )
    for (const row of rows) restoredVersions.set(row.id, row.version)
  }

  const names = await resolveNames(
    scope,
    deps,
    records.map((record) => record.actor),
  )
  const entries = records.map((record): VersionEntry => {
    let counts: VersionCounts | null = null
    let first = false
    if (hasBody(record)) {
      const body = bodies.get(record.id)
      const previousId = previousOf.get(record.id) ?? null
      const previous = previousId === null ? undefined : bodies.get(previousId)
      if (previousId === null) first = true
      else if (body !== undefined && previous !== undefined) counts = countsOf(previous, body)
    }
    const held = record.heldReason
    return {
      id: record.id,
      version: record.version,
      at: record.publishedAt ?? record.createdAt,
      status: record.status,
      reason: record.reason as VersionReason,
      actor: actorView(record.actor, names),
      restoresVersion: record.restoresSnapshotId
        ? (restoredVersions.get(record.restoresSnapshotId) ?? null)
        : null,
      decisionNote: record.decisionNote,
      held: held ? { hidden: held.hidden, previouslyVisible: held.previously_visible } : null,
      counts,
      first,
    }
  })
  return { entries, nextBeforeVersion: page.nextBeforeVersion }
}

// --- the integration's pause, the queue, the last run --------------------------------------------

/** The config of the integration this venue is mapped to; null when it has none. */
async function integrationConfigOf(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<unknown> {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ config: integrations.config })
      .from(barsyVenues)
      .innerJoin(integrations, eq(integrations.id, barsyVenues.integrationId))
      .where(eq(barsyVenues.venueId, venueId))
      .limit(1),
  )
  return row?.config ?? null
}

/**
 * Whether this venue's automatic publishing is paused (T76): its own flag, else the old one of the
 * integration it is mapped to; false when it has no integration.
 */
export async function readPaused(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<boolean> {
  const config = await integrationConfigOf(pool, tenantId, venueId)
  if (config === null) return false
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  return venueAutoPublishPaused(venue?.settings ?? {}, config)
}

/**
 * The venue's publishing rules as they apply now (CF-09b): its own value for each, else the
 * current setting of the integration it is linked to (what ran before the rules moved to the
 * venue), else the defaults.
 */
export async function readPublishRules(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<PublishRulesView> {
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  const settings = venue?.settings ?? {}
  const rules = venuePublishRules(settings, await integrationConfigOf(pool, tenantId, venueId))
  const own = venueOwnPublishRules(settings)
  return {
    afterSync: rules.after_sync,
    newItems: rules.new_items,
    inherited: own.after_sync === null || own.new_items === null,
  }
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  const code = (current as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * A manual publish or a files job of this menu that is queued or running, from pg-boss's job table
 * (the worker owns it). Automatic publishes waiting out their delay are not the person's business.
 * A job table that is not there (the worker has never started against this database) means nothing
 * is waiting.
 */
export async function readBusy(pool: DbPool, tenantId: string, menuId: string): Promise<BusyView> {
  try {
    const result = await withTenant(pool, tenantId, (tx) =>
      tx.execute(
        sql`select name, data ->> 'reason' as reason from pgboss.job
            where name in (${JOB_NAMES.publishMenu}, ${JOB_NAMES.publishFiles})
              and state::text in ('created', 'retry', 'active')
              and data ->> 'tenantId' = ${tenantId}
              and data ->> 'menuId' = ${menuId}
            limit 20`,
      ),
    )
    const rows = result.rows as { name: string; reason: string | null }[]
    if (rows.some((row) => row.name === JOB_NAMES.publishMenu && row.reason === 'manual')) {
      return 'publish'
    }
    return rows.some((row) => row.name === JOB_NAMES.publishFiles) ? 'files' : null
  } catch (error) {
    // 42P01 undefined_table, 3F000 invalid_schema_name, 42501 insufficient_privilege.
    const code = pgCode(error)
    if (code === '42P01' || code === '3F000' || code === '42501') return null
    throw error
  }
}

/** The latest `publish_menu` run of the organisation (runs carry no venue: one venue per tenant for now). */
export async function readLastRun(pool: DbPool, tenantId: string) {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.kind, 'publish_menu'))
      .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
      .limit(1),
  )
  return row === undefined ? null : toPublishRunView(row)
}

// --- the view ------------------------------------------------------------------------------------

async function liveViewOf(
  scope: ViewScope,
  deps: ViewDeps,
  menuId: NodeId,
  current: NonNullable<Awaited<ReturnType<typeof loadCurrentSnapshot>>>,
): Promise<LiveView> {
  // Someone returned to this version later: the newest return row that names it.
  const [returned] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ actor: snapshots.actor, at: snapshots.publishedAt, createdAt: snapshots.createdAt })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.menuId, menuId),
          eq(snapshots.venueId, scope.venue.id),
          eq(snapshots.restoresSnapshotId, current.id),
        ),
      )
      .orderBy(desc(snapshots.version))
      .limit(1),
  )
  const names = await resolveNames(scope, deps, [
    current.actor,
    ...(returned ? [returned.actor] : []),
  ])
  return {
    version: current.version,
    publishedAt: current.publishedAt,
    reason: current.reason === 'auto_sync' ? 'auto_sync' : 'manual',
    actor: actorView(current.actor, names),
    returned: returned
      ? {
          at: iso(returned.at) ?? returned.createdAt.toISOString(),
          actor: actorView(returned.actor, names),
        }
      : null,
  }
}

/** Everything the Publish tab shows. */
export async function loadPublishView(scope: ViewScope, deps: ViewDeps = {}): Promise<PublishView> {
  const base = {
    venueId: scope.venue.id,
    venueSlug: scope.venue.slug,
    venuePublicId: scope.venue.publicId,
    timeZone: scope.venue.timezone,
    canPublish: scope.canPublish,
  }
  const menuId = await menuOfVenue(scope.pool, scope.tenantId, scope.venue.id)
  const rules = await readPublishRules(scope.pool, scope.tenantId, scope.venue.id)
  if (menuId === null) {
    return {
      ...base,
      menu: 'none',
      live: null,
      draft: { state: 'unavailable' },
      held: null,
      paused: false,
      addressServed: true,
      rules,
      history: { entries: [], nextBeforeVersion: null },
      busy: null,
      lastRun: null,
    }
  }
  const target = { menuId, venueId: scope.venue.id }
  const current = await loadCurrentSnapshot(scope.pool, scope.tenantId, target)
  const [outcome, heldRows, history, paused, busy, lastRun, live, addressServed] =
    await Promise.all([
      buildDraft(scope, menuId, deps),
      loadHeldRows(scope.pool, scope.tenantId, target),
      loadHistoryPage(scope, menuId, {}, deps),
      readPaused(scope.pool, scope.tenantId, scope.venue.id),
      readBusy(scope.pool, scope.tenantId, menuId),
      readLastRun(scope.pool, scope.tenantId),
      current === null ? Promise.resolve(null) : liveViewOf(scope, deps, menuId, current),
      // Nothing published, nothing to serve.
      current === null
        ? Promise.resolve(true)
        : (deps.addressServed ?? venueIndexServed)(scope.venue),
    ])

  const draftHash = outcome.kind === 'built' ? outcome.draft.snapshot.snapshot.hash : null
  const draft: DraftView =
    outcome.kind === 'built'
      ? {
          state: 'ready',
          changes: changesOf(current?.body ?? null, outcome.draft.snapshot),
          staleOverrides: outcome.draft.staleOverrides.map((stale) => ({
            nodeId: stale.nodeId,
            fieldKey: stale.fieldKey,
            name: stale.name,
            isItem: stale.isItem,
          })),
          currency: outcome.draft.snapshot.currency,
        }
      : outcome.view

  const newestHeld = heldRows[0]
  return {
    ...base,
    menu: 'ready',
    live,
    draft,
    held: newestHeld ? heldViewOf(newestHeld, current?.body ?? null, draftHash) : null,
    paused,
    addressServed,
    rules,
    history,
    busy,
    lastRun,
  }
}
