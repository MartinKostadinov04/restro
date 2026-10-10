// loadMenusUsingAsset (which menus a picture is part of) and loadHeldNewItemIds / heldNewItemOps
// (the items the sync hid for review): against Postgres as the restro_app role (brief S3-04).
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { loadMenusUsingAsset } from './asset-menus'
import { HELD_NEW_ACTOR, heldNewItemOps, loadHeldNewItemIds } from './held-items'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

const unusedPool = {} as DbPool

describe('heldNewItemOps (no database needed)', () => {
  it('hides each item in the manual layer, master scope', () => {
    const [a, b] = [newId('nd'), newId('nd')]
    expect(heldNewItemOps([a, b])).toEqual([
      {
        op: 'setField',
        node: { id: a },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
        value: false,
      },
      {
        op: 'setField',
        node: { id: b },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
        value: false,
      },
    ])
    expect(heldNewItemOps([])).toEqual([])
    expect(HELD_NEW_ACTOR).toBe('system')
  })

  it('an asset id that is not one finds nothing, without a query', async () => {
    await expect(loadMenusUsingAsset(unusedPool, newId('tn'), 'as_')).resolves.toEqual([])
    await expect(loadMenusUsingAsset(unusedPool, newId('tn'), newId('nd'))).resolves.toEqual([])
  })
})

describe.skipIf(!hasDatabase)('the readers against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  const venues: { id: string; menu: ProvisionedMenu }[] = []

  const asset = newId('as')
  const otherAsset = newId('as')

  function changeSet(actor: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  async function change(ops: unknown[], actor = 'user:us_test', forTenant = tenant) {
    const result = await apply(app, forTenant, changeSet(actor, ops))
    expect(result.rejected).toEqual([])
  }
  const section = (id: string, parent: string) => ({
    op: 'createNode',
    id,
    nodeType: 'section',
    parent: { id: parent },
    status: 'active',
    sortKey: 'end',
  })
  const item = (id: string) => ({
    op: 'createNode',
    id,
    nodeType: 'item',
    parent: null,
    status: 'active',
  })
  const place = (itemId: string, sectionId: string) => ({
    op: 'setPlacement',
    item: { id: itemId },
    section: { id: sectionId },
    sortKey: 'end',
  })
  const image = (node: string, assetId: string) => ({
    op: 'setField',
    node: { id: node },
    fieldKey: 'image',
    layer: 'manual',
    scope: 'master',
    value: { asset_id: assetId, alt: {}, focal: null },
  })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-asset-menus-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Asset menus club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    for (const [name, slug] of [
      ['One', 'one'],
      ['Two', 'two'],
    ] as const) {
      const venue = await provisionVenue(app, tenant, { name, slug: testSlug(slug) })
      venues.push({ id: venue.id, menu: await provisionMenu(app, tenant, venue.id) })
    }
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  const menuOf = (index: number) => {
    const found = venues[index]
    if (!found) throw new Error('no venue')
    return found
  }

  it('finds the menu of an item placed in a nested section, and not one of a placed-nowhere item', async () => {
    const one = menuOf(0)
    const top = newId('nd')
    const nested = newId('nd')
    const placed = newId('nd')
    const unplaced = newId('nd')
    await change([
      section(top, one.menu.id),
      section(nested, top),
      item(placed),
      item(unplaced),
      place(placed, nested),
      image(placed, asset),
      image(unplaced, otherAsset),
    ])
    expect(await loadMenusUsingAsset(app, tenant, asset)).toEqual([
      { menuId: one.menu.id, venueId: one.id },
    ])
    // An item placed in no section is part of no menu: a snapshot cannot show it.
    expect(await loadMenusUsingAsset(app, tenant, otherAsset)).toEqual([])
  })

  it('finds a section’s own picture, and every menu that uses the same picture', async () => {
    const one = menuOf(0)
    const two = menuOf(1)
    const sharedAsset = newId('as')
    const inOne = newId('nd')
    const inTwo = newId('nd')
    const itemInTwo = newId('nd')
    await change([
      section(inOne, one.menu.id),
      image(inOne, sharedAsset),
      section(inTwo, two.menu.id),
      item(itemInTwo),
      place(itemInTwo, inTwo),
      image(itemInTwo, sharedAsset),
    ])
    const found = await loadMenusUsingAsset(app, tenant, sharedAsset)
    expect(found.map((entry) => entry.menuId).sort()).toEqual([one.menu.id, two.menu.id].sort())
    expect(found.find((entry) => entry.menuId === two.menu.id)?.venueId).toBe(two.id)
  })

  it('finds nothing for an unknown picture, and nothing across tenants', async () => {
    expect(await loadMenusUsingAsset(app, tenant, newId('as'))).toEqual([])
    // Another tenant sees nothing of this tenant's menus.
    expect(await loadMenusUsingAsset(app, otherTenant, asset)).toEqual([])
  })

  describe('loadHeldNewItemIds', () => {
    const itemA = newId('nd')
    const itemB = newId('nd')
    const itemC = newId('nd')

    it('lists the items whose manual hide the sync (actor system) wrote, and no others', async () => {
      await change([item(itemA), item(itemB), item(itemC)])
      await change(heldNewItemOps([itemA as NodeId, itemB as NodeId]), HELD_NEW_ACTOR)
      // A person hides C themselves.
      await change(heldNewItemOps([itemC as NodeId]), 'user:us_test')
      expect((await loadHeldNewItemIds(app, tenant)).sort()).toEqual([itemA, itemB].sort())
      expect(await loadHeldNewItemIds(app, otherTenant)).toEqual([])
    })

    it('forgets an item once a manager shows it (the value is cleared), even if they hide it again later', async () => {
      await change([
        {
          op: 'clearField',
          node: { id: itemA },
          fieldKey: 'visible',
          layer: 'manual',
          scope: 'master',
        },
      ])
      expect(await loadHeldNewItemIds(app, tenant)).toEqual([itemB])
      await change([
        {
          op: 'clearField',
          node: { id: itemB },
          fieldKey: 'visible',
          layer: 'manual',
          scope: 'master',
        },
      ])
      // Their own hide, written later, is theirs: not "new from barsy".
      await change(heldNewItemOps([itemB as NodeId]), 'user:us_test')
      expect(await loadHeldNewItemIds(app, tenant)).toEqual([])
    })
  })
})
