// "Sold out tonight" and "Back on sale" against a real Postgres, as the restro_app role (brief
// S3-08, D46): who may, what is written and where, what is queued with which payload, the
// refusals, and the item sheet reading the same state. The queue is a fake; the worker's side
// (live.json and the rollover) is tested in apps/worker.
import { type ChangeSet, JOB_NAMES, newId, type ProducedJobName, type VenueId } from '@restro/core'
import {
  apply,
  loadLiveOverlay,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadItemSheet, type SheetScope, type SheetServices } from '../item-sheet/service'
import { appDatabaseUrl, hasDatabase, openOwnerPool } from '../test-database'
import { type SoldOutScope, type SoldOutServices, setItemsSoldOut } from './service'

describe.skipIf(!hasDatabase)('sold out tonight (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: VenueId
  let emptyVenueId: VenueId
  let menu: ProvisionedMenu
  const item = newId('nd')
  const other = newId('nd')

  // 23:00 in Sofia on Friday 9 October 2026: service day 2026-10-09.
  const night = new Date('2026-10-09T20:00:00Z')

  const sent: { name: string; data: object }[] = []
  let failQueue = false
  const services: SoldOutServices = {
    async enqueue<N extends ProducedJobName>(name: N, data: object) {
      if (failQueue) throw new Error('queue down')
      sent.push({ name, data })
      return 'job-1'
    },
    now: () => night,
  }
  const scope = (overrides: Partial<SoldOutScope> = {}): SoldOutScope => ({
    pool: app,
    tenantId: tenant,
    venueId,
    actor: 'user:us_manager',
    canMark: true,
    ...overrides,
  })
  const changeSet = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_manager',
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const overlay = async () =>
    (await loadLiveOverlay(app, tenant, { menuId: menu.id, venueId }, { now: night }))?.overlay

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-sold-out-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Sold out action club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' })).id as VenueId
    menu = await provisionMenu(app, tenant, venueId)
    emptyVenueId = (await provisionVenue(app, tenant, { name: 'No menu', slug: 'no-menu' }))
      .id as VenueId
    const section = newId('nd')
    const result = await apply(
      app,
      tenant,
      changeSet([
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
        ...[item, other].flatMap((id, index) => [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          manual(id, 'name', { bg_BG: `Негрони ${index}`, en_US: `Negroni ${index}` }),
          manual(id, 'price', eur(1250)),
          manual(id, 'allergens', []),
          { op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' },
        ]),
      ]),
    )
    expect(result.rejected).toEqual([])
    await publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_manager' },
      { now: night },
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'item_first_published',
        'publish_pointers',
        'snapshots',
        'events',
        'field_values',
        'placements',
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

  it('marks the item, queues publish-live for the menu, and the overlay lists it', async () => {
    sent.length = 0
    expect(await setItemsSoldOut(scope(), services, { itemIds: [item], soldOut: true })).toEqual({
      ok: true,
      changed: 1,
      liveQueued: true,
    })
    expect(sent).toEqual([
      { name: JOB_NAMES.publishLive, data: { tenantId: tenant, menuId: menu.id, venueId } },
    ])
    expect((await overlay())?.items).toEqual({ [item]: { sold_out: true } })
  })

  it('asks for live.json again on a repeat (a retry repairs a lost job), changing nothing', async () => {
    sent.length = 0
    expect(await setItemsSoldOut(scope(), services, { itemIds: [item], soldOut: true })).toEqual({
      ok: true,
      changed: 0,
      liveQueued: true,
    })
    expect(sent).toHaveLength(1)
  })

  it('takes the mark off again', async () => {
    expect(
      await setItemsSoldOut(scope(), services, { itemIds: [item], soldOut: false }),
    ).toMatchObject({
      ok: true,
      changed: 1,
    })
    expect((await overlay())?.items).toEqual({})
  })

  it('refuses a person whose role may not mark, and writes and queues nothing', async () => {
    sent.length = 0
    expect(
      await setItemsSoldOut(scope({ canMark: false }), services, {
        itemIds: [item],
        soldOut: true,
      }),
    ).toEqual({ ok: false, error: 'not_allowed' })
    expect(sent).toEqual([])
    expect((await overlay())?.items).toEqual({})
  })

  it('keeps the mark when the job cannot be queued, and says so', async () => {
    failQueue = true
    try {
      expect(await setItemsSoldOut(scope(), services, { itemIds: [item], soldOut: true })).toEqual({
        ok: true,
        changed: 1,
        liveQueued: false,
      })
    } finally {
      failQueue = false
    }
    expect((await overlay())?.items).toEqual({ [item]: { sold_out: true } })
    await setItemsSoldOut(scope(), services, { itemIds: [item], soldOut: false })
  })

  it("refuses a venue without a menu, ids that are not items, and another tenant's venue", async () => {
    expect(
      await setItemsSoldOut(scope({ venueId: emptyVenueId }), services, {
        itemIds: [item],
        soldOut: true,
      }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(
      await setItemsSoldOut(scope(), services, { itemIds: [menu.id as string], soldOut: true }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(
      await setItemsSoldOut(scope(), services, { itemIds: [newId('nd')], soldOut: true }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(
      await setItemsSoldOut(scope({ tenantId: otherTenant }), services, {
        itemIds: [item],
        soldOut: true,
      }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(await setItemsSoldOut(scope(), services, { itemIds: [], soldOut: true })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect((await overlay())?.items).toEqual({})
  })

  describe('the item sheet reads the same state', () => {
    const sheet = (itemId: string, canMarkSoldOut: boolean): [SheetScope, SheetServices] => [
      { pool: app, tenantId: tenant, venueId, itemId, canMarkSoldOut },
      { store: undefined as never },
    ]

    // The sheet resolves on the real clock, so this test marks on the real clock too.
    const realClock: SoldOutServices = { ...services, now: () => new Date() }

    it('says on sale, then sold out tonight after a mark, and gives the role as canMark', async () => {
      const [mayMark, mayMarkServices] = sheet(other, true)
      expect((await loadItemSheet(mayMark, mayMarkServices))?.sale).toEqual({
        soldOutTonight: false,
        offSale: null,
        canMark: true,
      })
      await setItemsSoldOut(scope(), realClock, { itemIds: [other], soldOut: true })
      expect((await loadItemSheet(mayMark, mayMarkServices))?.sale).toEqual({
        soldOutTonight: true,
        offSale: null,
        canMark: true,
      })
      const [mayNot, mayNotServices] = sheet(other, false)
      expect((await loadItemSheet(mayNot, mayNotServices))?.sale.canMark).toBe(false)

      await setItemsSoldOut(scope(), realClock, { itemIds: [other], soldOut: false })
      expect((await loadItemSheet(mayMark, mayMarkServices))?.sale.soldOutTonight).toBe(false)
    })

    it('does not count the mark of an earlier evening', async () => {
      // `services` marks as of Friday 23:00 on 2026-10-09, long past on the real clock.
      await setItemsSoldOut(scope(), services, { itemIds: [other], soldOut: true })
      const [mayMark, mayMarkServices] = sheet(other, true)
      expect((await loadItemSheet(mayMark, mayMarkServices))?.sale.soldOutTonight).toBe(false)
      await setItemsSoldOut(scope(), services, { itemIds: [other], soldOut: false })
    })
  })
})
