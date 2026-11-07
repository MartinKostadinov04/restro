// Integration tests of the structural half of apply() on a real Postgres, as restro_app (brief
// S2-06a): moveNode (reorder, reparent, depth, cycles, other menus, groups and options), the
// structural changelog rows (`events.op`), atomic change sets, and loadUnplacedItems.
import {
  createPool,
  type DbPool,
  EVENT_OPS,
  events,
  nodes,
  placements,
  withTenant,
} from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { asc, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CHANGE_SET_OP_NAMES, type ChangeSet } from '../change-set'
import { mergeDocumentParts } from '../document/merge'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { resolve } from '../resolve'
import { sortKeyBetween } from '../sort-keys'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { type ApplyResult, apply } from './apply'
import { loadMenuDocument } from './load-document'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { itemsOfVenue, loadUnplacedItems } from './unplaced'

const EXTERNAL_ARTICLE = '556677889'

describe('the changelog and the op names', () => {
  it('events.op accepts exactly the ops a change set can hold', () => {
    expect([...EVENT_OPS].sort()).toEqual([...CHANGE_SET_OP_NAMES].sort())
  })
})

describe.skipIf(!hasDatabase)('structure: moveNode, structural events, atomic, unplaced', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let secondVenueId: string
  let menu: ProvisionedMenu
  let secondMenu: ProvisionedMenu
  let otherMenu: ProvisionedMenu

  function changeSet(source: string, ops: unknown[]): ChangeSet {
    return {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_structure_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet
  }
  const manual = (ops: unknown[]) => changeSet('manual', ops)
  const run = (ops: unknown[], options?: { atomic?: boolean }) =>
    apply(app, tenant, manual(ops), options)
  const codesOf = (result: ApplyResult) => result.rejected.map((rejection) => rejection.code)

  const nodeOf = async (id: string) =>
    (await withTenant(app, tenant, (tx) => tx.select().from(nodes).where(eq(nodes.id, id))))[0]
  const eventsOf = (nodeId: string) =>
    withTenant(app, tenant, (tx) =>
      tx.select().from(events).where(eq(events.nodeId, nodeId)).orderBy(asc(events.seq)),
    )
  const placementsOf = (itemId: string) =>
    withTenant(app, tenant, (tx) =>
      tx.select().from(placements).where(eq(placements.itemId, itemId)),
    )

  /** A section under `parent`, last among its siblings. */
  async function makeSection(parent: string, tenantId = tenant): Promise<NodeId> {
    const id = newId('nd')
    const result = await apply(
      app,
      tenantId,
      manual([
        {
          op: 'createNode',
          id,
          nodeType: 'section',
          parent: { id: parent },
          status: 'active',
          sortKey: 'end',
        },
      ]),
    )
    expect(result.rejected).toEqual([])
    return id
  }

  /** An item (no parent); `name` gives it a Bulgarian name so that it can be shown. */
  async function makeItem(name?: string): Promise<NodeId> {
    const id = newId('nd')
    const result = await run([
      { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
      ...(name === undefined
        ? []
        : [
            {
              op: 'setField',
              node: { id },
              fieldKey: 'name',
              layer: 'manual',
              scope: 'master',
              value: { bg_BG: name },
            },
          ]),
    ])
    expect(result.rejected).toEqual([])
    return id
  }

  const moveTo = (node: string, parent: string, sortKey = 'end') =>
    run([{ op: 'moveNode', node: { id: node }, parent: { id: parent }, sortKey }])

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-structure-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Structure test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') })).id
    secondVenueId = (
      await provisionVenue(app, tenant, { name: 'Second', slug: testSlug('second') })
    ).id
    const otherVenueId = (
      await provisionVenue(app, otherTenant, { name: 'Other', slug: testSlug('main') })
    ).id
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'demo.example')`),
    )
    menu = await provisionMenu(app, tenant, venueId)
    secondMenu = await provisionMenu(app, tenant, secondVenueId)
    otherMenu = await provisionMenu(app, otherTenant, otherVenueId)
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  describe('moveNode on sections', () => {
    it('reorders a section among its siblings, with an event and a revision', async () => {
      const a = await makeSection(menu.id)
      const b = await makeSection(menu.id)
      const c = await makeSection(menu.id)
      const keyA = (await nodeOf(a))?.sortKey ?? ''
      const keyC = (await nodeOf(c))?.sortKey ?? ''
      const revision = (await nodeOf(c))?.revision ?? 0
      const first = sortKeyBetween(null, keyA)

      const result = await moveTo(c, menu.id, first)
      expect(result).toMatchObject({ applied: 1, unchanged: 0, eventsWritten: 1, rejected: [] })
      expect(await nodeOf(c)).toMatchObject({ parentId: menu.id, sortKey: first })
      expect((await nodeOf(c))?.revision).toBe(revision + 1)
      expect((await nodeOf(b))?.sortKey).not.toBe(first)
      expect((await eventsOf(c)).at(-1)).toMatchObject({
        op: 'moveNode',
        fieldKey: 'parent',
        layer: 'manual',
        scope: 'master',
        source: 'manual',
        actor: 'user:us_structure_test',
        oldValue: { parent: menu.id, sort_key: keyC },
        newValue: { parent: menu.id, sort_key: first },
      })

      // The same move again, and 'end' under the parent it already has, change nothing.
      expect(await moveTo(c, menu.id, first)).toMatchObject({ applied: 0, unchanged: 1 })
      expect(await moveTo(c, menu.id, 'end')).toMatchObject({ applied: 0, unchanged: 1 })
      expect(await eventsOf(c)).toHaveLength(2) // created, moved
    })

    it('moves a section under another, last among its new siblings', async () => {
      const parent = await makeSection(menu.id)
      const first = await makeSection(menu.id)
      const second = await makeSection(menu.id)
      expect(await moveTo(first, parent)).toMatchObject({ applied: 1, rejected: [] })
      expect(await moveTo(second, parent)).toMatchObject({ applied: 1, rejected: [] })
      const keyFirst = (await nodeOf(first))?.sortKey ?? ''
      const keySecond = (await nodeOf(second))?.sortKey ?? ''
      expect((await nodeOf(first))?.parentId).toBe(parent)
      expect((await nodeOf(second))?.parentId).toBe(parent)
      expect(keyFirst < keySecond).toBe(true)
      // And back to the menu.
      expect(await moveTo(second, menu.id)).toMatchObject({ applied: 1 })
      expect((await nodeOf(second))?.parentId).toBe(menu.id)
    })

    it('keeps sections at most 3 deep, counting the sections inside the one that moves', async () => {
      const p1 = await makeSection(menu.id)
      const p2 = await makeSection(p1)
      const p3 = await makeSection(p2)
      const loose = await makeSection(menu.id)
      const target = await makeSection(menu.id)

      // A leaf under a depth-3 section would be at depth 4.
      expect(codesOf(await moveTo(loose, p3))).toEqual(['invalid_parent'])
      // p1 holds p2 and p3 (two levels below it): under `target` it would reach depth 4.
      expect(codesOf(await moveTo(p1, target))).toEqual(['invalid_parent'])
      expect((await nodeOf(p1))?.parentId).toBe(menu.id)
      // p2 holds p3 (one level): under `target` it ends at depth 3, which is allowed.
      expect(await moveTo(p2, target)).toMatchObject({ applied: 1, rejected: [] })
      expect((await nodeOf(p2))?.parentId).toBe(target)
    })

    it('refuses a move into itself, into its own sections, or into another menu', async () => {
      const top = await makeSection(menu.id)
      const child = await makeSection(top)
      expect(codesOf(await moveTo(top, top))).toEqual(['invalid_parent'])
      expect(codesOf(await moveTo(top, child))).toEqual(['invalid_parent'])
      expect(codesOf(await moveTo(top, secondMenu.id))).toEqual(['invalid_parent'])
      expect(codesOf(await moveTo(top, newId('nd')))).toEqual(['unknown_node'])
      expect((await nodeOf(top))?.parentId).toBe(menu.id)
    })

    it('refuses an item or a menu as the parent of a section', async () => {
      const section = await makeSection(menu.id)
      const item = await makeItem()
      expect(codesOf(await moveTo(section, item))).toEqual(['invalid_parent'])
    })

    it('lets a section be created and moved in the same change set', async () => {
      const a = newId('nd')
      const b = newId('nd')
      const create = (id: string) => ({
        op: 'createNode',
        id,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      })
      const result = await run([
        create(a),
        create(b),
        { op: 'moveNode', node: { id: a }, parent: { id: b }, sortKey: 'end' },
      ])
      expect(result).toMatchObject({ applied: 3, rejected: [] })
      expect(await nodeOf(a)).toMatchObject({ parentId: b })
      expect(await nodeOf(b)).toMatchObject({ parentId: menu.id })
    })

    it('is a person’s move only: a barsy change set cannot reorder the composition', async () => {
      const section = await makeSection(menu.id)
      const result = await apply(
        app,
        tenant,
        changeSet(`till:${integration}`, [
          { op: 'moveNode', node: { id: section }, parent: { id: menu.id }, sortKey: 'end' },
        ]),
      )
      expect(codesOf(result)).toEqual(['source_not_allowed'])
    })

    it('does not touch another tenant’s nodes', async () => {
      const theirs = await makeSection(otherMenu.id, otherTenant)
      expect(codesOf(await moveTo(theirs, menu.id))).toEqual(['unknown_node'])
    })
  })

  describe('moveNode on modifier groups and options', () => {
    it('reorders groups and options among their siblings only', async () => {
      const item = await makeItem()
      const otherItem = await makeItem()
      const create = (id: string, nodeType: string, parent: string) => ({
        op: 'createNode',
        id,
        nodeType,
        parent: { id: parent },
        status: 'active',
        sortKey: 'end',
      })
      const [g1, g2, o1, o2] = [newId('nd'), newId('nd'), newId('nd'), newId('nd')]
      const created = await run([
        create(g1, 'modifier_group', item),
        create(g2, 'modifier_group', item),
        create(o1, 'option', g1),
        create(o2, 'option', g1),
      ])
      expect(created.rejected).toEqual([])

      const keyG1 = (await nodeOf(g1))?.sortKey ?? ''
      expect(await moveTo(g2, item, sortKeyBetween(null, keyG1))).toMatchObject({ applied: 1 })
      expect(((await nodeOf(g2))?.sortKey ?? '') < keyG1).toBe(true)
      const keyO1 = (await nodeOf(o1))?.sortKey ?? ''
      expect(await moveTo(o2, g1, sortKeyBetween(null, keyO1))).toMatchObject({ applied: 1 })

      // Not to another parent: a group stays with its item, an option with its group.
      expect(codesOf(await moveTo(g1, otherItem))).toEqual(['invalid_parent'])
      expect(codesOf(await moveTo(o1, g2))).toEqual(['invalid_parent'])
    })

    it('does not move items or the menu this way', async () => {
      const item = await makeItem()
      const section = await makeSection(menu.id)
      expect(codesOf(await moveTo(item, section))).toEqual(['invalid_move'])
      expect(codesOf(await moveTo(menu.id, section))).toEqual(['invalid_move'])
    })
  })

  describe('structural events', () => {
    it('record a node’s creation, status, placement, move, link and unlink with their op', async () => {
      const section = await makeSection(menu.id)
      const item = await makeItem()
      const link = { integration, externalType: 'article', externalId: EXTERNAL_ARTICLE }
      const keyA = 'a0'
      const keyB = sortKeyBetween(null, keyA)

      await run([
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: keyA },
      ])
      await run([
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: keyB },
      ])
      await run([{ op: 'setNodeStatus', node: { id: item }, status: 'hidden' }])
      await run([{ op: 'linkSource', node: { id: item }, link }])
      await run([{ op: 'unlinkSource', node: { id: item }, link }])
      await run([{ op: 'removePlacement', item: { id: item }, section: { id: section } }])

      const history = (await eventsOf(item)).map((event) => ({
        op: event.op,
        fieldKey: event.fieldKey,
        layer: event.layer,
        scope: event.scope,
        oldValue: event.oldValue,
        newValue: event.newValue,
      }))
      const structural = { layer: 'manual', scope: 'master' }
      expect(history).toEqual([
        {
          op: 'createNode',
          fieldKey: 'node',
          ...structural,
          oldValue: null,
          newValue: { type: 'item', parent: null, status: 'active' },
        },
        {
          op: 'setPlacement',
          fieldKey: 'placement',
          ...structural,
          oldValue: null,
          newValue: { section, sort_key: keyA },
        },
        {
          op: 'setPlacement',
          fieldKey: 'placement',
          ...structural,
          oldValue: { section, sort_key: keyA },
          newValue: { section, sort_key: keyB },
        },
        {
          op: 'setNodeStatus',
          fieldKey: 'status',
          ...structural,
          oldValue: 'active',
          newValue: 'hidden',
        },
        {
          op: 'linkSource',
          fieldKey: 'link',
          ...structural,
          oldValue: null,
          newValue: { source: `till:${integration}`, external_type: 'article' },
        },
        {
          op: 'unlinkSource',
          fieldKey: 'link',
          ...structural,
          oldValue: { source: `till:${integration}`, external_type: 'article' },
          newValue: null,
        },
        {
          op: 'removePlacement',
          fieldKey: 'placement',
          ...structural,
          oldValue: { section, sort_key: keyB },
          newValue: null,
        },
      ])
      // Rule 3: no external id reaches the changelog.
      expect(JSON.stringify(history)).not.toContain(EXTERNAL_ARTICLE)
    })

    it('mark field changes as setField or clearField, and write nothing for a no-op', async () => {
      const item = await makeItem('Тест')
      const write = (value: unknown) => ({
        op: 'setField',
        node: { id: item },
        fieldKey: 'abv',
        layer: 'manual',
        scope: 'master',
        value,
      })
      const clear = {
        op: 'clearField',
        node: { id: item },
        fieldKey: 'abv',
        layer: 'manual',
        scope: 'master',
      }
      await run([write(5)])
      expect(await run([write(5)])).toMatchObject({ unchanged: 1, eventsWritten: 0 })
      await run([clear])
      const field = (await eventsOf(item)).filter((event) => event.fieldKey === 'abv')
      expect(field.map((event) => event.op)).toEqual(['setField', 'clearField'])
    })

    it('are refused by the database for an unknown op', async () => {
      const item = await makeItem()
      const error = await withTenantWrite(app, tenant, (tx) =>
        tx.execute(sql`
          insert into restro.events
            (tenant_id, node_id, op, field_key, layer, scope, new_value, source, actor, job_id,
             change_set_id)
          values (${tenant}, ${item}, 'deleteNode', 'node', 'manual', 'master', '1'::jsonb,
                  'manual', 'system', 'job_test', ${newId('cs')})`),
      ).then(
        () => undefined,
        (caught: unknown) => caught,
      )
      let cause = error
      while (cause instanceof Error && cause.cause instanceof Error) cause = cause.cause
      expect((cause as { constraint?: string } | undefined)?.constraint).toBe('events_op')
    })
  })

  describe('atomic change sets', () => {
    it('refuse the whole set when one op is refused, and write nothing', async () => {
      const section = await makeSection(menu.id)
      const item = await makeItem()
      const ops = [
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
        { op: 'removePlacement', item: { id: item }, section: { id: newId('nd') } },
      ]
      const before = (await eventsOf(item)).length
      await expect(run(ops, { atomic: true })).rejects.toMatchObject({
        name: 'ApplyError',
        code: 'change_set_rejected',
        rejected: [{ opIndex: 1, code: 'unknown_node' }],
      })
      expect(await placementsOf(item)).toEqual([])
      expect(await eventsOf(item)).toHaveLength(before)

      // Without the option the ops that work are applied and the others reported.
      const loose = await run(ops)
      expect(loose).toMatchObject({ applied: 1 })
      expect(codesOf(loose)).toEqual(['unknown_node'])
      expect(await placementsOf(item)).toHaveLength(1)
    })

    it('commit normally when every op works', async () => {
      const from = await makeSection(menu.id)
      const to = await makeSection(menu.id)
      const item = await makeItem()
      await run([{ op: 'setPlacement', item: { id: item }, section: { id: from }, sortKey: 'end' }])
      const moved = await run(
        [
          { op: 'setPlacement', item: { id: item }, section: { id: to }, sortKey: 'end' },
          { op: 'removePlacement', item: { id: item }, section: { id: from } },
        ],
        { atomic: true },
      )
      expect(moved).toMatchObject({ applied: 2, rejected: [] })
      expect((await placementsOf(item)).map((row) => row.sectionId)).toEqual([to])
    })
  })

  describe('loadUnplacedItems', () => {
    it('returns the items placed in no section of the menu, with their groups, options and values', async () => {
      const section = await makeSection(menu.id)
      const placed = await makeItem('Поставен')
      const loose = await makeItem('Свободен')
      const archived = await makeItem('Архивиран')
      const withGroup = await makeItem('С добавки')
      const group = newId('nd')
      const option = newId('nd')
      await run([
        { op: 'setPlacement', item: { id: placed }, section: { id: section }, sortKey: 'end' },
        { op: 'setNodeStatus', node: { id: archived }, status: 'archived' },
        {
          op: 'createNode',
          id: group,
          nodeType: 'modifier_group',
          parent: { id: withGroup },
          status: 'active',
          sortKey: 'end',
        },
        {
          op: 'createNode',
          id: option,
          nodeType: 'option',
          parent: { id: group },
          status: 'active',
          sortKey: 'end',
        },
      ])

      const unplaced = await loadUnplacedItems(app, tenant, menu.id)
      expect(unplaced.itemIds).toContain(loose)
      expect(unplaced.itemIds).toContain(withGroup)
      expect(unplaced.itemIds).not.toContain(placed)
      expect(unplaced.itemIds).not.toContain(archived)
      // Oldest first.
      expect(unplaced.itemIds.indexOf(loose)).toBeLessThan(unplaced.itemIds.indexOf(withGroup))
      const nodeIds = unplaced.nodes.map((node) => node.id)
      expect(nodeIds).toEqual(expect.arrayContaining([loose, withGroup, group, option]))
      expect(nodeIds).not.toContain(placed)
      expect(
        unplaced.values.find((value) => value.nodeId === loose && value.fieldKey === 'name'),
      ).toMatchObject({ layer: 'manual', scope: 'master', value: { bg_BG: 'Свободен' } })
      // Links carry no external id.
      expect(JSON.stringify(unplaced.links)).not.toContain('externalId')
    })

    it('lets the resolver show them with the composer’s issues, and drops one once it is placed', async () => {
      const section = await makeSection(menu.id)
      const loose = await makeItem('Свободен 2')
      const venueScope = `venue:${venueId}` as const
      const resolveWith = async () => {
        const doc = await loadMenuDocument(app, tenant, menu.id)
        const unplaced = await loadUnplacedItems(app, tenant, menu.id)
        return resolve(VENUE_MENU_TEMPLATE, mergeDocumentParts(doc, unplaced), {
          venueScope,
          locales: ['bg_BG'],
          now: new Date().toISOString(),
        })
      }

      const before = await resolveWith()
      expect(before.items[loose]?.visible).toBe(false)
      expect(before.items[loose]?.issues.map((issue) => issue.code)).toContain('unplaced_item')
      expect(before.items[loose]?.fields.name?.value).toEqual({ bg_BG: 'Свободен 2' })

      await run([
        { op: 'setPlacement', item: { id: loose }, section: { id: section }, sortKey: 'end' },
      ])
      expect((await loadUnplacedItems(app, tenant, menu.id)).itemIds).not.toContain(loose)
      const after = await resolveWith()
      expect(after.items[loose]?.issues.map((issue) => issue.code)).not.toContain('unplaced_item')
    })

    it('never lists an item another venue placed in its own menu (T72)', async () => {
      const there = await makeSection(secondMenu.id)
      const item = await makeItem('Другото меню')
      // Placed nowhere yet: any venue may take it.
      expect((await loadUnplacedItems(app, tenant, menu.id)).itemIds).toContain(item)
      await run([
        { op: 'setPlacement', item: { id: item }, section: { id: there }, sortKey: 'end' },
      ])
      expect((await loadUnplacedItems(app, tenant, menu.id)).itemIds).not.toContain(item)
      expect((await loadUnplacedItems(app, tenant, secondMenu.id)).itemIds).not.toContain(item)
    })

    it('lists a till item only in the venue the till read it for (T72)', async () => {
      // As a pull leaves it: linked to the till, a price for the second venue only, placed nowhere.
      const item = newId('nd')
      const articleId = `${Date.now()}`
      const record = newId('sr')
      await withTenantWrite(app, tenant, (tx) =>
        tx.execute(sql`
          insert into restro.source_records
            (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
             payload)
          values (${record}, ${tenant}, ${integration}, 'article', ${articleId}, 'master',
                  ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
      )
      const result = await apply(
        app,
        tenant,
        changeSet(`till:${integration}`, [
          { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
          {
            op: 'linkSource',
            node: { id: item },
            link: { integration, externalType: 'article', externalId: articleId },
          },
          {
            op: 'setField',
            node: { id: item },
            fieldKey: 'price',
            layer: 'till',
            scope: `venue:${secondVenueId}`,
            value: { amount_minor: 450, currency: 'EUR' },
            sourceRecordId: record,
            mappingVersion: 1,
          },
        ]),
      )
      expect(result.rejected).toEqual([])
      expect((await loadUnplacedItems(app, tenant, secondMenu.id)).itemIds).toContain(item)
      // The other venue never sees it, nameless and priceless, in its Unsorted.
      expect((await loadUnplacedItems(app, tenant, menu.id)).itemIds).not.toContain(item)
      // RR-72: the same answer when an action asks.
      expect(await itemsOfVenue(app, tenant, secondVenueId, [item])).toContain(item)
      expect(await itemsOfVenue(app, tenant, venueId, [item])).not.toContain(item)
    })

    it('itemsOfVenue: everything the composer shows is the venue’s, and what is another’s is not (RR-72)', async () => {
      // Placed in a nested section of the live menu.
      const top = await makeSection(menu.id)
      const nested = await makeSection(top)
      const inNested = await makeItem('Вложен')
      // Placed in a menu of the venue that is not live.
      const notLive = await provisionMenu(app, tenant, venueId)
      const inNotLive = await makeItem('Не е активно')
      const notLiveSection = await makeSection(notLive.id)
      // Placed at the other venue, and only there.
      const there = await makeSection(secondMenu.id)
      const atOther = await makeItem('На другото място')
      await run([
        { op: 'setPlacement', item: { id: inNested }, section: { id: nested }, sortKey: 'end' },
        {
          op: 'setPlacement',
          item: { id: inNotLive },
          section: { id: notLiveSection },
          sortKey: 'end',
        },
        { op: 'setPlacement', item: { id: atOther }, section: { id: there }, sortKey: 'end' },
      ])
      // Unsorted: hand-made and placed nowhere.
      const unsorted = await makeItem('Несортиран')

      // What the composer's two lists hold, asked of the real query: nothing shown is refused.
      const shown = [
        ...(await loadUnplacedItems(app, tenant, menu.id)).itemIds,
        ...(await loadUnplacedItems(app, tenant, notLive.id)).itemIds,
        inNested,
        inNotLive,
      ]
      expect(shown).toContain(unsorted)
      const ours = await itemsOfVenue(app, tenant, venueId, shown)
      expect(shown.filter((id) => !ours.has(id))).toEqual([])

      expect([...(await itemsOfVenue(app, tenant, venueId, [atOther]))]).toEqual([])
      expect([...(await itemsOfVenue(app, tenant, secondVenueId, [atOther]))]).toEqual([atOther])
      expect([...(await itemsOfVenue(app, tenant, secondVenueId, [inNested]))]).toEqual([])
      // Another tenant's item is nobody's here.
      expect([...(await itemsOfVenue(app, otherTenant, venueId, [inNested]))]).toEqual([])
    })

    it('refuses a menu the tenant does not have, and never returns another tenant’s items', async () => {
      await expect(loadUnplacedItems(app, otherTenant, menu.id)).rejects.toMatchObject({
        code: 'menu_not_found',
      })
      await expect(loadUnplacedItems(app, tenant, 'nd_nope')).rejects.toMatchObject({
        code: 'menu_not_found',
      })
      const theirs = await apply(
        app,
        otherTenant,
        manual([
          { op: 'createNode', id: newId('nd'), nodeType: 'item', parent: null, status: 'active' },
        ]),
      )
      const ours = await loadUnplacedItems(app, tenant, menu.id)
      expect(ours.itemIds).not.toContain(theirs.createdNodeIds[0])
    })
  })
})
