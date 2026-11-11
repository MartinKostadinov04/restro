// The demo club in the database, up to the moment the doors open: the venue on its simulated POS,
// its menu, Restro's own enrichment over it, the floor and its Tables with codes, the ported paper
// plan, the design, the settings, the guest features and the published snapshot. The night itself
// (people, open tables, bills, rounds, bookings) is `seed-demo-night.ts`.
//
// Every write goes through the one path for its kind of data (rule 1): the menu through
// `apply()`, the floor through `applyFloor` under a job run as the worker's `floor_read` writes
// it, and everything on the service side — the plan, its spots, the venue's spot kinds, the
// settings — through `applyService` as the owner's own screens send it (`runSettingsCommand`).
// There is no SQL here and no owner role: `apps/web/e2e/reservations-state.ts` writes raw rows as
// the owner, and that is an e2e fixture's licence, not a pattern.
//
// Safe to repeat. The venue, the instance, the menu and the plan are found before they are made;
// the spots are found by name and saved again, so a second run moves them rather than being
// refused the name; the Tables come from the floor reading, which collapses onto what is there.
import { createPublishStore, publishStoreConfig } from '@restro/assets'
import {
  CALL_WAITER_KINDS,
  type ChangeSet,
  type ChangeSetOp,
  type IntegrationId,
  type LocalizedText,
  menuPath,
  type NodeId,
  newId,
  OWNER_TICKS,
  readDesign,
  type VenueId,
} from '@restro/core'
import {
  appendSourceRecords,
  apply,
  applyFloor,
  createIntegration,
  finishJobRun,
  issueAllTableTokens,
  listVenueTables,
  mapBarsyVenue,
  provisionMenu,
  provisionVenue,
  publishMenu,
  setFloorSource,
  setGuestFeatures,
  startJobRun,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { type DbPool, floorPlans, integrations, sourceLinks, venues, withTenant } from '@restro/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { writeLiveOverlay, writePublishFiles } from '../../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../../worker/src/publish/organization-index'
import { writeTableTokenFiles } from '../../../worker/src/publish/table-tokens'
import { setItemHiddenOps } from '../../src/composer/ops'
import { valuesOfStyle } from '../../src/design/design-draft'
import { readSeededReservations, runWorkerCommand } from '../../src/server/seed/service'
import { runSettingsCommand } from '../../src/server/settings/command'
import { CLUB_BIAD_KINDS, type ClubBiadSpot, clubBiadFloor } from './club-biad-plan'
import {
  demoBarPullChangeSet,
  demoBarSourceRecords,
  loadDemoBarScenario,
  recordKey,
} from './demo-bar'
import {
  clubFloorReading,
  DEMO_ALLERGENS,
  DEMO_BID,
  DEMO_CAPABILITIES,
  DEMO_DESCRIPTIONS,
  DEMO_HIDDEN_ARTICLE,
  DEMO_INSTANCE_NAME,
  DEMO_LEGAL,
  DEMO_PAY_ACCOUNT,
  DEMO_PAY_PROVIDER,
  DEMO_PLAN_NAME,
  DEMO_SCENARIO,
  DEMO_TURN_MINUTES,
  DEMO_VENUE,
  DEMO_VENUE_SPOT,
  DEMO_WEEK,
  demoGuestHost,
  demoSimHost,
  loadDemoClubFloor,
} from './demo-club'

/** What the club's half of the seed leaves behind, for the night's half and the printed summary. */
export interface SeededDemoClub {
  readonly venueId: VenueId
  readonly integrationId: IntegrationId
  readonly menuId: NodeId
  readonly planId: string
  readonly venuePublicId: string
  /** The guest page's path, `/m/<organisation>/<venue>`. */
  readonly path: string
  readonly sections: number
  readonly articles: number
  readonly spots: number
  readonly tables: number
  readonly areas: readonly string[]
  /** The code hash of each Table that takes orders, by the Table's number. */
  readonly codeHashes: ReadonlyMap<string, string>
  /** The `tb_` id of each Table, by its number. */
  readonly tableIds: ReadonlyMap<string, string>
  /** Our item node id, by the POS's article id: what the night's rounds order. */
  readonly itemsByArticle: ReadonlyMap<string, NodeId>
  /** Our option node id, by `<article>:<group>:<option>` (`demo-bar.ts`'s `optionKey`). */
  readonly optionsByKey: ReadonlyMap<string, NodeId>
  /** The `sp_` id of each spot of the plan, by its name. */
  readonly spotIds: ReadonlyMap<string, string>
  /** How many Tables were given a code on this run. */
  readonly codesIssued: number
}

/** The owner whose screens the settings commands run as. */
export interface DemoClubOwner {
  readonly userId: string
  readonly organizationSlug: string
}

type Scope = Parameters<typeof runSettingsCommand>[0]

/** The venue, found by its slug or provisioned. */
async function venueOf(pool: DbPool, tenantId: string): Promise<VenueId> {
  const [found] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, DEMO_VENUE.slug)).limit(1),
  )
  if (found !== undefined) return found.id as VenueId
  const made = await provisionVenue(pool, tenantId, DEMO_VENUE)
  return made.id as VenueId
}

/** The simulated instance, found by its name or created, pointed at the local simulator. */
async function instanceOf(pool: DbPool, tenantId: string): Promise<IntegrationId> {
  const [found] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.kind, 'sim'),
          eq(integrations.name, DEMO_INSTANCE_NAME),
          isNull(integrations.removedAt),
        ),
      )
      .limit(1),
  )
  const id =
    found?.id ??
    (
      await createIntegration(pool, tenantId, {
        kind: 'sim',
        name: DEMO_INSTANCE_NAME,
        host: demoSimHost(),
      })
    ).id
  await updateIntegration(pool, tenantId, id, {
    host: demoSimHost(),
    config: { sim_scenario: DEMO_SCENARIO },
    status: 'connected',
  })
  return id as IntegrationId
}

/**
 * The POS's catalogue as the menu, written the way a pull writes it: one source record per thing
 * the POS has, then one till-source change set. Answers our item node id per article, read back
 * from the document's links so a second run finds the nodes that are already there.
 */
async function seedMenu(
  pool: DbPool,
  tenantId: string,
  venueId: VenueId,
  integrationId: IntegrationId,
  menuId: NodeId,
): Promise<{
  sections: number
  articles: number
  itemsByArticle: Map<string, NodeId>
  optionsByKey: Map<string, NodeId>
}> {
  const scenario = loadDemoBarScenario(DEMO_SCENARIO)
  const records = new Map<string, string>()
  for (const record of demoBarSourceRecords(scenario)) {
    const [stored] = await appendSourceRecords(pool, tenantId, integrationId, [
      {
        externalType: record.externalType,
        externalId: record.externalId,
        scope: 'master',
        raw: record.raw,
        payload: record.payload,
      },
    ])
    if (!stored) throw new Error('a source record of the club menu was not stored')
    records.set(recordKey(record.externalType, record.externalId), stored.id)
  }
  const set = demoBarPullChangeSet({ scenario, integrationId, venueId, menuId, records })
  const pull = await apply(pool, tenantId, set)
  if (pull.rejected.length > 0) {
    throw new Error(`the club menu was refused: ${pull.rejected.map((one) => one.code).join(', ')}`)
  }
  // The change set links every node it creates, so its own ops say which node is which article.
  // On a repeat the ids it generated are dropped and the links keep pointing at the nodes that
  // exist, so the map is read back from the links rather than from the ops.
  const wantedOf = (type: string): Set<string> => {
    const wanted = new Set<string>()
    for (const op of set.ops) {
      if (op.op === 'linkSource' && op.link.externalType === type) wanted.add(op.link.externalId)
    }
    return wanted
  }
  return {
    sections: scenario.sections.length,
    articles: scenario.sections.reduce((sum, section) => sum + section.items.length, 0),
    itemsByArticle: await linkedNodes(
      pool,
      tenantId,
      integrationId,
      'article',
      wantedOf('article'),
    ),
    optionsByKey: await linkedNodes(pool, tenantId, integrationId, 'option', wantedOf('option')),
  }
}

/**
 * Our node id per external id of one kind, read from the links. A read, not a write:
 * `source_links` is the one place that holds the POS's ids (rule 3), and nothing outside the
 * backend ever sees this map — the night's commands name our own `nd_` ids.
 */
async function linkedNodes(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  externalType: string,
  externalIds: ReadonlySet<string>,
): Promise<Map<string, NodeId>> {
  const found = new Map<string, NodeId>()
  if (externalIds.size === 0) return found
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
      .from(sourceLinks)
      .where(
        and(
          eq(sourceLinks.integrationId, integrationId),
          eq(sourceLinks.externalType, externalType),
          inArray(sourceLinks.externalId, [...externalIds]),
        ),
      ),
  )
  for (const row of rows) found.set(row.externalId, row.nodeId as NodeId)
  return found
}

/**
 * What Restro's own layers add over the POS's menu: allergens and a line of description where one
 * helps, and the cover charge hidden from the phones. A manual change set, so it names nodes by
 * their ids (the till source names them by their links); its layer is `manual`, which is only ever
 * more cautious than the POS (rule 5: `visible: false` hides, and nothing here touches a price or
 * puts anything back on sale).
 */
async function enrich(
  pool: DbPool,
  tenantId: string,
  venueId: VenueId,
  items: ReadonlyMap<string, NodeId>,
): Promise<number> {
  const ops: ChangeSetOp[] = []
  // `manual` at master scope: Restro's own layer over the POS's text, the one the composer writes.
  // Only a till value is venue-scoped (`change-set.ts`), and the club has one menu.
  const field = (id: NodeId, fieldKey: string, value: unknown): ChangeSetOp => ({
    op: 'setField',
    node: { id },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value: value as never,
  })
  for (const [article, allergens] of DEMO_ALLERGENS) {
    const id = items.get(article)
    if (id !== undefined) ops.push(field(id, 'allergens', [...allergens]))
  }
  for (const [article, text] of DEMO_DESCRIPTIONS) {
    const id = items.get(article)
    if (id !== undefined) ops.push(field(id, 'description', text satisfies LocalizedText))
  }
  // The hidden item, hidden the way the composer's own button hides one (rule 5: hiding is the
  // cautious direction, and our layers may only go that way).
  const hidden = items.get(DEMO_HIDDEN_ARTICLE)
  if (hidden !== undefined)
    ops.push(...setItemHiddenOps({ itemId: hidden, hidden: true, status: 'active' }))
  if (ops.length === 0) return 0
  const applied = await apply(pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops,
  } as ChangeSet)
  if (applied.rejected.length > 0) {
    throw new Error(
      `the club's own menu layer was refused: ${JSON.stringify(applied.rejected.slice(0, 3))}`,
    )
  }
  return ops.length
}

/**
 * The POS's floor, written as the worker's `floor_read` job writes it: Restro's Tables and areas
 * come from the POS and nowhere else (D89), and the instance's capabilities are recorded with it.
 */
async function seedFloor(
  pool: DbPool,
  tenantId: string,
  venueId: VenueId,
  integrationId: IntegrationId,
): Promise<void> {
  const floor = loadDemoClubFloor()
  await setFloorSource(pool, tenantId, {
    venueId,
    source: {
      halls: null,
      bars: null,
      paymentTables: floor.tables.filter((one) => one.payment).map((one) => one.number),
    },
  })
  const run = await startJobRun(pool, tenantId, { kind: 'floor_read', integrationId, venueId })
  const applied = await applyFloor(pool, tenantId, {
    integrationId,
    bid: DEMO_BID,
    jobId: run.id,
    reading: { complete: true, value: clubFloorReading(floor) },
    capabilities: DEMO_CAPABILITIES,
  })
  await finishJobRun(pool, tenantId, run.id, { status: 'completed', venueId })
  if (applied.kind !== 'applied') {
    throw new Error(`the club's floor was not written: ${applied.kind}`)
  }
}

/** The ported paper plan: the venue's spot kinds, the plan, and a spot per place on the floor. */
async function seedPlan(
  scope: Scope,
  tables: ReadonlyMap<string, string>,
): Promise<{ planId: string; spots: number; spotIds: Map<string, string> }> {
  const { kinds, spots } = clubBiadFloor()
  for (const kind of kinds) {
    const saved = await runSettingsCommand(
      scope,
      {
        type: 'spot_kind.save',
        key: kind.key,
        label: kind.label,
        symbol: kind.symbol,
        filters: kind.filters,
        defaultSeats: kind.defaultSeats,
        sortKey: kind.sortKey,
      },
      { own: true },
    )
    if (!saved.ok) throw new Error(`the spot kind ${kind.key} was refused: ${saved.error}`)
  }

  const [existingPlan] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ id: floorPlans.id })
      .from(floorPlans)
      .where(
        and(
          eq(floorPlans.venueId, scope.venueId),
          eq(floorPlans.name, DEMO_PLAN_NAME),
          isNull(floorPlans.removedAt),
        ),
      )
      .limit(1),
  )
  const plan = await runSettingsCommand(
    scope,
    {
      type: 'plan.save',
      ...(existingPlan === undefined ? {} : { planId: existingPlan.id }),
      name: DEMO_PLAN_NAME,
      makeCurrent: true,
    },
    { own: true },
  )
  if (!plan.ok) throw new Error(`the club's plan was refused: ${plan.error}`)
  const planId = plan.details.planId
  if (typeof planId !== 'string') throw new Error('the plan was saved without an id')

  // The spots already on the floor, by name: a second run saves each one again by its id, so a
  // name that is taken is taken by the spot being moved.
  const before = await readSeededReservations(scope)
  const byName = new Map(before.spots.map((one) => [one.name, one.id]))
  for (const spot of spots) {
    const saved = await runSettingsCommand(scope, spotCommand(spot, planId, byName, tables), {
      own: true,
    })
    if (!saved.ok) throw new Error(`the spot "${spot.name}" was refused: ${saved.error}`)
  }
  const after = await readSeededReservations(scope)
  return {
    planId,
    spots: spots.length,
    spotIds: new Map(after.spots.map((one) => [one.name, one.id])),
  }
}

/** One `spot.save`: the ported place, its kind, and the Table its orders go onto where it has one. */
function spotCommand(
  spot: ClubBiadSpot,
  planId: string,
  byName: ReadonlyMap<string, string>,
  tables: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const existing = byName.get(spot.name)
  const tableId = spot.takesOrders ? tables.get(spot.name) : undefined
  return {
    type: 'spot.save',
    ...(existing === undefined ? {} : { spotId: existing }),
    planId,
    name: spot.name,
    kind: spot.kind,
    shape: spot.shape,
    x: spot.x,
    y: spot.y,
    width: spot.width,
    height: spot.height,
    // The prototype states no capacities, so a spot takes its kind's default and says nothing of
    // its own; the two places it does state a number are the ones that carry `seats`.
    ...(spot.seats === null ? {} : { seats: spot.seats }),
    ...(tableId === undefined ? {} : { tableId }),
  }
}

/** The venue draws the Club Style: the Style's own values, saved as the Studio saves a design. */
async function seedDesign(pool: DbPool, tenantId: string, venueId: VenueId): Promise<void> {
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  if (venue === undefined) throw new Error('the demo club went missing before its design')
  // Club, picked the way the Studio picks it: a Style carries every option but the venue's own
  // body font, colours, roles and logo (D128), so `valuesOfStyle` fills it in over what is there.
  const current = readDesign(venue.settings)
  const values = valuesOfStyle('club', current.design.values)
  if (values === null) throw new Error('the shell has no Club Style to draw')
  const applied = await apply(pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops: [
      {
        op: 'setDesign',
        venueId,
        expectedRevision: current.revision,
        design: { style: 'club', values, logo_asset_id: null },
      },
    ],
  } as ChangeSet)
  if (applied.rejected.length > 0) {
    throw new Error(`the club's design was refused: ${JSON.stringify(applied.rejected)}`)
  }
}

/** The venue's settings, in the order the gates need them. */
async function seedSettings(scope: Scope): Promise<void> {
  // The legal details first: ordering from phones turns on only once the venue has a privacy
  // notice link on file (RR-O44), and paying needs the details too (#198).
  const legal = await runSettingsCommand(
    scope,
    {
      type: 'settings.paying_set',
      changes: { legalDetails: { ...DEMO_LEGAL } },
      providerMinMinor: 0,
    },
    { own: true },
  )
  if (!legal.ok) throw new Error(`the club's legal details were refused: ${legal.error}`)

  // The night's hours and the venue's spot on the map. The location check is left off, so the
  // walk can order from a desk; one tap in Settings → Ordering turns it on.
  const ordering = await runSettingsCommand(
    scope,
    {
      type: 'settings.ordering_set',
      changes: { serviceHours: DEMO_WEEK, spot: { ...DEMO_VENUE_SPOT }, locationCheck: false },
    },
    { own: true },
  )
  if (!ordering.ok) throw new Error(`the club's ordering settings were refused: ${ordering.error}`)

  // The reservation rules. The turn time is the one setting a venue must have before any booking
  // can be taken (D135: no invented default), so nothing in the night works without this.
  const rules = await runSettingsCommand(
    scope,
    {
      type: 'reservation_settings.set',
      turnMinutes: DEMO_TURN_MINUTES,
      editPastNights: false,
      privateNotesOn: true,
      phoneRequired: true,
    },
    { own: true },
  )
  if (!rules.ok) throw new Error(`the club's reservation rules were refused: ${rules.error}`)
}

/**
 * The venue's payment account with the simulated provider, through the four commands the real
 * thing uses (D125 2.2, 2.3): the owner presses Connect, the worker records what the provider
 * answered when the owner came back from its hosted form, and the owner ticks the two checks the
 * platform cannot read. Nothing here writes `payment_accounts` itself; the e2e harness's raw SQL
 * is an e2e-only exception, not a pattern. Card payments then only wait on the venue's payment
 * tables and legal details, which `seedSettings` and the POS floor already put in place.
 */
async function seedPaying(scope: Scope, integrationId: string): Promise<void> {
  const worker = { pool: scope.pool, tenantId: scope.tenantId, venueId: scope.venueId }
  const connected = await runSettingsCommand(
    scope,
    { type: 'payment_account.connect', providerKind: DEMO_PAY_PROVIDER },
    { own: true },
  )
  // `connected` is what a venue that already takes card payments answers: a second run is not a
  // failure, and the two commands below then only confirm what is already recorded.
  if (!connected.ok && connected.error !== 'already_connected') {
    throw new Error(`the club's payment account was refused: ${connected.error}`)
  }
  const started = await runWorkerCommand(
    worker,
    {
      type: 'payment_account.started',
      accountRef: DEMO_PAY_ACCOUNT,
      guestHost: demoGuestHost(),
    },
    { integrationId },
  )
  if (!started.ok) throw new Error(`the provider's account was refused: ${started.error}`)
  const observed = await runWorkerCommand(
    worker,
    {
      type: 'payment_account.observed',
      accountRef: DEMO_PAY_ACCOUNT,
      canTakePayments: true,
      missing: [],
      afterReturn: true,
      guestHost: demoGuestHost(),
      displayName: DEMO_LEGAL.name,
    },
    { integrationId },
  )
  if (!observed.ok) throw new Error(`the provider's reading was refused: ${observed.error}`)
  for (const check of OWNER_TICKS) {
    const ticked = await runSettingsCommand(
      scope,
      { type: 'payment_account.tick', check, done: true },
      { own: true },
    )
    if (!ticked.ok) throw new Error(`the owner's "${check}" tick was refused: ${ticked.error}`)
  }
}

/** Builds the demo club, up to the published snapshot. */
export async function seedDemoClub(
  pool: DbPool,
  tenantId: string,
  owner: DemoClubOwner,
): Promise<SeededDemoClub> {
  const sealKey = process.env.SEAL_PUBLIC_KEY?.trim()
  if (!sealKey) {
    throw new Error('the demo seed needs SEAL_PUBLIC_KEY (pnpm keys:seal --write-env .env.local).')
  }

  const venueId = await venueOf(pool, tenantId)
  const integrationId = await instanceOf(pool, tenantId)
  const menu = await provisionMenu(pool, tenantId, venueId)

  // The till venue the club serves, then the POS's floor and its catalogue.
  await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: DEMO_BID, name: DEMO_VENUE.name }])
  const mapped = await mapBarsyVenue(pool, tenantId, integrationId, DEMO_BID, venueId)
  if (!mapped.ok) throw new Error(`the club could not be linked to its till venue: ${mapped.error}`)
  await seedFloor(pool, tenantId, venueId, integrationId)
  const menuCounts = await seedMenu(pool, tenantId, venueId, integrationId, menu.id)
  await enrich(pool, tenantId, venueId, menuCounts.itemsByArticle)

  // A code for every Table that takes orders, and the files the guest page reads them from.
  const issued = await issueAllTableTokens(pool, tenantId, venueId, sealKey)
  if (!('ok' in issued) || !issued.ok) {
    throw new Error(`the club's table codes were refused: ${JSON.stringify(issued)}`)
  }
  const tables = await listVenueTables(pool, tenantId, venueId)
  const tableIds = new Map<string, string>()
  const codeHashes = new Map<string, string>()
  for (const table of tables) {
    // A Table with no number is one the POS gave none: it is neither a spot nor a QR code here.
    if (table.number === null) continue
    tableIds.set(table.number, table.id)
    if (table.codeHash !== null) codeHashes.set(table.number, table.codeHash)
  }

  const scope: Scope = {
    pool,
    tenantId,
    venueId,
    userId: owner.userId,
    sessionId: 'seed-demo',
    signedInAt: new Date(),
    operator: false,
  }
  await seedSettings(scope)
  await seedPaying(scope, integrationId)
  const plan = await seedPlan(scope, tableIds)
  await seedDesign(pool, tenantId, venueId)
  await setGuestFeatures(pool, tenantId, {
    venueId,
    features: {
      filters: true,
      call_waiter: { enabled: true, kinds: [...CALL_WAITER_KINDS] },
      bill: true,
      ordering: true,
      pay: true,
    },
  })

  // The snapshot and its files, as the publish job writes them.
  const published = await publishMenu(pool, tenantId, {
    menuId: menu.id,
    venueId,
    reason: 'manual',
    actor: 'system',
  })
  if (published.status === 'held') {
    throw new Error('the club menu was held, not published: check the composer for data issues')
  }
  const store = await createPublishStore(publishStoreConfig(process.env))
  const deps = { pool, store, now: () => new Date() }
  await writePublishFiles(deps, { tenantId, menuId: menu.id, venueId })
  await writeLiveOverlay(deps, { tenantId, menuId: menu.id, venueId })
  await writeOrganizationIndex(deps, tenantId)
  await writeTableTokenFiles({ pool, store }, { tenantId, venueId, retired: [] })

  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ publicId: venues.publicId }).from(venues).where(eq(venues.id, venueId)),
  )
  if (venue === undefined) throw new Error('the demo club went missing')
  return {
    venueId,
    integrationId,
    menuId: menu.id,
    planId: plan.planId,
    venuePublicId: venue.publicId,
    path: menuPath({ slug: DEMO_VENUE.slug, publicId: venue.publicId }),
    sections: menuCounts.sections,
    articles: menuCounts.articles,
    spots: plan.spots,
    tables: tables.length,
    areas: [...new Set(clubBiadFloor().areas)],
    codeHashes,
    tableIds,
    itemsByArticle: menuCounts.itemsByArticle,
    optionsByKey: menuCounts.optionsByKey,
    spotIds: plan.spotIds,
    codesIssued: issued.issued,
  }
}

/** The kinds the club's plan uses, for the printed summary. */
export const DEMO_KIND_COUNT = CLUB_BIAD_KINDS.length
