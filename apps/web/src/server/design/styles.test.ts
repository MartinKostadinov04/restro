// My styles on a real Postgres, as the restro_app role (D129): what the two reads offer the Design
// page and what a Style write answers. The audit's own rows:
//   - DA-31: an id is the server's to make. A `styleId` from the caller only ever means "replace
//     this Style of mine"; one this organisation does not hold is `not_found`, never a row under
//     that id and never the global primary key of `design_styles` refusing the insert.
//   - DA-36: a deleted venue's design is no tile, and a saved Style the contract has moved past is
//     left out rather than offered as a tile the renderer cannot draw.
//   - DA-O11: the two name cases Restro refuses but the database's unique index would let through
//     (a name differing only in case or in spaces) answer `name_taken` themselves.
import { BASIC_DESIGN_VALUES, newId, type StyleValues, styleValuesOf } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from '../test-database'
import { loadSavedStyles, loadVenueStyles, saveStyle, setStyleStatus } from './styles'

const actor = 'user:us_styles' as const
const values = (): StyleValues => styleValuesOf(BASIC_DESIGN_VALUES)

describe.skipIf(!hasDatabase)('My styles (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let venueId: string
  let secondVenueId: string

  /** A Style row of a tenant, written past row-level security (another organisation's, or junk). */
  const put = (fields: {
    name: string
    style?: string
    styleValues?: unknown
    tenantId?: string
    id?: string
  }) =>
    owner.query(
      `insert into restro.design_styles
         (id, tenant_id, name, style, style_values, layer, source, actor, job_id, change_set_id)
       values ($1, $2, $3, $4, $5::jsonb, 'manual', 'manual', $6, 'jb_styles', 'cs_styles')`,
      [
        fields.id ?? newId('ds'),
        fields.tenantId ?? tenant,
        fields.name,
        fields.style ?? 'club',
        JSON.stringify(fields.styleValues ?? values()),
        actor,
      ],
    )

  /** Every Style row of a tenant, read past row-level security. */
  const storedStyles = async (tenantId: string) =>
    (
      await owner.query<{ id: string; name: string }>(
        'select id, name from restro.design_styles where tenant_id = $1 order by id',
        [tenantId],
      )
    ).rows

  const save = (styleId: string | null, name: string, tenantId = tenant) =>
    saveStyle(getPool(), tenantId, { styleId, name, style: 'club', values: values(), actor })

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'Styles club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(getPool(), tenant, { name: 'Main', slug: testSlug('ms') })).id
    secondVenueId = (
      await provisionVenue(getPool(), tenant, { name: 'Second', slug: testSlug('ms2') })
    ).id
  }, 60_000)

  beforeEach(async () => {
    await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
      [tenant, otherTenant],
    ])
    await owner.query('update restro.venues set archived_at = null where id = any($1)', [
      [venueId, secondVenueId],
    ])
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      await owner.query('delete from restro.design_styles where tenant_id = any($1)', [tenants])
      for (const table of ['events', 'menus', 'nodes', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  describe('an id is the server’s to make (DA-31)', () => {
    it('saves a new Style under an id of its own when none is named', async () => {
      const result = await save(null, 'Ours')
      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error('unreachable')
      expect(result.styleId).toMatch(/^ds_[0-9A-Za-z]{22}$/)
      expect(await storedStyles(tenant)).toEqual([{ id: result.styleId, name: 'Ours' }])
    })

    it('replaces the Style an id of its own names', async () => {
      const first = await save(null, 'Ours')
      if (!first.ok) throw new Error('setup')
      expect(await save(first.styleId, 'Renamed')).toEqual({ ok: true, styleId: first.styleId })
      expect(await storedStyles(tenant)).toEqual([{ id: first.styleId, name: 'Renamed' }])
    })

    it('answers not_found for another organisation’s id, and writes nothing either side', async () => {
      const theirs = newId('ds')
      await put({ name: 'Theirs', tenantId: otherTenant, id: theirs })
      expect(await save(theirs, 'Mine now')).toEqual({ ok: false, error: 'not_found' })
      expect(await storedStyles(otherTenant)).toEqual([{ id: theirs, name: 'Theirs' }])
      expect(await storedStyles(tenant)).toEqual([])
    })

    it('answers not_found for a made-up id, and creates no Style under it', async () => {
      const madeUp = newId('ds')
      expect(await save(madeUp, 'Made up')).toEqual({ ok: false, error: 'not_found' })
      expect(await storedStyles(tenant)).toEqual([])
    })

    it('answers not_found for a removed Style of its own, which Undo puts back first', async () => {
      const first = await save(null, 'Ours')
      if (!first.ok) throw new Error('setup')
      await setStyleStatus(getPool(), tenant, {
        styleId: first.styleId,
        status: 'removed',
        actor,
      })
      expect(await save(first.styleId, 'Ours again')).toEqual({ ok: false, error: 'not_found' })
      expect(await storedStyles(tenant)).toEqual([{ id: first.styleId, name: 'Ours' }])
    })
  })

  describe('a name another live Style holds (DA-O11)', () => {
    // The unique index is on the name exactly as written, so these two are Restro's own rule: the
    // refusal has to come from the write path, not from the database.
    it.each(['night club', 'NIGHT CLUB', '  Night Club  '])(
      'answers name_taken for %s, whatever the case or the spaces',
      async (name) => {
        const first = await save(null, 'Night Club')
        if (!first.ok) throw new Error('setup')
        expect(await save(null, name)).toEqual({ ok: false, error: 'name_taken' })
        expect(await storedStyles(tenant)).toEqual([{ id: first.styleId, name: 'Night Club' }])
      },
    )

    it('answers name_taken when Undo meets a name taken in another case', async () => {
      const first = await save(null, 'Night Club')
      if (!first.ok) throw new Error('setup')
      await setStyleStatus(getPool(), tenant, { styleId: first.styleId, status: 'removed', actor })
      const second = await save(null, 'night club')
      expect(second).toMatchObject({ ok: true })
      expect(
        await setStyleStatus(getPool(), tenant, {
          styleId: first.styleId,
          status: 'active',
          actor,
        }),
      ).toEqual({ ok: false, error: 'name_taken' })
    })

    it('lets another organisation hold the same name', async () => {
      await save(null, 'Night Club')
      expect(await save(null, 'Night Club', otherTenant)).toMatchObject({ ok: true })
    })
  })

  describe('what the Design page is offered (DA-36)', () => {
    it('leaves out a saved Style that no longer fits the contract', async () => {
      const good = values() as unknown as { general: Record<string, string> }
      await put({ name: 'Fine' })
      await put({
        name: 'Option retired',
        styleValues: { ...good, general: { ...good.general, gone: 'x' } },
      })
      await put({
        name: 'Value renamed',
        styleValues: { ...good, general: { ...good.general, corners: 'rounded' } },
      })
      await put({ name: 'Page missing', styleValues: { general: good.general } })
      await put({ name: 'Style gone', style: 'retired-style' })
      const saved = await loadSavedStyles(getPool(), tenant)
      expect(saved.map((style) => style.name)).toEqual(['Fine'])
    })

    it('leaves out a removed Style, and shows it again after Undo', async () => {
      const first = await save(null, 'Ours')
      if (!first.ok) throw new Error('setup')
      await setStyleStatus(getPool(), tenant, { styleId: first.styleId, status: 'removed', actor })
      expect(await loadSavedStyles(getPool(), tenant)).toEqual([])
      await setStyleStatus(getPool(), tenant, { styleId: first.styleId, status: 'active', actor })
      expect((await loadSavedStyles(getPool(), tenant)).map((style) => style.name)).toEqual([
        'Ours',
      ])
    })

    it('offers no tile for a deleted venue, nor for the venue being edited', async () => {
      expect((await loadVenueStyles(getPool(), tenant, venueId)).map((row) => row.venueId)).toEqual(
        [secondVenueId],
      )
      await owner.query('update restro.venues set archived_at = now() where id = $1', [
        secondVenueId,
      ])
      expect(await loadVenueStyles(getPool(), tenant, venueId)).toEqual([])
    })
  })
})
