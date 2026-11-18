// Which menus hold an orderable item paid first (Tonight's pay-rule line, walk P6), read from the
// published snapshot as the restro_app role: an item's own `payment_mode`, or the venue's default
// where the item sets none. A pay-first item that is not orderable does not count. Skipped without
// a database.
import { createHash } from 'node:crypto'

import { withTenant } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionMenu } from '../apply/provision'
import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { menusWithPayFirstItem } from './pay-first'

describe.skipIf(!hasDatabase)('menusWithPayFirstItem (as the restro_app role)', () => {
  let world: ServiceWorld
  let menuId: string
  let snapshotId: string

  const publish = async (items: Record<string, unknown>) => {
    await world.owner.query('update restro.snapshots set body = $2::jsonb where id = $1', [
      snapshotId,
      JSON.stringify({ items }),
    ])
  }
  const read = (itemMode: 'on_bill' | 'pay_first') =>
    withTenant(world.app, world.tenantId, (tx) =>
      menusWithPayFirstItem(tx, { venueId: world.venueId, itemMode }),
    )

  beforeAll(async () => {
    world = await openServiceWorld('pay-first-menus')
    menuId = (await provisionMenu(world.app, world.tenantId, world.venueId)).menu.id
    snapshotId = newId('sn')
    await world.owner.query(
      `insert into restro.snapshots
         (id, tenant_id, menu_id, venue_id, version, hash, body, status, reason, actor, published_at)
       values ($1, $2, $3, $4, 1, $5, '{"items":{}}'::jsonb, 'published', 'manual', 'system', now())`,
      [
        snapshotId,
        world.tenantId,
        menuId,
        world.venueId,
        createHash('sha256').update(snapshotId).digest('hex'),
      ],
    )
    await world.owner.query(
      `insert into restro.publish_pointers (tenant_id, menu_id, venue_id, current_snapshot_id)
       values ($1, $2, $3, $4)`,
      [world.tenantId, menuId, world.venueId, snapshotId],
    )
    await world.owner.query('update restro.venues set live_menu_id = $2 where id = $1', [
      world.venueId,
      menuId,
    ])
  })

  afterAll(async () => {
    await world?.close()
  })

  it('finds the menu when an orderable item is pay-first itself', async () => {
    await publish({
      nd_beer: { orderable: true },
      nd_gin: { orderable: true, payment_mode: 'pay_first' },
    })
    expect([...(await read('on_bill'))]).toEqual([menuId])
  })

  it('finds the menu when the venue default is pay-first and an item sets none', async () => {
    await publish({ nd_beer: { orderable: true } })
    expect([...(await read('pay_first'))]).toEqual([menuId])
  })

  it('finds nothing when no item is pay-first, or the pay-first one cannot be ordered', async () => {
    await publish({
      nd_beer: { orderable: true },
      nd_wine: { orderable: true, payment_mode: 'on_bill' },
    })
    expect((await read('on_bill')).size).toBe(0)
    await publish({ nd_gin: { orderable: false, payment_mode: 'pay_first' } })
    expect((await read('on_bill')).size).toBe(0)
  })

  it('lets an item that stays on the bill override a pay-first venue default', async () => {
    await publish({ nd_beer: { orderable: true, payment_mode: 'on_bill' } })
    expect((await read('pay_first')).size).toBe(0)
  })
})
