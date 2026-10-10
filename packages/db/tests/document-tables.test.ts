// Integration tests of the document tables (brief S2-01) on a real Postgres, as restro_app:
// every table keeps tenants apart, composite foreign keys stop a reference to another tenant's
// row (Postgres checks foreign keys without row-level security), the append-only tables refuse
// updates and deletes, sort keys compare by byte order, and rule 2 (provenance) holds in the
// database itself.
import { sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assets,
  barsyVenues,
  createPool,
  type DbPool,
  events,
  fieldValues,
  integrations,
  jobRuns,
  menus,
  nodes,
  placements,
  places,
  sourceLinks,
  sourceRecords,
  tenants,
  venues,
  withTenant,
} from '../src/index'
import { type WriteTx, withTenantWrite } from '../src/write/index'
import {
  appDatabaseUrl,
  cleanUp,
  DOCUMENT_TABLES_CHILDREN_FIRST,
  databaseError,
  hasDatabase,
  openOwnerPool,
  testId,
} from './database'

const RLS_VIOLATION = /violates row-level security policy/
const FK_VIOLATION = /violates foreign key constraint/
const PERMISSION_DENIED = /permission denied/
const HASH = 'a'.repeat(64)

/** The ids of one tenant's sample document. */
interface Sample {
  tenant: string
  venue: string
  /** A second venue, with no menu and no barsy venue. */
  spareVenue: string
  integration: string
  menu: string
  section: string
  item: string
  sourceRecord: string
  job: string
  place: string
  asset: string
}

function sampleIds(): Sample {
  return {
    tenant: testId('tn'),
    venue: testId('vn'),
    spareVenue: testId('vn'),
    integration: testId('in'),
    menu: testId('nd'),
    section: testId('nd'),
    item: testId('nd'),
    sourceRecord: testId('sr'),
    job: testId('jb'),
    place: testId('tb'),
    asset: testId('as'),
  }
}

/** One row in every document table, for tenant `s.tenant`, written as restro_app. */
async function writeSample(tx: WriteTx, s: Sample): Promise<void> {
  const t = s.tenant
  await tx.insert(tenants).values({ id: t, name: `Club ${t}` })
  await tx.insert(venues).values([
    { id: s.venue, tenantId: t, name: 'Main', slug: 'main' },
    { id: s.spareVenue, tenantId: t, name: 'Spare', slug: 'spare' },
  ])
  await tx.insert(integrations).values({ id: s.integration, tenantId: t, kind: 'barsy', host: 'x' })
  await tx
    .insert(barsyVenues)
    .values({ tenantId: t, integrationId: s.integration, bid: 1, name: 'Main', venueId: s.venue })
  await tx.insert(nodes).values([
    { id: s.menu, tenantId: t, nodeType: 'menu', parentId: null },
    { id: s.section, tenantId: t, nodeType: 'section', parentId: s.menu, sortKey: 'a0' },
    { id: s.item, tenantId: t, nodeType: 'item', parentId: null },
  ])
  await tx.insert(menus).values({
    id: s.menu,
    tenantId: t,
    venueId: s.venue,
    templateKey: 'venue-menu',
    templateVersion: 1,
    rootNodeId: s.menu,
  })
  await tx
    .insert(placements)
    .values({ tenantId: t, itemId: s.item, sectionId: s.section, sortKey: 'a0' })
  await tx.insert(sourceRecords).values({
    id: s.sourceRecord,
    tenantId: t,
    integrationId: s.integration,
    externalType: 'article',
    externalId: '102751',
    scope: 'master',
    contentHash: HASH,
    raw: '{"article_id":102751,"actual_price":12.5}',
    payload: { article_id: 102751, actual_price: 12.5 },
  })
  await tx.insert(sourceLinks).values({
    tenantId: t,
    integrationId: s.integration,
    externalType: 'article',
    externalId: '102751',
    nodeId: s.item,
  })
  await tx.insert(fieldValues).values({
    tenantId: t,
    nodeId: s.item,
    fieldKey: 'price',
    layer: 'barsy',
    scope: `venue:${s.venue}`,
    value: { amount_minor: 1250, currency: 'EUR' },
    valueHash: HASH,
    source: `barsy:${s.integration}`,
    jobId: s.job,
    actor: `integration:${s.integration}`,
    observedAt: new Date(),
    sourceRecordId: s.sourceRecord,
    mappingVersion: 1,
  })
  await tx.insert(events).values({
    tenantId: t,
    nodeId: s.item,
    fieldKey: 'price',
    layer: 'barsy',
    scope: `venue:${s.venue}`,
    oldValue: null,
    newValue: { amount_minor: 1250, currency: 'EUR' },
    source: `barsy:${s.integration}`,
    actor: `integration:${s.integration}`,
    jobId: s.job,
    changeSetId: testId('cs'),
  })
  await tx
    .insert(jobRuns)
    .values({ id: s.job, tenantId: t, integrationId: s.integration, kind: 'barsy_full' })
  await tx.insert(places).values({
    id: s.place,
    tenantId: t,
    integrationId: s.integration,
    bid: 1,
    placeId: '7',
    isPublic: true,
  })
  await tx.insert(assets).values({ id: s.asset, tenantId: t, origin: 'upload' })
}

describe.skipIf(!hasDatabase)('document tables', () => {
  const a = sampleIds()
  const b = sampleIds()
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-db-document-tests' })
    await withTenantWrite(app, a.tenant, (tx) => writeSample(tx, a))
    await withTenantWrite(app, b.tenant, (tx) => writeSample(tx, b))
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [a.tenant, b.tenant] })
      await owner.end()
    }
  })

  it('every document table shows a tenant its own rows only', async () => {
    expect([...DOCUMENT_TABLES_CHILDREN_FIRST].sort()).toEqual(
      [
        'assets',
        'barsy_venues',
        'events',
        'field_values',
        'integrations',
        'job_runs',
        'menus',
        'nodes',
        'placements',
        'places',
        'source_links',
        'source_records',
      ].sort(),
    )
    for (const sample of [a, b]) {
      for (const table of DOCUMENT_TABLES_CHILDREN_FIRST) {
        const seen = await withTenant(app, sample.tenant, (tx) =>
          tx.execute<{ tenant_id: string }>(
            sql.raw(`select distinct tenant_id from restro.${table}`),
          ),
        )
        expect(
          seen.rows.map((row) => row.tenant_id),
          table,
        ).toEqual([sample.tenant])
      }
    }
  })

  it('a tenant cannot write a row for another tenant into any document table (WITH CHECK)', async () => {
    const intruder = sampleIds()
    // Tenant B writes A's tenant id on otherwise fresh rows: row-level security refuses each.
    const attempts: Record<string, (tx: WriteTx) => Promise<unknown>> = {
      integrations: (tx) =>
        tx
          .insert(integrations)
          .values({ id: intruder.integration, tenantId: a.tenant, kind: 'barsy', host: 'x' }),
      barsy_venues: (tx) =>
        tx
          .insert(barsyVenues)
          .values({ tenantId: a.tenant, integrationId: a.integration, bid: 99, name: 'X' }),
      nodes: (tx) =>
        tx.insert(nodes).values({ id: intruder.item, tenantId: a.tenant, nodeType: 'item' }),
      menus: (tx) =>
        tx.insert(menus).values({
          id: intruder.menu,
          tenantId: a.tenant,
          venueId: a.venue,
          templateKey: 'venue-menu',
          templateVersion: 1,
          rootNodeId: intruder.menu,
        }),
      placements: (tx) =>
        tx
          .insert(placements)
          .values({ tenantId: a.tenant, itemId: a.item, sectionId: a.section, sortKey: 'a1' }),
      source_records: (tx) =>
        tx.insert(sourceRecords).values({
          id: intruder.sourceRecord,
          tenantId: a.tenant,
          integrationId: a.integration,
          externalType: 'article',
          externalId: '1',
          scope: 'master',
          contentHash: HASH,
          raw: '{}',
          payload: {},
        }),
      source_links: (tx) =>
        tx.insert(sourceLinks).values({
          tenantId: a.tenant,
          integrationId: a.integration,
          externalType: 'article',
          externalId: '1',
          nodeId: a.section,
        }),
      field_values: (tx) =>
        tx.insert(fieldValues).values({
          tenantId: a.tenant,
          nodeId: a.item,
          fieldKey: 'description',
          layer: 'manual',
          scope: 'master',
          value: { en_US: 'planted' },
          valueHash: HASH,
          source: 'manual',
          jobId: 'job_x',
          actor: 'system',
          observedAt: new Date(),
        }),
      events: (tx) =>
        tx.insert(events).values({
          tenantId: a.tenant,
          nodeId: a.item,
          fieldKey: 'description',
          layer: 'manual',
          scope: 'master',
          newValue: { en_US: 'planted' },
          source: 'manual',
          actor: 'system',
          jobId: 'job_x',
          changeSetId: testId('cs'),
        }),
      job_runs: (tx) =>
        tx.insert(jobRuns).values({ id: intruder.job, tenantId: a.tenant, kind: 'x' }),
      places: (tx) =>
        tx.insert(places).values({
          id: intruder.place,
          tenantId: a.tenant,
          integrationId: a.integration,
          bid: 1,
          placeId: '8',
          isPublic: true,
        }),
      assets: (tx) =>
        tx.insert(assets).values({ id: intruder.asset, tenantId: a.tenant, origin: 'upload' }),
    }
    expect(Object.keys(attempts).sort()).toEqual([...DOCUMENT_TABLES_CHILDREN_FIRST].sort())
    for (const [table, attempt] of Object.entries(attempts)) {
      expect(await databaseError(withTenantWrite(app, b.tenant, attempt)), table).toMatch(
        RLS_VIOLATION,
      )
    }
  })

  it('composite foreign keys stop a reference to another tenant’s row', async () => {
    const own = sampleIds()
    const attempts: Record<string, (tx: WriteTx) => Promise<unknown>> = {
      'a section under A’s menu': (tx) =>
        tx.insert(nodes).values({
          id: own.section,
          tenantId: b.tenant,
          nodeType: 'section',
          parentId: a.menu,
          sortKey: 'a0',
        }),
      'a menu for A’s venue': (tx) =>
        tx
          .insert(nodes)
          .values({ id: own.menu, tenantId: b.tenant, nodeType: 'menu' })
          .then(() =>
            tx.insert(menus).values({
              id: own.menu,
              tenantId: b.tenant,
              venueId: a.spareVenue,
              templateKey: 'venue-menu',
              templateVersion: 1,
              rootNodeId: own.menu,
            }),
          ),
      'A’s item placed in B’s section': (tx) =>
        tx
          .insert(placements)
          .values({ tenantId: b.tenant, itemId: a.item, sectionId: b.section, sortKey: 'a5' }),
      'a link through A’s integration': (tx) =>
        tx.insert(sourceLinks).values({
          tenantId: b.tenant,
          integrationId: a.integration,
          externalType: 'article',
          externalId: '555',
          nodeId: b.section,
        }),
      'a value citing A’s source record': (tx) =>
        tx.insert(fieldValues).values({
          tenantId: b.tenant,
          nodeId: b.item,
          fieldKey: 'name',
          layer: 'barsy',
          scope: 'master',
          value: { en_US: 'x' },
          valueHash: HASH,
          source: `barsy:${b.integration}`,
          jobId: b.job,
          actor: 'system',
          observedAt: new Date(),
          sourceRecordId: a.sourceRecord,
          mappingVersion: 1,
        }),
      'a barsy venue mapped to A’s venue': (tx) =>
        tx.insert(barsyVenues).values({
          tenantId: b.tenant,
          integrationId: b.integration,
          bid: 2,
          name: 'X',
          venueId: a.spareVenue,
        }),
      'a table of A’s barsy venue': (tx) =>
        tx.insert(places).values({
          id: own.place,
          tenantId: b.tenant,
          integrationId: a.integration,
          bid: 1,
          placeId: '9',
          isPublic: true,
        }),
    }
    for (const [label, attempt] of Object.entries(attempts)) {
      expect(await databaseError(withTenantWrite(app, b.tenant, attempt)), label).toMatch(
        FK_VIOLATION,
      )
    }
  })

  it('compares placement sort keys by byte order (COLLATE "C"), whatever the database default', async () => {
    const { rows } = await owner.query<{ collation: string }>(
      `select c.collname as collation from pg_attribute a
       join pg_collation c on c.oid = a.attcollation
       where a.attrelid = 'restro.placements'::regclass and a.attname = 'sort_key'`,
    )
    expect(rows).toEqual([{ collation: 'C' }])
    const ordered = await withTenant(app, a.tenant, (tx) =>
      tx.execute<{ key: string }>(
        sql`select sort_key as key from (values ('a0'::text), ('Zz'), ('a1'), ('b00')) as v(sort_key)
            order by sort_key collate "C"`,
      ),
    )
    expect(ordered.rows.map((row) => row.key)).toEqual(['Zz', 'a0', 'a1', 'b00'])
  })

  it.each([
    ['update restro.events set new_value = \'{"x":1}\'::jsonb', 'events'],
    ['delete from restro.events', 'events'],
    ["update restro.source_records set raw = '{}'", 'source_records'],
    ['delete from restro.source_records', 'source_records'],
    ["update restro.menus set template_key = 'other'", 'menus'],
    ['delete from restro.nodes', 'nodes'],
    ['delete from restro.integrations', 'integrations'],
    ['truncate restro.field_values', 'field_values'],
  ])('the app role is denied: %s', async (statement) => {
    expect(
      await databaseError(withTenantWrite(app, a.tenant, (tx) => tx.execute(sql.raw(statement)))),
    ).toMatch(PERMISSION_DENIED)
  })

  it('inserts events without any privilege on their sequence, in ascending order', async () => {
    const inserted = await withTenantWrite(app, a.tenant, (tx) =>
      tx
        .insert(events)
        .values(
          [1, 2].map((n) => ({
            tenantId: a.tenant,
            nodeId: a.item,
            fieldKey: 'description',
            layer: 'manual',
            scope: 'master',
            newValue: { en_US: `v${n}` },
            source: 'manual',
            actor: 'system',
            jobId: 'job_manual',
            changeSetId: testId('cs'),
          })),
        )
        .returning({ seq: events.seq }),
    )
    const [first, second] = inserted.map((row) => row.seq)
    expect(second).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY)
    const { rows } = await owner.query<{ granted: boolean }>(
      `select has_sequence_privilege('restro_app', 'restro.events_seq_seq', 'USAGE') as granted`,
    )
    expect(rows[0]?.granted).toBe(false)
  })

  it('rule 2: no field value without layer, source and job, and each source keeps to its layers', async () => {
    const insert = (columns: Record<string, unknown>) =>
      databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(fieldValues).values({
            tenantId: a.tenant,
            nodeId: a.item,
            fieldKey: 'description',
            layer: 'manual',
            scope: 'master',
            value: { en_US: 'x' },
            valueHash: HASH,
            source: 'manual',
            jobId: 'job_manual',
            actor: 'system',
            observedAt: new Date(),
            ...columns,
          } as typeof fieldValues.$inferInsert),
        ),
      )
    for (const column of ['layer', 'source', 'jobId']) {
      expect(await insert({ [column]: null }), column).toMatch(/violates not-null constraint/)
    }
    expect(
      await insert({ layer: 'barsy', sourceRecordId: a.sourceRecord, mappingVersion: 1 }),
    ).toMatch(/field_values_layer_matches_source/)
    expect(await insert({ source: `barsy:${a.integration}` })).toMatch(
      /field_values_layer_matches_source/,
    )
    expect(await insert({ scope: `venue:${a.venue}` })).toMatch(
      /field_values_venue_scope_barsy_only/,
    )
    expect(await insert({ layer: 'override' })).toMatch(/field_values_basis_on_overrides/)
    expect(await insert({ valid: false })).toMatch(/field_values_reject_reason/)
    expect(
      await insert({
        layer: 'barsy',
        source: `barsy:${a.integration}`,
        fieldKey: 'name',
      }),
    ).toMatch(/field_values_barsy_provenance/)
  })

  it('keeps a menu’s id equal to its root node and one menu per venue', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(menus).values({
            id: a.section,
            tenantId: a.tenant,
            venueId: a.venue,
            templateKey: 'venue-menu',
            templateVersion: 1,
            rootNodeId: a.menu,
          }),
        ),
      ),
    ).toMatch(/menus_id_is_root_node/)
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(menus).values({
            id: a.section,
            tenantId: a.tenant,
            venueId: a.venue,
            templateKey: 'venue-menu',
            templateVersion: 1,
            rootNodeId: a.section,
          }),
        ),
      ),
    ).toMatch(/menus_venue_id_unique/)
  })

  it('refuses a parent on menus and items, and a missing parent on the other node types', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(nodes).values({
            id: testId('nd'),
            tenantId: a.tenant,
            nodeType: 'item',
            parentId: a.section,
            sortKey: 'a0',
          }),
        ),
      ),
    ).toMatch(/nodes_parent_by_type/)
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(nodes).values({ id: testId('nd'), tenantId: a.tenant, nodeType: 'option' }),
        ),
      ),
    ).toMatch(/nodes_parent_by_type/)
  })

  it('gives exactly the nodes with a parent a sibling sort key, compared by byte order', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx.insert(nodes).values({
            id: testId('nd'),
            tenantId: a.tenant,
            nodeType: 'section',
            parentId: a.menu,
          }),
        ),
      ),
    ).toMatch(/nodes_sort_key_with_parent/)
    expect(
      await databaseError(
        withTenantWrite(app, a.tenant, (tx) =>
          tx
            .insert(nodes)
            .values({ id: testId('nd'), tenantId: a.tenant, nodeType: 'item', sortKey: 'a0' }),
        ),
      ),
    ).toMatch(/nodes_sort_key_with_parent/)
    const { rows } = await owner.query<{ collation: string }>(
      `select c.collname as collation from pg_attribute a
       join pg_collation c on c.oid = a.attcollation
       where a.attrelid = 'restro.nodes'::regclass and a.attname = 'sort_key'`,
    )
    expect(rows).toEqual([{ collation: 'C' }])
  })
})
