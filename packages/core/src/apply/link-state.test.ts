// Integration tests on a real Postgres, as restro_app (brief S2-03a): setLinkState (the Link
// lifecycle, its events and `state_changed_at`, seen/hash bookkeeping, refusals, the enrichment
// that a state change never touches, the resolver hiding and showing the node) and
// `onlyIfUnplaced` placements (a re-sync never undoes the manager's arrangement).
import {
  createPool,
  type DbPool,
  events,
  fieldValues,
  placements,
  sourceLinks,
  withTenant,
} from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, asc, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet, SourceLink } from '../change-set'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { resolve } from '../resolve'
import { sortKeyBetween } from '../sort-keys'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { type ApplyResult, apply } from './apply'
import { loadMenuDocument } from './load-document'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

describe.skipIf(!hasDatabase)('setLinkState and onlyIfUnplaced (as the restro_app role)', () => {
  const tenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let secondVenueId: string
  let menu: ProvisionedMenu
  let secondMenu: ProvisionedMenu
  /** One tier-1 record every barsy write of these tests cites. */
  let record: string

  const linkTo = (externalType: string, externalId: string): SourceLink => ({
    integration,
    externalType,
    externalId,
  })
  const article = (externalId: string) => linkTo('article', externalId)
  const category = (externalId: string) => linkTo('category', externalId)

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_link_state_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const barsy = (ops: unknown[]) => apply(app, tenant, changeSet(`barsy:${integration}`, ops))
  const manual = (ops: unknown[], options?: { atomic?: boolean }) =>
    apply(app, tenant, changeSet('manual', ops), options)

  const barsyField = (link: SourceLink, fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link },
    fieldKey,
    layer: 'barsy',
    scope,
    value,
    sourceRecordId: record,
    mappingVersion: 1,
  })

  /** A pulled category under `parent` (our menu id or the parent category's link). */
  function categoryOps(externalId: string, parent: { id: string } | { link: SourceLink }) {
    const id = newId('nd')
    return [
      { op: 'createNode', id, nodeType: 'section', parent, status: 'active', sortKey: 'end' },
      { op: 'linkSource', node: { id }, link: category(externalId) },
      barsyField(category(externalId), 'title', { bg_BG: `Раздел ${externalId}` }),
    ]
  }

  /** A pulled article placed, mirror-style, in every category it belongs to. */
  function articleOps(externalId: string, categories: readonly string[]) {
    const id = newId('nd')
    const link = article(externalId)
    return [
      { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
      { op: 'linkSource', node: { id }, link },
      barsyField(link, 'name', { bg_BG: `Артикул ${externalId}` }),
      barsyField(link, 'price', eur(1000), `venue:${venueId}`),
      barsyField(link, 'for_sale', true, `venue:${venueId}`),
      barsyField(link, 'visible', true),
      ...categories.map((catId) => ({
        op: 'setPlacement',
        item: { link },
        section: { link: category(catId) },
        sortKey: 'end',
        onlyIfUnplaced: true,
      })),
    ]
  }

  const setLinkState = (link: SourceLink, state: string, extra: object = {}) => ({
    op: 'setLinkState',
    link,
    state,
    ...extra,
  })

  async function linkRow(link: SourceLink) {
    const rows = await withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(sourceLinks)
        .where(
          and(
            eq(sourceLinks.integrationId, link.integration),
            eq(sourceLinks.externalType, link.externalType),
            eq(sourceLinks.externalId, link.externalId),
          ),
        ),
    )
    const row = rows[0]
    if (!row) throw new Error(`no link ${link.externalType} ${link.externalId}`)
    return row
  }
  const nodeOf = async (link: SourceLink) => (await linkRow(link)).nodeId as NodeId
  const valuesOf = (nodeId: string) =>
    withTenant(app, tenant, (tx) =>
      tx
        .select()
        .from(fieldValues)
        .where(eq(fieldValues.nodeId, nodeId))
        .orderBy(asc(fieldValues.fieldKey), asc(fieldValues.layer), asc(fieldValues.scope)),
    )
  const placementsOf = (itemId: string) =>
    withTenant(app, tenant, (tx) =>
      tx
        .select({ sectionId: placements.sectionId, sortKey: placements.sortKey })
        .from(placements)
        .where(eq(placements.itemId, itemId))
        .orderBy(asc(placements.sectionId)),
    )
  const sectionOrder = async (sectionId: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx
          .select({ itemId: placements.itemId })
          .from(placements)
          .where(eq(placements.sectionId, sectionId))
          .orderBy(sql`${placements.sortKey} collate "C"`),
      )
    ).map((row) => row.itemId)
  const eventsOf = (nodeId: string) =>
    withTenant(app, tenant, (tx) =>
      tx.select().from(events).where(eq(events.nodeId, nodeId)).orderBy(asc(events.seq)),
    )
  const codesOf = (result: ApplyResult) =>
    result.rejected.map((rejection) => [rejection.opIndex, rejection.code])

  async function resolvedItem(itemId: NodeId) {
    const doc = await loadMenuDocument(app, tenant, menu.id)
    return resolve(VENUE_MENU_TEMPLATE, doc, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: new Date().toISOString(),
    }).items[itemId]
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-link-state-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Link state test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: 'main' })).id
    secondVenueId = (await provisionVenue(app, tenant, { name: 'Second', slug: 'second' })).id
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    menu = await provisionMenu(app, tenant, venueId)
    secondMenu = await provisionMenu(app, tenant, secondVenueId)
    record = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${tenant}, ${integration}, 'article', '1', 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  describe('setLinkState', () => {
    // Category 9100 with article 91001, enriched by the manager below.
    const cat = category('9100')
    const art = article('91001')
    let item: NodeId

    beforeAll(async () => {
      const pulled = await barsy([
        ...categoryOps('9100', { id: menu.id }),
        ...articleOps('91001', ['9100']),
      ])
      expect(pulled.rejected).toEqual([])
      item = await nodeOf(art)
      // The manager's enrichment: a builder value and an override of barsy's name.
      const enriched = await manual([
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'abv',
          layer: 'manual',
          scope: 'master',
          value: 12,
        },
        {
          op: 'setField',
          node: { id: item },
          fieldKey: 'name',
          layer: 'override',
          scope: 'master',
          value: { bg_BG: 'Хубав артикул' },
          basis: { bg_BG: 'Артикул 91001' },
        },
      ])
      expect(enriched.rejected).toEqual([])
      expect(await resolvedItem(item)).toMatchObject({ visible: true })
    })

    it('active → missing: one event, a fresh state_changed_at, the node hidden, the enrichment kept', async () => {
      const before = await linkRow(art)
      expect(before.state).toBe('active')
      const values = await valuesOf(item)
      const placed = await placementsOf(item)
      const eventCount = (await eventsOf(item)).length

      const result = await barsy([setLinkState(art, 'missing')])
      expect(result).toMatchObject({ applied: 1, unchanged: 0, rejected: [], eventsWritten: 1 })
      const after = await linkRow(art)
      expect(after.state).toBe('missing')
      expect(after.stateChangedAt.getTime()).toBeGreaterThan(before.stateChangedAt.getTime())
      expect(after.lastSeenAt).toEqual(before.lastSeenAt)

      const written = (await eventsOf(item)).slice(eventCount)
      expect(written).toHaveLength(1)
      expect(written[0]).toMatchObject({
        op: 'setLinkState',
        fieldKey: 'link',
        layer: 'barsy',
        scope: 'master',
        source: `barsy:${integration}`,
        oldValue: { source: `barsy:${integration}`, external_type: 'article', state: 'active' },
        newValue: { source: `barsy:${integration}`, external_type: 'article', state: 'missing' },
      })
      expect(JSON.stringify(written)).not.toContain('91001')

      expect(await valuesOf(item)).toEqual(values)
      expect(await placementsOf(item)).toEqual(placed)
      expect(await resolvedItem(item)).toMatchObject({ visible: false })
    })

    it('the same state again is a no-op without an event; state_changed_at stays', async () => {
      const before = await linkRow(art)
      const eventCount = (await eventsOf(item)).length
      const result = await barsy([setLinkState(art, 'missing')])
      expect(result).toMatchObject({ applied: 0, unchanged: 1, rejected: [], eventsWritten: 0 })
      expect((await linkRow(art)).stateChangedAt).toEqual(before.stateChangedAt)
      expect(await eventsOf(item)).toHaveLength(eventCount)
    })

    it('missing → deleted; deleted → missing is refused; deleted → active shows the node again with its enrichment', async () => {
      const values = await valuesOf(item)
      expect(await barsy([setLinkState(art, 'deleted')])).toMatchObject({ applied: 1 })
      expect((await linkRow(art)).state).toBe('deleted')
      expect(await resolvedItem(item)).toMatchObject({ visible: false })

      const refusedMove = await barsy([setLinkState(art, 'missing')])
      expect(codesOf(refusedMove)).toEqual([[0, 'invalid_transition']])
      expect((await linkRow(art)).state).toBe('deleted')

      expect(await barsy([setLinkState(art, 'active')])).toMatchObject({ applied: 1 })
      expect((await linkRow(art)).state).toBe('active')
      expect(await valuesOf(item)).toEqual(values)
      const shown = await resolvedItem(item)
      expect(shown).toMatchObject({ visible: true })
      expect(shown?.fields.name?.value).toEqual({ bg_BG: 'Хубав артикул' })
      expect(shown?.fields.abv?.value).toBe(12)

      const states = (await eventsOf(item))
        .filter((event) => event.op === 'setLinkState')
        .map((event) => [
          (event.oldValue as { state: string }).state,
          (event.newValue as { state: string }).state,
        ])
      expect(states).toEqual([
        ['active', 'missing'],
        ['missing', 'deleted'],
        ['deleted', 'active'],
      ])
    })

    it('active → deleted directly (barsy delete_flag) and back; a section link follows the same rules', async () => {
      expect(await barsy([setLinkState(art, 'deleted')])).toMatchObject({ applied: 1 })
      expect(await barsy([setLinkState(art, 'active')])).toMatchObject({ applied: 1 })
      const section = await nodeOf(cat)
      expect(
        await barsy([setLinkState(cat, 'missing'), setLinkState(cat, 'active')]),
      ).toMatchObject({ applied: 2, eventsWritten: 2 })
      expect((await linkRow(cat)).state).toBe('active')
      expect((await eventsOf(section)).filter((event) => event.op === 'setLinkState')).toHaveLength(
        2,
      )
    })

    it('an unknown link is refused in the result, never thrown; the other ops still apply', async () => {
      const result = await barsy([
        setLinkState(article('91999'), 'missing'),
        barsyField(art, 'for_sale', false, `venue:${venueId}`),
      ])
      expect(codesOf(result)).toEqual([[0, 'unknown_link']])
      expect(result.applied).toBe(1)
      await barsy([barsyField(art, 'for_sale', true, `venue:${venueId}`)])
    })

    it("only the link's own source sets its state", async () => {
      const fromPerson = await manual([setLinkState(art, 'missing')])
      expect(codesOf(fromPerson)).toEqual([[0, 'source_not_allowed']])
      await expect(
        apply(app, tenant, changeSet(`barsy:${newId('in')}`, [setLinkState(art, 'missing')])),
      ).rejects.toMatchObject({ code: 'invalid_change_set' })
      expect((await linkRow(art)).state).toBe('active')
    })

    it('seenAt and hash move last_seen_at / last_hash forward only, without an event or a state move', async () => {
      const before = await linkRow(art)
      const eventCount = (await eventsOf(item)).length
      const later = new Date(before.lastSeenAt.getTime() + 60_000)
      const muchLater = new Date(before.lastSeenAt.getTime() + 120_000)
      const earlier = new Date(before.lastSeenAt.getTime() - 60_000)
      const hash = (text: string) => sha256Hex(text)

      const seen = await barsy([
        setLinkState(art, 'active', { seenAt: later.toISOString(), hash: hash('v2') }),
      ])
      expect(seen).toMatchObject({ applied: 0, unchanged: 1, eventsWritten: 0, rejected: [] })
      expect(await linkRow(art)).toMatchObject({
        state: 'active',
        lastSeenAt: later,
        lastHash: hash('v2'),
        stateChangedAt: before.stateChangedAt,
      })

      // An older observation (a chunk of an earlier pull applied late) changes nothing.
      await barsy([
        setLinkState(art, 'active', { seenAt: earlier.toISOString(), hash: hash('v1') }),
      ])
      expect(await linkRow(art)).toMatchObject({ lastSeenAt: later, lastHash: hash('v2') })

      await barsy([
        setLinkState(art, 'active', { seenAt: muchLater.toISOString(), hash: hash('v3') }),
      ])
      expect(await linkRow(art)).toMatchObject({ lastSeenAt: muchLater, lastHash: hash('v3') })
      // The same observation again is a no-op.
      expect(
        await barsy([
          setLinkState(art, 'active', { seenAt: muchLater.toISOString(), hash: hash('v3') }),
        ]),
      ).toMatchObject({ unchanged: 1 })
      expect(await eventsOf(item)).toHaveLength(eventCount)
    })

    it('a move and a sighting together: the state moves and the sighting is recorded', async () => {
      const before = await linkRow(art)
      const seenAt = new Date(before.lastSeenAt.getTime() + 60_000)
      await barsy([setLinkState(art, 'missing')])
      const result = await barsy([
        setLinkState(art, 'active', { seenAt: seenAt.toISOString(), hash: sha256Hex('v4') }),
      ])
      expect(result).toMatchObject({ applied: 1, eventsWritten: 1 })
      expect(await linkRow(art)).toMatchObject({
        state: 'active',
        lastSeenAt: seenAt,
        lastHash: sha256Hex('v4'),
      })
    })

    it('a link created in the same change set takes the sighting on insert', async () => {
      const seenAt = new Date(Date.now() + 60_000)
      const link = article('91002')
      const result = await barsy([
        ...articleOps('91002', ['9100']),
        setLinkState(link, 'active', { seenAt: seenAt.toISOString(), hash: sha256Hex('new') }),
      ])
      expect(result.rejected).toEqual([])
      expect(await linkRow(link)).toMatchObject({
        state: 'active',
        lastSeenAt: seenAt,
        lastHash: sha256Hex('new'),
      })
    })
  })

  describe('onlyIfUnplaced: a re-sync never undoes the manager’s arrangement', () => {
    // Categories 9200 and 9300 (two sections); article 92001 belongs to both.
    let sectionA: NodeId
    let sectionB: NodeId
    let both: NodeId
    let second: NodeId
    const pull = () => [
      ...categoryOps('9200', { id: menu.id }),
      ...categoryOps('9300', { id: menu.id }),
      ...articleOps('92001', ['9200', '9300']),
      ...articleOps('92002', ['9200']),
    ]

    it('first import: an item in two categories gets two placements', async () => {
      const result = await barsy(pull())
      expect(result).toMatchObject({ rejected: [], skipped: 0 })
      sectionA = await nodeOf(category('9200'))
      sectionB = await nodeOf(category('9300'))
      both = await nodeOf(article('92001'))
      second = await nodeOf(article('92002'))
      expect((await placementsOf(both)).map((row) => row.sectionId).sort()).toEqual(
        [sectionA, sectionB].sort(),
      )
      expect(await sectionOrder(sectionA)).toEqual([both, second])
    })

    it('the manager moves the item: a re-sync changes nothing', async () => {
      // Out of section A (it stays in B), as the composer's move does.
      const moved = await manual(
        [{ op: 'removePlacement', item: { id: both }, section: { id: sectionA } }],
        { atomic: true },
      )
      expect(moved.applied).toBe(1)
      const before = await placementsOf(both)

      const again = await barsy(pull())
      expect(again).toMatchObject({ applied: 0, rejected: [], eventsWritten: 0, skipped: 3 })
      expect(await placementsOf(both)).toEqual(before)
      expect(await sectionOrder(sectionA)).toEqual([second])
    })

    it('the manager reorders a section: a re-sync changes nothing', async () => {
      // Put the item back into A, first, before the other one.
      const [firstKey] = (await placementsOf(second)).map((row) => row.sortKey)
      await manual([
        {
          op: 'setPlacement',
          item: { id: both },
          section: { id: sectionA },
          sortKey: sortKeyBetween(null, firstKey ?? null),
        },
      ])
      expect(await sectionOrder(sectionA)).toEqual([both, second])
      const before = [await placementsOf(both), await placementsOf(second)]

      const again = await barsy(pull())
      expect(again).toMatchObject({ applied: 0, rejected: [], eventsWritten: 0, skipped: 3 })
      expect([await placementsOf(both), await placementsOf(second)]).toEqual(before)
      expect(await sectionOrder(sectionA)).toEqual([both, second])
    })

    it('a brand-new item in a later sync is placed at the end', async () => {
      const result = await barsy([...pull(), ...articleOps('92003', ['9200'])])
      expect(result).toMatchObject({ rejected: [], skipped: 3 })
      const added = await nodeOf(article('92003'))
      expect(await sectionOrder(sectionA)).toEqual([both, second, added])
    })

    it('a placement in another menu still applies (the check is per menu)', async () => {
      const otherSection = newId('nd')
      await manual([
        {
          op: 'createNode',
          id: otherSection,
          nodeType: 'section',
          parent: { id: secondMenu.id },
          status: 'active',
        },
      ])
      const result = await barsy([
        {
          op: 'setPlacement',
          item: { link: article('92001') },
          section: { id: otherSection },
          sortKey: 'end',
          onlyIfUnplaced: true,
        },
      ])
      expect(result).toMatchObject({ applied: 1, skipped: 0 })
      expect((await placementsOf(both)).map((row) => row.sectionId)).toContain(otherSection)
    })

    it('known edge (T47): an item the manager took out of every section is placed again', async () => {
      await manual([{ op: 'removePlacement', item: { id: second }, section: { id: sectionA } }])
      expect(await placementsOf(second)).toEqual([])
      const result = await barsy(pull())
      expect(result.rejected).toEqual([])
      expect((await placementsOf(second)).map((row) => row.sectionId)).toEqual([sectionA])
      expect((await sectionOrder(sectionA)).at(-1)).toBe(second)
    })
  })
})
