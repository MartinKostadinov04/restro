// The composer's structure actions of brief S6 (D89, D90, D92) against a real Postgres, as the
// restro_app role: deleting, renaming and laying out sections, deleting and renaming items, on a
// venue made by hand and on a venue with a till, and the menu each action names (a venue has
// several; a binned menu or another venue's is refused). The session is the only fake.
import { type ChangeSet, newId } from '@restro/core'
import {
  apply,
  createMenu,
  deleteMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '@/server/db'
import {
  hasDatabase,
  openOwnerPool,
  testSlug,
  useTestServerEnvironment,
} from '@/server/test-database'

import {
  createSectionAction,
  deleteItemAction,
  deleteSectionAction,
  renameItemAction,
  renameSectionAction,
  setSectionLayoutAction,
} from './actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_s6tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'S6 club', slug: 's6-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

interface ValueRow {
  layer: string
  value: unknown
  basis: unknown
}

describe.skipIf(!hasDatabase)('the structure actions of S6 (as the restro_app role)', () => {
  const tenant = newId('tn')
  const integration = newId('in')
  let owner: pg.Pool
  // A venue made by hand, with two menus and a binned one.
  let hand: string
  let menu: string
  let second: string
  let binned: string
  // A venue with a till.
  let till: string
  let tillMenu: string
  let record: string
  const ids = {
    drinks: newId('nd'),
    classics: newId('nd'),
    food: newId('nd'),
    mojito: newId('nd'),
    daiquiri: newId('nd'),
    soup: newId('nd'),
    tillSection: newId('nd'),
    ownSection: newId('nd'),
    tillItem: newId('nd'),
  }

  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const section = (id: string, parent: string, title: string) => [
    {
      op: 'createNode',
      id,
      nodeType: 'section',
      parent: { id: parent },
      status: 'active',
      sortKey: 'end',
    },
    manual(id, 'title', title === '' ? {} : { bg_BG: title }),
  ]
  const item = (id: string, sectionId: string, name: Record<string, string>) => [
    { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
    manual(id, 'name', name),
    { op: 'setPlacement', item: { id }, section: { id: sectionId }, sortKey: 'end' },
  ]
  const change = (source: string, ops: unknown[]) =>
    apply(getPool(), tenant, {
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'system' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet).then((result) => expect(result.rejected).toEqual([]))

  const status = async (id: string) =>
    (await owner.query<{ status: string }>('select status from restro.nodes where id = $1', [id]))
      .rows[0]?.status
  const placementsOf = async (id: string) =>
    (
      await owner.query<{ section_id: string }>(
        'select section_id from restro.placements where item_id = $1 order by section_id',
        [id],
      )
    ).rows.map((row) => row.section_id)
  const values = async (id: string, fieldKey: string) =>
    (
      await owner.query<ValueRow>(
        `select layer, value, basis from restro.field_values
           where node_id = $1 and field_key = $2 order by layer`,
        [id, fieldKey],
      )
    ).rows

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    const pool = getPool()
    await provisionTenant(pool, { tenantId: tenant, name: 'S6 club' })
    asked.tenantId = tenant

    hand = (await provisionVenue(pool, tenant, { name: 'By hand', slug: testSlug('hand') })).id
    menu = (await provisionMenu(pool, tenant, hand)).id
    const made = await createMenu(pool, tenant, { venueId: hand, name: 'Brunch' })
    const toBin = await createMenu(pool, tenant, { venueId: hand, name: 'Old' })
    if (!made.ok || !toBin.ok) throw new Error('the menus could not be made')
    second = made.menu.id
    binned = toBin.menu.id
    expect((await deleteMenu(pool, tenant, { venueId: hand, menuId: binned })).ok).toBe(true)

    await change('manual', [
      ...section(ids.drinks, menu, 'Напитки'),
      ...section(ids.classics, ids.drinks, 'Класика'),
      ...section(ids.food, menu, 'Храна'),
      ...item(ids.mojito, ids.drinks, { bg_BG: 'Мохито', en_US: 'Mojito' }),
      ...item(ids.daiquiri, ids.classics, { bg_BG: 'Дайкири' }),
      // The soup is in Drinks' sub-section and in Food: deleting Drinks leaves it in Food.
      ...item(ids.soup, ids.food, { bg_BG: 'Супа' }),
      { op: 'setPlacement', item: { id: ids.soup }, section: { id: ids.classics }, sortKey: 'end' },
    ])

    // The venue with a till: a barsy venue is mapped to it (D66), its category is a section of
    // the till, and the venue made a section of its own with a till item moved into it.
    till = (await provisionVenue(pool, tenant, { name: 'Till', slug: testSlug('till') })).id
    tillMenu = (await provisionMenu(pool, tenant, till)).id
    await owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', $3)`,
      [integration, tenant, 's6.test'],
    )
    await owner.query(
      `insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id)
       values ($1, $2, 1, 'Till venue', $3)`,
      [tenant, integration, till],
    )
    record = newId('sr')
    await owner.query(
      `insert into restro.source_records
         (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
       values ($1, $2, $3, 'category', 'cat-1', 'master', $4, '{}', '{}'::jsonb)`,
      [record, tenant, integration, 'b'.repeat(64)],
    )
    const tillTitle = {
      op: 'setField',
      node: { id: ids.tillSection },
      fieldKey: 'title',
      layer: 'till',
      scope: 'master',
      value: { bg_BG: 'Бира' },
      sourceRecordId: record,
      mappingVersion: 1,
    }
    await change(`till:${integration}`, [
      {
        op: 'createNode',
        id: ids.tillSection,
        nodeType: 'section',
        parent: { id: tillMenu },
        status: 'active',
      },
      {
        op: 'linkSource',
        node: { id: ids.tillSection },
        link: { integration, externalType: 'category', externalId: 'cat-1' },
      },
      tillTitle,
      { op: 'createNode', id: ids.tillItem, nodeType: 'item', parent: null, status: 'active' },
      {
        op: 'linkSource',
        node: { id: ids.tillItem },
        link: { integration, externalType: 'article', externalId: 'art-1' },
      },
      {
        ...tillTitle,
        node: { id: ids.tillItem },
        fieldKey: 'name',
        value: { bg_BG: 'Загорка' },
      },
    ])
    await change('manual', [
      ...section(ids.ownSection, tillMenu, 'Топ'),
      {
        op: 'setPlacement',
        item: { id: ids.tillItem },
        section: { id: ids.ownSection },
        sortKey: 'end',
      },
    ])
  })

  beforeEach(() => {
    asked.role = 'owner'
    revalidated.length = 0
  })

  afterAll(async () => {
    if (owner) {
      for (const table of [
        'barsy_venues',
        'events',
        'field_values',
        'placements',
        'source_links',
        'source_records',
        'integrations',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenant])
      }
      await owner.query('update restro.venues set live_menu_id = null where tenant_id = $1', [
        tenant,
      ])
      for (const table of ['menus', 'nodes', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenant])
      }
      await owner.query('delete from restro.tenants where id = $1', [tenant])
      await owner.end()
    }
    await getPool().end()
  })

  describe('the menu each action names', () => {
    it('works on the menu given: a section made in the second menu belongs to it', async () => {
      const id = newId('nd')
      expect(
        await createSectionAction({
          venueId: hand,
          menuId: second,
          id,
          parentId: null,
          title: { bg_BG: 'Закуски' },
          sortKey: 'a0',
        }),
      ).toEqual({ ok: true })
      const parent = await owner.query<{ parent_id: string }>(
        'select parent_id from restro.nodes where id = $1',
        [id],
      )
      expect(parent.rows[0]?.parent_id).toBe(second)
    })

    it('refuses a binned menu and another venue’s menu', async () => {
      for (const menuId of [binned, tillMenu]) {
        expect(
          await setSectionLayoutAction({
            venueId: hand,
            menuId,
            sectionId: ids.drinks,
            layout: 'horizontal',
          }),
          menuId,
        ).toEqual({ ok: false, error: 'not_found' })
      }
    })

    it('refuses a section of another menu of the same venue', async () => {
      expect(
        await setSectionLayoutAction({
          venueId: hand,
          menuId: second,
          sectionId: ids.drinks,
          layout: 'horizontal',
        }),
      ).toEqual({ ok: false, error: 'invalid' })
    })
  })

  describe('setSectionLayoutAction (D92)', () => {
    it('writes the layout as ours, on a section of the venue’s own and on one of the till', async () => {
      const cases = [
        { venueId: hand, menuId: menu, sectionId: ids.food },
        { venueId: till, menuId: tillMenu, sectionId: ids.tillSection },
      ]
      for (const target of cases) {
        expect(await setSectionLayoutAction({ ...target, layout: 'horizontal' })).toEqual({
          ok: true,
        })
        expect(await values(target.sectionId, 'layout')).toEqual([
          { layer: 'manual', value: 'horizontal', basis: null },
        ])
        expect(await setSectionLayoutAction({ ...target, layout: 'vertical' })).toEqual({
          ok: true,
        })
        expect((await values(target.sectionId, 'layout'))[0]?.value).toBe('vertical')
      }
      expect(revalidated).toContain(`/venues/${till}`)
    })

    it('refuses a layout that is not one', async () => {
      expect(
        await setSectionLayoutAction({
          venueId: hand,
          menuId: menu,
          sectionId: ids.food,
          layout: 'diagonal',
        }),
      ).toEqual({ ok: false, error: 'invalid' })
    })
  })

  describe('renameSectionAction', () => {
    it('renames a section of the venue’s own in the language given, keeping the others', async () => {
      await apply(getPool(), tenant, {
        id: newId('cs'),
        source: 'manual',
        jobId: newId('jb'),
        actor: 'system',
        observedAt: new Date().toISOString(),
        ops: [manual(ids.food, 'title', { bg_BG: 'Храна', en_US: 'Food' })],
      } as ChangeSet)
      expect(
        await renameSectionAction({
          venueId: hand,
          menuId: menu,
          sectionId: ids.food,
          title: { en_US: 'Kitchen' },
        }),
      ).toEqual({ ok: true })
      expect(await values(ids.food, 'title')).toEqual([
        { layer: 'manual', value: { bg_BG: 'Храна', en_US: 'Kitchen' }, basis: null },
      ])
    })

    it('puts our name over the till’s for a section of the till (the dictionary, D90)', async () => {
      expect(
        await renameSectionAction({
          venueId: till,
          menuId: tillMenu,
          sectionId: ids.tillSection,
          title: { bg_BG: 'Наливна бира' },
        }),
      ).toEqual({ ok: true })
      const rows = await values(ids.tillSection, 'title')
      expect(rows.find((row) => row.layer === 'override')).toEqual({
        layer: 'override',
        value: { bg_BG: 'Наливна бира' },
        basis: { bg_BG: 'Бира' },
      })
      // The till's own title is untouched.
      expect(rows.find((row) => row.layer === 'till')?.value).toEqual({ bg_BG: 'Бира' })
    })

    it('saving the same title changes nothing; a language the venue lacks or a blank is refused', async () => {
      expect(
        await renameSectionAction({
          venueId: hand,
          menuId: menu,
          sectionId: ids.food,
          title: { bg_BG: 'Храна' },
        }),
      ).toEqual({ ok: true })
      for (const title of [{ de_DE: 'Essen' }, { bg_BG: '   ' }, {}]) {
        expect(
          await renameSectionAction({ venueId: hand, menuId: menu, sectionId: ids.food, title }),
          JSON.stringify(title),
        ).toEqual({ ok: false, error: 'invalid' })
      }
    })
  })

  describe('deleteSectionAction', () => {
    it('refuses a plain member, and a section of the till (only hidden, D92)', async () => {
      asked.role = 'member'
      expect(
        await deleteSectionAction({ venueId: hand, menuId: menu, sectionId: ids.drinks }),
      ).toEqual({ ok: false, error: 'not_allowed' })
      asked.role = 'owner'
      expect(
        await deleteSectionAction({ venueId: till, menuId: tillMenu, sectionId: ids.tillSection }),
      ).toEqual({ ok: false, error: 'till_section' })
      expect(await status(ids.tillSection)).toBe('active')
      expect(await status(ids.drinks)).toBe('active')
    })

    it('a venue made by hand: the section and its sub-section go, their items to Unsorted', async () => {
      expect(
        await deleteSectionAction({ venueId: hand, menuId: menu, sectionId: ids.drinks }),
      ).toEqual({ ok: true })
      expect(await status(ids.drinks)).toBe('archived')
      expect(await status(ids.classics)).toBe('archived')
      // The items stay; only their places in the deleted sections go.
      expect(await status(ids.mojito)).toBe('active')
      expect(await placementsOf(ids.mojito)).toEqual([])
      expect(await placementsOf(ids.daiquiri)).toEqual([])
      expect(await placementsOf(ids.soup)).toEqual([ids.food])
      // The history keeps the record (rule 2).
      const events = await owner.query(
        `select 1 from restro.events where node_id = $1 and op = 'setNodeStatus'`,
        [ids.drinks],
      )
      expect(events.rowCount).toBeGreaterThan(0)
      // A deleted section is no section of the menu any more.
      expect(
        await deleteSectionAction({ venueId: hand, menuId: menu, sectionId: ids.drinks }),
      ).toEqual({ ok: false, error: 'invalid' })
    })

    it('a venue with a till deletes a section of its own; the till item in it goes to Unsorted', async () => {
      expect(
        await deleteSectionAction({ venueId: till, menuId: tillMenu, sectionId: ids.ownSection }),
      ).toEqual({ ok: true })
      expect(await status(ids.ownSection)).toBe('archived')
      expect(await status(ids.tillItem)).toBe('active')
      expect(await placementsOf(ids.tillItem)).toEqual([])
    })
  })

  describe('renameItemAction and deleteItemAction (items made by hand, D89)', () => {
    it('renames an item made by hand in the language given', async () => {
      expect(
        await renameItemAction({
          venueId: hand,
          menuId: menu,
          itemId: ids.mojito,
          name: { en_US: 'Virgin mojito' },
        }),
      ).toEqual({ ok: true })
      expect(await values(ids.mojito, 'name')).toEqual([
        { layer: 'manual', value: { bg_BG: 'Мохито', en_US: 'Virgin mojito' }, basis: null },
      ])
    })

    it('a venue with a till renames and deletes no item here (`till_venue`)', async () => {
      expect(
        await renameItemAction({
          venueId: till,
          menuId: tillMenu,
          itemId: ids.tillItem,
          name: { bg_BG: 'Бира' },
        }),
      ).toEqual({ ok: false, error: 'till_venue' })
      expect(
        await deleteItemAction({ venueId: till, menuId: tillMenu, itemId: ids.tillItem }),
      ).toEqual({ ok: false, error: 'till_venue' })
      expect(await status(ids.tillItem)).toBe('active')
    })

    it('deletes an item made by hand (owners and admins); the history keeps it', async () => {
      asked.role = 'member'
      expect(await deleteItemAction({ venueId: hand, menuId: menu, itemId: ids.soup })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      asked.role = 'admin'
      expect(await deleteItemAction({ venueId: hand, menuId: menu, itemId: ids.soup })).toEqual({
        ok: true,
      })
      expect(await status(ids.soup)).toBe('archived')
      // A deleted item is gone from the menu: neither renamed nor deleted again.
      expect(await deleteItemAction({ venueId: hand, menuId: menu, itemId: ids.soup })).toEqual({
        ok: false,
        error: 'invalid',
      })
    })

    it('refuses an item of another venue', async () => {
      expect(await deleteItemAction({ venueId: hand, menuId: menu, itemId: ids.tillItem })).toEqual(
        { ok: false, error: 'invalid' },
      )
      expect(await status(ids.tillItem)).toBe('active')
    })
  })
})
