// The till's own name standing in for a missing public one (D75, CF-17), read back from what the
// sync stored: which nodes it names (items, options, sections), what the item sheet says about
// it, and that a name typed here takes the warning away. Against a real Postgres, as restro_app.

import type { AssetStore } from '@restro/assets'
import { type ChangeSet, newId } from '@restro/core'
import { apply, provisionMenu, provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool, withTenant } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadItemSheet, type SheetScope, saveField } from '../server/item-sheet/service'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../server/test-database'
import { readNameFallbackNodeIds } from './sync-reads'

const noStore: AssetStore = {
  async put() {},
  async getUrl() {
    return 'memory://none'
  },
  async get() {
    return null
  },
}

describe.skipIf(!hasDatabase)('names that are the till’s own, against Postgres', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  const userId = 'usertest0123456789abcdefghijklmn'
  let app: DbPool
  let owner: pg.Pool
  let venueId: string

  const section = { own: newId('nd'), public: newId('nd') }
  const item = {
    own: newId('nd'),
    typed: newId('nd'),
    public: newId('nd'),
    cleared: newId('nd'),
    handMade: newId('nd'),
    notAsked: newId('nd'),
  }
  const group = newId('nd')
  const option = { own: newId('nd'), public: newId('nd') }

  const record = {
    ownArticle: newId('sr'),
    typedArticle: newId('sr'),
    publicArticle: newId('sr'),
    notAskedArticle: newId('sr'),
    ownOption: newId('sr'),
    publicOption: newId('sr'),
    ownCategory: newId('sr'),
    publicCategory: newId('sr'),
    combo: newId('sr'),
  }

  const link = (externalType: string, externalId: string) => ({
    integration,
    externalType,
    externalId,
  })
  const tillSet = (node: string, fieldKey: string, value: unknown, recordId: string) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'till',
    scope: 'master',
    value,
    sourceRecordId: recordId,
    mappingVersion: 2,
  })

  async function insertRecord(
    id: string,
    externalType: string,
    externalId: string,
    payload: unknown,
    tenantId = tenant,
  ) {
    await owner.query(
      `insert into restro.source_records
         (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
       values ($1, $2, $3, $4, $5, 'master', $6, '{}', $7::jsonb)`,
      [
        id,
        tenantId,
        integration,
        externalType,
        externalId,
        'a'.repeat(64),
        JSON.stringify(payload),
      ],
    )
  }

  const scopeOf = (itemId: string): SheetScope => ({
    pool: app,
    tenantId: tenant,
    venueId,
    itemId,
  })
  const sheetOf = async (itemId: string) => {
    const data = await loadItemSheet(scopeOf(itemId), { store: noStore })
    if (!data) throw new Error('sheet not found')
    return data
  }
  const fallbackIds = (nodeIds?: readonly string[], tenantId = tenant) =>
    withTenant(app, tenantId, (tx) => readNameFallbackNodeIds(tx, nodeIds))
  const sorted = (ids: readonly string[]) => [...ids].sort()

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-name-fallback-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Name fallback club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') })).id
    await owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'demo.example')`,
      [integration, tenant],
    )
    const menu = await provisionMenu(app, tenant, venueId)

    // Records as the sync stores them: the article or category as the till sent it.
    await insertRecord(record.ownArticle, 'article', '1', {
      article_name: 'Own item',
      article_name_public: null,
      article_name_public_ml: { bg_BG: '', en_US: ' ', de_DE: null },
    })
    await insertRecord(record.typedArticle, 'article', '2', {
      article_name: 'Own typed over',
      article_name_public: '',
    })
    await insertRecord(record.publicArticle, 'article', '3', {
      article_name: 'Internal 3',
      article_name_public: null,
      article_name_public_ml: { bg_BG: 'Public item' },
    })
    // Read without the public-name fields at all: it says nothing about a public name.
    await insertRecord(record.notAskedArticle, 'article', '8', { article_name: 'Own, not asked' })
    await insertRecord(record.ownOption, 'article', '4', {
      article_name: 'Own option',
      article_name_public: null,
    })
    await insertRecord(record.publicOption, 'article', '5', {
      article_name: 'Internal 5',
      article_name_public: 'Public option',
    })
    await insertRecord(record.ownCategory, 'category', '10', {
      cat_name: 'Own section',
      cat_name_public: '',
      cat_name_public_ml: { bg_BG: '' },
    })
    await insertRecord(record.publicCategory, 'category', '11', {
      cat_name: 'Internal 11',
      cat_name_public: 'Public section',
    })
    await insertRecord(record.combo, 'article_supplements', '1', [{ supplement_group_name: 'Own' }])

    await apply(app, tenant, {
      id: newId('cs'),
      source: `till:${integration}`,
      jobId: newId('jb'),
      actor: `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section.own,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
        },
        { op: 'linkSource', node: { id: section.own }, link: link('category', '10') },
        tillSet(section.own, 'title', { bg_BG: 'Own section' }, record.ownCategory),
        {
          op: 'createNode',
          id: section.public,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
        },
        { op: 'linkSource', node: { id: section.public }, link: link('category', '11') },
        tillSet(section.public, 'title', { bg_BG: 'Public section' }, record.publicCategory),

        { op: 'createNode', id: item.own, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item.own }, link: link('article', '1') },
        tillSet(item.own, 'name', { bg_BG: 'Own item' }, record.ownArticle),
        { op: 'createNode', id: item.typed, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item.typed }, link: link('article', '2') },
        tillSet(item.typed, 'name', { bg_BG: 'Own typed over' }, record.typedArticle),
        { op: 'createNode', id: item.public, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item.public }, link: link('article', '3') },
        tillSet(item.public, 'name', { bg_BG: 'Public item' }, record.publicArticle),
        { op: 'createNode', id: item.notAsked, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item.notAsked }, link: link('article', '8') },
        tillSet(item.notAsked, 'name', { bg_BG: 'Old name' }, record.notAskedArticle),
        // The sync before D75 left the name empty: no value, so nothing to flag until a new pull.
        { op: 'createNode', id: item.cleared, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: item.cleared }, link: link('article', '6') },
        { op: 'createNode', id: item.handMade, nodeType: 'item', parent: null, status: 'active' },

        // An option is an article too: its name cites the option article's record.
        {
          op: 'createNode',
          id: group,
          nodeType: 'modifier_group',
          parent: { id: item.own },
          status: 'active',
        },
        { op: 'linkSource', node: { id: group }, link: link('supplement_group', '1:7') },
        tillSet(group, 'name', { bg_BG: 'Own' }, record.combo),
        {
          op: 'createNode',
          id: option.own,
          nodeType: 'option',
          parent: { id: group },
          status: 'active',
        },
        { op: 'linkSource', node: { id: option.own }, link: link('supplement', '1:7:4') },
        tillSet(option.own, 'name', { bg_BG: 'Own option' }, record.ownOption),
        {
          op: 'createNode',
          id: option.public,
          nodeType: 'option',
          parent: { id: group },
          status: 'active',
        },
        { op: 'linkSource', node: { id: option.public }, link: link('supplement', '1:7:5') },
        tillSet(option.public, 'name', { bg_BG: 'Public option' }, record.publicOption),
      ],
    } as ChangeSet)
    // Hand-made item: its name is ours (the manual layer), cites no record.
    await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: `user:${userId}`,
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'setField',
          node: { id: item.handMade },
          fieldKey: 'name',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Made here' },
        },
      ],
    } as ChangeSet)
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'events',
        'field_values',
        'placements',
        'source_links',
        'menus',
        'nodes',
        'source_records',
        'assets',
        'integrations',
        'tags',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('names the items, options and sections whose till name was mapped from a record with no public name', async () => {
    expect(sorted(await fallbackIds())).toEqual(
      sorted([section.own, item.own, item.typed, option.own]),
    )
  })

  it('leaves out public names, a cleared name, a hand-made name, a record read without the public fields and a group’s own name', async () => {
    const ids = await fallbackIds()
    for (const left of [
      section.public,
      item.public,
      item.cleared,
      item.handMade,
      item.notAsked,
      option.public,
      group,
    ]) {
      expect(ids).not.toContain(left)
    }
  })

  it('answers for some nodes only, and for none', async () => {
    expect(sorted(await fallbackIds([item.own, item.public, section.own]))).toEqual(
      sorted([item.own, section.own]),
    )
    expect(await fallbackIds([])).toEqual([])
    expect(await fallbackIds([newId('nd')])).toEqual([])
  })

  it('shows nothing of another tenant’s names', async () => {
    expect(await fallbackIds(undefined, otherTenant)).toEqual([])
  })

  it('the item sheet warns for a name that is the till’s own, not for a public or a made-here one', async () => {
    expect((await sheetOf(item.own)).nameFromTill).toBe(true)
    expect((await sheetOf(item.public)).nameFromTill).toBe(false)
    expect((await sheetOf(item.handMade)).nameFromTill).toBe(false)
    expect((await sheetOf(item.cleared)).nameFromTill).toBe(false)
  })

  it('a name typed in the sheet takes the warning away, and clearing it brings the warning back', async () => {
    expect((await sheetOf(item.typed)).nameFromTill).toBe(true)
    const saved = await saveField(
      scopeOf(item.typed),
      { store: noStore },
      { userId },
      { fieldKey: 'name', value: { bg_BG: 'Typed here' } },
    )
    if (!saved.ok) throw new Error(`save failed: ${saved.error}`)
    expect(saved.data.nameFromTill).toBe(false)
    expect(saved.data.title).toBe('Typed here')
    expect((await sheetOf(item.typed)).nameFromTill).toBe(false)
    // The stored fallback is still the till's: it is the resolver that no longer shows it.
    expect(await fallbackIds([item.typed])).toEqual([item.typed])
  })
})
