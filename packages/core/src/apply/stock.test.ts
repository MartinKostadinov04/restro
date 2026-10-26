// Stock from the POS against Postgres as the restro_app role (#80, D122 §4, rules 1, 5 and 6): a
// mark is one change set through apply() in the POS layer, it reaches guests through the live
// overlay, a complete reading that says the item is back clears only our own mark, and an
// incomplete one changes nothing.

import { createPool, type DbPool, fieldValues, sourceRecords, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadLiveOverlay, publishMenu } from './publish'
import {
  lapseStockMarks,
  listStockMarks,
  liveScopesOfVenue,
  recordPosStock,
  STOCK_RECORD_TYPE,
} from './stock'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('stock from the POS (as the restro_app role)', () => {
  const tenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  const records: Record<string, string> = {}
  const names: Record<string, string> = {
    'ext-mojito': 'Mojito',
    'ext-negroni': 'Negroni',
    'ext-campari': 'Campari',
  }

  const section = newId('nd')
  /** Linked items on sale, one the POS's menu has off sale, and a hand-made one. */
  const mojito = newId('nd')
  const negroni = newId('nd')
  const campari = newId('nd')
  const handMade = newId('nd')

  // 23:00 on Friday 9 October 2026 in Sofia: service day 2026-10-09 (the day ends at 07:00).
  const night = new Date('2026-10-09T20:00:00Z')
  // 08:00 the next morning: the next service day.
  const morning = new Date('2026-10-10T05:00:00Z')

  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const manager = 'user:us_manager'

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? manager : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const till = (external: string, fieldKey: string, value: unknown, where = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId: external } },
    fieldKey,
    layer: 'till',
    scope: where,
    value,
    sourceRecordId: records[external],
    mappingVersion: 1,
  })
  async function run(ops: unknown[], source = 'manual') {
    const result = await apply(app, tenant, changeSet(source, ops))
    expect(result.rejected).toEqual([])
  }
  const reading = (items: [NodeId, boolean][]) =>
    ({
      complete: true,
      items: items.map(([itemId, available]) => ({ itemId, available })),
    }) as const
  const record = (
    items: [NodeId, boolean][],
    now = night,
    pass: 'availability' | 'refusal' = 'availability',
  ) =>
    recordPosStock(
      app,
      tenant,
      { integrationId: integration, venueId, pass, reading: reading(items) },
      { now },
    )
  const slotOf = async (node: string) => {
    const rows = await withTenant(app, tenant, (tx) =>
      tx
        .select({
          value: fieldValues.value,
          source: fieldValues.source,
          actor: fieldValues.actor,
          recordType: sourceRecords.externalType,
          payload: sourceRecords.payload,
        })
        .from(fieldValues)
        .leftJoin(sourceRecords, eq(sourceRecords.id, fieldValues.sourceRecordId))
        .where(
          and(
            eq(fieldValues.nodeId, node),
            eq(fieldValues.fieldKey, 'for_sale'),
            eq(fieldValues.layer, 'till'),
            eq(fieldValues.scope, `venue:${venueId}`),
          ),
        ),
    )
    return rows[0]
  }
  const soldOut = async () => {
    const live = await loadLiveOverlay(app, tenant, { menuId: menu.id, venueId }, { now: night })
    return Object.keys(live?.overlay.items ?? {}).sort()
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-stock-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Stock test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('stock') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'sim', 'sim.example')`),
    )
    for (const external of ['ext-mojito', 'ext-negroni', 'ext-campari']) {
      const id = newId('sr')
      records[external] = id
      await withTenantWrite(app, tenant, (tx) =>
        tx.execute(sql`
          insert into restro.source_records
            (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
             payload)
          values (${id}, ${tenant}, ${integration}, 'article', ${external}, 'master',
                  ${sha256Hex(id)}, '{}', '{}'::jsonb)`),
      )
    }
    await run([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      { op: 'createNode', id: handMade, nodeType: 'item', parent: null, status: 'active' },
      manual(handMade, 'name', { bg_BG: 'Лимонада', en_US: 'Lemonade' }),
      manual(handMade, 'price', eur(500)),
      manual(handMade, 'allergens', []),
      { op: 'setPlacement', item: { id: handMade }, section: { id: section }, sortKey: 'end' },
    ])
    for (const [id, external, forSale] of [
      [mojito, 'ext-mojito', true],
      [negroni, 'ext-negroni', true],
      [campari, 'ext-campari', false],
    ] as const) {
      await run(
        [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          {
            op: 'linkSource',
            node: { id },
            link: { integration, externalType: 'article', externalId: external },
          },
          till(external, 'name', { bg_BG: names[external], en_US: names[external] }),
          till(external, 'price', eur(1250), `venue:${venueId}`),
          till(external, 'for_sale', forSale, `venue:${venueId}`),
          till(external, 'visible', true),
          till(external, 'allergens', []),
        ],
        `till:${integration}`,
      )
      await run([{ op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' }])
    }
    const published = await publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: manager },
      { now: night },
    )
    expect(published.status).toBe('published')
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant])
    await owner?.end()
    await app?.end()
  })

  it('marks what the POS says ran out in the POS layer, through apply(), and greys it', async () => {
    expect(await soldOut()).toEqual([campari].sort())
    const result = await record([[mojito, false]], night, 'refusal')
    expect(result).toEqual({ marked: [mojito], cleared: [] })

    const slot = await slotOf(mojito)
    expect(slot).toMatchObject({
      value: false,
      source: `till:${integration}`,
      actor: `integration:${integration}`,
      recordType: STOCK_RECORD_TYPE,
      payload: { item: 'ext-mojito', available: false, pass: 'refusal', serviceDate: '2026-10-09' },
    })
    expect(await soldOut()).toEqual([campari, mojito].sort())
    expect(await listStockMarks(app, tenant)).toEqual([
      { integrationId: integration, venueId, itemId: mojito, serviceDate: '2026-10-09' },
    ])
  })

  it('writes nothing the second time, nor for an item no link ties to the POS', async () => {
    expect(
      await record([
        [mojito, false],
        [handMade, false],
      ]),
    ).toEqual({ marked: [], cleared: [] })
    expect(await slotOf(handMade)).toBeUndefined()
  })

  it('rule 6: an incomplete reading changes nothing', async () => {
    const result = await recordPosStock(
      app,
      tenant,
      { integrationId: integration, venueId, pass: 'availability', reading: { complete: false } },
      { now: night },
    )
    expect(result).toEqual({ marked: [], cleared: [] })
    expect((await slotOf(mojito))?.value).toBe(false)
  })

  it("rule 5: a reading that says it is back clears our mark, never the POS's own flag", async () => {
    expect(
      await record([
        [mojito, true],
        [campari, true],
        [negroni, true],
      ]),
    ).toEqual({
      marked: [],
      cleared: [mojito],
    })
    // The mark had replaced the POS's own `true` in the same slot: clearing it leaves the slot
    // empty, which reads as on sale, as the POS last said.
    expect(await slotOf(mojito)).toBeUndefined()
    expect(await slotOf(campari)).toMatchObject({ value: false, recordType: 'article' })
    expect(await soldOut()).toEqual([campari])
  })

  it('lapses a mark of an earlier service day', async () => {
    await record([[negroni, false]], night)
    expect(
      await lapseStockMarks(
        app,
        tenant,
        { integrationId: integration, venueId, itemIds: [negroni] },
        { now: night },
      ),
    ).toEqual({ marked: [], cleared: [] })
    expect(
      await lapseStockMarks(
        app,
        tenant,
        { integrationId: integration, venueId, itemIds: [negroni, campari] },
        { now: morning },
      ),
    ).toEqual({ marked: [], cleared: [negroni] })
    expect(await listStockMarks(app, tenant)).toEqual([])
  })

  it("names the venue's live menu as the scope to republish", async () => {
    expect(await liveScopesOfVenue(app, tenant, venueId)).toEqual([{ menuId: menu.id, venueId }])
  })
})
