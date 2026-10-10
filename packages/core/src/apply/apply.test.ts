// Integration tests of the one write path on a real Postgres, as restro_app (brief S2-01):
// identity, idempotency, hash no-ops, clearField, 'end' positions, unlink, rule 5 (also as a
// property), rule 2, rejected rows, refusals, tenant isolation, the append-only changelog, and
// what loadMenuDocument returns (no external ids). Ends with the resolver reading the result.
import {
  createPool,
  type DbPool,
  events,
  fieldValues,
  nodes,
  placements,
  withTenant,
} from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { asc, eq, sql } from 'drizzle-orm'
import * as fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet, SourceLink } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import * as core from '../index'
import { resolve } from '../resolve'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { type ApplyResult, apply, BARSY_LINK_TYPES } from './apply'
import * as applyEntry from './index'
import { loadMenuDocument } from './load-document'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

// Distinctive external ids, so a leak into the read model would be found by a text search.
const ARTICLE = '918273645'
const CATEGORY = '827364519'
const PERMISSION_DENIED = /permission denied/

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

describe('module boundary', () => {
  it('exports apply, loadMenuDocument and provisionMenu from @restro/core/apply only', () => {
    for (const name of ['apply', 'loadMenuDocument', 'provisionMenu', 'ApplyError', 'unlinkCopy']) {
      expect(Object.keys(applyEntry), name).toContain(name)
      expect(Object.keys(core), name).not.toContain(name)
    }
  })

  it('links items to articles, sections to categories, groups to supplement groups, options to modificators or supplements', () => {
    expect(BARSY_LINK_TYPES).toEqual({
      item: ['article'],
      section: ['category'],
      modifier_group: ['supplement_group'],
      option: ['modificator', 'supplement'],
    })
  })
})

describe.skipIf(!hasDatabase)('apply() against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let secondVenueId: string
  let otherVenueId: string
  let menu: ProvisionedMenu

  const article = (externalId: string): SourceLink => ({
    integration,
    externalType: 'article',
    externalId,
  })
  const category = (externalId: string): SourceLink => ({
    integration,
    externalType: 'category',
    externalId,
  })

  function changeSet(source: string, ops: unknown[], jobId: string = newId('jb')): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId,
      actor: source === 'manual' ? 'user:us_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const manual = (ops: unknown[]) => changeSet('manual', ops, 'job_manual_test')
  const barsy = (ops: unknown[], jobId?: string) =>
    changeSet(`barsy:${integration}`, ops, jobId ?? newId('jb'))

  /** A tier-1 record for a barsy write to cite (the sync stores these before applying). */
  async function sourceRecord(externalType: string, externalId: string): Promise<string> {
    const id = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${id}, ${tenant}, ${integration}, ${externalType}, ${externalId}, 'master',
                ${sha256Hex(id)}, '{}', '{}'::jsonb)`),
    )
    return id
  }

  function barsyField(
    link: SourceLink,
    record: string,
    fieldKey: string,
    value: unknown,
    scope = 'master',
  ) {
    return {
      op: 'setField',
      node: { link },
      fieldKey,
      layer: 'barsy',
      scope,
      value,
      sourceRecordId: record,
      mappingVersion: 1,
    }
  }

  /** What a pull of one barsy category produces: the section, its link and its title. */
  function categoryOps(section: NodeId, externalId: string, record: string) {
    const link = category(externalId)
    return [
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      { op: 'linkSource', node: { id: section }, link },
      barsyField(link, record, 'title', { bg_BG: 'РљРѕРєС‚РµР№Р»Рё', en_US: 'Cocktails' }),
    ]
  }

  /** What a pull of one barsy article produces: the item, its link, its values, its placement. */
  function articleOps(
    item: NodeId,
    externalId: string,
    record: string,
    options: { priceMinor?: number; forSale?: boolean; section?: SourceLink } = {},
  ) {
    const link = article(externalId)
    return [
      { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
      { op: 'linkSource', node: { id: item }, link },
      barsyField(link, record, 'name', { bg_BG: 'РќРµРіСЂРѕРЅРё', en_US: 'Negroni' }),
      barsyField(link, record, 'price', eur(options.priceMinor ?? 1250), `venue:${venueId}`),
      barsyField(link, record, 'for_sale', options.forSale ?? true, `venue:${venueId}`),
      barsyField(link, record, 'visible', true),
      ...(options.section
        ? [
            {
              op: 'setPlacement',
              item: { link },
              section: { link: options.section },
              sortKey: 'end',
            },
          ]
        : []),
    ]
  }

  const valuesOf = (nodeId: string) =>
    withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(fieldValues)
        .where(eq(fieldValues.nodeId, nodeId))
        .orderBy(asc(fieldValues.fieldKey), asc(fieldValues.layer), asc(fieldValues.scope)),
    )
  const storedValue = async (nodeId: string, fieldKey: string, layer: string, scope = 'master') =>
    (await valuesOf(nodeId)).find(
      (row) => row.fieldKey === fieldKey && row.layer === layer && row.scope === scope,
    )
  const eventsOf = (nodeId: string) =>
    withTenant(app, tenant, (tx) =>
      tx.select().from(events).where(eq(events.nodeId, nodeId)).orderBy(asc(events.seq)),
    )
  const nodeOf = async (id: string) =>
    (await withTenant(app, tenant, (tx) => tx.select().from(nodes).where(eq(nodes.id, id))))[0]
  const placementsIn = (sectionId: string) =>
    withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(placements)
        .where(eq(placements.sectionId, sectionId))
        .orderBy(sql`${placements.sortKey} collate "C"`),
    )
  const codesOf = (result: ApplyResult) => result.rejected.map((rejection) => rejection.code)

  // The pulled section and item most tests build on.
  const section = newId('nd')
  const item = newId('nd')
  let pull: ChangeSet

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-apply-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Apply test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') })).id
    secondVenueId = (
      await provisionVenue(app, tenant, { name: 'Second', slug: testSlug('second') })
    ).id
    otherVenueId = (
      await provisionVenue(app, otherTenant, { name: 'Other', slug: testSlug('main') })
    ).id
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    menu = await provisionMenu(app, tenant, venueId)
    const categoryRecord = await sourceRecord('category', CATEGORY)
    const articleRecord = await sourceRecord('article', ARTICLE)
    pull = barsy([
      ...categoryOps(section, CATEGORY, categoryRecord),
      ...articleOps(item, ARTICLE, articleRecord, { section: category(CATEGORY) }),
    ])
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  describe('provisionMenu', () => {
    it('creates the venueвЂ™s root node and menu once, pinned to venue-menu@1', async () => {
      expect(menu).toMatchObject({
        venueId,
        templateKey: 'venue-menu',
        templateVersion: 1,
        rootNodeId: menu.id,
        created: true,
      })
      expect(await nodeOf(menu.id)).toMatchObject({
        nodeType: 'menu',
        parentId: null,
        sortKey: null,
        status: 'active',
      })
      expect(await provisionMenu(app, tenant, venueId)).toEqual({ ...menu, created: false })
    })

    it('refuses a venue of another tenant and malformed ids', async () => {
      await expect(provisionMenu(app, tenant, otherVenueId)).rejects.toMatchObject({
        code: 'venue_missing',
      })
      await expect(provisionMenu(app, tenant, 'vn_nope')).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(provisionMenu(app, 'tn_nope', venueId)).rejects.toMatchObject({
        code: 'invalid_input',
      })
    })
  })

  it('a barsy pull creates the section and item, links them, writes values and places the item', async () => {
    const result = await apply(app, tenant, pull)
    expect(result.rejected).toEqual([])
    expect(result.createdNodeIds).toEqual([section, item])
    expect(result.applied).toBe(pull.ops.length)
    // 5 field values + 2 created nodes + 2 links + 1 placement.
    expect(result.eventsWritten).toBe(10)
    expect(await nodeOf(section)).toMatchObject({
      nodeType: 'section',
      parentId: menu.id,
      sortKey: 'a0',
      revision: 1,
    })
    expect(await placementsIn(section)).toMatchObject([{ itemId: item, sortKey: 'a0' }])
    expect(await storedValue(item, 'price', 'barsy', `venue:${venueId}`)).toMatchObject({
      value: eur(1250),
      source: `barsy:${integration}`,
      jobId: pull.jobId,
      valid: true,
      mappingVersion: 1,
    })
    expect((await eventsOf(item)).map((event) => `${event.op}:${event.fieldKey}`).sort()).toEqual([
      'createNode:node',
      'linkSource:link',
      'setField:for_sale',
      'setField:name',
      'setField:price',
      'setField:visible',
      'setPlacement:placement',
    ])
  })

  it('is idempotent: the same change set again is all no-ops and writes no event', async () => {
    const eventsBefore = (await eventsOf(item)).length
    const revisionBefore = (await nodeOf(item))?.revision
    const again = await apply(app, tenant, pull)
    expect(again).toEqual({
      applied: 0,
      unchanged: pull.ops.length,
      skipped: 0,
      rejected: [],
      createdNodeIds: [],
      eventsWritten: 0,
    })
    expect(await eventsOf(item)).toHaveLength(eventsBefore)
    expect((await nodeOf(item))?.revision).toBe(revisionBefore)
  })

  it('resolves identity through source_links: the same article in a new pull is the same node', async () => {
    const record = await sourceRecord('article', ARTICLE)
    const freshId = newId('nd')
    const result = await apply(
      app,
      tenant,
      barsy(
        articleOps(freshId, ARTICLE, record, { priceMinor: 1300, section: category(CATEGORY) }),
      ),
    )
    expect(result.rejected).toEqual([])
    expect(result.createdNodeIds).toEqual([])
    expect(result.applied).toBe(1) // only the new price
    expect(await nodeOf(freshId)).toBeUndefined()
    expect((await storedValue(item, 'price', 'barsy', `venue:${venueId}`))?.value).toEqual(
      eur(1300),
    )
    expect(await placementsIn(section)).toHaveLength(1)
  })

  it('skips a write whose value hash equals the stored one, keeping its provenance', async () => {
    const first = await apply(
      app,
      tenant,
      manual([
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'dietary',
          layer: 'manual',
          scope: 'master',
          value: ['vegan', 'vegetarian'],
        },
      ]),
    )
    expect(first.applied).toBe(1)
    const stored = await storedValue(item, 'dietary', 'manual')
    const reordered = await apply(app, tenant, {
      ...manual([
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'dietary',
          layer: 'manual',
          scope: 'master',
          value: ['vegetarian', 'vegan'],
        },
      ]),
      jobId: 'job_manual_other',
    })
    expect(reordered).toMatchObject({ applied: 0, unchanged: 1, eventsWritten: 0 })
    expect(await storedValue(item, 'dietary', 'manual')).toEqual(stored)
  })

  it('bumps a nodeвЂ™s revision once per change set that changes it', async () => {
    const before = (await nodeOf(item))?.revision ?? 0
    await apply(
      app,
      tenant,
      manual([
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'abv',
          layer: 'manual',
          scope: 'master',
          value: 24,
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'tags',
          layer: 'manual',
          scope: 'master',
          value: ['signature'],
        },
      ]),
    )
    expect((await nodeOf(item))?.revision).toBe(before + 1)
  })

  it('clearField removes one layerвЂ™s value, with an event; clearing nothing is a no-op', async () => {
    const hide = {
      op: 'setField',
      node: { id: item },
      fieldKey: 'visible',
      layer: 'manual',
      scope: 'master',
      value: false,
    }
    const clear = {
      op: 'clearField',
      node: { id: item },
      fieldKey: 'visible',
      layer: 'manual',
      scope: 'master',
    }
    expect((await apply(app, tenant, manual([hide]))).applied).toBe(1)
    expect((await storedValue(item, 'visible', 'manual'))?.value).toBe(false)
    const cleared = await apply(app, tenant, manual([clear]))
    expect(cleared).toMatchObject({ applied: 1, eventsWritten: 1 })
    expect(await storedValue(item, 'visible', 'manual')).toBeUndefined()
    expect((await eventsOf(item)).at(-1)).toMatchObject({
      fieldKey: 'visible',
      layer: 'manual',
      oldValue: false,
      newValue: null,
    })
    expect(await apply(app, tenant, manual([clear]))).toMatchObject({ applied: 0, unchanged: 1 })
    // The barsy layer is barsy's to clear: a manual change set cannot.
    await expect(apply(app, tenant, manual([{ ...clear, layer: 'barsy' }]))).rejects.toMatchObject({
      code: 'invalid_change_set',
    })
  })

  it("'end' appends after the current last; an item already placed stays put", async () => {
    const curated = newId('nd')
    const [x, y, z] = [newId('nd'), newId('nd'), newId('nd')]
    const createItem = (id: NodeId) => ({
      op: 'createNode',
      id,
      nodeType: 'item',
      parent: null,
      status: 'active',
    })
    const result = await apply(
      app,
      tenant,
      manual([
        {
          op: 'createNode',
          id: curated,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
        },
        createItem(x),
        createItem(y),
        createItem(z),
        { op: 'setPlacement', item: { id: x }, section: { id: curated }, sortKey: 'a0' },
        { op: 'setPlacement', item: { id: y }, section: { id: curated }, sortKey: 'a5' },
      ]),
    )
    expect(result.rejected).toEqual([])
    // The new section went after the pulled one among the menu's sections.
    expect((await nodeOf(curated))?.sortKey).toBe('a1')
    const end = await apply(
      app,
      tenant,
      manual([
        { op: 'setPlacement', item: { id: z }, section: { id: curated }, sortKey: 'end' },
        { op: 'setPlacement', item: { id: x }, section: { id: curated }, sortKey: 'end' },
      ]),
    )
    expect(end).toMatchObject({ applied: 1, unchanged: 1 })
    const order = await placementsIn(curated)
    expect(order.map((row) => row.itemId)).toEqual([x, y, z])
    expect((order[2]?.sortKey ?? '') > 'a5').toBe(true)
    expect(order[0]?.sortKey).toBe('a0')
    // A move with an explicit key rewrites only that row; removing takes the item out.
    await apply(
      app,
      tenant,
      manual([
        { op: 'setPlacement', item: { id: x }, section: { id: curated }, sortKey: 'Zz' },
        { op: 'removePlacement', item: { id: y }, section: { id: curated } },
      ]),
    )
    expect((await placementsIn(curated)).map((row) => row.itemId)).toEqual([x, z])
  })

  it('unlink copies the barsy values into manual, clears the barsy rows and removes the link', async () => {
    const externalId = '736451928'
    const record = await sourceRecord('article', externalId)
    const unlinked = newId('nd')
    const link = article(externalId)
    await apply(
      app,
      tenant,
      barsy([
        ...articleOps(unlinked, externalId, record, { priceMinor: 990, forSale: false }),
        barsyField(link, record, 'description', { en_US: 'From barsy', bg_BG: 'РћС‚ barsy' }),
      ]),
    )
    await apply(
      app,
      tenant,
      manual([
        {
          op: 'setField',
          node: { id: unlinked },
          fieldKey: 'name',
          layer: 'manual',
          scope: 'master',
          value: { de_DE: 'Negroni (DE)' },
        },
        {
          op: 'setField',
          node: { id: unlinked },
          fieldKey: 'description',
          layer: 'manual',
          scope: 'master',
          value: { en_US: 'Ours' },
        },
      ]),
    )
    const result = await apply(
      app,
      tenant,
      manual([{ op: 'unlinkSource', node: { id: unlinked }, link }]),
    )
    expect(result).toMatchObject({ applied: 1, rejected: [] })

    const rows = await valuesOf(unlinked)
    expect(rows.filter((row) => row.layer === 'barsy')).toEqual([])
    const manualValue = (fieldKey: string) =>
      rows.find((row) => row.fieldKey === fieldKey && row.layer === 'manual')?.value
    expect(manualValue('name')).toEqual({
      de_DE: 'Negroni (DE)',
      bg_BG: 'РќРµРіСЂРѕРЅРё',
      en_US: 'Negroni',
    })
    expect(manualValue('price')).toEqual(eur(990))
    expect(manualValue('for_sale')).toBe(false)
    expect(manualValue('description')).toEqual({ en_US: 'Ours', bg_BG: 'РћС‚ barsy' })
    expect(manualValue('visible')).toBeUndefined() // barsy said true: absence already means true
    // Every barsy row's removal and every copy is in the changelog.
    const changes = (await eventsOf(unlinked)).slice(-9)
    expect(
      changes.filter((event) => event.layer === 'barsy' && event.newValue === null),
    ).toHaveLength(5)
    expect(changes.filter((event) => event.layer === 'manual')).toHaveLength(4)

    // Hand-made now: a manual price is accepted, and the old link no longer finds the node.
    const after = await apply(
      app,
      tenant,
      manual([
        {
          op: 'setField',
          node: { id: unlinked },
          fieldKey: 'price',
          layer: 'manual',
          scope: 'master',
          value: eur(1100),
        },
      ]),
    )
    expect(after.applied).toBe(1)
    const stale = await apply(
      app,
      tenant,
      barsy([barsyField(link, record, 'name', { en_US: 'x' })]),
    )
    expect(codesOf(stale)).toEqual(['unknown_node'])
    // Unlinking again changes nothing.
    expect(
      await apply(app, tenant, manual([{ op: 'unlinkSource', node: { id: unlinked }, link }])),
    ).toMatchObject({ unchanged: 1 })
  })

  it('rule 5: a builder layer never un-hides, puts back on sale or prices a linked item', async () => {
    const result = await apply(
      app,
      tenant,
      manual([
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'visible',
          layer: 'manual',
          scope: 'master',
          value: true,
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'for_sale',
          layer: 'edition:tonight',
          scope: 'master',
          value: true,
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'price',
          layer: 'manual',
          scope: 'master',
          value: eur(1),
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'price',
          layer: 'override',
          scope: 'master',
          value: eur(1),
          basis: eur(1300),
        },
      ]),
    )
    expect(codesOf(result)).toEqual([
      'less_cautious',
      'less_cautious',
      'layer_not_allowed',
      'layer_not_allowed',
    ])
    expect(
      (await valuesOf(item)).filter(
        (row) => row.layer !== 'barsy' && ['visible', 'for_sale', 'price'].includes(row.fieldKey),
      ),
    ).toEqual([])
  })

  it('rule 5 (property): whatever builder writes arrive, the stored builder layers stay cautious', async () => {
    const builderLayer = fc.constantFrom('manual', 'override', 'edition:tonight', 'edition:vip')
    const write = fc.record({
      fieldKey: fc.constantFrom('visible', 'for_sale', 'price'),
      layer: builderLayer,
      // Shapes valid for some fields and not for others (Postgres jsonb refuses \u0000, so no
      // arbitrary JSON here).
      value: fc.oneof(
        fc.boolean(),
        fc.constant(eur(500)),
        fc.constant('yes'),
        fc.integer({ min: -3, max: 3 }),
        fc.constant(null),
      ),
    })
    await fc.assert(
      fc.asyncProperty(fc.array(write, { minLength: 1, maxLength: 6 }), async (writes) => {
        await apply(
          app,
          tenant,
          manual(
            writes.map((w) => ({
              op: 'setField',
              node: { id: item },
              fieldKey: w.fieldKey,
              layer: w.layer,
              scope: 'master',
              value: w.value,
              ...(w.layer === 'override' ? { basis: false } : {}),
            })),
          ),
        )
        const builderRows = (await valuesOf(item)).filter((row) => row.layer !== 'barsy')
        for (const row of builderRows) {
          if (row.fieldKey === 'price') expect.fail(`a ${row.layer} price was stored`)
          if (['visible', 'for_sale'].includes(row.fieldKey) && row.valid) {
            expect(row.value, `${row.fieldKey} in ${row.layer}`).toBe(false)
          }
        }
      }),
      { numRuns: 25 },
    )
    // Leave the item as the next tests expect it: no builder hides.
    for (const row of (await valuesOf(item)).filter(
      (r) => r.layer !== 'barsy' && ['visible', 'for_sale'].includes(r.fieldKey),
    )) {
      await apply(
        app,
        tenant,
        manual([
          {
            op: 'clearField',
            node: { id: item },
            fieldKey: row.fieldKey,
            layer: row.layer,
            scope: 'master',
          },
        ]),
      )
    }
  })

  it('keeps an invalid barsy value as a rejected row only where no good value exists', async () => {
    const externalId = '645192837'
    const record = await sourceRecord('article', externalId)
    const priced = newId('nd')
    const link = article(externalId)
    const price = (amount: unknown) => barsyField(link, record, 'price', amount, `venue:${venueId}`)
    const first = await apply(
      app,
      tenant,
      barsy([
        { op: 'createNode', id: priced, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: priced }, link },
        price(eur(-5)),
      ]),
    )
    expect(first.rejected).toMatchObject([{ opIndex: 2, code: 'V2' }])
    expect(await storedValue(priced, 'price', 'barsy', `venue:${venueId}`)).toMatchObject({
      valid: false,
      value: eur(-5),
      rejectReason: expect.stringContaining('money'),
    })
    expect((await apply(app, tenant, barsy([price(eur(800))]))).applied).toBe(1)
    const good = await storedValue(priced, 'price', 'barsy', `venue:${venueId}`)
    expect(good).toMatchObject({ valid: true, value: eur(800), rejectReason: null })
    const bad = await apply(app, tenant, barsy([price({ amount_minor: 8.5, currency: 'EUR' })]))
    expect(codesOf(bad)).toEqual(['V2'])
    expect(await storedValue(priced, 'price', 'barsy', `venue:${venueId}`)).toEqual(good)
  })

  it('refuses each op the document cannot take, and still applies the others', async () => {
    const record = await sourceRecord('article', ARTICLE)
    const group = newId('nd')
    const result = await apply(
      app,
      tenant,
      manual([
        /* 0 */ {
          op: 'setField',
          node: { id: newId('nd') },
          fieldKey: 'abv',
          layer: 'manual',
          scope: 'master',
          value: 5,
        },
        /* 1 */ {
          op: 'createNode',
          id: newId('nd'),
          nodeType: 'modifier_group',
          parent: { id: section },
          status: 'active',
        },
        /* 2 */ {
          op: 'createNode',
          id: newId('nd'),
          nodeType: 'menu',
          parent: null,
          status: 'active',
        },
        /* 3 */ { op: 'linkSource', node: { id: section }, link: article('111') },
        /* 4 */ { op: 'linkSource', node: { id: section }, link: category(CATEGORY) },
        /* 5 */ { op: 'linkSource', node: { id: item }, link: article('222') },
        /* 6 */ {
          op: 'createNode',
          id: group,
          nodeType: 'modifier_group',
          parent: { id: item },
          status: 'active',
        },
        /* 7 */ { op: 'linkSource', node: { id: group }, link: article('333') },
        /* 8 */ {
          op: 'setPlacement',
          item: { id: section },
          section: { id: section },
          sortKey: 'end',
        },
        /* 9 */ {
          op: 'linkSource',
          node: { id: item },
          link: { integration: newId('in'), externalType: 'article', externalId: '1' },
        },
        /* 10 */ {
          op: 'setField',
          node: { id: group },
          fieldKey: 'min',
          layer: 'manual',
          scope: 'master',
          value: 0,
        },
      ]),
    )
    expect(result.rejected.map(({ opIndex, code }) => [opIndex, code])).toEqual([
      [0, 'unknown_node'],
      [1, 'invalid_parent'],
      [2, 'source_not_allowed'],
      [3, 'invalid_link_type'],
      [5, 'already_linked'],
      [7, 'invalid_link_type'],
      [8, 'invalid_placement'],
      [9, 'unknown_integration'],
    ])
    expect(result).toMatchObject({ applied: 2, unchanged: 1, createdNodeIds: [group] })
    expect(await nodeOf(group)).toMatchObject({ parentId: item, sortKey: 'a0' })

    const fromBarsy = await apply(
      app,
      tenant,
      barsy([
        /* 0 */ barsyField(article(ARTICLE), newId('sr'), 'name', { en_US: 'x' }),
        /* 1 */ barsyField(article(ARTICLE), record, 'price', eur(1), `venue:${otherVenueId}`),
        /* 2 */ {
          ...barsyField(article(ARTICLE), record, 'name', { en_US: 'x' }),
          node: { id: group },
        },
        /* 3 */ { op: 'unlinkSource', node: { id: item }, link: article(ARTICLE) },
        /* 4 */ {
          op: 'createNode',
          id: newId('nd'),
          nodeType: 'section',
          parent: { link: category(CATEGORY) },
          status: 'active',
        },
        /* 5 */ { op: 'linkSource', node: { id: section }, link: category('999') },
      ]),
    )
    expect(fromBarsy.rejected.map(({ opIndex, code }) => [opIndex, code])).toEqual([
      [0, 'unknown_source_record'],
      [1, 'unknown_venue'],
      [2, 'not_linked'],
      [3, 'source_not_allowed'],
      [5, 'already_linked'],
    ])
    expect(fromBarsy.applied).toBe(1)
    // A refusal says which of our nodes and which field it was about (never a barsy id): by id,
    // through a source link that resolves, and not at all for a node that does not exist.
    expect(fromBarsy.rejected[1]).toMatchObject({ opIndex: 1, nodeRef: item, fieldKey: 'price' })
    expect(fromBarsy.rejected[2]).toMatchObject({ opIndex: 2, nodeRef: group, fieldKey: 'name' })
    expect(fromBarsy.rejected[3]).toMatchObject({ opIndex: 3, nodeRef: item })
    expect(fromBarsy.rejected[3]?.fieldKey).toBeUndefined()
    expect(result.rejected[0]).toMatchObject({ opIndex: 0, code: 'unknown_node' })
    expect(result.rejected[0]?.nodeRef).toBeUndefined()
  })

  it('refuses a whole change set that does not parse or names an unknown integration', async () => {
    await expect(apply(app, tenant, { ...manual([]), ops: [] })).rejects.toMatchObject({
      name: 'ApplyError',
      code: 'invalid_change_set',
    })
    const stranger = newId('in')
    await expect(
      apply(app, tenant, {
        ...changeSet(`barsy:${stranger}`, [
          {
            op: 'setNodeStatus',
            node: { link: { integration: stranger, externalType: 'article', externalId: '1' } },
            status: 'hidden',
          },
        ]),
        actor: `integration:${stranger}`,
      }),
    ).rejects.toMatchObject({ code: 'unknown_integration' })
  })

  it('keeps tenants apart: another tenant can neither name these nodes nor read this menu', async () => {
    const result = await apply(
      app,
      otherTenant,
      manual([{ op: 'setNodeStatus', node: { id: item }, status: 'archived' }]),
    )
    expect(codesOf(result)).toEqual(['unknown_node'])
    expect((await nodeOf(item))?.status).toBe('active')
    await expect(loadMenuDocument(app, otherTenant, menu.id)).rejects.toMatchObject({
      code: 'menu_not_found',
    })
  })

  it('rule 2: every stored value and event carries its layer, source and job', async () => {
    const { rows } = await owner.query<{ missing: number }>(
      `select count(*)::int as missing from (
         select layer, source, job_id from restro.field_values where tenant_id = $1
         union all
         select layer, source, job_id from restro.events where tenant_id = $1) as provenance
       where coalesce(layer, '') = '' or coalesce(source, '') = '' or coalesce(job_id, '') = ''`,
      [tenant],
    )
    expect(rows[0]?.missing).toBe(0)
    const { rows: counts } = await owner.query<{ events: number }>(
      'select count(*)::int as events from restro.events where tenant_id = $1',
      [tenant],
    )
    expect(counts[0]?.events).toBeGreaterThan(0)
  })

  it('events are append-only: the app role can neither change nor delete one', async () => {
    for (const statement of [
      "update restro.events set job_id = 'rewritten'",
      'delete from restro.events',
    ]) {
      await expect(
        withTenantWrite(app, tenant, (tx) => tx.execute(sql.raw(statement))),
      ).rejects.toSatisfy((error: unknown) => {
        let current = error
        while (current instanceof Error && current.cause instanceof Error) current = current.cause
        return current instanceof Error && PERMISSION_DENIED.test(current.message)
      })
    }
  })

  it('loadMenuDocument returns the menu without external ids and only this venueвЂ™s scope', async () => {
    const record = await sourceRecord('article', ARTICLE)
    await apply(
      app,
      tenant,
      barsy([barsyField(article(ARTICLE), record, 'price', eur(1500), `venue:${secondVenueId}`)]),
    )
    const doc = await loadMenuDocument(app, tenant, menu.id)
    expect(doc.menu).toEqual({
      id: menu.id,
      venueId,
      templateKey: 'venue-menu',
      templateVersion: 1,
      rootNodeId: menu.id,
    })
    expect(doc.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([menu.id, section, item]),
    )
    expect(doc.nodes.find((node) => node.id === section)).toMatchObject({
      sortKey: 'a0',
      parentId: menu.id,
    })
    expect(doc.placements).toContainEqual({ itemId: item, sectionId: section, sortKey: 'a0' })
    expect(
      doc.values.every((value) => value.scope === 'master' || value.scope === `venue:${venueId}`),
    ).toBe(true)
    expect(doc.links).toContainEqual({
      nodeId: item,
      source: `barsy:${integration}`,
      externalType: 'article',
      state: 'active',
    })
    for (const link of doc.links)
      expect(Object.keys(link).sort()).toEqual(['externalType', 'nodeId', 'source', 'state'])
    const text = JSON.stringify(doc)
    for (const externalId of [ARTICLE, CATEGORY, '736451928', '645192837']) {
      expect(text).not.toContain(externalId)
    }
    await expect(loadMenuDocument(app, tenant, newId('nd'))).rejects.toMatchObject({
      code: 'menu_not_found',
    })
  })

  it('the resolver reads what apply wrote: the pulled item is visible and orderable', async () => {
    const doc = await loadMenuDocument(app, tenant, menu.id)
    const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: new Date().toISOString(),
    })
    expect(resolved.sections[0]?.id).toBe(section)
    expect(resolved.items[item]).toMatchObject({ visible: true, computed: { orderable: true } })
    expect(resolved.items[item]?.fields.price?.value).toEqual(eur(1300))
  })
})
