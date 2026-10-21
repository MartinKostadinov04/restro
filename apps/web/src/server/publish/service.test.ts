// "Publish now" and "Roll back" against a real Postgres, as the restro_app role (brief S3-01b):
// who may do what, what is queued with which payload (also for a menu that is not the live one,
// S4), a rollback moving the pointer, the refusals, and the Automation settings (D82, D96). The
// queue is a fake; the worker side is tested in apps/worker.
import {
  type ChangeSet,
  JOB_NAMES,
  newId,
  type ProducedJobName,
  type SnapshotId,
  type VenueId,
} from '@restro/core'
import {
  apply,
  createMenu,
  deleteMenu,
  loadCurrentSnapshot,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  setVenueAutoPublishPaused,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { readAutomation, readOwnPause, readPaused } from './load'
import {
  type PublishScope,
  type PublishServices,
  publishNow,
  resumeAutoPublish,
  rollback,
  saveAutomation,
} from './service'

describe.skipIf(!hasDatabase)('publish now and rollback (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: VenueId
  let emptyVenueId: VenueId
  let menu: ProvisionedMenu
  let v1: SnapshotId
  let v2: SnapshotId

  const sent: { name: string; data: object }[] = []
  let answer: string | null = 'job-1'
  let failQueue = false
  const services: PublishServices = {
    async enqueue<N extends ProducedJobName>(name: N, data: object) {
      if (failQueue) throw new Error('queue down')
      sent.push({ name, data })
      return answer
    },
  }
  const scope = (overrides: Partial<PublishScope> = {}): PublishScope => ({
    pool: app,
    tenantId: tenant,
    venueId,
    actor: 'user:us_publisher',
    canPublish: true,
    ...overrides,
  })

  const changeSet = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_publisher',
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
  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_publisher' },
      { now: new Date(Date.parse('2026-10-09T18:00:00Z') + minutes * 60_000) },
    )

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-publish-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Publish action club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as VenueId
    menu = await provisionMenu(app, tenant, venueId)
    emptyVenueId = (
      await provisionVenue(app, tenant, { name: 'No menu', slug: testSlug('no-menu') })
    ).id as VenueId
    const section = newId('nd')
    const item = newId('nd')
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
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Негрони', en_US: 'Negroni' }),
        manual(item, 'price', eur(1250)),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ]),
    )
    expect(result.rejected).toEqual([])
    v1 = (await publish(0)).snapshot.id
    expect(
      (await apply(app, tenant, changeSet([manual(item, 'price', eur(1400))]))).rejected,
    ).toEqual([])
    v2 = (await publish(5)).snapshot.id
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
        'barsy_venues',
        'integrations',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  describe('publishNow', () => {
    it('queues a manual publish of the venue’s menu, with the person as the actor', async () => {
      sent.length = 0
      expect(await publishNow(scope(), services)).toEqual({ ok: true, queued: true })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishMenu,
          data: {
            tenantId: tenant,
            menuId: menu.id,
            venueId,
            reason: 'manual',
            actor: 'user:us_publisher',
          },
        },
      ])
    })

    it('is fine when an identical manual publish is already waiting', async () => {
      answer = null
      expect(await publishNow(scope(), services)).toEqual({ ok: true, queued: true })
      answer = 'job-1'
    })

    it('is for owners and admins only, and queues nothing for anyone else', async () => {
      sent.length = 0
      expect(await publishNow(scope({ canPublish: false }), services)).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(sent).toEqual([])
    })

    it('says so when the venue has no menu, and when the queue is down', async () => {
      expect(await publishNow(scope({ venueId: emptyVenueId }), services)).toEqual({
        ok: false,
        error: 'no_menu',
      })
      failQueue = true
      try {
        expect(await publishNow(scope(), services)).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
      } finally {
        failQueue = false
      }
    })

    it('does not see another organisation’s menu', async () => {
      expect(await publishNow(scope({ tenantId: otherTenant }), services)).toEqual({
        ok: false,
        error: 'no_menu',
      })
    })

    it('publishes the menu it is given, also one that is not live (S4); refuses one that is not the venue’s in use', async () => {
      const brunch = await createMenu(app, tenant, { venueId, name: 'Brunch' })
      if (!brunch.ok) throw new Error(brunch.reason)
      expect(brunch.menu.live).toBe(false)
      sent.length = 0
      expect(await publishNow(scope(), services, brunch.menu.id)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishMenu,
          data: {
            tenantId: tenant,
            menuId: brunch.menu.id,
            venueId,
            reason: 'manual',
            actor: 'user:us_publisher',
          },
        },
      ])

      sent.length = 0
      // Another venue's menu, a made-up one, a malformed id, a binned one: nothing is queued.
      const otherVenue = (
        await provisionVenue(app, tenant, { name: 'Other', slug: testSlug('other') })
      ).id
      const other = await provisionMenu(app, tenant, otherVenue)
      expect(await publishNow(scope(), services, other.id)).toEqual({ ok: false, error: 'no_menu' })
      expect(await publishNow(scope(), services, newId('nd'))).toEqual({
        ok: false,
        error: 'no_menu',
      })
      expect(await publishNow(scope(), services, 'not-an-id')).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect((await deleteMenu(app, tenant, { venueId, menuId: brunch.menu.id })).ok).toBe(true)
      expect(await publishNow(scope(), services, brunch.menu.id)).toEqual({
        ok: false,
        error: 'no_menu',
      })
      expect(sent).toEqual([])
    })
  })

  describe('rollback', () => {
    it('moves the pointer back and queues the files', async () => {
      sent.length = 0
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(v2)
      expect(await rollback(scope(), services, v1)).toEqual({ ok: true, queued: true })
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(v1)
      expect(sent).toEqual([
        { name: JOB_NAMES.publishFiles, data: { tenantId: tenant, menuId: menu.id, venueId } },
      ])
    })

    it('does nothing when the snapshot is current already', async () => {
      sent.length = 0
      expect(await rollback(scope(), services, v1)).toEqual({ ok: true, queued: false })
      expect(sent).toEqual([])
    })

    it('refuses what is not an earlier publish of this menu', async () => {
      sent.length = 0
      expect(await rollback(scope(), services, newId('sn'))).toEqual({
        ok: false,
        error: 'not_restorable',
      })
      expect(await rollback(scope(), services, 'sn_not-an-id')).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(await rollback(scope(), services, newId('nd') as string)).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(sent).toEqual([])
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(v1)
    })

    it('is for owners and admins only', async () => {
      expect(await rollback(scope({ canPublish: false }), services, v2)).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(v1)
    })

    it('says so when nothing was ever published, or the venue has no menu', async () => {
      const unpublished = (
        await provisionVenue(app, tenant, { name: 'Fresh', slug: testSlug('fresh') })
      ).id as VenueId
      await provisionMenu(app, tenant, unpublished)
      expect(await rollback(scope({ venueId: unpublished }), services, v1)).toEqual({
        ok: false,
        error: 'nothing_published',
      })
      expect(await rollback(scope({ venueId: emptyVenueId }), services, v1)).toEqual({
        ok: false,
        error: 'no_menu',
      })
    })

    it('reports a rollback whose files could not be queued as done but not queued', async () => {
      failQueue = true
      try {
        expect(await rollback(scope(), services, v2)).toEqual({ ok: true, queued: false })
      } finally {
        failQueue = false
      }
      // The pointer did move: the repair is the same publish-files job, queued again later.
      expect((await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.id).toBe(v2)
    })
  })

  describe('the venue’s Automation settings (D82, D96)', () => {
    const sync = { mode: 'auto', incremental_minutes: 5, full_pull_time: '12:00' } as const

    it('refuses a venue without a till: it has nothing to sync', async () => {
      expect(
        await readAutomation(app, tenant, { id: emptyVenueId, timezone: 'Europe/Sofia' }),
      ).toBe(null)
      expect(
        await saveAutomation(scope({ venueId: emptyVenueId }), { sync, afterSync: 'auto' }),
      ).toEqual({ ok: false, error: 'not_found' })
    })

    it('start as what the connection said, and say they are inherited', async () => {
      // A venue linked to a connection that has its own old schedule and rule follows them.
      const integration = newId('in')
      await owner.query(
        `insert into restro.integrations (id, tenant_id, kind, host, config)
         values ($1, $2, 'barsy', 'rules.test',
           '{"publish":{"after_sync":"manual","new_items":"hold"},"schedule":{"incremental_enabled":true,"incremental_minutes":10,"full_pull_enabled":true,"full_pull_time":"06:30"}}')`,
        [integration, tenant],
      )
      await owner.query(
        `insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id)
         values ($1, $2, 1, 'Main bar', $3)`,
        [tenant, integration, venueId],
      )
      expect(await readAutomation(app, tenant, { id: venueId, timezone: 'Europe/Sofia' })).toEqual({
        source: expect.any(String),
        timeZone: 'Europe/Sofia',
        sync: { mode: 'auto', incremental_minutes: 10, full_pull_time: '06:30' },
        syncInherited: true,
        afterSync: 'manual',
        afterSyncInherited: true,
      })
    })

    it('saves both as the venue’s own, which then win over the connection’s', async () => {
      sent.length = 0
      expect(
        await saveAutomation(scope(), {
          sync: { mode: 'manual', incremental_minutes: 15, full_pull_time: '04:00' },
          afterSync: 'auto',
        }),
      ).toEqual({ ok: true, queued: true })
      expect(
        await readAutomation(app, tenant, { id: venueId, timezone: 'Europe/Sofia' }),
      ).toMatchObject({
        sync: { mode: 'manual', incremental_minutes: 15, full_pull_time: '04:00' },
        syncInherited: false,
        afterSync: 'auto',
        afterSyncInherited: false,
      })
      // Nothing is queued or published by a save, and the connection's settings are not rewritten.
      expect(sent).toEqual([])
      const { rows } = await owner.query(
        `select config -> 'publish' as publish from restro.integrations where tenant_id = $1`,
        [tenant],
      )
      expect(rows[0]?.publish).toEqual({ after_sync: 'manual', new_items: 'hold' })
    })

    it('keeps the rollback pause the venue had (the save rewrites the publish settings)', async () => {
      await setVenueAutoPublishPaused(app, tenant, venueId, true)
      expect(await saveAutomation(scope(), { sync, afterSync: 'manual' })).toEqual({
        ok: true,
        queued: true,
      })
      expect(await readOwnPause(app, tenant, venueId)).toBe(true)
      expect(await readPaused(app, tenant, venueId)).toBe(true)
    })

    it('"Resume automatic publishing" takes the pause off and publishes nothing', async () => {
      sent.length = 0
      expect(await resumeAutoPublish(scope({ canPublish: false }))).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(await readPaused(app, tenant, venueId)).toBe(true)
      expect(await resumeAutoPublish(scope())).toEqual({ ok: true, queued: false })
      expect(await readPaused(app, tenant, venueId)).toBe(false)
      expect(sent).toEqual([])
    })

    it('is for owners and admins only, and writes nothing for anyone else', async () => {
      expect(
        await saveAutomation(scope({ canPublish: false }), { sync, afterSync: 'auto' }),
      ).toEqual({ ok: false, error: 'not_allowed' })
      expect(
        await readAutomation(app, tenant, { id: venueId, timezone: 'Europe/Sofia' }),
      ).toMatchObject({
        afterSync: 'manual',
      })
    })

    it('refuses a venue of another organisation', async () => {
      expect(
        await saveAutomation(scope({ tenantId: otherTenant }), { sync, afterSync: 'auto' }),
      ).toEqual({ ok: false, error: 'not_found' })
    })
  })
})
