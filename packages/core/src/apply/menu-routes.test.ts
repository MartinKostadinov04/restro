// Integration tests of the menu routing dictionary (D95, D91), as the restro_app role on a real
// Postgres: an entry per area or table, the most specific published menu wins, an unpublished or
// binned menu falls back to the next level up, the live menu is the default, and the token files
// carry the menu each code opens. Skipped without a database.
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type AreaId, newId, type TableId } from '../ids'
import { apply } from './apply'
import { listMenuRoutes, resolveRoutes, setMenuRoute } from './menu-routes'
import { createMenu, deleteMenu, setLiveMenu } from './menus'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { publishMenu } from './publish'
import {
  createArea,
  createTable,
  issueAllTableTokens,
  listVenueAreas,
  listVenueTables,
  loadTokenFiles,
} from './tables'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('menu routes (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let live: string
  let second: string
  let third: string
  let hall: AreaId
  let patio: AreaId
  let one: TableId
  let two: TableId
  let three: TableId

  const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`)
    return result as Extract<T, { ok: true }>
  }

  /** Gives a menu a section with one priced item, so it can be published (V10). */
  async function fill(menuId: string, name: string): Promise<void> {
    const section = newId('nd')
    const item = newId('nd')
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const result = await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menuId },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: name, en_US: name }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: `${name} 1`, en_US: `${name} 1` }),
        manual(item, 'price', { amount_minor: 900, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  }
  const publish = (menuId: string) =>
    publishMenu(app, tenant, { menuId, venueId, reason: 'manual', actor: 'user:us_test' })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-routes-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Routes club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Other routes club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Routes', slug: testSlug('routes') })).id
    // A hand-made venue with three menus: the first is live and published, the second published
    // as a draft, the third never published.
    live = (await provisionMenu(app, tenant, venueId)).id
    second = ok(await createMenu(app, tenant, { venueId, name: 'Late night' })).menu.id
    third = ok(await createMenu(app, tenant, { venueId, name: 'Brunch' })).menu.id
    await fill(live, 'Main')
    await fill(second, 'Night')
    await fill(third, 'Brunch')
    await publish(live)
    await publish(second)
    hall = ok(await createArea(app, tenant, venueId, 'Hall')).area.id
    patio = ok(await createArea(app, tenant, venueId, 'Patio')).area.id
    one = ok(await createTable(app, tenant, { areaId: hall, name: null, number: '1' })).table.id
    two = ok(await createTable(app, tenant, { areaId: hall, name: null, number: '2' })).table.id
    three = ok(await createTable(app, tenant, { areaId: patio, name: null, number: '3' })).table.id
    ok(await issueAllTableTokens(app, tenant, venueId))
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  it('with no entry, every area and table shows the live menu', async () => {
    const routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.live).toBe(live)
    expect([...routes.areas.values()]).toEqual([live, live])
    expect([...routes.tables.values()]).toEqual([live, live, live])
    expect(await listMenuRoutes(app, tenant, venueId)).toEqual([])
  })

  it('an area entry overrides the venue, a table entry its area; null takes the choice away', async () => {
    const area = ok(
      await setMenuRoute(app, tenant, { venueId, target: { areaId: hall }, menuId: second }),
    )
    expect(area.route).toEqual({ target: { areaId: hall }, menuId: second })
    let routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.areas.get(hall)).toBe(second)
    expect(routes.areas.get(patio)).toBe(live)
    expect(routes.tables.get(one)).toBe(second)
    expect(routes.tables.get(two)).toBe(second)
    expect(routes.tables.get(three)).toBe(live)

    ok(await setMenuRoute(app, tenant, { venueId, target: { tableId: two }, menuId: live }))
    routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.tables.get(one)).toBe(second)
    expect(routes.tables.get(two)).toBe(live)
    expect(await listMenuRoutes(app, tenant, venueId)).toEqual([
      { target: { areaId: hall }, menuId: second },
      { target: { tableId: two }, menuId: live },
    ])

    // The token files say which menu each code opens.
    const files = await loadTokenFiles(app, tenant, venueId)
    const tables = await listVenueTables(app, tenant, venueId)
    const menuOf = (tableId: string) =>
      files?.files.find((file) => file.token === tables.find((t) => t.id === tableId)?.token)
        ?.menuId
    expect([menuOf(one), menuOf(two), menuOf(three)]).toEqual([second, live, live])

    // Taking the area's choice away: its tables inherit the venue again (the table keeps its own).
    ok(await setMenuRoute(app, tenant, { venueId, target: { areaId: hall }, menuId: null }))
    routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.tables.get(one)).toBe(live)
    expect(routes.tables.get(two)).toBe(live)
    expect(await listMenuRoutes(app, tenant, venueId)).toEqual([
      { target: { tableId: two }, menuId: live },
    ])
    ok(await setMenuRoute(app, tenant, { venueId, target: { tableId: two }, menuId: null }))
  })

  it('an unpublished menu falls back to the next level up (D91); a binned menu is refused', async () => {
    ok(await setMenuRoute(app, tenant, { venueId, target: { areaId: patio }, menuId: third }))
    ok(await setMenuRoute(app, tenant, { venueId, target: { tableId: three }, menuId: third }))
    let routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.areas.get(patio)).toBe(live)
    expect(routes.tables.get(three)).toBe(live)
    // The entry stays: once the menu is published it applies.
    expect(await listMenuRoutes(app, tenant, venueId)).toEqual([
      { target: { areaId: patio }, menuId: third },
      { target: { tableId: three }, menuId: third },
    ])
    await publish(third)
    routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.tables.get(three)).toBe(third)

    // Binned: refused as a new choice; an existing entry falls back (the pointer stays, D91).
    ok(await setMenuRoute(app, tenant, { venueId, target: { tableId: three }, menuId: null }))
    ok(await setMenuRoute(app, tenant, { venueId, target: { areaId: patio }, menuId: null }))
    ok(await setMenuRoute(app, tenant, { venueId, target: { areaId: patio }, menuId: second }))
    ok(await setLiveMenu(app, tenant, { venueId, menuId: third }))
    ok(await deleteMenu(app, tenant, { venueId, menuId: second }))
    expect(
      await setMenuRoute(app, tenant, { venueId, target: { tableId: three }, menuId: second }),
    ).toMatchObject({ ok: false, error: 'menu_deleted' })
    routes = await resolveRoutes(app, tenant, venueId)
    expect(routes.live).toBe(third)
    expect(routes.areas.get(patio)).toBe(third)
    ok(await setLiveMenu(app, tenant, { venueId, menuId: live }))
  })

  it('refuses a target the venue does not have, a menu it does not have, bad ids and another tenant', async () => {
    const stranger = (
      await provisionVenue(app, otherTenant, { name: 'Stranger', slug: testSlug('stranger') })
    ).id
    const [strangerArea] = await listVenueAreas(app, otherTenant, stranger)
    expect(
      await setMenuRoute(app, tenant, { venueId, target: { areaId: newId('ar') }, menuId: live }),
    ).toMatchObject({ ok: false, error: 'unknown_target' })
    expect(
      await setMenuRoute(app, tenant, { venueId, target: { areaId: hall }, menuId: newId('nd') }),
    ).toMatchObject({ ok: false, error: 'unknown_menu' })
    expect(
      await setMenuRoute(app, tenant, { venueId, target: { areaId: 'nope' }, menuId: live }),
    ).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(
      await setMenuRoute(app, tenant, { venueId, target: { areaId: hall }, menuId: 'nope' }),
    ).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(
      await setMenuRoute(app, otherTenant, { venueId, target: { areaId: hall }, menuId: live }),
    ).toMatchObject({ ok: false, error: 'unknown_venue' })
    expect(strangerArea).toBeUndefined()
    expect(await listMenuRoutes(app, otherTenant, venueId)).toEqual([])
    expect((await resolveRoutes(app, otherTenant, venueId)).live).toBeNull()
  })
})
