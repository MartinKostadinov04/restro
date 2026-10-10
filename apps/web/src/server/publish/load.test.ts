// The Publish tab's data and actions against a real Postgres, as the restro_app role (brief S3-05):
// what the live card, the changes, the held banner and the history say; "return to this version"
// pausing automatic publishing; approving and rejecting a held publish; the preview; who may do
// what; and another organisation seeing none of it. The queue is a fake.
import {
  autoPublishPaused,
  type ChangeSet,
  JOB_NAMES,
  type NodeId,
  newId,
  type ProducedJobName,
  type SnapshotId,
  type VenueId,
} from '@restro/core'
import {
  apply,
  createIntegration,
  finishJobRun,
  loadCurrentSnapshot,
  mapBarsyVenue,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  setAutoPublishPaused,
  startJobRun,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { createPool, type DbPool, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { saveSyncSettings } from '../integration/service'
import { appDatabaseUrl, hasDatabase, openOwnerPool } from '../test-database'
import { loadHistoryPage, loadPublishView, type ViewDeps, type ViewScope } from './load'
import {
  approveHeld,
  type PublishScope,
  type PublishServices,
  previewDraft,
  rejectHeldPublish,
  rollback,
} from './service'
import { isLiveEntry, isReturnable } from './view'

describe.skipIf(!hasDatabase)('the Publish tab (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: VenueId
  let menu: ProvisionedMenu
  let integrationId: string
  let section: NodeId
  const items: NodeId[] = []
  const snapshotIds: Record<string, SnapshotId> = {}

  const sent: { name: string; data: Record<string, unknown> }[] = []
  const services: PublishServices = {
    async enqueue<N extends ProducedJobName>(name: N, data: object) {
      sent.push({ name, data: data as Record<string, unknown> })
      return 'job-1'
    },
  }
  const scope = (overrides: Partial<PublishScope> = {}): PublishScope => ({
    pool: app,
    tenantId: tenant,
    venueId,
    actor: 'user:us_maria',
    canPublish: true,
    ...overrides,
  })
  const viewScope = (overrides: Partial<ViewScope> = {}): ViewScope => ({
    pool: app,
    tenantId: tenant,
    venue: { id: venueId, slug: 'main', timezone: 'Europe/Sofia' },
    canPublish: true,
    ...overrides,
  })
  const deps: ViewDeps = {
    personNames: async (_tenant, ids) =>
      new Map(ids.flatMap((id) => (id === 'us_maria' ? [[id, 'Maria Ivanova'] as const] : []))),
  }
  const view = (overrides: Partial<ViewScope> = {}) => loadPublishView(viewScope(overrides), deps)

  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const changeSet = (ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_maria',
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  async function change(ops: unknown[]) {
    expect((await apply(app, tenant, changeSet(ops))).rejected).toEqual([])
  }
  const publish = (
    reason: 'manual' | 'auto_sync',
    minutes: number,
    extra: { approveHold?: SnapshotId } = {},
  ) =>
    publishMenu(
      app,
      tenant,
      {
        menuId: menu.id,
        venueId,
        reason,
        actor: reason === 'manual' ? 'user:us_maria' : `integration:${integrationId}`,
        ...extra,
      },
      { now: new Date(Date.parse('2026-10-09T18:00:00Z') + minutes * 60_000) },
    )
  const configOf = async () =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, integrationId)),
      )
    )[0]?.config
  const current = () => loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-publish-tab-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Publish tab club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' })).id as VenueId
    menu = await provisionMenu(app, tenant, venueId)
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'tab.test' })).id
    await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 10, name: 'Demo' }])
    expect((await mapBarsyVenue(app, tenant, integrationId, 10, venueId)).ok).toBe(true)

    section = newId('nd')
    const created = Array.from({ length: 5 }, () => newId('nd'))
    items.push(...created)
    await change([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      ...created.flatMap((id, index) => [
        { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
        manual(id, 'name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
        manual(id, 'price', eur(500 + index * 100)),
        manual(id, 'allergens', []),
        { op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' },
      ]),
    ])
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

  describe('before anything is published', () => {
    it('has no live version; every item is waiting; the history is empty', async () => {
      const before = await view()
      expect(before).toMatchObject({
        menu: 'ready',
        live: null,
        held: null,
        paused: false,
        busy: null,
        lastRun: null,
        canPublish: true,
        history: { entries: [], nextBeforeVersion: null },
      })
      expect(before.draft.state).toBe('ready')
      if (before.draft.state !== 'ready') throw new Error('the draft should be ready')
      expect(before.draft.changes.added).toHaveLength(5)
      expect(before.draft.changes.total).toBe(5)
      expect(before.draft.changes.identical).toBe(false)
      expect(before.draft.staleOverrides).toEqual([])
    })

    it('says "no menu" for a venue without one', async () => {
      const bare = (await provisionVenue(app, tenant, { name: 'Bare', slug: 'bare' })).id
      const result = await view({ venue: { id: bare, slug: 'bare', timezone: 'Europe/Sofia' } })
      expect(result).toMatchObject({ menu: 'none', live: null, held: null })
    })

    it('rolls back nothing, with a clear answer', async () => {
      expect(await rollback(scope(), services, newId('sn'))).toEqual({
        ok: false,
        error: 'nothing_published',
      })
      expect(autoPublishPaused(await configOf())).toBe(false)
    })
  })

  describe('after publishing', () => {
    it('shows version 1 as live, with who and when, and nothing waiting', async () => {
      const first = await publish('manual', 0)
      snapshotIds.v1 = first.snapshot.id
      const after = await view()
      expect(after.live).toEqual({
        version: 1,
        publishedAt: '2026-10-09T18:00:00.000Z',
        reason: 'manual',
        actor: { kind: 'person', name: 'Maria Ivanova' },
        returned: null,
      })
      if (after.draft.state !== 'ready') throw new Error('the draft should be ready')
      expect(after.draft.changes).toMatchObject({ total: 0, identical: true, added: [] })
      expect(after.history.entries).toMatchObject([
        { version: 1, first: true, counts: null, status: 'published' },
      ])
      const [only] = after.history.entries
      expect(only && isLiveEntry(only, after.live?.version ?? null)).toBe(true)
      expect(only && isReturnable(only, after.live?.version ?? null)).toBe(false)
    })

    it('counts a price change as one change waiting, and a publish clears it', async () => {
      await change([manual(items[1] as string, 'price', eur(650))])
      const waiting = await view()
      if (waiting.draft.state !== 'ready') throw new Error('the draft should be ready')
      expect(waiting.draft.changes.total).toBe(1)
      expect(waiting.draft.changes.priceChanged).toMatchObject([
        { id: items[1], from: eur(600), to: eur(650) },
      ])
      expect(waiting.draft.changes.identical).toBe(false)

      const second = await publish('auto_sync', 5)
      snapshotIds.v2 = second.snapshot.id
      const done = await view()
      expect(done.live).toMatchObject({
        version: 2,
        reason: 'auto_sync',
        actor: { kind: 'sync' },
      })
      const liveVersion = done.live?.version ?? null
      expect(
        done.history.entries.map((entry) => [
          entry.version,
          isLiveEntry(entry, liveVersion),
          isReturnable(entry, liveVersion),
        ]),
      ).toEqual([
        [2, true, false],
        [1, false, true],
      ])
      expect(done.history.entries[0]?.counts).toEqual({
        total: 1,
        added: 0,
        hidden: 0,
        priceChanged: 1,
        renamed: 0,
        otherChanged: 0,
        areas: 0,
      })
    })
  })

  describe('returning to an earlier version', () => {
    it('moves the live version back, pauses automatic publishing, and queues the files', async () => {
      sent.length = 0
      expect(autoPublishPaused(await configOf())).toBe(false)
      expect(await rollback(scope(), services, snapshotIds.v1 as string)).toEqual({
        ok: true,
        queued: true,
      })
      expect((await current())?.id).toBe(snapshotIds.v1)
      expect(autoPublishPaused(await configOf())).toBe(true)
      expect(sent).toEqual([
        { name: JOB_NAMES.publishFiles, data: { tenantId: tenant, menuId: menu.id, venueId } },
      ])

      const after = await view()
      expect(after.paused).toBe(true)
      expect(after.live).toMatchObject({
        version: 1,
        returned: { actor: { kind: 'person', name: 'Maria Ivanova' } },
      })
      // The draft is still the newer menu: the price change waits.
      if (after.draft.state !== 'ready') throw new Error('the draft should be ready')
      expect(after.draft.changes.total).toBe(1)
      const liveVersion = after.live?.version ?? null
      expect(
        after.history.entries.map((entry) => [
          entry.version,
          entry.reason,
          isLiveEntry(entry, liveVersion),
          isReturnable(entry, liveVersion),
        ]),
      ).toEqual([
        [3, 'rollback', false, false],
        [2, 'auto_sync', false, true],
        [1, 'manual', true, false],
      ])
      expect(after.history.entries[0]).toMatchObject({ restoresVersion: 1, counts: null })
    })

    it('keeps the pause when the form saves the sync settings (they do not own it)', async () => {
      const result = await saveSyncSettings(
        {
          pool: app,
          tenantId: tenant,
          venue: { id: venueId, name: 'Main', timezone: 'Europe/Sofia' },
          canManage: true,
        },
        {
          schedule: {
            incremental_enabled: true,
            incremental_minutes: 5,
            full_pull_enabled: true,
            full_pull_time: '12:00',
          },
          publish: { after_sync: 'auto', new_items: 'show' },
        },
      )
      expect(result).toEqual({ ok: true })
      expect(autoPublishPaused(await configOf())).toBe(true)
    })

    it('does not pause again, or change the pause, when the version is current already', async () => {
      sent.length = 0
      expect(await rollback(scope(), services, snapshotIds.v1 as string)).toEqual({
        ok: true,
        queued: false,
      })
      expect(sent).toEqual([])
      expect(autoPublishPaused(await configOf())).toBe(true)
    })

    it('takes a pause it set off again when the return fails; leaves an earlier pause alone', async () => {
      await setAutoPublishPaused(app, tenant, integrationId, false)
      expect(await rollback(scope(), services, newId('sn'))).toEqual({
        ok: false,
        error: 'not_restorable',
      })
      expect(autoPublishPaused(await configOf())).toBe(false)

      await setAutoPublishPaused(app, tenant, integrationId, true)
      expect(await rollback(scope(), services, newId('sn'))).toEqual({
        ok: false,
        error: 'not_restorable',
      })
      // It was paused before this call: still paused.
      expect(autoPublishPaused(await configOf())).toBe(true)
    })

    it('is for owners and admins only, and changes nothing for anyone else', async () => {
      await setAutoPublishPaused(app, tenant, integrationId, false)
      expect(
        await rollback(scope({ canPublish: false }), services, snapshotIds.v2 as string),
      ).toEqual({ ok: false, error: 'not_allowed' })
      expect(autoPublishPaused(await configOf())).toBe(false)
      expect((await current())?.id).toBe(snapshotIds.v1)
    })

    it('can go forward again; the pause follows every return', async () => {
      expect(await rollback(scope(), services, snapshotIds.v2 as string)).toEqual({
        ok: true,
        queued: true,
      })
      expect((await current())?.id).toBe(snapshotIds.v2)
      expect(autoPublishPaused(await configOf())).toBe(true)
      await setAutoPublishPaused(app, tenant, integrationId, false)
    })

    it('pauses nothing for a venue with no barsy integration', async () => {
      const lone = (await provisionVenue(app, tenant, { name: 'Lone', slug: 'lone' })).id as VenueId
      const loneMenu = await provisionMenu(app, tenant, lone)
      const section2 = newId('nd')
      const item = newId('nd')
      await change([
        {
          op: 'createNode',
          id: section2,
          nodeType: 'section',
          parent: { id: loneMenu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section2, 'title', { bg_BG: 'Бира', en_US: 'Beer' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Лагер', en_US: 'Lager' }),
        manual(item, 'price', eur(400)),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section2 }, sortKey: 'end' },
      ])
      const first = await publishMenu(app, tenant, {
        menuId: loneMenu.id,
        venueId: lone,
        reason: 'manual',
        actor: 'user:us_maria',
      })
      await change([manual(item, 'price', eur(450))])
      const second = await publishMenu(app, tenant, {
        menuId: loneMenu.id,
        venueId: lone,
        reason: 'manual',
        actor: 'user:us_maria',
      })
      expect(second.snapshot.version).toBe(2)
      expect(
        await rollback(scope({ venueId: lone }), services, first.snapshot.id as string),
      ).toEqual({ ok: true, queued: true })
      expect(autoPublishPaused(await configOf())).toBe(false)
    })
  })

  describe('a held publish (V11)', () => {
    let heldId: string

    it('shows what it would hide, as a share of what is live', async () => {
      // Three of five items hidden: more than 30% of what is visible.
      await change(items.slice(0, 3).map((id) => manual(id, 'visible', false)))
      const held = await publish('auto_sync', 20)
      expect(held.status).toBe('held')
      heldId = held.snapshot.id

      const result = await view()
      expect(result.held).toMatchObject({
        snapshotId: heldId,
        hidden: 3,
        previouslyVisible: 5,
        percent: 60,
        outdated: false,
      })
      expect(result.held?.items.map((item) => item.id).sort()).toEqual(items.slice(0, 3).sort())
      expect(result.held?.items[0]?.name).toMatchObject({
        bg_BG: expect.stringContaining('Напитка'),
      })
      // The held publish is in the history, and cannot be returned to.
      expect(result.history.entries[0]).toMatchObject({
        status: 'held',
        held: { hidden: 3, previouslyVisible: 5 },
      })
      const [heldEntry] = result.history.entries
      expect(heldEntry && isReturnable(heldEntry, result.live?.version ?? null)).toBe(false)
    })

    it('goes out of date when the menu moves on', async () => {
      await change([manual(items[3] as string, 'visible', false)])
      expect((await view()).held).toMatchObject({ snapshotId: heldId, outdated: true })
      // Showing an item again clears the builder's hide (a hide is never undone by writing true).
      await change([
        {
          op: 'clearField',
          node: { id: items[3] },
          fieldKey: 'visible',
          layer: 'manual',
          scope: 'master',
        },
      ])
      expect((await view()).held).toMatchObject({ outdated: false })
    })

    it('approving queues a manual publish that names the held snapshot', async () => {
      sent.length = 0
      expect(await approveHeld(scope(), services, heldId)).toEqual({ ok: true, queued: true })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishMenu,
          data: {
            tenantId: tenant,
            menuId: menu.id,
            venueId,
            reason: 'manual',
            actor: 'user:us_maria',
            approveHold: heldId,
          },
        },
      ])
    })

    it('refuses to approve what is not held, what is malformed, and for the wrong role', async () => {
      sent.length = 0
      expect(await approveHeld(scope(), services, newId('sn'))).toEqual({
        ok: false,
        error: 'held_not_found',
      })
      expect(await approveHeld(scope(), services, 'sn_nope')).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(await approveHeld(scope({ canPublish: false }), services, heldId)).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(sent).toEqual([])
    })

    it('rejecting turns down every held publish of the menu, and leaves the live menu alone', async () => {
      // A second hold, with different content.
      await change([manual(items[3] as string, 'visible', false)])
      const second = await publish('auto_sync', 25)
      expect(second.status).toBe('held')
      const liveBefore = (await current())?.id

      expect(await rejectHeldPublish(scope({ canPublish: false }), heldId)).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(await rejectHeldPublish(scope(), newId('sn'))).toEqual({
        ok: false,
        error: 'held_not_found',
      })
      expect(await rejectHeldPublish(scope(), second.snapshot.id)).toEqual({
        ok: true,
        queued: false,
      })

      const result = await view()
      expect(result.held).toBeNull()
      expect((await current())?.id).toBe(liveBefore)
      expect(result.history.entries.filter((entry) => entry.status === 'held')).toEqual([])
      expect(result.history.entries.filter((entry) => entry.status === 'rejected')).toHaveLength(2)
      // Already decided: nothing left to approve.
      expect(await approveHeld(scope(), services, heldId)).toEqual({
        ok: false,
        error: 'held_not_found',
      })
    })
  })

  describe('the preview', () => {
    it('builds the draft in memory and writes nothing', async () => {
      const rows = async () =>
        (
          await owner.query(
            'select count(*)::int as n from restro.snapshots where tenant_id = $1',
            [tenant],
          )
        ).rows[0].n as number
      const before = await rows()
      const preview = await previewDraft(scope())
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(preview.snapshot.schema).toBe('menu-snapshot/1')
      expect(Object.keys(preview.snapshot.items).length).toBeGreaterThan(0)
      expect(preview.overlay.items).toEqual({})
      expect(await rows()).toBe(before)
      expect(JSON.stringify(preview.snapshot)).not.toMatch(/user:us_|integration:/)
    })

    it('says why there is nothing to show, and works for any member', async () => {
      expect(await previewDraft({ ...scope({ canPublish: false }) })).toMatchObject({ ok: true })
      const empty = (await provisionVenue(app, tenant, { name: 'Empty', slug: 'empty' })).id
      expect(
        await previewDraft({ pool: app, tenantId: tenant, venueId: empty as VenueId }),
      ).toEqual({
        ok: false,
        error: 'no_menu',
      })
      const noItems = (await provisionVenue(app, tenant, { name: 'No items', slug: 'noitems' }))
        .id as VenueId
      await provisionMenu(app, tenant, noItems)
      expect(await previewDraft({ pool: app, tenantId: tenant, venueId: noItems })).toEqual({
        ok: false,
        error: 'nothing_visible',
      })
    })

    it('shows "nothing visible" in the view when every item is hidden', async () => {
      const noItems = (await provisionVenue(app, tenant, { name: 'None here', slug: 'nonehere' }))
        .id as VenueId
      await provisionMenu(app, tenant, noItems)
      const result = await view({
        venue: { id: noItems, slug: 'nonehere', timezone: 'Europe/Sofia' },
      })
      expect(result.draft).toEqual({ state: 'nothing_visible' })
      expect(result.live).toBeNull()
    })
  })

  describe('the last publish run, and a queue that is not there', () => {
    it('reads how the latest publish ended', async () => {
      const started = await startJobRun(app, tenant, { kind: 'publish_menu' })
      expect((await view()).lastRun).toEqual({
        id: started.id,
        state: 'running',
        version: null,
        refusal: null,
      })
      await finishJobRun(app, tenant, started.id, {
        status: 'completed',
        counters: { snapshot_version: 7, published: 1 },
        summary: 'published version 7',
      })
      expect((await view()).lastRun).toEqual({
        id: started.id,
        state: 'published',
        version: 7,
        refusal: null,
      })
      const refused = await startJobRun(app, tenant, { kind: 'publish_menu' })
      await finishJobRun(app, tenant, refused.id, {
        status: 'failed',
        counters: { refused: 1 },
        summary: 'publish refused: no_visible_items (V10)',
      })
      expect((await view()).lastRun).toMatchObject({
        state: 'refused',
        refusal: 'no_visible_items',
      })
    })

    it('does not see another organisation’s runs, versions or held publishes', async () => {
      const other = await loadPublishView(
        {
          pool: app,
          tenantId: otherTenant,
          venue: { id: venueId, slug: 'main', timezone: 'Europe/Sofia' },
          canPublish: true,
        },
        deps,
      )
      expect(other).toMatchObject({ menu: 'none', live: null, held: null, lastRun: null })
      expect(other.history.entries).toEqual([])
    })
  })

  describe('the history pages', () => {
    it('lists 20 to a page and continues from the oldest version shown', async () => {
      const many = (await provisionVenue(app, tenant, { name: 'Many', slug: 'many' })).id as VenueId
      const manyMenu = await provisionMenu(app, tenant, many)
      const sec = newId('nd')
      const item = newId('nd')
      await change([
        {
          op: 'createNode',
          id: sec,
          nodeType: 'section',
          parent: { id: manyMenu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(sec, 'title', { bg_BG: 'Вино', en_US: 'Wine' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Мерло', en_US: 'Merlot' }),
        manual(item, 'price', eur(1000)),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: sec }, sortKey: 'end' },
      ])
      for (let version = 1; version <= 23; version++) {
        await change([manual(item, 'price', eur(1000 + version))])
        await publishMenu(app, tenant, {
          menuId: manyMenu.id,
          venueId: many,
          reason: 'manual',
          actor: 'user:us_maria',
        })
      }
      const scopeMany = viewScope({ venue: { id: many, slug: 'many', timezone: 'Europe/Sofia' } })
      const first = await loadHistoryPage(scopeMany, manyMenu.id, {}, deps)
      expect(first.entries).toHaveLength(20)
      expect(first.entries[0]?.version).toBe(23)
      expect(first.entries[0]).toMatchObject({ counts: { total: 1, priceChanged: 1 } })
      expect(first.nextBeforeVersion).toBe(4)

      const second = await loadHistoryPage(
        scopeMany,
        manyMenu.id,
        { beforeVersion: first.nextBeforeVersion ?? 0 },
        deps,
      )
      expect(second.entries.map((entry) => entry.version)).toEqual([3, 2, 1])
      expect(second.nextBeforeVersion).toBeNull()
      // The oldest version on the first page is compared with the one on the next page's side.
      expect(first.entries.at(-1)).toMatchObject({ version: 4, counts: { priceChanged: 1 } })
      expect(second.entries.at(-1)).toMatchObject({ version: 1, first: true, counts: null })
    })

    it('compares a version after a return with the version the menu was returned to', async () => {
      const lone = (await provisionVenue(app, tenant, { name: 'Return', slug: 'return' }))
        .id as VenueId
      const loneMenu = await provisionMenu(app, tenant, lone)
      const sec = newId('nd')
      const item = newId('nd')
      await change([
        {
          op: 'createNode',
          id: sec,
          nodeType: 'section',
          parent: { id: loneMenu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(sec, 'title', { bg_BG: 'Вино', en_US: 'Wine' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Мерло', en_US: 'Merlot' }),
        manual(item, 'price', eur(1000)),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: sec }, sortKey: 'end' },
      ])
      const publishLone = () =>
        publishMenu(app, tenant, {
          menuId: loneMenu.id,
          venueId: lone,
          reason: 'manual',
          actor: 'user:us_maria',
        })
      const one = await publishLone()
      await change([manual(item, 'price', eur(1200))])
      await publishLone() // version 2
      const back = await rollback(scope({ venueId: lone }), services, one.snapshot.id as string)
      expect(back).toMatchObject({ ok: true })
      // The price stays at 12,00: this publish is version 4, with version 2's content. Guests had
      // version 1 (10,00), so it changed a price, even though version 2 is the number before it.
      const four = await publishLone()
      expect(four.snapshot.version).toBe(4)

      const scopeLone = viewScope({ venue: { id: lone, slug: 'return', timezone: 'Europe/Sofia' } })
      const page = await loadHistoryPage(scopeLone, loneMenu.id, {}, deps)
      expect(page.entries.map((entry) => entry.version)).toEqual([4, 3, 2, 1])
      expect(page.entries[0]).toMatchObject({ counts: { total: 1, priceChanged: 1 } })
      expect(page.entries[1]).toMatchObject({
        reason: 'rollback',
        restoresVersion: 1,
        counts: null,
      })
      expect(page.entries[2]).toMatchObject({ counts: { total: 1, priceChanged: 1 } })
      expect(page.entries[3]).toMatchObject({ first: true, counts: null })
    })
  })
})
