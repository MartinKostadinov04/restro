// The venue's menus in Settings › General (brief S4; D88, D90, D91) against a real Postgres, as
// the restro_app role: what each action writes, who may call it (owners and admins), the refusals
// of a venue fed by a till (`till_venue`) and of the live menu (`menu_live`), the bin and restore,
// "Set live" queuing a publish of the menu, and the import of a hand-made venue's menu. The
// session and the job queue are the only fakes.
import { type ChangeSet, JOB_NAMES, newId } from '@restro/core'
import {
  apply,
  createIntegration,
  createMenu,
  listMenus,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  upsertBarsyVenues,
} from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import {
  createMenuAction,
  deleteMenuAction,
  importMenuAction,
  listImportSourcesAction,
  moveMenuAction,
  renameMenuAction,
  restoreMenuAction,
  setLiveMenuAction,
} from './menus-actions'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_s4tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'S4 club', slug: 's4-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))
vi.mock('./jobs', () => ({
  enqueueJob: async (name: string, data: Record<string, unknown>) => {
    if (queue.failing) throw new Error('the queue is down')
    queue.jobs.push({ name, data })
    return 'job-1'
  },
}))

describe.skipIf(!hasDatabase)('the menu actions (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let handMade: string
  let liveMenu: string
  let tillVenue: string
  let tillMenu: string
  let tillSecond: string

  const venueRow = async (venueId: string) =>
    (
      await owner.query<{ live_menu_id: string | null }>(
        'select live_menu_id from restro.venues where id = $1',
        [venueId],
      )
    ).rows[0]

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'S4 club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    asked.tenantId = tenant
    handMade = (await provisionVenue(getPool(), tenant, { name: 'By hand', slug: testSlug('s4') }))
      .id
    liveMenu = (await provisionMenu(getPool(), tenant, handMade)).id
    tillVenue = (
      await provisionVenue(getPool(), tenant, { name: 'Till club', slug: testSlug('s4-till') })
    ).id
    tillMenu = (await provisionMenu(getPool(), tenant, tillVenue)).id
    // A second menu, made while the venue was still by hand (a till venue's menus are the till's).
    const second = await createMenu(getPool(), tenant, { venueId: tillVenue, name: 'Till second' })
    if (!second.ok) throw new Error(second.reason)
    tillSecond = second.menu.id
    const integration = (
      await createIntegration(getPool(), tenant, { kind: 'barsy', host: 's4-menus.test' })
    ).id
    await upsertBarsyVenues(getPool(), tenant, integration, [{ bid: 41, name: 'Till 41' }])
    expect(await mapBarsyVenue(getPool(), tenant, integration, 41, tillVenue)).toMatchObject({
      ok: true,
    })
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
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
        'barsy_venues',
        'integrations',
        'menu_routes',
        'menus',
        'nodes',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
    await getPool().end()
  })

  describe('add, rename and move', () => {
    it('adds a menu to a hand-made venue, after the others, not live; and refreshes the venue page', async () => {
      const added = await createMenuAction({ venueId: handMade, name: 'Brunch' })
      expect(added).toMatchObject({ ok: true, menu: { name: 'Brunch', live: false } })
      expect(revalidated).toEqual([`/venues/${handMade}`])
      const menus = await listMenus(getPool(), tenant, handMade)
      expect(menus.map((menu) => [menu.id === liveMenu, menu.name])).toEqual([
        [true, null],
        [false, 'Brunch'],
      ])
    })

    it('refuses a venue fed by a till: its menus are the till’s (D88)', async () => {
      expect(await createMenuAction({ venueId: tillVenue, name: 'Mine' })).toEqual({
        ok: false,
        error: 'till_venue',
      })
    })

    it('renames and moves the menus of any venue, also one fed by a till', async () => {
      expect(
        await renameMenuAction({ venueId: tillVenue, menuId: tillMenu, name: 'Bar menu' }),
      ).toMatchObject({ ok: true, menu: { name: 'Bar menu' } })
      const [first, second] = await listMenus(getPool(), tenant, handMade)
      if (first === undefined || second === undefined) throw new Error('two menus expected')
      expect(
        await moveMenuAction({
          venueId: handMade,
          menuId: second.id,
          position: { before: first.id },
        }),
      ).toMatchObject({ ok: true })
      expect((await listMenus(getPool(), tenant, handMade)).map((menu) => menu.id)).toEqual([
        second.id,
        first.id,
      ])
      expect(
        await moveMenuAction({ venueId: handMade, menuId: second.id, position: 'end' }),
      ).toMatchObject({ ok: true })
    })

    it('is for owners and admins only; a malformed input is refused before anything', async () => {
      asked.role = 'admin'
      expect(await createMenuAction({ venueId: handMade, name: 'By an admin' })).toMatchObject({
        ok: true,
      })
      asked.role = 'member'
      expect(await createMenuAction({ venueId: handMade, name: 'By a member' })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(await renameMenuAction({ venueId: handMade, menuId: liveMenu, name: 'X' })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      asked.role = 'owner'
      expect(await createMenuAction({ venueId: 'nope', name: 'X' })).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(
        await moveMenuAction({ venueId: handMade, menuId: liveMenu, position: 'top' }),
      ).toEqual({ ok: false, error: 'invalid' })
    })

    it('does not reach another organisation’s venue', async () => {
      asked.tenantId = otherTenant
      expect(await createMenuAction({ venueId: handMade, name: 'Intruder' })).toEqual({
        ok: false,
        error: 'unknown_venue',
      })
    })
  })

  describe('the bin (D91)', () => {
    it('refuses to delete the live menu: choose another first', async () => {
      expect(await deleteMenuAction({ venueId: handMade, menuId: liveMenu })).toEqual({
        ok: false,
        error: 'menu_live',
      })
    })

    it('moves a menu to the bin and restores it', async () => {
      const made = await createMenuAction({ venueId: handMade, name: 'Winter' })
      if (!made.ok) throw new Error(made.error)
      const deleted = await deleteMenuAction({ venueId: handMade, menuId: made.menu.id })
      expect(deleted).toMatchObject({ ok: true, menu: { id: made.menu.id } })
      expect(deleted.ok && deleted.menu.deletedAt).not.toBe(null)
      expect((await listMenus(getPool(), tenant, handMade)).map((menu) => menu.id)).not.toContain(
        made.menu.id,
      )
      const binned = await listMenus(getPool(), tenant, handMade, { includeDeleted: true })
      expect(binned.find((menu) => menu.id === made.menu.id)?.deletedAt).not.toBeNull()

      expect(await restoreMenuAction({ venueId: handMade, menuId: made.menu.id })).toMatchObject({
        ok: true,
        menu: { deletedAt: null },
      })
      expect((await listMenus(getPool(), tenant, handMade)).map((menu) => menu.id)).toContain(
        made.menu.id,
      )
    })

    it('has nothing to delete or restore on a venue fed by a till', async () => {
      expect(await deleteMenuAction({ venueId: tillVenue, menuId: tillMenu })).toEqual({
        ok: false,
        error: 'till_venue',
      })
      expect(await restoreMenuAction({ venueId: tillVenue, menuId: tillMenu })).toEqual({
        ok: false,
        error: 'till_venue',
      })
    })
  })

  describe('Set live (D90: switching the live menu publishes it)', () => {
    it('moves the live pointer and queues a manual publish of that menu, by the person', async () => {
      const made = await createMenuAction({ venueId: handMade, name: 'Summer' })
      if (!made.ok) throw new Error(made.error)
      queue.jobs.length = 0
      expect(await setLiveMenuAction({ venueId: handMade, menuId: made.menu.id })).toMatchObject({
        ok: true,
        queued: true,
        menu: { id: made.menu.id, live: true },
      })
      expect((await venueRow(handMade))?.live_menu_id).toBe(made.menu.id)
      expect(queue.jobs).toEqual([
        {
          name: JOB_NAMES.publishMenu,
          data: {
            tenantId: tenant,
            menuId: made.menu.id,
            venueId: handMade,
            reason: 'manual',
            actor: 'user:us_s4tester',
          },
        },
      ])

      // Already live: nothing moves, nothing is queued.
      queue.jobs.length = 0
      expect(await setLiveMenuAction({ venueId: handMade, menuId: made.menu.id })).toMatchObject({
        ok: true,
        queued: false,
      })
      expect(queue.jobs).toEqual([])

      // Back to the first menu; the queue is down: it is live all the same, and says so.
      queue.failing = true
      expect(await setLiveMenuAction({ venueId: handMade, menuId: liveMenu })).toMatchObject({
        ok: true,
        queued: false,
      })
      expect((await venueRow(handMade))?.live_menu_id).toBe(liveMenu)
    })

    it('never for a member; works on a venue fed by a till; never for a binned menu', async () => {
      asked.role = 'member'
      expect(await setLiveMenuAction({ venueId: tillVenue, menuId: tillSecond })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect((await venueRow(tillVenue))?.live_menu_id).toBe(tillMenu)
      expect(queue.jobs).toEqual([])

      asked.role = 'admin'
      expect(await setLiveMenuAction({ venueId: tillVenue, menuId: tillSecond })).toMatchObject({
        ok: true,
        queued: true,
      })
      expect((await venueRow(tillVenue))?.live_menu_id).toBe(tillSecond)

      const gone = await createMenuAction({ venueId: handMade, name: 'Gone' })
      if (!gone.ok) throw new Error(gone.error)
      await deleteMenuAction({ venueId: handMade, menuId: gone.menu.id })
      expect(await setLiveMenuAction({ venueId: handMade, menuId: gone.menu.id })).toEqual({
        ok: false,
        error: 'menu_deleted',
      })
    })
  })

  describe('Import from another venue (D88)', () => {
    it('lists the other hand-made venues with their menus, never a venue fed by a till', async () => {
      const other = (
        await provisionVenue(getPool(), tenant, { name: 'Sister bar', slug: testSlug('s4-sis') })
      ).id
      await provisionMenu(getPool(), tenant, other)
      const result = await listImportSourcesAction(handMade)
      if (!result.ok) throw new Error(result.error)
      const names = result.venues.map((venue) => venue.name)
      expect(names).toContain('Sister bar')
      expect(names).not.toContain('Till club')
      expect(names).not.toContain('By hand')
      expect(result.venues.find((venue) => venue.name === 'Sister bar')?.menus).toEqual([
        { id: expect.stringMatching(/^nd_/), name: 'Sister bar' },
      ])
      asked.role = 'member'
      expect(await listImportSourcesAction(handMade)).toEqual({ ok: false, error: 'not_allowed' })
    })

    it('copies a hand-made venue’s menu into another, once; refuses a venue fed by a till', async () => {
      const source = (
        await provisionVenue(getPool(), tenant, { name: 'Source bar', slug: testSlug('s4-src') })
      ).id
      const sourceMenu = (await provisionMenu(getPool(), tenant, source)).id
      const section = newId('nd')
      const item = newId('nd')
      const changeSet = {
        id: newId('cs'),
        source: 'manual',
        jobId: newId('jb'),
        actor: 'user:us_s4tester',
        observedAt: new Date().toISOString(),
        ops: [
          {
            op: 'createNode',
            id: section,
            nodeType: 'section',
            parent: { id: sourceMenu },
            status: 'active',
            sortKey: 'end',
          },
          { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
          {
            op: 'setField',
            node: { id: item },
            fieldKey: 'name',
            layer: 'manual',
            scope: 'master',
            value: { bg_BG: 'Мохито', en_US: 'Mojito' },
          },
          { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
        ],
      } as ChangeSet
      expect((await apply(getPool(), tenant, changeSet)).rejected).toEqual([])

      const imported = await importMenuAction({
        fromVenueId: source,
        fromMenuId: sourceMenu,
        toVenueId: handMade,
        name: 'Copied',
      })
      expect(imported).toMatchObject({ ok: true, menu: { name: 'Copied', live: false } })
      expect(revalidated).toEqual([`/venues/${handMade}`])
      expect((await listMenus(getPool(), tenant, handMade)).map((menu) => menu.name)).toContain(
        'Copied',
      )

      expect(
        await importMenuAction({
          fromVenueId: source,
          fromMenuId: sourceMenu,
          toVenueId: tillVenue,
        }),
      ).toEqual({ ok: false, error: 'till_venue' })
      expect(
        await importMenuAction({
          fromVenueId: tillVenue,
          fromMenuId: tillMenu,
          toVenueId: handMade,
        }),
      ).toEqual({ ok: false, error: 'till_venue' })
    })
  })
})
