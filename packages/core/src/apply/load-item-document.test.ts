// loadItemDocument(): the menu document plus an item that no section places (brief S2-06b).
import { createPool, type DbPool } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { resolve } from '../resolve'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { apply } from './apply'
import { loadMenuDocument } from './load-document'
import { ItemNotFoundError, loadItemDocument } from './load-item-document'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe('input checks (no database needed)', () => {
  it('refuses an item id that is not an nd_ id before any query', async () => {
    await expect(
      loadItemDocument({} as DbPool, newId('tn'), newId('nd'), 'nd_nope'),
    ).rejects.toBeInstanceOf(ItemNotFoundError)
  })
})

describe.skipIf(!hasDatabase)('loadItemDocument against Postgres', () => {
  const tenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let menu: ProvisionedMenu
  let record: string

  const placed = newId('nd')
  const unplaced = newId('nd')
  const group = newId('nd')
  const option = newId('nd')
  const section = newId('nd')

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }

  const barsyField = (externalId: string, fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId } },
    fieldKey,
    layer: 'barsy',
    scope,
    value,
    sourceRecordId: record,
    mappingVersion: 1,
  })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-load-item-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Load item test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') })).id
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    menu = await provisionMenu(app, tenant, venueId)
    record = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${tenant}, ${integration}, 'article', 'a1', 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
    await apply(
      app,
      tenant,
      changeSet(`barsy:${integration}`, [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
        },
        { op: 'createNode', id: placed, nodeType: 'item', parent: null, status: 'active' },
        { op: 'createNode', id: unplaced, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'linkSource',
          node: { id: unplaced },
          link: { integration, externalType: 'article', externalId: 'a1' },
        },
        {
          op: 'createNode',
          id: group,
          nodeType: 'modifier_group',
          parent: { id: unplaced },
          status: 'active',
        },
        {
          op: 'createNode',
          id: option,
          nodeType: 'option',
          parent: { id: group },
          status: 'active',
        },
        barsyField('a1', 'name', { bg_BG: 'Неразпределен', en_US: 'Unsorted' }),
        barsyField('a1', 'price', { amount_minor: 450, currency: 'EUR' }, `venue:${venueId}`),
        { op: 'setPlacement', item: { id: placed }, section: { id: section }, sortKey: 'end' },
      ]),
    )
    await apply(
      app,
      tenant,
      changeSet('manual', [
        {
          op: 'setField',
          node: { id: placed },
          fieldKey: 'description',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Описание' },
        },
        {
          op: 'setField',
          node: { id: unplaced },
          fieldKey: 'description',
          layer: 'manual',
          scope: 'master',
          value: { en_US: 'Our description' },
        },
      ]),
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  it('is the plain menu document for an item a section places', async () => {
    const plain = await loadMenuDocument(app, tenant, menu.id)
    const withItem = await loadItemDocument(app, tenant, menu.id, placed)
    expect(withItem).toEqual(plain)
  })

  it('adds an unplaced item, its subtree, values and links', async () => {
    const plain = await loadMenuDocument(app, tenant, menu.id)
    expect(plain.nodes.map((node) => node.id)).not.toContain(unplaced)

    const doc = await loadItemDocument(app, tenant, menu.id, unplaced)
    expect(doc.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([unplaced, group, option, placed, section, menu.id]),
    )
    expect(doc.nodes.filter((node) => node.id === unplaced)).toHaveLength(1)
    expect(
      doc.values.filter((value) => value.nodeId === unplaced).map((value) => value.fieldKey),
    ).toEqual(['description', 'name', 'price'])
    expect(doc.links).toContainEqual({
      nodeId: unplaced,
      source: `barsy:${integration}`,
      externalType: 'article',
      state: 'active',
    })
    // Nothing of the placed item is duplicated, and no external id travels with the links.
    expect(doc.values.filter((value) => value.nodeId === placed)).toHaveLength(1)
    expect(JSON.stringify(doc)).not.toContain('a1"')
  })

  it('gives the resolver what it needs to resolve the unplaced item', async () => {
    const doc = await loadItemDocument(app, tenant, menu.id, unplaced)
    const resolved = resolve(VENUE_MENU_TEMPLATE, doc, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: new Date().toISOString(),
    })
    const item = resolved.items[unplaced as NodeId]
    expect(item?.fields.name?.provenance).toBe('barsy')
    expect(item?.fields.description?.provenance).toBe('owned')
    expect(item?.issues.map((issue) => issue.code)).toContain('unplaced_item')
    expect(item?.visible).toBe(false)
  })

  it('refuses ids that are not items of the tenant', async () => {
    await expect(loadItemDocument(app, tenant, menu.id, newId('nd'))).rejects.toBeInstanceOf(
      ItemNotFoundError,
    )
    await expect(loadItemDocument(app, tenant, menu.id, section)).rejects.toBeInstanceOf(
      ItemNotFoundError,
    )
    await expect(loadItemDocument(app, tenant, menu.id, menu.id)).rejects.toBeInstanceOf(
      ItemNotFoundError,
    )
    await expect(loadItemDocument(app, newId('tn'), menu.id, unplaced)).rejects.toThrow()
  })
})
