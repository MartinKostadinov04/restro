// The design record through the one write path (D129, rules 1 and 2): `setDesign` against a real
// Postgres as restro_app. One event with provenance per save, a stale revision refused with the
// stored record, the row-level security that keeps a record to its organisation, and the property:
// any record built from the contract's values comes back unchanged from apply and from a snapshot.
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import * as fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { DESIGN_PAGES, type DesignValues } from '../design/contract'
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  type DesignContent,
  readDesign,
  readDesignRecord,
} from '../design/record'
import { sha256Hex } from '../hash'
import { type NodeId, newId } from '../ids'
import { MenuSnapshotSchema } from '../snapshot/schema'
import { apply } from './apply'
import { createAsset } from './create-asset'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { archiveVenue } from './venue-lifecycle'

const COLOURS = { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' }

/** Any design on the contract: a value of every option, either colouring, any logo of `logos`. */
const anyDesign = (logos: readonly (string | null)[]): fc.Arbitrary<DesignContent> => {
  const hex = fc
    .integer({ min: 0, max: 0xffffff })
    .map((n) => `#${n.toString(16).padStart(6, '0')}`)
  const values = fc.record(
    Object.fromEntries(
      DESIGN_PAGES.map((page) => [
        page.id,
        fc.record(
          Object.fromEntries(
            page.options.flatMap((option) =>
              option.kind === 'choice'
                ? [[option.id, fc.constantFrom(...option.values.map((value) => value.id))]]
                : [],
            ),
          ),
        ),
      ]),
    ),
  ) as unknown as fc.Arbitrary<DesignValues>
  // Borders have no reading requirement, so any colour may be set by hand for them.
  const overrides = fc.option(
    fc.record({ light: fc.record({ border: hex }), dark: fc.record({ border: hex }) }),
    { nil: undefined },
  )
  const colouring = fc.oneof(
    fc.constant({}),
    hex.map((brand) => ({ brand })),
    fc.record({ primary: hex, secondary: hex, tertiary: hex }).map((colors) => ({ colors })),
  )
  return fc
    .record({
      style: fc.constantFrom('basic', 'editorial'),
      values,
      colouring,
      overrides,
      logo_asset_id: fc.constantFrom(...logos),
    })
    .map(({ colouring: colours, overrides: roles, ...rest }) => ({
      ...rest,
      ...colours,
      ...(roles === undefined ? {} : { overrides: roles }),
    })) as unknown as fc.Arbitrary<DesignContent>
}

describe.skipIf(!hasDatabase)('the design record (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let otherVenueId: `vn_${string}`
  let archivedVenueId: `vn_${string}`
  let menu: ProvisionedMenu
  let minutes = 0

  const save = (
    venue: string,
    expectedRevision: number,
    design: unknown,
    fields: { tenantId?: string; actor?: string } = {},
  ) => {
    const set = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: fields.actor ?? 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [{ op: 'setDesign', venueId: venue, expectedRevision, design }],
    }
    return apply(app, fields.tenantId ?? tenant, set as ChangeSet).then((result) => ({
      set,
      result,
    }))
  }
  const settingsOf = async (tenantId: string, id: string) =>
    (
      await withTenant(app, tenantId, (tx) =>
        tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, id)),
      )
    )[0]?.settings
  /** The venue's settings, read past row-level security. */
  const storedSettings = async (id: string) =>
    (
      await owner.query<{ settings: Record<string, unknown> }>(
        'select settings from restro.venues where id = $1',
        [id],
      )
    ).rows[0]?.settings
  const eventsOf = async (id: string) =>
    (
      await owner.query<Record<string, unknown>>(
        `select op, node_id, field_key, layer, scope, old_value, new_value, source, actor, job_id,
                change_set_id
         from restro.events where scope = $1 order by seq`,
        [`venue:${id}`],
      )
    ).rows
  const resetVenue = async (id: string) => {
    await owner.query('delete from restro.events where scope = $1', [`venue:${id}`])
    await owner.query(`update restro.venues set settings = '{}'::jsonb where id = $1`, [id])
  }
  const publish = () => {
    minutes += 1
    return publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-10-30T18:00:00Z') + minutes * 60_000) },
    )
  }
  const makeLogo = async (forTenant: string, name: string) => {
    const asset = await createAsset(app, forTenant, {
      origin: 'upload',
      contentType: 'image/png',
      checksum: sha256Hex(name),
      width: 600,
      height: 200,
      storageKey: `tenants/${forTenant}/assets/${name}/original.png`,
    })
    return asset.id
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-design-record-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Design club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as `vn_${string}`
    otherVenueId = (
      await provisionVenue(app, otherTenant, { name: 'Else', slug: testSlug('else') })
    ).id as `vn_${string}`
    archivedVenueId = (await provisionVenue(app, tenant, { name: 'Gone', slug: testSlug('gone') }))
      .id as `vn_${string}`
    await archiveVenue(app, tenant, archivedVenueId)
    menu = await provisionMenu(app, tenant, venueId)
    const section = newId('nd') as NodeId
    const item = newId('nd') as NodeId
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const made = await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Напитки' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Вода' }),
        manual(item, 'price', { amount_minor: 500, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(made.rejected).toEqual([])
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  beforeEach(async () => {
    await resetVenue(venueId)
    await resetVenue(otherVenueId)
  })

  describe('a save', () => {
    it('stores the record with its provenance and appends one event', async () => {
      const design = { ...DEFAULT_DESIGN, colors: COLOURS }
      const { set, result } = await save(venueId, 0, design)
      expect(result).toMatchObject({ applied: 1, eventsWritten: 1, rejected: [] })

      const record = readDesignRecord(await storedSettings(venueId))
      expect(record).toEqual({
        ...design,
        revision: 1,
        provenance: {
          layer: 'manual',
          source: 'manual',
          actor: 'user:us_test',
          job_id: set.jobId,
          change_set_id: set.id,
        },
      })
      expect(await eventsOf(venueId)).toEqual([
        {
          op: 'setDesign',
          node_id: null,
          field_key: 'design',
          layer: 'manual',
          scope: `venue:${venueId}`,
          old_value: null,
          new_value: record,
          source: 'manual',
          actor: 'user:us_test',
          job_id: set.jobId,
          change_set_id: set.id,
        },
      ])
    })

    it('counts the revision up, each event holding the record before and after', async () => {
      await save(venueId, 0, { ...DEFAULT_DESIGN, colors: COLOURS })
      const first = readDesignRecord(await storedSettings(venueId))
      const { result } = await save(venueId, 1, DEFAULT_DESIGN, { actor: 'system' })
      expect(result.rejected).toEqual([])
      const second = readDesignRecord(await storedSettings(venueId))
      expect(second).toMatchObject({ revision: 2, provenance: { actor: 'system' } })
      expect(second).not.toHaveProperty('colors')
      const events = await eventsOf(venueId)
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ old_value: first, new_value: second, actor: 'system' })
    })

    it('leaves the venue’s other settings alone', async () => {
      await owner.query(`update restro.venues set settings = '{"other": 1}'::jsonb where id = $1`, [
        venueId,
      ])
      await save(venueId, 0, { ...DEFAULT_DESIGN, colors: COLOURS })
      const settings = await storedSettings(venueId)
      expect(settings?.other).toBe(1)
      expect(readDesign(settings).revision).toBe(1)
    })

    it('that changes nothing writes nothing: no revision, no event', async () => {
      const design = { ...DEFAULT_DESIGN, colors: COLOURS }
      await save(venueId, 0, design)
      const { result } = await save(venueId, 1, design)
      expect(result).toMatchObject({ applied: 0, unchanged: 1, eventsWritten: 0, rejected: [] })
      expect(readDesign(await storedSettings(venueId)).revision).toBe(1)
      expect(await eventsOf(venueId)).toHaveLength(1)
    })

    it('of Basic on a venue with no record is that too: it already reads as Basic', async () => {
      const { result } = await save(venueId, 0, DEFAULT_DESIGN)
      expect(result).toMatchObject({ applied: 0, unchanged: 1, rejected: [] })
      expect(await storedSettings(venueId)).toEqual({})
    })
  })

  describe('a refusal', () => {
    it('of a stale revision carries the stored record, and writes nothing', async () => {
      const stored = { ...DEFAULT_DESIGN, colors: COLOURS }
      await save(venueId, 0, stored)
      for (const stale of [0, 2, 99]) {
        const { result } = await save(venueId, stale, DEFAULT_DESIGN)
        expect(result.applied).toBe(0)
        expect(result.rejected).toHaveLength(1)
        expect(result.rejected[0]).toMatchObject({
          code: 'stale_revision',
          storedDesign: { revision: 1, design: stored },
        })
      }
      expect(readDesign(await storedSettings(venueId))).toEqual({ revision: 1, design: stored })
      expect(await eventsOf(venueId)).toHaveLength(1)
    })

    it('of two saves at once lets one through, the other told it is stale', async () => {
      const first = { ...DEFAULT_DESIGN, colors: COLOURS }
      const second = { ...DEFAULT_DESIGN, colors: { ...COLOURS, tertiary: '#123456' } }
      const results = await Promise.all([save(venueId, 0, first), save(venueId, 0, second)])
      expect(results.map(({ result }) => result.applied).sort()).toEqual([0, 1])
      const refused = results.find(({ result }) => result.applied === 0)?.result.rejected[0]
      expect(refused?.code).toBe('stale_revision')
      expect(readDesign(await storedSettings(venueId)).revision).toBe(1)
      expect(await eventsOf(venueId)).toHaveLength(1)
    })

    it('of a design whose colours do not read writes nothing', async () => {
      const unreadable = {
        ...DEFAULT_DESIGN,
        colors: COLOURS,
        overrides: { light: { text: COLOURS.primary } },
      }
      const { result } = await save(venueId, 0, unreadable)
      expect(result.rejected[0]?.code).toBe('unreadable')
      expect(await storedSettings(venueId)).toEqual({})
    })

    it('of a deleted venue writes nothing', async () => {
      const { result } = await save(archivedVenueId, 0, DEFAULT_DESIGN)
      expect(result.rejected[0]?.code).toBe('venue_archived')
      expect(readDesignRecord(await storedSettings(archivedVenueId))).toBeNull()
    })

    it('of a logo that is not a stored image of this organisation writes nothing', async () => {
      const foreign = await makeLogo(otherTenant, 'foreign-logo')
      for (const logo of [newId('as'), foreign]) {
        const { result } = await save(venueId, 0, { ...DEFAULT_DESIGN, logo_asset_id: logo })
        expect(result.rejected[0]?.code, logo).toBe('logo_not_usable')
      }
      expect(await storedSettings(venueId)).toEqual({})
      const own = await makeLogo(tenant, 'own-logo')
      const { result } = await save(venueId, 0, { ...DEFAULT_DESIGN, logo_asset_id: own })
      expect(result.rejected).toEqual([])
    })
  })

  describe('row-level security', () => {
    it('does not let an organisation see or save another’s venue', async () => {
      await save(otherVenueId, 0, { ...DEFAULT_DESIGN, colors: COLOURS }, { tenantId: otherTenant })
      expect(await settingsOf(tenant, otherVenueId)).toBeUndefined()

      const { result } = await save(otherVenueId, 1, DEFAULT_DESIGN)
      expect(result.rejected[0]?.code).toBe('unknown_venue')
      // The refusal never carries the other organisation's record.
      expect(result.rejected[0]).not.toHaveProperty('storedDesign')
      expect(readDesign(await storedSettings(otherVenueId))).toEqual({
        revision: 1,
        design: { ...DEFAULT_DESIGN, colors: COLOURS },
      })
      // Its events are its own: the first organisation reads none of them.
      const rows = await withTenant(app, tenant, (tx) =>
        tx.execute(`select 1 from restro.events where scope = 'venue:${otherVenueId}'`),
      )
      expect(rows.rows).toHaveLength(0)
    })
  })

  describe('a publish', () => {
    it('carries the design block, the layout from it, and no template', async () => {
      const values = {
        ...BASIC_DESIGN_VALUES,
        items: { ...BASIC_DESIGN_VALUES.items, layout: 'one', guest_switch: 'off' },
      }
      await save(venueId, 0, { ...DEFAULT_DESIGN, values })
      const published = await publish()
      expect(published.status).toBe('published')
      expect(published.snapshot.body?.design).toEqual(values)
      expect(published.snapshot.body?.layout).toEqual({ default: 'one', guest_switch: false })
      expect(published.snapshot.body).not.toHaveProperty('presentation')
    })

    it('never carries the record’s provenance, revision or Style', async () => {
      await save(venueId, 0, { ...DEFAULT_DESIGN, colors: COLOURS })
      const published = await publish()
      const text = JSON.stringify(published.snapshot.body)
      expect(text).not.toContain('us_test')
      expect(text).not.toContain('provenance')
      expect(published.snapshot.body?.design).not.toHaveProperty('revision')
      expect(published.snapshot.body?.design).not.toHaveProperty('style')
    })
  })

  // Rule 2's record and the guest's block are the same values: nothing is lost or re-worded on the
  // way through apply and the snapshot, for any design the contract allows.
  it('round-trips any design built from the contract through apply and the snapshot', async () => {
    const logo = await makeLogo(tenant, 'round-trip-logo')
    await fc.assert(
      fc.asyncProperty(anyDesign([null, logo]), async (design) => {
        const before = readDesign(await storedSettings(venueId))
        const { result } = await save(venueId, before.revision, design)
        expect(result.rejected).toEqual([])
        const stored = readDesign(await storedSettings(venueId))
        expect(stored.design).toEqual(design)
        const published = await publish()
        expect(published.status).not.toBe('held')
        const body = published.snapshot.body
        expect(MenuSnapshotSchema.safeParse(body).success).toBe(true)
        expect(body?.design).toEqual(design.values)
        expect(body?.layout).toEqual({
          default: design.values.items.layout,
          guest_switch: design.values.items.guest_switch === 'on',
        })
      }),
      { numRuns: 15 },
    )
  }, 120_000)
})
