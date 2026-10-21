// The first sync after CF-16 (brief CF-16): the demo venue's existing data — its links, sections,
// items, placements, values and published snapshot — is the same after one full pull of today's
// sync.
//
// The database holds what the pull before CF-16 wrote for the one demo venue: the demo
// recordings read through the real reader, mapped with every section key plain (that mapping is
// pinned against the one of b4ecbe1 in packages/barsy/src/mapping/venues.test.ts), applied
// through the same `apply()` with the seen marks and the records' hashes, then published. The
// link table holds what migration 0016 leaves (the catalogue, the price per venue; its backfill
// is pinned in packages/db/tests/venue-catalogue-migration.test.ts). Then one full pull of the
// new sync runs through its real job handler, against the same recordings.
import { randomUUID } from 'node:crypto'

import {
  type Article,
  BARSY_MAPPING_VERSION,
  createBarsyClient,
  createBarsyReader,
  mapCatalogue,
  mapModificators,
} from '@restro/barsy'
import {
  type ChangeSetOp,
  canonicalJson,
  type IntegrationId,
  JOB_NAMES,
  type NodeId,
  newId,
  tillSource,
  type VenueId,
} from '@restro/core'
import {
  appendSourceRecords,
  createIntegration,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  updateIntegration,
} from '@restro/core/apply'
import { parseSealPublicKey, sealBarsyCredentials } from '@restro/core/seal'
import { generateSealKeyPair, parseSealPrivateKey } from '@restro/core/seal-open'
import { createPool, type DbPool } from '@restro/db'
import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { BarsyPolicy, SealKeys } from '../src/config'
import { WorkerStatus } from '../src/health'
import { createBarsyJobs } from '../src/jobs/barsy'
import type { WorkerContext } from '../src/jobs/types'
import { createLogger } from '../src/logger'
import { applyMapped, applyOps, emptyTotals } from '../src/sync/apply-chunks'
import type { SyncEnvironment } from '../src/sync/context'
import { LimiterRegistry } from '../src/sync/limiter'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'
import { createFakeBarsy } from './fake-barsy'

type Row = Record<string, unknown>

const DEMO_BID = 10
const DEMO_ROOT = 1091
const POLICY: BarsyPolicy = {
  env: 'test',
  allowedHostSuffixes: ['.barsyonline.com'],
  productionHosts: ['live-club.barsyonline.com'],
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** Rows sorted in JavaScript by a key (never by SQL `order by`: CLAUDE.md). */
const sorted = (rows: Row[], key: (row: Row) => string) =>
  [...rows].sort((a, b) => compareText(key(a), key(b)))

/** Gives every category of the tree a public title, so that sections and items publish. */
function titleAll(node: Row): void {
  const category = node.category as Row
  if (category.cat_id !== null) {
    const title = `Раздел ${String(category.cat_id)}`
    category.cat_name_public = title
    category.cat_name_public_ml = { bg_BG: title, en_US: `Section ${String(category.cat_id)}` }
  }
  for (const child of node.categories as Row[]) titleAll(child)
}

allowSlowSetup()

describe.skipIf(!hasDatabase)('migration 0016 and the first sync after it (CF-16)', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let pool: DbPool
  let keys: SealKeys
  const tenantId = newId('tn')
  const integrationId = newId('in')
  let venueId: string
  let menuId: string
  const clock = { now: new Date('2026-10-11T08:00:00Z') }

  const query = <T extends Row = Row>(sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows as T[])

  /** What must not change: every link, node, placement and value of the tenant. */
  const state = async () => ({
    // The one link the new sync adds is the menu's own, to the root it mirrors (D88): it ties the
    // menu the picker filled to the till tree and changes nothing in the menu itself.
    links: sorted(
      await query(
        `select external_type, external_id, node_id, state, state_changed_at, first_seen_at, last_hash
         from restro.source_links where tenant_id = $1 and external_type <> 'menu_root'`,
        [tenantId],
      ),
      (row) => `${row.external_type}:${row.external_id}`,
    ),
    // The menu's root node is left out: its new `menu_root` link bumps its revision (and only that).
    nodes: sorted(
      await query(
        `select id, node_type, parent_id, sort_key, status, revision, updated_at
         from restro.nodes where tenant_id = $1 and node_type <> 'menu'`,
        [tenantId],
      ),
      (row) => String(row.id),
    ),
    placements: sorted(
      await query(
        'select section_id, item_id, sort_key, updated_at from restro.placements where tenant_id = $1',
        [tenantId],
      ),
      (row) => `${row.section_id}:${row.item_id}`,
    ),
    values: sorted(
      await query(
        `select node_id, field_key, layer, scope, value, value_hash, source, job_id,
                source_record_id, valid, updated_at
         from restro.field_values where tenant_id = $1`,
        [tenantId],
      ),
      (row) => `${row.node_id}|${row.field_key}|${row.layer}|${row.scope}`,
    ),
  })

  let before: Awaited<ReturnType<typeof state>>
  let firstHash: string

  beforeAll(async () => {
    fake.listen()
    // One root only, as the venue was mapped before D88: without a public menu, the pull adopts
    // the venue's one menu for the till tree, and nothing is created.
    fake.venues = fake.venues.map((venue) =>
      (venue as { barsy_id?: unknown }).barsy_id === DEMO_BID
        ? { ...(venue as Record<string, unknown>), public_cat_id: null }
        : venue,
    )
    titleAll(fake.tree as Row)
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-0016-test', max: 2 })
    const pair = generateSealKeyPair()
    keys = {
      publicKey: parseSealPublicKey(pair.publicKey),
      privateKey: parseSealPrivateKey(pair.privateKey),
    }

    // The tenant, the demo venue and its integration, as before CF-16 (price: current_price).
    await provisionTenant(pool, { tenantId, name: 'Demo club' })
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Demo club',
      slug: testSlug('demo-club'),
    })
    venueId = venue.id
    menuId = (await provisionMenu(pool, tenantId, venueId)).rootNodeId
    await createIntegration(pool, tenantId, {
      kind: 'barsy',
      host: fake.host,
      id: integrationId,
      credentialsSealed: sealBarsyCredentials(
        { user: 'demo', password: fake.password },
        { tenantId, integrationId, host: fake.host, publicKey: pair.publicKey },
      ),
    })
    await updateIntegration(pool, tenantId, integrationId, {
      status: 'connected',
      config: { price_source: 'current_price' },
    })
    // The link table as 0016 leaves it: the catalogue and the price per venue backfilled.
    await query(
      `insert into restro.barsy_venues
         (tenant_id, integration_id, bid, name, venue_id, catalogue_root_cat_id, catalogue_id, price_source)
       values ($1, $2, $3, 'Bar & Dinner', $4, $5, 1, 'current_price'),
              ($1, $2, 102, 'Burgers', null, null, 72, 'current_price')`,
      [tenantId, integrationId, DEMO_BID, venueId, DEMO_ROOT],
    )
    // What the connection check stored about the venues (tier 1), as it did before CF-16.
    await appendSourceRecords(
      pool,
      tenantId,
      integrationId,
      fake.venues.map((venue) => {
        const raw = canonicalJson(venue)
        return {
          externalType: 'barsy_venue',
          externalId: String(venue.barsy_id),
          scope: 'master' as const,
          raw,
          payload: JSON.parse(raw) as unknown,
        }
      }),
    )

    // The full pull before CF-16, for the one venue: read through the real reader.
    const client = createBarsyClient({
      host: fake.host,
      user: 'demo',
      password: fake.password,
      env: 'test',
      allowedHosts: [fake.host],
    })
    const reader = createBarsyReader(client)
    const tree = (await reader.getCategoryTree(DEMO_BID)).data
    const articles: Article[] = (
      await reader.getArticlesPage(DEMO_BID, { rootCatId: DEMO_ROOT, offset: 0, length: 500 })
    ).data
    const details = (await reader.getArticleDetailsTree()).data
    const languages = (await reader.getLanguages()).data
    const modificators = (await reader.getModificatorsPage(DEMO_BID, { offset: 0, length: 50 }))
      .data
    const runId = newId('jb')
    const observedAt = clock.now.toISOString()
    const mapping = mapCatalogue(
      {
        venueId: venueId as VenueId,
        bid: DEMO_BID,
        menuId: menuId as NodeId,
        tree,
        articles,
        supplementsByArticle: {},
        detailsTree: details,
        languages,
      },
      {
        integrationId: integrationId as IntegrationId,
        catalogueRootCatId: DEMO_ROOT,
        priceSource: 'current_price',
        mappingVersion: BARSY_MAPPING_VERSION,
        includeServices: false,
        jobId: runId,
        actor: `integration:${integrationId}`,
        observedAt,
      },
    )
    await appendSourceRecords(
      pool,
      tenantId,
      integrationId,
      [
        ...mapping.sourceRecords,
        ...mapModificators(modificators, { integrationId: integrationId as IntegrationId }),
      ].map((record) => ({
        id: record.id,
        externalType: record.externalType,
        externalId: record.externalId,
        scope: record.scope,
        raw: record.raw,
        payload: record.payload,
      })),
    )
    const log = await createLogger({ level: 'silent', pretty: false })
    const env = {
      pool,
      log,
      now: () => clock.now,
    } as unknown as SyncEnvironment
    const totals = emptyTotals()
    await applyMapped(env, tenantId, mapping.changeSet, totals)
    const hashOf = new Map(
      mapping.sourceRecords.map((record) => [
        `${record.externalType}:${record.externalId}`,
        record.contentHash,
      ]),
    )
    const seen: ChangeSetOp[] = mapping.linkStates.map((intent) => {
      const hash = hashOf.get(`${intent.linkType}:${intent.externalId}`)
      return {
        op: 'setLinkState',
        link: {
          integration: integrationId as IntegrationId,
          externalType: intent.linkType,
          externalId: intent.externalId,
        },
        state: intent.state,
        seenAt: observedAt,
        ...(hash === undefined ? {} : { hash }),
      }
    })
    await applyOps(
      env,
      tenantId,
      {
        source: tillSource(integrationId as IntegrationId),
        jobId: runId,
        actor: `integration:${integrationId}`,
        observedAt,
      },
      seen,
      totals,
    )
    expect(totals.rejected).toEqual([])
    const published = await publishMenu(pool, tenantId, {
      menuId,
      venueId,
      reason: 'manual',
      actor: 'system',
    })
    expect(published.status).toBe('published')
    firstHash = published.snapshot.hash
    before = await state()
    expect(before.links.length).toBeGreaterThan(60)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    fake.close()
    await pool?.end()
    await db?.drop()
  })

  it('one full pull of the new sync changes no link, section, item, placement, value or snapshot', async () => {
    clock.now = new Date(clock.now.getTime() + 60 * 60 * 1000)
    const log = await createLogger({ level: 'silent', pretty: false })
    const enqueued: { name: string }[] = []
    const send = async (name: string) => {
      enqueued.push({ name })
      return `queued-${enqueued.length}`
    }
    const context: WorkerContext = {
      pool,
      log,
      workerId: 'migration-test',
      version: '0.0.0-test',
      now: () => clock.now,
      status: new WorkerStatus(),
      queue: { send },
    }
    const jobs = createBarsyJobs({
      keys,
      policy: POLICY,
      store: { put: async () => undefined },
      limiters: new LimiterRegistry(),
      fetch: async () => new Response('no photos here', { status: 404 }),
      pullLocksMax: 1,
    })
    const fullPull = jobs.find((job) => job.name === JOB_NAMES.barsyFullPull)
    if (!fullPull) throw new Error('no full pull job')
    await fullPull.handler(
      [
        {
          id: randomUUID(),
          name: JOB_NAMES.barsyFullPull,
          data: { tenantId, integrationId, venueId },
          signal: new AbortController().signal,
          retryCount: 0,
        } as unknown as Job<object>,
      ],
      context,
    )
    const [run] = await query<{ status: string; counters: Record<string, number> }>(
      `select status, counters from restro.job_runs
       where integration_id = $1 and kind = 'barsy_full_pull'`,
      [integrationId],
    )
    expect(run?.status).toBe('completed')
    expect(run?.counters).toMatchObject({
      created: 0,
      missing: 0,
      deleted: 0,
      hidden_here: 0,
      nodes_created: 0,
      ops_applied: 0,
    })
    // Nothing changed, so nothing was queued to publish.
    expect(enqueued.filter((job) => job.name === JOB_NAMES.publishMenu)).toEqual([])

    const after = await state()
    expect(after.links).toEqual(before.links)
    expect(after.nodes).toEqual(before.nodes)
    expect(after.placements).toEqual(before.placements)
    expect(after.values).toEqual(before.values)

    const again = await publishMenu(pool, tenantId, {
      menuId,
      venueId,
      reason: 'manual',
      actor: 'system',
    })
    expect(again.status).toBe('unchanged')
    expect(again.snapshot.hash).toBe(firstHash)
  })
})
