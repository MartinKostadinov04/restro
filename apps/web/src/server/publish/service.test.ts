// "Publish now" and "Roll back" against a real Postgres, as the restro_app role (brief S3-01b):
// who may do what, what is queued with which payload, a rollback moving the pointer, and the
// refusals. The queue is a fake; the worker side is tested in apps/worker.
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
  loadCurrentSnapshot,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { readPublishRules } from './load'
import {
  type PublishScope,
  type PublishServices,
  publishNow,
  rollback,
  savePublishRules,
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

  describe('the venue’s publishing rules (CF-09b)', () => {
    const rules = (mode: string, newItems: string) => ({ afterSync: mode, newItems })

    it('start as what the integration says, or the defaults when it says nothing', async () => {
      expect(await readPublishRules(app, tenant, venueId)).toEqual({
        afterSync: 'auto',
        newItems: 'show',
        inherited: true,
      })
      // A venue linked to an integration that has its own old rule follows it, and says so.
      const integration = newId('in')
      await owner.query(
        `insert into restro.integrations (id, tenant_id, kind, host, config)
         values ($1, $2, 'barsy', 'rules.test', '{"publish":{"after_sync":"manual","new_items":"hold"}}')`,
        [integration, tenant],
      )
      await owner.query(
        `insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id)
         values ($1, $2, 1, 'Main bar', $3)`,
        [tenant, integration, venueId],
      )
      expect(await readPublishRules(app, tenant, venueId)).toEqual({
        afterSync: 'manual',
        newItems: 'hold',
        inherited: true,
      })
    })

    it('saves both rules as the venue’s own, which then win over the integration’s', async () => {
      expect(await savePublishRules(scope(), rules('auto', 'show'))).toEqual({
        ok: true,
        queued: true,
      })
      expect(await readPublishRules(app, tenant, venueId)).toEqual({
        afterSync: 'auto',
        newItems: 'show',
        inherited: false,
      })
      // Only this venue: the other one still follows the (unlinked) defaults.
      expect(await readPublishRules(app, tenant, emptyVenueId)).toMatchObject({ inherited: true })
      // The integration's rule is not rewritten.
      const { rows } = await owner.query(
        `select config -> 'publish' as publish from restro.integrations where tenant_id = $1`,
        [tenant],
      )
      expect(rows[0]?.publish).toEqual({ after_sync: 'manual', new_items: 'hold' })
    })

    it('queues nothing and publishes nothing by itself', async () => {
      sent.length = 0
      await savePublishRules(scope(), rules('manual', 'hold'))
      expect(sent).toEqual([])
      expect(await readPublishRules(app, tenant, venueId)).toMatchObject({
        afterSync: 'manual',
        newItems: 'hold',
      })
    })

    it('is for owners and admins only, and writes nothing for anyone else', async () => {
      await savePublishRules(scope(), rules('auto', 'show'))
      expect(await savePublishRules(scope({ canPublish: false }), rules('manual', 'hold'))).toEqual(
        {
          ok: false,
          error: 'not_allowed',
        },
      )
      expect(await readPublishRules(app, tenant, venueId)).toMatchObject({
        afterSync: 'auto',
        newItems: 'show',
      })
    })

    it('refuses a value outside the lists and a venue of another organisation', async () => {
      expect(await savePublishRules(scope(), rules('later', 'hold'))).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(await savePublishRules(scope(), rules('auto', 'hide'))).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(
        await savePublishRules(scope({ tenantId: otherTenant }), rules('manual', 'hold')),
      ).toEqual({ ok: false, error: 'not_found' })
      expect(await readPublishRules(app, tenant, venueId)).toMatchObject({
        afterSync: 'auto',
        newItems: 'show',
      })
    })
  })
})
