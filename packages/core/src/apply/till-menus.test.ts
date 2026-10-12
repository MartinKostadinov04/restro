// Integration tests on a real Postgres (as restro_app): a till venue's menus follow the roots the
// till designates (D88, adjustments B3): one menu per root, an older menu adopted for the root
// the caller names, the first root's menu live when the venue has none, and all of it idempotent.
import { createPool, type DbPool, sourceLinks, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { listMenus } from './menus'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { ensureTillMenus, listTillMenus, MENU_ROOT_LINK_TYPE, tillMenuRootId } from './till-menus'

describe.skipIf(!hasDatabase)(
  'a till venue’s menus follow its roots (as the restro_app role)',
  () => {
    const tenant = newId('tn')
    const integration = newId('in')
    let app: DbPool
    let owner: pg.Pool
    let venueId: string
    let firstMenu: string
    let fresh: string

    beforeAll(async () => {
      owner = openOwnerPool()
      app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-till-menus-tests' })
      await provisionTenant(app, { tenantId: tenant, name: 'Till menus test' })
      venueId = (await provisionVenue(app, tenant, { name: 'Till', slug: testSlug('till') })).id
      firstMenu = (await provisionMenu(app, tenant, venueId)).id
      fresh = (await provisionVenue(app, tenant, { name: 'Fresh', slug: testSlug('fresh') })).id
      await owner.query(
        "insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'till.example.test')",
        [integration, tenant],
      )
    })

    afterAll(async () => {
      await app?.end()
      if (owner) {
        await cleanUp(owner, [tenant])
        await owner.end()
      }
    })

    const roots = () => [
      { externalId: tillMenuRootId(1171, venueId) },
      { externalId: tillMenuRootId(1091, venueId) },
    ]

    it('adopts the older menu for the root the caller names and creates a menu for the other', async () => {
      const result = await ensureTillMenus(app, tenant, {
        venueId,
        integrationId: integration,
        roots: roots(),
        adoptFor: tillMenuRootId(1091, venueId),
        jobId: newId('jb'),
      })
      expect(result.menus.map((menu) => [menu.externalId, menu.created, menu.adopted])).toEqual([
        [tillMenuRootId(1171, venueId), true, false],
        [tillMenuRootId(1091, venueId), false, true],
      ])
      expect(result.menus[1]?.menuId).toBe(firstMenu)
      // The live menu stays the one the venue had.
      expect(result.liveMenuId).toBe(firstMenu)
      const links = await withTenant(app, tenant, (tx) =>
        tx
          .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
          .from(sourceLinks)
          .where(
            and(
              eq(sourceLinks.integrationId, integration),
              eq(sourceLinks.externalType, MENU_ROOT_LINK_TYPE),
            ),
          ),
      )
      expect(links.map((link) => [link.externalId, link.nodeId]).sort()).toEqual(
        result.menus.map((menu) => [menu.externalId, menu.menuId]).sort(),
      )
      expect(await listTillMenus(app, tenant, venueId, integration)).toEqual(
        result.menus
          .map((menu) => ({ menuId: menu.menuId, externalId: menu.externalId }))
          .sort((a, b) => (a.menuId === firstMenu ? -1 : b.menuId === firstMenu ? 1 : 0)),
      )
      const listed = await listMenus(app, tenant, venueId)
      expect(listed.map((menu) => [menu.id, menu.live])).toEqual([
        [firstMenu, true],
        [result.menus[0]?.menuId, false],
      ])
    })

    it('a second call with the same roots changes nothing', async () => {
      const again = await ensureTillMenus(app, tenant, {
        venueId,
        integrationId: integration,
        roots: roots(),
        jobId: newId('jb'),
      })
      expect(again.menus.every((menu) => !menu.created && !menu.adopted)).toBe(true)
      expect((await listMenus(app, tenant, venueId)).map((menu) => menu.id)).toHaveLength(2)
    })

    it('a root the till no longer names: its menu follows the new root instead of a second menu', async () => {
      // The public menu's category changed at the till: 1171 became 1180.
      const moved = await ensureTillMenus(app, tenant, {
        venueId,
        integrationId: integration,
        roots: [
          { externalId: tillMenuRootId(1180, venueId) },
          { externalId: tillMenuRootId(1091, venueId) },
        ],
        jobId: newId('jb'),
      })
      const publicMenu = (await listTillMenus(app, tenant, venueId, integration)).find(
        (menu) => menu.externalId === tillMenuRootId(1180, venueId),
      )
      expect(moved.menus[0]).toMatchObject({
        externalId: tillMenuRootId(1180, venueId),
        created: false,
        adopted: true,
        menuId: publicMenu?.menuId,
      })
      expect(moved.menus[1]).toMatchObject({ menuId: firstMenu, created: false, adopted: false })
      expect((await listMenus(app, tenant, venueId)).map((menu) => menu.id)).toHaveLength(2)
      const roots = await listTillMenus(app, tenant, venueId, integration)
      expect(roots.map((root) => root.externalId).sort()).toEqual(
        [tillMenuRootId(1180, venueId), tillMenuRootId(1091, venueId)].sort(),
      )
    })

    it('a venue without a live menu gets the first root’s menu as its live one', async () => {
      const result = await ensureTillMenus(app, tenant, {
        venueId: fresh,
        integrationId: integration,
        roots: [
          { externalId: tillMenuRootId(1171, fresh) },
          { externalId: tillMenuRootId(1091, fresh) },
        ],
        jobId: newId('jb'),
      })
      expect(result.menus.map((menu) => menu.created)).toEqual([true, true])
      expect(result.liveMenuId).toBe(result.menus[0]?.menuId)
      expect((await listMenus(app, tenant, fresh)).map((menu) => [menu.id, menu.live])).toEqual([
        [result.menus[0]?.menuId, true],
        [result.menus[1]?.menuId, false],
      ])
    })

    it('refuses a bad root key and a venue the tenant does not have', async () => {
      await expect(
        ensureTillMenus(app, tenant, {
          venueId,
          integrationId: integration,
          roots: [{ externalId: 'not safe at all!' }],
          jobId: newId('jb'),
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(
        ensureTillMenus(app, tenant, {
          venueId: newId('vn'),
          integrationId: integration,
          roots: roots(),
          jobId: newId('jb'),
        }),
      ).rejects.toMatchObject({ code: 'venue_missing' })
    })
  },
)
