// publishMenu / rollbackTo / rejectHeld and the readers against Postgres as the restro_app role
// (brief S3-01a, integration tests): versions and the pointer, the no-op, rollback, V10, V11
// with approval and rejection, first-published dates, tenant isolation, concurrency, and the
// database's own refusal to change a snapshot.
import { createPool, type DbPool, itemFirstPublished, snapshots, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId, type SnapshotId } from '../ids'
import * as core from '../index'
import { apply } from './apply'
import * as applyEntry from './index'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import {
  listSnapshots,
  loadCurrentSnapshot,
  loadSnapshot,
  PublishError,
  publishMenu,
  rejectHeld,
  rollbackTo,
} from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

describe('module boundary', () => {
  it('is exported from @restro/core/apply, never from the pure @restro/core entry', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining(['publishMenu', 'rollbackTo', 'rejectHeld', 'loadCurrentSnapshot']),
    )
    expect(Object.keys(core)).not.toContain('publishMenu')
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['buildSnapshot', 'buildLiveOverlay']))
  })
})

describe('input checks (no database needed)', () => {
  const valid = {
    menuId: newId('nd'),
    venueId: newId('vn'),
    reason: 'manual' as const,
    actor: 'user:us_test',
  }

  it.each([
    ['a malformed menu id', { menuId: 'nd_nope' }],
    ['a venue id of another kind', { venueId: newId('tn') }],
    ['an unknown reason', { reason: 'rollback' }],
    ['an actor with personal data', { actor: 'martin@example.com' }],
    ['an approval on an automatic publish', { reason: 'auto_sync', approveHold: newId('sn') }],
    ['an unknown field', { force: true }],
  ])('refuses %s before touching the database', async (_label, overrides) => {
    await expect(
      publishMenu(unusedPool, newId('tn'), { ...valid, ...overrides } as never),
    ).rejects.toMatchObject({ name: 'PublishError', code: 'invalid_input' })
  })
})

describe.skipIf(!hasDatabase)('publishing against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  const EXTERNAL_ID = 'ext102751'
  const INTERNAL_NOTE = 'supplier still owes us two cases'
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  let record: string

  const section = newId('nd')
  /** Four hand-made items and one barsy item: five visible items. */
  const handMade = [newId('nd'), newId('nd'), newId('nd'), newId('nd')] as const
  const barsyItem = newId('nd')
  const versions: Record<string, SnapshotId> = {}

  const base = Date.parse('2026-10-09T18:00:00Z')
  /** The publish clock: `minutes` after a fixed Friday evening. */
  const at = (minutes: number) => new Date(base + minutes * 60_000)

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const barsy = (fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId: EXTERNAL_ID } },
    fieldKey,
    layer: 'barsy',
    scope,
    value,
    sourceRecordId: record,
    mappingVersion: 1,
  })
  async function run(ops: unknown[], source = 'manual') {
    const result = await apply(app, tenant, changeSet(source, ops))
    expect(result.rejected).toEqual([])
  }
  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const publish = (
    reason: 'manual' | 'auto_sync',
    minutes: number,
    extra: { approveHold?: SnapshotId } = {},
  ) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason, actor: 'user:us_test', ...extra },
      { now: at(minutes) },
    )
  const scope = () => ({ menuId: menu.id, venueId })
  const rowCount = async () =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select({ id: snapshots.id }).from(snapshots).where(eq(snapshots.menuId, menu.id)),
      )
    ).length
  const firstPublished = async () =>
    Object.fromEntries(
      (
        await withTenant(app, tenant, (tx) =>
          tx.select().from(itemFirstPublished).where(eq(itemFirstPublished.menuId, menu.id)),
        )
      ).map((row) => [row.nodeId, row.firstPublishedAt.toISOString()]),
    )

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-publish-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Publish test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    record = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${tenant}, ${integration}, 'article', ${EXTERNAL_ID}, 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
    await run([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      ...handMade.flatMap((id, index) => [
        { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
        manual(id, 'name', { bg_BG: `Напитка ${index}`, en_US: `Drink ${index}` }),
        manual(id, 'price', eur(500 + index * 100)),
        manual(id, 'allergens', []),
        { op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' },
      ]),
      manual(handMade[0], 'internal_note', INTERNAL_NOTE),
    ])
    await run(
      [
        { op: 'createNode', id: barsyItem, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'linkSource',
          node: { id: barsyItem },
          link: { integration, externalType: 'article', externalId: EXTERNAL_ID },
        },
        barsy('name', { bg_BG: 'Негрони', en_US: 'Negroni' }),
        barsy('price', eur(1250), `venue:${venueId}`),
        barsy('for_sale', true, `venue:${venueId}`),
        barsy('visible', true),
        barsy('allergens', []),
      ],
      `barsy:${integration}`,
    )
    await run([
      { op: 'setPlacement', item: { id: barsyItem }, section: { id: section }, sortKey: 'end' },
    ])
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  it('publishes version 1 and points at it, with nothing a guest must not see', async () => {
    const result = await publish('manual', 0)
    expect(result).toMatchObject({ status: 'published', previous: null })
    expect(result.snapshot).toMatchObject({ version: 1, status: 'published', reason: 'manual' })
    const body = result.snapshot.body
    expect(body?.snapshot).toMatchObject({
      id: result.snapshot.id,
      version: 1,
      hash: result.snapshot.hash,
      published_at: '2026-10-09T21:00:00+03:00',
      menu_id: menu.id,
      venue_id: venueId,
      edition: ['master', `venue:${venueId}`, 'service:2026-10-09'],
    })
    expect(body?.sections[section]?.items).toEqual([...handMade, barsyItem])
    expect(body?.items[barsyItem]).toMatchObject({ orderable: true, price: eur(1250) })
    expect(body?.items[handMade[0]]?.badges).toEqual(['new'])
    const json = JSON.stringify(body)
    expect(json).not.toContain(EXTERNAL_ID)
    expect(json).not.toContain(INTERNAL_NOTE)

    const current = await loadCurrentSnapshot(app, tenant, scope())
    expect(current?.id).toBe(result.snapshot.id)
    expect(current?.body).toEqual(body)
    versions.v1 = result.snapshot.id
  })

  it('records each published item first-published once', async () => {
    const dates = await firstPublished()
    expect(Object.keys(dates).sort()).toEqual([...handMade, barsyItem].sort())
    expect(new Set(Object.values(dates))).toEqual(new Set([at(0).toISOString()]))
  })

  it('does nothing when the document gives the current content', async () => {
    const result = await publish('manual', 5)
    expect(result.status).toBe('unchanged')
    expect(result.snapshot.id).toBe(versions.v1)
    expect(await rowCount()).toBe(1)
  })

  it('publishes version 2 after a price change, keeping first-published dates', async () => {
    await run([manual(handMade[1], 'price', eur(650))])
    const result = await publish('manual', 10)
    expect(result.status).toBe('published')
    expect(result.snapshot.version).toBe(2)
    expect(result.previous?.id).toBe(versions.v1)
    expect(result.snapshot.body?.items[handMade[1]]?.price).toEqual(eur(650))
    expect(new Set(Object.values(await firstPublished()))).toEqual(new Set([at(0).toISOString()]))
    versions.v2 = result.snapshot.id
  })

  it('rolls the pointer back to version 1 and records the rollback', async () => {
    const result = await rollbackTo(app, tenant, {
      ...scope(),
      snapshotId: versions.v1 as SnapshotId,
      actor: 'user:us_test',
    })
    expect(result.status).toBe('rolled_back')
    expect(result.snapshot.id).toBe(versions.v1)
    expect(result.previous.id).toBe(versions.v2)
    expect(result.record).toMatchObject({
      version: 3,
      reason: 'rollback',
      status: 'published',
      restoresSnapshotId: versions.v1,
    })
    expect((await loadCurrentSnapshot(app, tenant, scope()))?.id).toBe(versions.v1)
    const rollbackRow = await loadSnapshot(app, tenant, result.record?.id ?? '')
    expect(rollbackRow?.body).toBeNull()

    // Rolling back to the current snapshot changes nothing; a rollback row is not a target.
    await expect(
      rollbackTo(app, tenant, {
        ...scope(),
        snapshotId: versions.v1 as SnapshotId,
        actor: 'system',
      }),
    ).resolves.toMatchObject({ status: 'unchanged', record: null })
    await expect(
      rollbackTo(app, tenant, {
        ...scope(),
        snapshotId: result.record?.id as SnapshotId,
        actor: 'system',
      }),
    ).rejects.toMatchObject({ code: 'not_restorable' })

    // The history, newest first, in pages.
    const first = await listSnapshots(app, tenant, { ...scope(), limit: 2 })
    expect(first.snapshots.map((row) => row.version)).toEqual([3, 2])
    expect(first.snapshots[0]).not.toHaveProperty('body')
    const second = await listSnapshots(app, tenant, {
      ...scope(),
      limit: 2,
      beforeVersion: first.nextBeforeVersion ?? 0,
    })
    expect(second).toEqual({
      snapshots: [expect.objectContaining({ version: 1 })],
      nextBeforeVersion: null,
    })

    // The next publish compares with the restored snapshot: the document's content comes back.
    const again = await publish('manual', 15)
    expect(again.status).toBe('published')
    expect(again.snapshot.version).toBe(4)
    expect(again.snapshot.hash).toBe((await loadSnapshot(app, tenant, versions.v2 ?? ''))?.hash)
    versions.v4 = again.snapshot.id
  })

  it('V11: holds an automatic publish that hides 40% of the items, then publishes it on approval', async () => {
    await run([manual(handMade[2], 'visible', false), manual(handMade[3], 'visible', false)])
    const held = await publish('auto_sync', 20)
    expect(held.status).toBe('held')
    expect(held.snapshot).toMatchObject({
      version: 5,
      status: 'held',
      reason: 'auto_sync',
      publishedAt: null,
      heldReason: {
        code: 'V11',
        hidden: 2,
        previously_visible: 5,
        hidden_item_ids: [handMade[2], handMade[3]].sort(),
      },
    })
    expect((await loadCurrentSnapshot(app, tenant, scope()))?.id).toBe(versions.v4)

    // The next sync finds the same content: the same held snapshot, not a second one.
    const again = await publish('auto_sync', 25)
    expect(again).toMatchObject({ status: 'held', snapshot: { id: held.snapshot.id } })
    expect(await rowCount()).toBe(5)

    const approved = await publish('manual', 30, { approveHold: held.snapshot.id })
    expect(approved.status).toBe('published')
    expect(approved.snapshot).toMatchObject({
      id: held.snapshot.id,
      version: 5,
      status: 'published',
      decidedBy: 'user:us_test',
    })
    expect((await loadCurrentSnapshot(app, tenant, scope()))?.id).toBe(held.snapshot.id)
    expect(Object.keys(approved.snapshot.body?.items ?? {})).toHaveLength(3)
    await expect(publish('manual', 31, { approveHold: held.snapshot.id })).rejects.toMatchObject({
      code: 'held_not_found',
    })
  })

  it('V11: a held publish the document has moved on from is outdated, and can be rejected', async () => {
    await run([manual(handMade[1], 'visible', false)])
    const held = await publish('auto_sync', 35)
    expect(held.status).toBe('held')
    await run([manual(handMade[0], 'price', eur(555))])
    await expect(publish('manual', 40, { approveHold: held.snapshot.id })).rejects.toMatchObject({
      code: 'held_outdated',
    })
    const rejected = await rejectHeld(app, tenant, {
      ...scope(),
      snapshotId: held.snapshot.id,
      actor: 'user:us_test',
    })
    expect(rejected).toMatchObject({ status: 'rejected', decidedBy: 'user:us_test' })
    await expect(
      rejectHeld(app, tenant, { ...scope(), snapshotId: held.snapshot.id, actor: 'system' }),
    ).rejects.toMatchObject({ code: 'held_not_found' })
    // A manual publish is never held: it publishes the current document.
    const manualPublish = await publish('manual', 45)
    expect(manualPublish.status).toBe('published')
    expect(Object.keys(manualPublish.snapshot.body?.items ?? {})).toHaveLength(2)
  })

  it('records a newly published item at the time of its first publish', async () => {
    const added = newId('nd')
    await run([
      { op: 'createNode', id: added, nodeType: 'item', parent: null, status: 'active' },
      manual(added, 'name', { bg_BG: 'Нова' }),
      manual(added, 'price', eur(700)),
      { op: 'setPlacement', item: { id: added }, section: { id: section }, sortKey: 'end' },
    ])
    await publish('manual', 50)
    const dates = await firstPublished()
    expect(dates[added]).toBe(at(50).toISOString())
    expect(dates[handMade[0]]).toBe(at(0).toISOString())
  })

  it('V10: refuses to publish a menu with no visible item, writing nothing', async () => {
    const secondVenue = await provisionVenue(app, tenant, { name: 'Empty', slug: 'empty' })
    const empty = await provisionMenu(app, tenant, secondVenue.id)
    await expect(
      publishMenu(app, tenant, {
        menuId: empty.id,
        venueId: secondVenue.id,
        reason: 'manual',
        actor: 'system',
      }),
    ).rejects.toMatchObject({ name: 'PublishError', code: 'no_visible_items' })
    expect(
      await loadCurrentSnapshot(app, tenant, { menuId: empty.id, venueId: secondVenue.id }),
    ).toBeNull()
    // A menu published for the wrong venue does not exist.
    await expect(
      publishMenu(app, tenant, {
        menuId: menu.id,
        venueId: secondVenue.id,
        reason: 'manual',
        actor: 'system',
      }),
    ).rejects.toMatchObject({ code: 'menu_not_found' })
  })

  it('keeps every tenant to its own publish records (row-level security)', async () => {
    expect(await loadCurrentSnapshot(app, otherTenant, scope())).toBeNull()
    expect(await loadSnapshot(app, otherTenant, versions.v1 as SnapshotId)).toBeNull()
    expect(await listSnapshots(app, otherTenant, scope())).toEqual({
      snapshots: [],
      nextBeforeVersion: null,
    })
    const rows = await withTenant(app, otherTenant, (tx) => tx.select().from(itemFirstPublished))
    expect(rows).toEqual([])
    await expect(
      publishMenu(app, otherTenant, { ...scope(), reason: 'manual', actor: 'system' }),
    ).rejects.toMatchObject({ code: 'menu_not_found' })
  })

  it('never lets a snapshot change once written (database trigger)', async () => {
    await expect(
      withTenantWrite(app, tenant, (tx) =>
        tx
          .update(snapshots)
          .set({ hash: '0'.repeat(64) })
          .where(eq(snapshots.id, versions.v1 as string)),
      ),
    ).rejects.toThrow()
    await expect(
      withTenantWrite(app, tenant, (tx) =>
        tx.delete(snapshots).where(eq(snapshots.id, versions.v1 as string)),
      ),
    ).rejects.toThrow()
  })

  it('never gives two publishes of one menu the same version, even concurrently', async () => {
    const prices = [801, 802, 803, 804, 805, 806]
    const results = await Promise.all(
      prices.map(async (price, index) => {
        await run([manual(handMade[0], 'price', eur(price))])
        return publish('manual', 60 + index)
      }),
    )
    const published = results.filter((result) => result.status === 'published')
    expect(published.length).toBeGreaterThan(0)
    const publishedVersions = published.map((result) => result.snapshot.version)
    expect(new Set(publishedVersions).size).toBe(publishedVersions.length)

    const all = (
      await withTenant(app, tenant, (tx) =>
        tx
          .select({ version: snapshots.version })
          .from(snapshots)
          .where(eq(snapshots.menuId, menu.id)),
      )
    )
      .map((row) => row.version)
      .sort((a, b) => a - b)
    expect(all).toEqual(all.map((_, index) => index + 1))
    // Whatever order they ran in, the last publish shows the last price written.
    const current = await loadCurrentSnapshot(app, tenant, scope())
    const finalPrice = current?.body?.items[handMade[0] as NodeId]?.price?.amount_minor
    expect(prices).toContain(finalPrice)
  })

  it('names the refusal in a PublishError', () => {
    const error = new PublishError('no_visible_items', 'V10', { issues: ['V10'] })
    expect(error).toMatchObject({ name: 'PublishError', code: 'no_visible_items', issues: ['V10'] })
  })
})
