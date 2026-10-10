// Sold out tonight against Postgres as the restro_app role (brief S3-08, D46, rule 5): a mark is
// one change set through apply(), it reaches guests through the live overlay and never through a
// snapshot, it lapses with the service day, and no sequence of marks and unmarks makes an item
// more available than barsy says.

import { createPool, type DbPool, events, fieldValues, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'
import * as fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import {
  listPublishedScopes,
  loadCurrentSnapshot,
  loadDraft,
  loadLiveOverlay,
  publishMenu,
} from './publish'
import { MAX_SOLD_OUT_ITEMS, SoldOutError, setSoldOutTonight } from './sold-out'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

describe('input checks (no database needed)', () => {
  const unusedPool = {} as DbPool
  const valid = { venueId: newId('vn'), itemIds: [newId('nd')], soldOut: true, actor: 'user:us_x' }

  it.each([
    ['no items', { itemIds: [] }],
    [
      'too many items',
      { itemIds: Array.from({ length: MAX_SOLD_OUT_ITEMS + 1 }, () => newId('nd')) },
    ],
    ['a malformed item id', { itemIds: ['nd_nope'] }],
    ['a venue id of another kind', { venueId: newId('tn') }],
    ['an actor with personal data', { actor: 'martin@example.com' }],
    ['a value other than a boolean (there is no "on sale" write)', { soldOut: 'true' }],
    ['an unknown field', { value: true }],
  ])('refuses %s before touching the database', async (_label, overrides) => {
    await expect(
      setSoldOutTonight(unusedPool, newId('tn'), { ...valid, ...overrides } as never),
    ).rejects.toMatchObject({ name: 'SoldOutError', code: 'invalid_input' })
  })
})

describe.skipIf(!hasDatabase)('sold out tonight (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  const records: Record<string, string> = {}

  const section = newId('nd')
  /** Hand-made items, a barsy item on sale and a barsy item that barsy has off sale. */
  const handMade = [newId('nd'), newId('nd'), newId('nd')] as const
  const barsyOn = newId('nd')
  const barsyOff = newId('nd')
  const ALL = [...handMade, barsyOn, barsyOff] as const

  // 23:00 on Friday 9 October 2026 in Sofia: service day 2026-10-09 (the day ends at 07:00).
  const night = new Date('2026-10-09T20:00:00Z')
  // 06:30 the next morning: still the same service day. 08:00: the next one.
  const lateNight = new Date('2026-10-10T03:30:00Z')
  const morning = new Date('2026-10-10T05:00:00Z')

  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const scope = () => ({ menuId: menu.id, venueId })
  const manager = 'user:us_manager'

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? manager : `integration:${integration}`,
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
  const barsy = (external: string, fieldKey: string, value: unknown, where = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId: external } },
    fieldKey,
    layer: 'barsy',
    scope: where,
    value,
    sourceRecordId: records[external],
    mappingVersion: 1,
  })
  async function run(ops: unknown[], source = 'manual') {
    const result = await apply(app, tenant, changeSet(source, ops))
    expect(result.rejected).toEqual([])
  }
  const mark = (ids: readonly string[], soldOut: boolean, now: Date) =>
    setSoldOutTonight(
      app,
      tenant,
      { venueId, itemIds: [...ids] as NodeId[], soldOut, actor: manager },
      { now },
    )
  const overlayAt = async (now: Date) =>
    (await loadLiveOverlay(app, tenant, scope(), { now }))?.overlay
  const publishAt = (now: Date) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: manager },
      { now },
    )
  const rowsOf = (node: string) =>
    withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(fieldValues)
        .where(and(eq(fieldValues.nodeId, node), eq(fieldValues.fieldKey, 'for_sale'))),
    )

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-sold-out-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Sold out test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    for (const external of ['ext-on', 'ext-off']) {
      const record = newId('sr')
      records[external] = record
      await withTenantWrite(app, tenant, (tx) =>
        tx.execute(sql`
          insert into restro.source_records
            (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
             payload)
          values (${record}, ${tenant}, ${integration}, 'article', ${external}, 'master',
                  ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
      )
    }
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
    ])
    for (const [id, external, forSale] of [
      [barsyOn, 'ext-on', true],
      [barsyOff, 'ext-off', false],
    ] as const) {
      await run(
        [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          {
            op: 'linkSource',
            node: { id },
            link: { integration, externalType: 'article', externalId: external },
          },
          barsy(
            external,
            'name',
            forSale
              ? { bg_BG: 'Негрони', en_US: 'Negroni' }
              : { bg_BG: 'Кампари', en_US: 'Campari' },
          ),
          barsy(external, 'price', eur(1250), `venue:${venueId}`),
          barsy(external, 'for_sale', forSale, `venue:${venueId}`),
          barsy(external, 'visible', true),
          barsy(external, 'allergens', []),
        ],
        `barsy:${integration}`,
      )
      await run([{ op: 'setPlacement', item: { id }, section: { id: section }, sortKey: 'end' }])
    }
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  it("writes for_sale = false in the venue's service edition, as one manual change set", async () => {
    const result = await mark([handMade[0]], true, night)
    expect(result).toMatchObject({ day: '2026-10-09', applied: 1, unchanged: 0, rejected: [] })

    const rows = await rowsOf(handMade[0])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      layer: 'edition:service:2026-10-09',
      scope: 'master',
      source: 'manual',
      actor: manager,
      value: false,
      valid: true,
    })
    const logged = await withTenant(app, tenant, (tx) =>
      tx.select().from(events).where(eq(events.nodeId, handMade[0])),
    )
    const markEvent = logged.find((event) => event.layer === 'edition:service:2026-10-09')
    expect(markEvent).toMatchObject({
      op: 'setField',
      fieldKey: 'for_sale',
      source: 'manual',
      actor: manager,
    })
  })

  it('does nothing the second time, and unmarking removes the row', async () => {
    expect(await mark([handMade[0]], true, night)).toMatchObject({ applied: 0, unchanged: 1 })
    expect(await mark([handMade[0]], false, night)).toMatchObject({ applied: 1 })
    expect(await rowsOf(handMade[0])).toEqual([])
    expect(await mark([handMade[0]], false, night)).toMatchObject({ applied: 0, unchanged: 1 })
  })

  it('marks several items in one atomic change set, or none', async () => {
    expect(await mark([handMade[1], handMade[2]], true, night)).toMatchObject({ applied: 2 })
    await mark([handMade[1], handMade[2]], false, night)
    // One bad id refuses the whole selection: the good one is not marked either.
    await expect(mark([handMade[1], section], true, night)).rejects.toMatchObject({
      name: 'SoldOutError',
      code: 'unknown_item',
    })
    expect(await rowsOf(handMade[1])).toEqual([])
  })

  describe('what guests are told', () => {
    it('lists the mark in the live overlay and leaves the snapshot as it was', async () => {
      const first = await publishAt(night)
      expect(first.status).toBe('published')
      expect(first.snapshot.body?.snapshot.edition).toEqual(['master', `venue:${venueId}`])
      const version = first.snapshot.version

      await mark([handMade[1]], true, night)

      // The overlay (live.json) carries it, and the barsy item that barsy has off sale.
      expect((await overlayAt(night))?.items).toEqual({
        [handMade[1]]: { sold_out: true },
        [barsyOff]: { sold_out: true },
      })
      expect((await overlayAt(night))?.version).toBe(version)

      // Publishing again finds the same content: no new version, no new hash.
      const again = await publishAt(night)
      expect(again.status).toBe('unchanged')
      expect(again.snapshot.id).toBe(first.snapshot.id)
      const current = await loadCurrentSnapshot(app, tenant, scope())
      expect(current?.hash).toBe(first.snapshot.hash)
      // The snapshot never holds the mark: the item is still available there.
      expect(current?.body?.items[handMade[1]]?.availability.state).toBe('available')
      expect(current?.body?.items[handMade[1]]).toEqual(first.snapshot.body?.items[handMade[1]])
      expect(JSON.stringify(current?.body)).not.toContain('service:')
    })

    it("keeps barsy's own off-sale flag in the snapshot, as before", async () => {
      const current = await loadCurrentSnapshot(app, tenant, scope())
      expect(current?.body?.items[barsyOff]).toMatchObject({
        availability: { state: 'sold_out' },
        orderable: false,
      })
    })

    it('takes the item out of the overlay when the mark is removed', async () => {
      await mark([handMade[1]], false, night)
      expect((await overlayAt(night))?.items).toEqual({ [barsyOff]: { sold_out: true } })
    })

    it("shows the mark in a draft's overlay and not in its snapshot", async () => {
      await mark([handMade[2]], true, night)
      const draft = await loadDraft(app, tenant, scope(), { now: night })
      expect(draft.overlay.items[handMade[2]]).toEqual({ sold_out: true })
      expect(draft.snapshot.items[handMade[2]]?.availability.state).toBe('available')
      expect(draft.snapshot.snapshot.edition).toEqual(['master', `venue:${venueId}`])
      await mark([handMade[2]], false, night)
    })
  })

  describe('the service day rollover (07:00 venue time)', () => {
    it('holds the mark until the day ends, then drops it from the overlay without a publish', async () => {
      await mark([handMade[0]], true, night)
      expect((await overlayAt(night))?.items[handMade[0]]).toEqual({ sold_out: true })
      expect((await overlayAt(lateNight))?.items[handMade[0]]).toEqual({ sold_out: true })
      // 07:00 sharp is a new service day.
      const sharp = new Date('2026-10-10T04:00:00Z')
      expect((await overlayAt(new Date(sharp.getTime() - 1000)))?.items[handMade[0]]).toBeDefined()
      expect((await overlayAt(sharp))?.items).toEqual({ [barsyOff]: { sold_out: true } })
      expect((await overlayAt(morning))?.items).toEqual({ [barsyOff]: { sold_out: true } })
      // The row is still stored (history); it is simply out of context.
      expect(await rowsOf(handMade[0])).toHaveLength(1)
    })

    it('gives the same snapshot content at 23:00 and at 08:00', async () => {
      const before = await loadCurrentSnapshot(app, tenant, scope())
      const after = await publishAt(morning)
      expect(after.status).toBe('unchanged')
      expect(after.snapshot.hash).toBe(before?.hash)
    })

    it('lets the next evening start clean, and marks only that evening', async () => {
      const nextNight = new Date('2026-10-10T20:00:00Z')
      expect((await overlayAt(nextNight))?.items[handMade[0]]).toBeUndefined()
      await mark([handMade[1]], true, nextNight)
      expect((await overlayAt(nextNight))?.items[handMade[1]]).toEqual({ sold_out: true })
      // Yesterday's evening does not see tomorrow's mark either (its layer is another day's).
      expect((await overlayAt(night))?.items[handMade[1]]).toBeUndefined()
      expect((await rowsOf(handMade[1])).map((row) => row.layer)).toEqual([
        'edition:service:2026-10-10',
      ])
      await mark([handMade[1]], false, nextNight)
      await mark([handMade[0]], false, night)
    })
  })

  describe('rule 5: it can only make the menu more cautious', () => {
    it('refuses to write "on sale" into the service edition through apply()', async () => {
      const result = await apply(
        app,
        tenant,
        changeSet('manual', [
          {
            op: 'setField',
            node: { id: barsyOff },
            fieldKey: 'for_sale',
            layer: 'edition:service:2026-10-09',
            scope: 'master',
            value: true,
          },
        ]),
      )
      expect(result.applied).toBe(0)
      expect(result.rejected).toMatchObject([{ code: 'less_cautious' }])
      const layers = (await rowsOf(barsyOff)).map((row) => row.layer)
      expect(layers).not.toContain('edition:service:2026-10-09')
    })

    it("cannot clear barsy's flag: a manual change set may not touch the barsy layer", async () => {
      await expect(
        apply(
          app,
          tenant,
          changeSet('manual', [
            {
              op: 'clearField',
              node: { id: barsyOff },
              fieldKey: 'for_sale',
              layer: 'barsy',
              scope: `venue:${venueId}`,
            },
          ]),
        ),
      ).rejects.toMatchObject({ code: 'invalid_change_set' })
      expect((await rowsOf(barsyOff)).map((row) => row.layer)).toEqual(['barsy'])
    })

    it('keeps an item barsy has off sale sold out through any marks and unmarks', async () => {
      await mark([barsyOff], true, night)
      expect((await overlayAt(night))?.items[barsyOff]).toEqual({ sold_out: true })
      await mark([barsyOff], false, night)
      expect((await overlayAt(night))?.items[barsyOff]).toEqual({ sold_out: true })
      expect(
        (await loadCurrentSnapshot(app, tenant, scope()))?.body?.items[barsyOff],
      ).toMatchObject({
        availability: { state: 'sold_out' },
        orderable: false,
      })
      // Barsy puts it back on sale: only now is it available again.
      await run([barsy('ext-off', 'for_sale', true, `venue:${venueId}`)], `barsy:${integration}`)
      expect((await overlayAt(night))?.items[barsyOff]).toBeUndefined()
      await run([barsy('ext-off', 'for_sale', false, `venue:${venueId}`)], `barsy:${integration}`)
    })

    // The sequence property, against the real database: one distinct service day per run keeps the
    // runs apart. After every step, an item barsy has off sale is in the overlay, an item that is
    // marked tonight is too, and no other item is; the snapshot never changes.
    it('holds for any sequence of marks and unmarks by managers', async () => {
      const before = await loadCurrentSnapshot(app, tenant, scope())
      const step = fc.record({
        item: fc.integer({ min: 0, max: ALL.length - 1 }),
        soldOut: fc.boolean(),
      })
      let day = 0
      await fc.assert(
        fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 8 }), async (steps) => {
          day += 1
          const now = new Date(Date.UTC(2026, 10, day, 20, 0, 0))
          const marked = new Set<string>()
          for (const { item, soldOut } of steps) {
            const id = ALL[item] as string
            await mark([id], soldOut, now)
            if (soldOut) marked.add(id)
            else marked.delete(id)
            const expected = new Set([...marked, barsyOff])
            const items = (await overlayAt(now))?.items ?? {}
            expect(new Set(Object.keys(items))).toEqual(expected)
          }
        }),
        { numRuns: 12 },
      )
      const after = await loadCurrentSnapshot(app, tenant, scope())
      expect(after?.id).toBe(before?.id)
      expect(after?.body?.items[barsyOff]?.availability.state).toBe('sold_out')
    }, 120_000)
  })

  describe('who and what it accepts', () => {
    it('refuses ids that are not active items of the tenant', async () => {
      const archived = newId('nd')
      await run([
        { op: 'createNode', id: archived, nodeType: 'item', parent: null, status: 'active' },
        { op: 'setNodeStatus', node: { id: archived }, status: 'archived' },
      ])
      for (const id of [section, archived, newId('nd')]) {
        await expect(mark([id], true, night), id).rejects.toMatchObject({
          name: 'SoldOutError',
          code: 'unknown_item',
        })
      }
      // Another tenant's session sees none of this tenant's nodes or venues.
      await expect(
        setSoldOutTonight(app, otherTenant, {
          venueId,
          itemIds: [handMade[0]],
          soldOut: true,
          actor: manager,
        }),
      ).rejects.toBeInstanceOf(SoldOutError)
      // The other tenant's attempt wrote nothing for this evening.
      const tonight = (await rowsOf(handMade[0])).filter(
        (row) => row.layer === 'edition:service:2026-10-09',
      )
      expect(tonight).toEqual([])
    })

    it('refuses an unknown venue', async () => {
      await expect(
        setSoldOutTonight(app, tenant, {
          venueId: newId('vn'),
          itemIds: [handMade[0]],
          soldOut: true,
          actor: manager,
        }),
      ).rejects.toMatchObject({ code: 'unknown_venue' })
    })
  })

  it('lists the published menus with their clock, for the rollover tick', async () => {
    expect(await listPublishedScopes(app, tenant)).toEqual([
      { menuId: menu.id, venueId, timezone: 'Europe/Sofia', dayEndsAt: '07:00:00' },
    ])
    expect(await listPublishedScopes(app, otherTenant)).toEqual([])
  })
})
