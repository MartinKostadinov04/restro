// The Publish bar's read (brief S4, D96) against a real Postgres, as the restro_app role: one row
// per menu with its name, its routed areas, its change count and why it is blocked (a menu whose
// draft cannot be built says so and the others still come back); whether anything can be
// published; the held publish and the address in the page's state; and another organisation
// seeing nothing.
import { type ChangeSet, type NodeId, newId, type VenueId } from '@restro/core'
import {
  apply,
  createArea,
  createMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  renameMenu,
  setMenuRoute,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { loadVersioningView } from './load'
import { loadPublishSummary, loadVenuePublishState } from './summary'

describe.skipIf(!hasDatabase)('loadPublishSummary (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: VenueId
  let main: NodeId
  let brunch: NodeId
  let empty: NodeId

  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  /** A section with `count` priced items in the menu. */
  async function fill(menuId: NodeId, count: number) {
    const section = newId('nd')
    const ops: unknown[] = [
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menuId },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Напитки', en_US: 'Drinks' }),
    ]
    for (let index = 0; index < count; index++) {
      const item = newId('nd')
      ops.push(
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
        manual(item, 'price', { amount_minor: 500 + index, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      )
    }
    const changeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_s4',
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
  }
  const publish = (menuId: NodeId) =>
    publishMenu(app, tenant, { menuId, venueId, reason: 'manual', actor: 'user:us_s4' })
  const served = { addressServed: async () => true }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-publish-summary-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Summary club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Summary Club', slug: testSlug('sum') }))
      .id as VenueId
    main = (await provisionMenu(app, tenant, venueId)).id
    const second = await createMenu(app, tenant, { venueId, name: 'Brunch' })
    const third = await createMenu(app, tenant, { venueId, name: 'Empty' })
    if (!second.ok || !third.ok) throw new Error('the menus were not made')
    brunch = second.menu.id
    empty = third.menu.id
    await fill(main, 3)
    await fill(brunch, 1)
    const terrace = await createArea(app, tenant, venueId, 'Terrace')
    const garden = await createArea(app, tenant, venueId, 'Garden')
    if (!terrace.ok || !garden.ok) throw new Error('the areas were not made')
    // Areas in their order: Terrace, then Garden; both show the brunch menu.
    for (const area of [garden.area.id, terrace.area.id]) {
      expect(
        (await setMenuRoute(app, tenant, { venueId, target: { areaId: area }, menuId: brunch })).ok,
      ).toBe(true)
    }
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'job_runs',
        'item_first_published',
        'publish_pointers',
        'snapshots',
        'events',
        'field_values',
        'placements',
        'menu_routes',
        'tables',
        'areas',
        'menus',
        'nodes',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('lists every menu in order with its name, areas and changes; a blocked one says why', async () => {
    const summary = await loadPublishSummary(app, tenant, venueId, served)
    expect(summary).toEqual({
      canPublish: true,
      addressServed: true,
      menus: [
        {
          menuId: main,
          // No header name: the venue's.
          name: 'Summary Club',
          live: true,
          areas: [],
          changes: 3,
          identical: false,
          blocked: null,
        },
        {
          menuId: brunch,
          name: 'Brunch',
          live: false,
          areas: ['Terrace', 'Garden'],
          changes: 1,
          identical: false,
          blocked: null,
        },
        {
          menuId: empty,
          name: 'Empty',
          live: false,
          areas: [],
          changes: null,
          identical: false,
          blocked: 'no_visible_items',
        },
      ],
    })
  })

  it('follows a publish per menu, and a header name', async () => {
    await publish(main)
    const published = await loadPublishSummary(app, tenant, venueId, served)
    expect(published.menus[0]).toMatchObject({ changes: 0, identical: true })
    // The header name is the guest heading (D92): a rename is a change waiting.
    expect((await renameMenu(app, tenant, { venueId, menuId: main, name: 'Main' })).ok).toBe(true)
    const summary = await loadPublishSummary(app, tenant, venueId, served)
    expect(summary.menus[0]).toMatchObject({ name: 'Main', changes: 1, identical: false })
    expect(summary.menus[1]).toMatchObject({ changes: 1, identical: false })
    // The brunch menu still has something to publish.
    expect(summary.canPublish).toBe(true)
  })

  it('has nothing to publish once every menu that can be published is', async () => {
    await publish(main)
    await publish(brunch)
    const summary = await loadPublishSummary(app, tenant, venueId, served)
    expect(summary.menus.map((menu) => [menu.changes, menu.identical, menu.blocked])).toEqual([
      [0, true, null],
      [0, true, null],
      [null, false, 'no_visible_items'],
    ])
    expect(summary.canPublish).toBe(false)
  })

  it('a switched-off address makes the live menu publishable again (D86)', async () => {
    const summary = await loadPublishSummary(app, tenant, venueId, {
      addressServed: async () => false,
    })
    expect(summary).toMatchObject({ canPublish: true, addressServed: false })
  })

  it('the page’s state: the menus have a published version, nothing held, no job waiting', async () => {
    const state = await loadVenuePublishState(app, tenant, venueId, served)
    expect(
      state.menus.map((menu) => [
        menu.name,
        menu.published,
        menu.held,
        menu.busy,
        menu.list?.total,
      ]),
    ).toEqual([
      ['Main', true, null, null, 0],
      ['Brunch', true, null, null, 0],
      ['Empty', false, null, null, undefined],
    ])
    expect(state).toMatchObject({ paused: false, addressServed: true })
  })

  it('Settings › Versioning: each menu’s live version and versions', async () => {
    const view = await loadVersioningView({
      pool: app,
      tenantId: tenant,
      venue: { id: venueId, slug: 'sum', publicId: 'k3x9p2m7qa1z', timezone: 'Europe/Sofia' },
      venueName: 'Summary Club',
      canPublish: true,
    })
    expect(
      view.menus.map((menu) => [
        menu.name,
        menu.live,
        menu.liveVersion?.version ?? null,
        menu.entries.map((entry) => entry.version),
      ]),
    ).toEqual([
      ['Main', true, 2, [2, 1]],
      ['Brunch', false, 1, [1]],
      ['Empty', false, null, []],
    ])
  })

  it('shows another organisation nothing', async () => {
    expect(await loadPublishSummary(app, otherTenant, venueId, served)).toEqual({
      canPublish: false,
      addressServed: true,
      menus: [],
    })
  })
})
