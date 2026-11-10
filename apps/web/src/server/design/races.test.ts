// The Design page's server side under concurrency and bad stored rows (audit B5): what the owner
// is told when two Style saves race, when Undo meets a reused name, and when a saved Style or a
// venue's design holds something the contract no longer allows. The owner must get a clear
// answer, never a database error.
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  newId,
  type StyleValues,
  styleValuesOf,
} from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { getPool } from '../db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from '../test-database'
import { loadDesign } from './service'
import { loadMyStyles, loadSavedStyles, saveStyle, setStyleStatus } from './styles'

const values = (): StyleValues => styleValuesOf(BASIC_DESIGN_VALUES)
const actor = 'user:us_races' as const

describe.skipIf(!hasDatabase)('the Design page’s server side under races (as restro_app)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let venueId: string
  let otherVenueId: string

  const put = (style: string, name: string, styleValues: unknown, tenantId = tenant, id?: string) =>
    owner.query(
      `insert into restro.design_styles
         (id, tenant_id, name, style, style_values, layer, source, actor, job_id, change_set_id)
       values ($1, $2, $3, $4, $5::jsonb, 'manual', 'manual', 'user:us_races', 'jb_x', 'cs_x')`,
      [id ?? newId('ds'), tenantId, name, style, JSON.stringify(styleValues)],
    )

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'Races club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Other club' })
    venueId = (await provisionVenue(getPool(), tenant, { name: 'Main', slug: testSlug('rc') })).id
    otherVenueId = (
      await provisionVenue(getPool(), tenant, { name: 'Second', slug: testSlug('rc2') })
    ).id
  }, 60_000)

  beforeEach(async () => {
    await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
      [tenant, otherTenant],
    ])
    await owner.query(`delete from restro.events where tenant_id = any($1)`, [
      [tenant, otherTenant],
    ])
    await owner.query(`update restro.venues set settings = '{}'::jsonb where id = any($1)`, [
      [venueId, otherVenueId],
    ])
  })

  afterAll(async () => {
    if (owner) {
      await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
        [tenant, otherTenant],
      ])
      for (const table of ['events', 'menus', 'nodes', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [
          [tenant, otherTenant],
        ])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [[tenant, otherTenant]])
      await owner.end()
    }
  })

  it('answers two saves of one name at once with one ok and name_taken, never failed', async () => {
    for (let round = 0; round < 4; round += 1) {
      await owner.query('delete from restro.design_styles where tenant_id = $1', [tenant])
      const answers = await Promise.all(
        ['Night', 'night', ' NIGHT ', 'Night'].map((name) =>
          saveStyle(getPool(), tenant, {
            styleId: null,
            name,
            style: 'club',
            values: values(),
            actor,
          }).catch((error: unknown) => ({ ok: false as const, error: `threw ${String(error)}` })),
        ),
      )
      expect(answers.filter((a) => a.ok)).toHaveLength(1)
      expect(answers.filter((a) => !a.ok).map((a) => (a as { error: string }).error)).toEqual([
        'name_taken',
        'name_taken',
        'name_taken',
      ])
    }
  })

  it('answers Undo of a Style whose name was reused with name_taken', async () => {
    const first = await saveStyle(getPool(), tenant, {
      styleId: null,
      name: 'Night',
      style: 'club',
      values: values(),
      actor,
    })
    if (!first.ok) throw new Error('setup')
    await setStyleStatus(getPool(), tenant, { styleId: first.styleId, status: 'removed', actor })
    await saveStyle(getPool(), tenant, {
      styleId: null,
      name: 'night',
      style: 'club',
      values: values(),
      actor,
    })
    expect(
      await setStyleStatus(getPool(), tenant, { styleId: first.styleId, status: 'active', actor }),
    ).toEqual({ ok: false, error: 'name_taken' })
  })

  it('answers a Style id that another organisation already holds without a database error', async () => {
    const taken = newId('ds')
    await put('club', 'Theirs', values(), otherTenant, taken)
    const answer = await saveStyle(getPool(), tenant, {
      styleId: taken,
      name: 'Mine',
      style: 'club',
      values: values(),
      actor,
    }).catch((error: unknown) => ({ threw: String(error).slice(0, 100) }))
    // Not a thrown unique-key violation: the action would turn that into a bare "failed", and the
    // refusal would tell a caller that the id exists in another organisation.
    expect(answer).not.toHaveProperty('threw')
  })

  it('leaves out of My styles a saved Style the contract has moved past, and never throws', async () => {
    const good = values()
    await put('club', 'Fine', good)
    await put('club', 'Retired option', {
      ...good,
      general: { ...(good as { general: object }).general, retired: 'x' },
    })
    await put('club', 'Renamed value', {
      ...good,
      general: { ...(good as { general: object }).general, corners: 'rounded' },
    })
    await put('club', 'Missing page', { general: (good as { general: object }).general })
    await put('retired-style', 'Gone Style', good)
    const saved = await loadSavedStyles(getPool(), tenant)
    // A Style whose premade Style no longer exists is also not drawable.
    expect(saved.map((style) => style.name)).toEqual(['Fine'])
  })

  it('reads another venue’s broken design as Basic in My styles, never throws', async () => {
    for (const stored of [
      { revision: 2, style: 'editorial', values: { general: { corners: 'rounded' } } },
      { revision: 'x' },
      [],
      'text',
      null,
    ]) {
      await owner.query(
        `update restro.venues set settings = jsonb_build_object('design', $2::jsonb) where id = $1`,
        [otherVenueId, JSON.stringify(stored)],
      )
      // A tile offers another venue's design as it would be published, and a row that does not
      // parse publishes nothing: Basic, never a throw (`readDesign`, the plain read).
      const mine = await loadMyStyles(getPool(), tenant, venueId)
      expect(mine.venues.find((venue) => venue.venueId === otherVenueId)?.style).toBe('basic')
    }
  })

  it('opens a broken design on the page as what can be read of it, to be saved again', async () => {
    const page = (stored: unknown) =>
      loadDesign(
        getPool(),
        tenant,
        { settings: { design: stored } as never },
        async () => ({ getUrl: async () => 'x' }),
        'owner',
      )
    // Since #291 the page shows what it can read and opens already changed, so Done replaces the
    // row the publisher refuses (`invalid_design`): the Style and every option value the contract
    // still lists survive, the rest reads as Basic's.
    const salvaged = await page({
      revision: 2,
      style: 'editorial',
      values: { general: { corners: 'rounded', depth: 'none' } },
    })
    expect(salvaged).toMatchObject({ revision: 2, repair: true })
    expect(salvaged.design.style).toBe('editorial')
    expect(salvaged.design.values.general.depth).toBe('none')
    // A value the contract no longer has falls back to Basic's.
    expect(salvaged.design.values.general.corners).toBe(DEFAULT_DESIGN.values.general.corners)
    // Nothing readable at all is Basic, with the row still marked for replacing, and never a throw.
    for (const stored of [{ revision: 'x' }, [], 'text', null]) {
      const view = await page(stored)
      expect(view.design).toEqual(DEFAULT_DESIGN)
      expect(view.repair).toBe(true)
    }
  })
})
