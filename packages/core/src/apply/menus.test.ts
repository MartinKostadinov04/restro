// Integration tests on a real Postgres (as restro_app): a venue's menus (D88, D90, D91, D92;
// adjustments M1): several per venue, exactly one live, named, ordered, binned and restored,
// the one-time copy into another hand-made venue, and what a till venue is refused.
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor, ChangeSet } from '../change-set'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { loadMenuDocument } from './load-document'
import {
  createMenu,
  deleteMenu,
  importMenu,
  listMenus,
  moveMenu,
  renameMenu,
  restoreMenu,
  setLiveMenu,
} from './menus'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('menus of a venue (as the restro_app role)', () => {
  const tenant = newId('tn')
  const integration = newId('in')
  const actor: Actor = `user:${newId('us')}`
  let app: DbPool
  let owner: pg.Pool
  let handA: string
  let handB: string
  let till: string
  let firstA: NodeId
  let firstB: NodeId
  let second: NodeId

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-menus-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Menus test' })
    handA = (await provisionVenue(app, tenant, { name: 'Hand A', slug: testSlug('hand-a') })).id
    handB = (await provisionVenue(app, tenant, { name: 'Hand B', slug: testSlug('hand-b') })).id
    till = (await provisionVenue(app, tenant, { name: 'Till', slug: testSlug('till') })).id
    firstA = (await provisionMenu(app, tenant, handA)).id
    firstB = (await provisionMenu(app, tenant, handB)).id
    await provisionMenu(app, tenant, till)
    // A till serves the third venue (the integration layer's link; the owner bypasses RLS).
    await owner.query(
      "insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'till.example.test')",
      [integration, tenant],
    )
    await owner.query(
      'insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id) values ($1, $2, 1, $3, $4)',
      [tenant, integration, 'Till', till],
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  it('a venue’s first menu is its live one', async () => {
    const menus = await listMenus(app, tenant, handA)
    expect(menus).toHaveLength(1)
    expect(menus[0]).toMatchObject({
      id: firstA,
      venueId: handA,
      name: null,
      sortKey: 'a0',
      settings: {},
      deletedAt: null,
      live: true,
    })
  })

  it('adds a menu to a hand-made venue, after the others, as a draft', async () => {
    const created = await createMenu(app, tenant, { venueId: handA, name: '  Night menu  ' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    second = created.menu.id
    expect(created.menu).toMatchObject({ name: 'Night menu', live: false, deletedAt: null })
    const menus = await listMenus(app, tenant, handA)
    expect(menus.map((menu) => [menu.id, menu.live])).toEqual([
      [firstA, true],
      [second, false],
    ])
    expect((menus[1]?.sortKey ?? '') > (menus[0]?.sortKey ?? '')).toBe(true)
  })

  it('refuses a menu for a till venue, a bad name and a bad position', async () => {
    expect(await createMenu(app, tenant, { venueId: till })).toMatchObject({
      ok: false,
      error: 'till_venue',
    })
    expect(await createMenu(app, tenant, { venueId: handA, name: 'x'.repeat(121) })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    })
    expect(
      await createMenu(app, tenant, { venueId: handA, position: { before: newId('nd') } }),
    ).toMatchObject({ ok: false, error: 'unknown_menu' })
    expect(await createMenu(app, tenant, { venueId: newId('vn') })).toMatchObject({
      ok: false,
      error: 'unknown_venue',
    })
  })

  it('renames, reorders and sets the settings of a menu', async () => {
    expect(
      await renameMenu(app, tenant, { venueId: handA, menuId: second, name: '' }),
    ).toMatchObject({ ok: true, menu: { name: null } })
    expect(
      await renameMenu(app, tenant, { venueId: handA, menuId: second, name: 'Late' }),
    ).toMatchObject({ ok: true, menu: { name: 'Late' } })
    const moved = await moveMenu(app, tenant, {
      venueId: handA,
      menuId: second,
      position: { before: firstA },
    })
    expect(moved.ok).toBe(true)
    expect((await listMenus(app, tenant, handA)).map((menu) => menu.id)).toEqual([second, firstA])
    expect(
      await renameMenu(app, tenant, { venueId: handB, menuId: second, name: 'Other' }),
    ).toMatchObject({ ok: false, error: 'unknown_menu' })
  })

  it('never bins the live menu; bins and restores another; a binned menu leaves the list', async () => {
    expect(await deleteMenu(app, tenant, { venueId: handA, menuId: firstA })).toMatchObject({
      ok: false,
      error: 'menu_live',
    })
    const binned = await deleteMenu(app, tenant, { venueId: handA, menuId: second })
    expect(binned.ok).toBe(true)
    if (binned.ok) expect(binned.menu.deletedAt).not.toBeNull()
    expect((await listMenus(app, tenant, handA)).map((menu) => menu.id)).toEqual([firstA])
    expect(
      (await listMenus(app, tenant, handA, { includeDeleted: true })).map((menu) => menu.id),
    ).toEqual([second, firstA])
    expect(await setLiveMenu(app, tenant, { venueId: handA, menuId: second })).toMatchObject({
      ok: false,
      error: 'menu_deleted',
    })
    expect(
      await renameMenu(app, tenant, { venueId: handA, menuId: second, name: 'x' }),
    ).toMatchObject({ ok: false, error: 'menu_deleted' })
    expect(await restoreMenu(app, tenant, { venueId: handA, menuId: second })).toMatchObject({
      ok: true,
      menu: { deletedAt: null },
    })
    expect(await deleteMenu(app, tenant, { venueId: till, menuId: newId('nd') })).toMatchObject({
      ok: false,
      error: 'till_venue',
    })
  })

  it('switches the live menu and says which one was live before', async () => {
    const switched = await setLiveMenu(app, tenant, { venueId: handA, menuId: second })
    expect(switched).toMatchObject({
      ok: true,
      changed: true,
      previous: firstA,
      menu: { live: true },
    })
    expect((await listMenus(app, tenant, handA)).map((menu) => menu.live)).toEqual([true, false])
    expect(await setLiveMenu(app, tenant, { venueId: handA, menuId: second })).toMatchObject({
      ok: true,
      changed: false,
      previous: second,
    })
    // The live menu is set for a till venue as well: it is a choice, not a change of the till.
    const tillMenus = await listMenus(app, tenant, till)
    expect(
      await setLiveMenu(app, tenant, { venueId: till, menuId: tillMenus[0]?.id ?? '' }),
    ).toMatchObject({ ok: true, changed: false })
    expect(await setLiveMenu(app, tenant, { venueId: handA, menuId: newId('nd') })).toMatchObject({
      ok: false,
      error: 'unknown_menu',
    })
  })

  it('copies a hand-made menu into another hand-made venue, once, without the tags', async () => {
    const section = newId('nd')
    const item = newId('nd')
    const seed: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: firstA },
          status: 'active',
        },
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'setField',
          node: { id: section },
          fieldKey: 'title',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Коктейли', en_US: 'Cocktails' },
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'name',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Негрони', en_US: 'Negroni' },
        },
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    }
    const seeded = await apply(app, tenant, seed)
    expect(seeded.rejected).toEqual([])

    const imported = await importMenu(app, tenant, {
      fromVenueId: handA,
      fromMenuId: firstA,
      toVenueId: handB,
      name: 'Copied',
      actor,
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.menu).toMatchObject({ venueId: handB, name: 'Copied', live: false })
    expect(imported.copied).toEqual({
      sections: 1,
      items: 1,
      modifierGroups: 0,
      options: 0,
      values: 2,
      placements: 1,
    })
    expect(imported.result.rejected).toEqual([])
    const copy = await loadMenuDocument(app, tenant, imported.menu.id)
    const types = copy.nodes.map((node) => node.type).sort()
    expect(types).toEqual(['item', 'menu', 'section'])
    expect(copy.nodes.map((node) => node.id)).not.toContain(section)
    expect(copy.nodes.map((node) => node.id)).not.toContain(item)
    const copiedSection = copy.nodes.find((node) => node.type === 'section')
    const copiedItem = copy.nodes.find((node) => node.type === 'item')
    expect(copiedSection?.parentId).toBe(imported.menu.id)
    expect(copy.placements).toEqual([
      { itemId: copiedItem?.id, sectionId: copiedSection?.id, sortKey: expect.any(String) },
    ])
    expect(
      copy.values
        .filter((value) => value.fieldKey === 'name')
        .map((value) => [value.nodeId, value.layer, value.value]),
    ).toEqual([[copiedItem?.id, 'manual', { bg_BG: 'Негрони', en_US: 'Negroni' }]])
    // The source is untouched, and venue B keeps its own live menu.
    const source = await loadMenuDocument(app, tenant, firstA)
    expect(source.nodes.map((node) => node.id).sort()).toEqual([firstA, item, section].sort())
    expect((await listMenus(app, tenant, handB)).map((menu) => [menu.id, menu.live])).toEqual([
      [firstB, true],
      [imported.menu.id, false],
    ])
  })

  it('refuses a copy from or into a till venue, from a binned or foreign menu, or into itself', async () => {
    const base = { fromVenueId: handA, fromMenuId: firstA, actor }
    expect(await importMenu(app, tenant, { ...base, toVenueId: till })).toMatchObject({
      ok: false,
      error: 'till_venue',
    })
    const tillMenus = await listMenus(app, tenant, till)
    expect(
      await importMenu(app, tenant, {
        fromVenueId: till,
        fromMenuId: tillMenus[0]?.id ?? '',
        toVenueId: handB,
        actor,
      }),
    ).toMatchObject({ ok: false, error: 'till_venue' })
    expect(
      await importMenu(app, tenant, {
        fromVenueId: handB,
        fromMenuId: firstA,
        toVenueId: handA,
        actor,
      }),
    ).toMatchObject({ ok: false, error: 'unknown_source' })
    expect(await importMenu(app, tenant, { ...base, toVenueId: handA })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    })
    expect(
      await importMenu(app, tenant, { ...base, toVenueId: handB, actor: 'nobody' }),
    ).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})
