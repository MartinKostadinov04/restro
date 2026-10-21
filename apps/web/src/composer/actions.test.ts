// The composer's "new item" action against a real Postgres, as the restro_app role (CF-01): what
// createItemAction writes (node, name, price in minor units, placement, all in the manual layer),
// who may call it, and every refusal. The session is the only fake: it says which organisation and
// role is asking. The menu is made by S4's menu action now (brief S6); the structure actions of S6
// are in structure-actions.test.ts.
import { type ChangeSet, newId } from '@restro/core'
import { apply, provisionMenu, provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from '@/server/db'
import {
  hasDatabase,
  openOwnerPool,
  testSlug,
  useTestServerEnvironment,
} from '@/server/test-database'
import { venueHasTill } from '@/server/venues'

import { createItemAction } from './actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_cf01tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'CF-01 club', slug: 'cf01-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

interface FieldRow {
  field_key: string
  layer: string
  scope: string
  value: unknown
  source: string
  actor: string
}

describe.skipIf(!hasDatabase)('createItemAction (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let venueId: string
  let menuId: string
  let sectionId: string
  let nestedId: string
  let otherVenueSection: string
  let otherTenantSection: string
  let archivedSection: string
  let noMenuVenueId: string
  let tillVenueId: string
  let tillMenuId: string
  let tillSection: string

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
      sortKey: 'a0',
    },
    manual(id, 'title', { bg_BG: title }),
  ]
  const fixture = (tenantId: string, ops: unknown[]) =>
    apply(getPool(), tenantId, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'system',
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet).then((result) => expect(result.rejected).toEqual([]))

  const input = (overrides: Record<string, unknown> = {}) => ({
    venueId,
    menuId,
    id: newId('nd'),
    sectionId,
    name: { bg_BG: 'Мохито', en_US: 'Mojito' },
    price: '4.50',
    sortKey: 'a5',
    ...overrides,
  })
  const fields = async (id: string) =>
    (
      await owner.query<FieldRow>(
        'select field_key, layer, scope, value, source, actor from restro.field_values where node_id = $1 order by field_key',
        [id],
      )
    ).rows
  const nodeRows = async (id: string) =>
    (
      await owner.query<{ node_type: string; parent_id: string | null; status: string }>(
        'select node_type, parent_id, status from restro.nodes where id = $1',
        [id],
      )
    ).rows
  const placements = async (id: string) =>
    (
      await owner.query<{ section_id: string; sort_key: string }>(
        'select section_id, sort_key from restro.placements where item_id = $1',
        [id],
      )
    ).rows
  /** Nothing of this item was written. */
  async function expectNothing(id: string) {
    expect(await nodeRows(id)).toEqual([])
    expect(await fields(id)).toEqual([])
    expect(await placements(id)).toEqual([])
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    const pool = getPool()
    await provisionTenant(pool, { tenantId: tenant, name: 'CF-01 club' })
    await provisionTenant(pool, { tenantId: otherTenant, name: 'Another club' })
    asked.tenantId = tenant
    venueId = (await provisionVenue(pool, tenant, { name: 'Main', slug: testSlug('main') })).id
    menuId = (await provisionMenu(pool, tenant, venueId)).id
    const secondVenue = (
      await provisionVenue(pool, tenant, { name: 'Second', slug: testSlug('second') })
    ).id
    const secondMenu = (await provisionMenu(pool, tenant, secondVenue)).id
    noMenuVenueId = (
      await provisionVenue(pool, tenant, { name: 'No menu', slug: testSlug('none') })
    ).id
    const otherVenue = (
      await provisionVenue(pool, otherTenant, { name: 'Else', slug: testSlug('else') })
    ).id
    const otherMenu = (await provisionMenu(pool, otherTenant, otherVenue)).id

    // A venue with a till: a barsy venue is mapped to it (D66).
    tillVenueId = (await provisionVenue(pool, tenant, { name: 'Till', slug: testSlug('till') })).id
    const tillMenu = (await provisionMenu(pool, tenant, tillVenueId)).id
    tillMenuId = tillMenu
    const integration = newId('in')
    await owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', $3)`,
      [integration, tenant, 'cf01.test'],
    )
    await owner.query(
      `insert into restro.barsy_venues (tenant_id, integration_id, bid, name, venue_id)
       values ($1, $2, 1, 'Till venue', $3)`,
      [tenant, integration, tillVenueId],
    )
    tillSection = newId('nd')

    sectionId = newId('nd')
    nestedId = newId('nd')
    archivedSection = newId('nd')
    otherVenueSection = newId('nd')
    otherTenantSection = newId('nd')
    await fixture(tenant, [
      ...section(sectionId, menuId, 'Коктейли'),
      ...section(nestedId, sectionId, 'Класика'),
      ...section(archivedSection, menuId, 'Стара'),
      ...section(otherVenueSection, secondMenu, 'Друго заведение'),
      ...section(tillSection, tillMenu, 'От касата'),
    ])
    await fixture(otherTenant, section(otherTenantSection, otherMenu, 'Чужда'))
    await owner.query("update restro.nodes set status = 'archived' where id = $1", [
      archivedSection,
    ])
  })

  beforeEach(() => {
    asked.role = 'owner'
    revalidated.length = 0
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'barsy_venues',
        'integrations',
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
    await getPool().end()
  })

  describe('createItemAction', () => {
    it('writes the node, the name, the price in minor units and the placement, all by hand', async () => {
      const request = input()
      expect(await createItemAction(request)).toEqual({ ok: true })

      // An item has no parent: it belongs to the menu through its placement.
      expect(await nodeRows(request.id)).toEqual([
        { node_type: 'item', parent_id: null, status: 'active' },
      ])
      const rows = await fields(request.id)
      expect(rows.map((row) => row.field_key)).toEqual(['name', 'price'])
      for (const row of rows) {
        // The manual layer, for the whole venue's master data, by this person.
        expect(row).toMatchObject({
          layer: 'manual',
          scope: 'master',
          source: 'manual',
          actor: 'user:us_cf01tester',
        })
      }
      expect(rows.find((row) => row.field_key === 'name')?.value).toEqual({
        bg_BG: 'Мохито',
        en_US: 'Mojito',
      })
      expect(rows.find((row) => row.field_key === 'price')?.value).toEqual({
        amount_minor: 450,
        currency: 'EUR',
      })
      expect(await placements(request.id)).toEqual([{ section_id: sectionId, sort_key: 'a5' }])
      expect(revalidated).toEqual([`/venues/${venueId}`])
    })

    it('converts the typed price with core’s money module, comma or point, never a float', async () => {
      const cases: [string, number][] = [
        ['4,50', 450],
        ['4.5', 450],
        ['12', 1200],
        ['0', 0],
        ['0.07', 7],
        ['  3.10 ', 310],
        // Where a float would be off: 19.99 * 100 = 1998.9999999999998.
        ['19.99', 1999],
        ['1.15', 115],
        ['99999999.99', 9999999999],
      ]
      for (const [text, minor] of cases) {
        const request = input({ price: text })
        expect(await createItemAction(request), text).toEqual({ ok: true })
        const price = (await fields(request.id)).find((row) => row.field_key === 'price')
        expect(price?.value, text).toEqual({ amount_minor: minor, currency: 'EUR' })
      }
    })

    it('writes no price when none was typed', async () => {
      for (const price of [undefined, '', '   ']) {
        const { price: _unused, ...rest } = input()
        const request = price === undefined ? rest : { ...rest, price }
        expect(await createItemAction(request)).toEqual({ ok: true })
        expect((await fields(request.id)).map((row) => row.field_key)).toEqual(['name'])
      }
    })

    it('refuses a price that is not a price, and writes nothing', async () => {
      for (const price of [
        'abc',
        '-1',
        '4.505',
        '4,5,0',
        '1 000',
        '.5',
        '5.',
        '1e2',
        '99999999999999',
      ]) {
        const request = input({ price })
        expect(await createItemAction(request), price).toEqual({ ok: false, error: 'invalid' })
        await expectNothing(request.id)
      }
    })

    it('starts an item in Unsorted when no section is given: no placement', async () => {
      const request = input({ sectionId: null })
      expect(await createItemAction(request)).toEqual({ ok: true })
      expect((await nodeRows(request.id))[0]?.node_type).toBe('item')
      expect(await placements(request.id)).toEqual([])
    })

    it('places an item in a nested section of the same menu', async () => {
      const request = input({ sectionId: nestedId })
      expect(await createItemAction(request)).toEqual({ ok: true })
      expect(await placements(request.id)).toEqual([{ section_id: nestedId, sort_key: 'a5' }])
    })

    it('needs a name in the venue’s main language, and only in enabled languages', async () => {
      for (const name of [
        { en_US: 'Mojito' },
        {},
        { bg_BG: 'Мохито', de_DE: 'Mojito' },
        { bg_BG: '   ' },
      ]) {
        const request = input({ name })
        expect(await createItemAction(request), JSON.stringify(name)).toEqual({
          ok: false,
          error: 'invalid',
        })
        await expectNothing(request.id)
      }
    })

    it('refuses a section of another venue, of another tenant, an archived one or an item', async () => {
      const aliveItem = input({ sectionId: null })
      expect(await createItemAction(aliveItem)).toEqual({ ok: true })
      for (const target of [
        otherVenueSection,
        otherTenantSection,
        archivedSection,
        aliveItem.id,
        menuId,
      ]) {
        const request = input({ sectionId: target })
        expect(await createItemAction(request), target).toEqual({ ok: false, error: 'invalid' })
        await expectNothing(request.id)
      }
    })

    it('refuses a venue that has a till: its items come from the till (D66)', async () => {
      for (const target of [tillSection, null]) {
        const request = input({ venueId: tillVenueId, menuId: tillMenuId, sectionId: target })
        expect(await createItemAction(request)).toEqual({ ok: false, error: 'till_venue' })
        await expectNothing(request.id)
      }
      expect(revalidated).toEqual([])
      // The role is checked first: a plain member is told about the role, not about the till.
      asked.role = 'member'
      expect(
        await createItemAction(
          input({ venueId: tillVenueId, menuId: tillMenuId, sectionId: null }),
        ),
      ).toEqual({
        ok: false,
        error: 'not_allowed',
      })
    })

    it('refuses a plain member before anything is written', async () => {
      asked.role = 'member'
      const request = input()
      expect(await createItemAction(request)).toEqual({ ok: false, error: 'not_allowed' })
      await expectNothing(request.id)
      expect(revalidated).toEqual([])
    })

    it('lets an admin create items', async () => {
      asked.role = 'admin'
      expect(await createItemAction(input())).toEqual({ ok: true })
    })

    it('refuses a venue that is not the organisation’s, has no menu, or a menu of another venue', async () => {
      const elsewhere = input({ venueId: `vn_${'x'.repeat(22)}` })
      expect(await createItemAction(elsewhere)).toEqual({ ok: false, error: 'not_found' })
      const noMenu = input({ venueId: noMenuVenueId, sectionId: null })
      expect(await createItemAction(noMenu)).toEqual({ ok: false, error: 'not_found' })
      await expectNothing(noMenu.id)
      // The menu must be the venue's own (S6: the composer works on the menu in its URL).
      const wrongMenu = input({ menuId: tillMenuId, sectionId: null })
      expect(await createItemAction(wrongMenu)).toEqual({ ok: false, error: 'not_found' })
      await expectNothing(wrongMenu.id)
    })

    it('refuses malformed input (unknown keys, bad ids, long text) as invalid', async () => {
      const bad: Record<string, unknown>[] = [
        { extra: true },
        { id: 'nd_' },
        { id: 'in_abcdefghijklmnopqrstuv' },
        { venueId: 'nd_abcdefghijklmnopqrstuv' },
        { menuId: 'vn_abcdefghijklmnopqrstuv' },
        { menuId: undefined },
        { sectionId: 'vn_abcdefghijklmnopqrstuv' },
        { sortKey: '' },
        { price: 450 },
        { price: '1234567890123' },
        { name: { bg_BG: 'x'.repeat(121) } },
        { name: { xx_XX: 'Mojito' } },
      ]
      for (const overrides of bad) {
        const request = input(overrides)
        expect(await createItemAction(request), JSON.stringify(overrides)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect(await createItemAction(undefined)).toEqual({ ok: false, error: 'invalid' })
    })

    it('makes a display-only item: no till link, no sale flag, nothing on the till layers (rule 5)', async () => {
      const request = input()
      expect(await createItemAction(request)).toEqual({ ok: true })
      const layers = (await fields(request.id)).map((row) => row.layer)
      expect(new Set(layers)).toEqual(new Set(['manual']))
      const links = await owner.query('select 1 from restro.source_links where node_id = $1', [
        request.id,
      ])
      expect(links.rowCount).toBe(0)
      const keys = (await fields(request.id)).map((row) => row.field_key)
      expect(keys).not.toContain('for_sale')
      expect(keys).not.toContain('visible')
      expect(keys).not.toContain('order_mode')
    })

    it('refuses a repeated id instead of overwriting the item', async () => {
      const request = input()
      expect(await createItemAction(request)).toEqual({ ok: true })
      const again = { ...request, name: { bg_BG: 'Друго' } }
      expect((await createItemAction(again)).ok).toBe(false)
      const name = (await fields(request.id)).find((row) => row.field_key === 'name')
      expect(name?.value).toEqual({ bg_BG: 'Мохито', en_US: 'Mojito' })
      // Nor any other node: a section's id as the new item's id changes nothing.
      const before = await fields(sectionId)
      expect(await createItemAction(input({ id: sectionId }))).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(await fields(sectionId)).toEqual(before)
    })
  })

  describe('venueHasTill', () => {
    it('is true for a venue a barsy venue is mapped to, false for any other', async () => {
      expect(await venueHasTill(tenant, tillVenueId)).toBe(true)
      expect(await venueHasTill(tenant, venueId)).toBe(false)
      expect(await venueHasTill(tenant, noMenuVenueId)).toBe(false)
      // Another organisation cannot see the mapping, and a malformed id is no venue.
      expect(await venueHasTill(otherTenant, tillVenueId)).toBe(false)
      expect(await venueHasTill(tenant, 'not-an-id')).toBe(false)
    })
  })
})
