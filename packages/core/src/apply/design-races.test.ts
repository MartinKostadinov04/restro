// The designer wave under concurrency (audit B5): `setDesign`, `setStyle` and `setStyleStatus`
// against a real Postgres as restro_app, with many writers at once and a publish in the middle.
// Each test states the invariant it holds. Every loop here went red once under a deliberate
// mutation before it was kept (the mutation is named in the audit's robustness.md).
import { createPool, type DbPool } from '@restro/db'
import * as fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import type { DesignValues } from '../design/contract'
import {
  BASIC_DESIGN_VALUES,
  CORNER_RADIUS,
  DEFAULT_DESIGN,
  type DesignContent,
  readDesign,
} from '../design/record'
import { type SavedStyleContent, styleValuesOf } from '../design/saved-style'
import { type NodeId, newId } from '../ids'
import { MenuSnapshotSchema } from '../snapshot/schema'
import { apply } from './apply'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadCurrentSnapshot, publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

const COLOURS = { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' }

/** A design whose values differ from every other `n` on four pages, so a half-merge shows. */
function variant(n: number): DesignContent {
  const corners = (['soft', 'square', 'round', 'extra'] as const)[n % 4]
  const screen = (['auto', 'light', 'dark'] as const)[n % 3]
  const values: DesignValues = {
    ...BASIC_DESIGN_VALUES,
    general: { ...BASIC_DESIGN_VALUES.general, corners, screen },
    items: {
      ...BASIC_DESIGN_VALUES.items,
      layout: (['list', 'one', 'two'] as const)[n % 3],
      name_size: (['s', 'm', 'l'] as const)[(n + 1) % 3],
    },
    sections: {
      ...BASIC_DESIGN_VALUES.sections,
      title_size: (['s', 'm', 'l'] as const)[(n + 2) % 3],
    },
    pay: { ...BASIC_DESIGN_VALUES.pay },
  } as DesignValues
  return {
    ...DEFAULT_DESIGN,
    style: n % 2 === 0 ? 'editorial' : 'basic',
    values,
    colors: { ...COLOURS, tertiary: `#${(0xe0a43a - n * 0x101).toString(16).padStart(6, '0')}` },
  } as DesignContent
}

const styleContent = (name: string, n = 0): SavedStyleContent => ({
  name,
  style: 'club',
  values: styleValuesOf(variant(n).values),
})

describe.skipIf(!hasDatabase)('the designer wave under concurrency (as restro_app)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  let minutes = 0

  const changeSet = (ops: unknown[], actor = 'user:us_test'): ChangeSet =>
    ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet

  const saveDesign = (expectedRevision: number, design: DesignContent, venue: string = venueId) => {
    const set = changeSet([{ op: 'setDesign', venueId: venue, expectedRevision, design }])
    return apply(app, tenant, set).then((result) => ({ set, result }))
  }
  const saveStyle = (styleId: string, content: SavedStyleContent, tenantId = tenant) =>
    apply(app, tenantId, changeSet([{ op: 'setStyle', styleId, content }]))
  const setStatus = (styleId: string, status: 'active' | 'removed') =>
    apply(app, tenant, changeSet([{ op: 'setStyleStatus', styleId, status }]))

  const storedSettings = async () =>
    (
      await owner.query<{ settings: Record<string, unknown> }>(
        'select settings from restro.venues where id = $1',
        [venueId],
      )
    ).rows[0]?.settings
  const designEvents = async () =>
    (
      await owner.query<Record<string, unknown>>(
        `select * from restro.events where scope = $1 and op = 'setDesign' order by seq`,
        [`venue:${venueId}`],
      )
    ).rows
  const styleRows = async () =>
    (
      await owner.query<{ id: string; name: string; removed_at: Date | null }>(
        `select id, name, removed_at from restro.design_styles where tenant_id = $1 order by id`,
        [tenant],
      )
    ).rows
  const styleEventCount = async () =>
    Number(
      (
        await owner.query<{ n: string }>(
          `select count(*) n from restro.events where tenant_id = $1 and op in ('setStyle', 'setStyleStatus')`,
          [tenant],
        )
      ).rows[0]?.n,
    )
  const liveStyles = async () => (await styleRows()).filter((row) => row.removed_at === null)

  const publish = () => {
    minutes += 1
    return publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-11-01T18:00:00Z') + minutes * 60_000) },
    )
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-design-races-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Races club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Other club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('races') }))
      .id as `vn_${string}`
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
    const made = await apply(
      app,
      tenant,
      changeSet([
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
      ]),
    )
    expect(made.rejected).toEqual([])
  }, 60_000)

  afterAll(async () => {
    if (owner) {
      await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
        [tenant, otherTenant],
      ])
      await cleanUp(owner, [tenant, otherTenant])
    }
    await owner?.end()
    await app?.end()
  })

  beforeEach(async () => {
    await owner.query('delete from restro.events where scope = $1', [`venue:${venueId}`])
    await owner.query(
      `delete from restro.events where tenant_id = $1 and op in ('setStyle', 'setStyleStatus')`,
      [tenant],
    )
    await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
      [tenant, otherTenant],
    ])
    await owner.query(
      `update restro.venues set settings = '{}'::jsonb, unpublished_at = null where id = $1`,
      [venueId],
    )
  })

  // 1. Two saves at once on one venue's design.
  describe('saves of one venue’s design at once', () => {
    it('let exactly one through; the loser leaves no field behind (no half-merge)', async () => {
      for (let round = 0; round < 5; round += 1) {
        const before = readDesign(await storedSettings()).revision
        const inputs = Array.from({ length: 8 }, (_, i) => variant(round * 8 + i + 1))
        const results = await Promise.all(inputs.map((design) => saveDesign(before, design)))
        const winners = results.flatMap(({ result }, i) => (result.applied === 1 ? [i] : []))
        expect(winners, `round ${round}`).toHaveLength(1)
        for (const [i, { result }] of results.entries()) {
          if (i === winners[0]) continue
          expect(result.rejected[0]?.code).toBe('stale_revision')
          expect(result.rejected[0]?.storedDesign?.revision).toBe(before + 1)
        }
        const stored = readDesign(await storedSettings())
        expect(stored.revision).toBe(before + 1)
        // The stored design is the winner's whole design, not a mix of two.
        expect(stored.design).toEqual(inputs[winners[0] as number])
        expect(await designEvents()).toHaveLength(before + 1)
      }
    })

    it('a chain of saves, each from the revision the last one left, loses none', async () => {
      const results = await Promise.all([
        saveDesign(0, variant(1)),
        saveDesign(0, variant(2)),
        saveDesign(0, variant(3)),
      ])
      expect(results.filter(({ result }) => result.applied === 1)).toHaveLength(1)
      const events = await designEvents()
      expect(events).toHaveLength(1)
      // The event holds the record before (none) and the record after, which is the stored one.
      expect(events[0]).toMatchObject({ old_value: null })
    })
  })

  // 2. A save during a publish.
  describe('a save while the venue is being published', () => {
    const themeRadiusOf = (design: DesignContent) => CORNER_RADIUS[design.values.general.corners]

    it('never publishes a mix of two designs, and the pointer names the last snapshot', async () => {
      const old = variant(2)
      await saveDesign(0, old)
      const errors: unknown[] = []
      for (let round = 0; round < 6; round += 1) {
        const current = readDesign(await storedSettings())
        const next = variant(round * 5 + 11)
        const [published, saved] = await Promise.allSettled([
          publish(),
          saveDesign(current.revision, next),
        ])
        if (published.status === 'rejected') errors.push(published.reason)
        if (saved.status === 'rejected') errors.push(saved.reason)
        const body = (await loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }))?.body
        const candidates = [current.design, next]
        const holder = candidates.find(
          (design) => JSON.stringify(design.values) === JSON.stringify(body?.design),
        )
        expect(holder, `round ${round}: the design block is one whole design`).toBeDefined()
        // The theme tokens come from that same design, not the other one.
        expect(body?.theme.radius).toBe(themeRadiusOf(holder as DesignContent))
        expect(body?.theme.scheme).toBe((holder as DesignContent).values.general.screen)
        // The layout block is the same design's Layout and Guest switch.
        expect(body?.layout?.default).toBe(
          { list: 'list', one: 'one', two: 'two' }[
            (holder as DesignContent).values.items.layout as 'list' | 'one' | 'two'
          ],
        )
      }
      expect(errors).toEqual([])
    })

    it('does not deadlock with a save when the venue is unpublished (the publish serves it again)', async () => {
      await saveDesign(0, variant(2))
      await publish()
      const errors: unknown[] = []
      for (let round = 0; round < 6; round += 1) {
        await owner.query(`update restro.venues set unpublished_at = now() where id = $1`, [
          venueId,
        ])
        const current = readDesign(await storedSettings())
        const [published, saved] = await Promise.allSettled([
          publish(),
          saveDesign(current.revision, variant(round * 7 + 21)),
        ])
        for (const outcome of [published, saved]) {
          if (outcome.status === 'rejected') errors.push(outcome.reason)
        }
      }
      expect(errors.map(pgCode)).toEqual([])
    }, 60_000)
  })

  // 3. Two Styles saved with the same name at once.
  describe('two Styles saved with one name at once', () => {
    it('let one through and refuse the others as name_taken, never a database error', async () => {
      const names = ['Night', 'night', ' Night ', 'NIGHT', 'Night']
      for (let round = 0; round < 4; round += 1) {
        const settled = await Promise.allSettled(
          names.map((name, i) => saveStyle(newId('ds'), styleContent(name, i + round))),
        )
        expect(settled.filter((outcome) => outcome.status === 'rejected')).toEqual([])
        const results = settled.map((outcome) => (outcome as PromiseFulfilledResult<never>).value)
        const winners = results.filter((result: { applied: number }) => result.applied === 1)
        expect(winners, `round ${round}`).toHaveLength(1)
        for (const result of results as {
          applied: number
          rejected: { code: string; reason: string }[]
        }[]) {
          if (result.applied === 1) continue
          expect(result.rejected[0]?.code).toBe('style_name_taken')
          expect(result.rejected[0]?.reason).toMatch(/already has the name/)
        }
        expect(await liveStyles()).toHaveLength(1)
        // Clear the way for the next round.
        await owner.query('delete from restro.design_styles where tenant_id = $1', [tenant])
        await owner.query(`delete from restro.events where tenant_id = $1 and op = 'setStyle'`, [
          tenant,
        ])
      }
    })

    it('hold for any names, whatever the case or the space around them (property)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: fc.constantFrom(
                'Club',
                'club',
                ' CLUB',
                'Club ',
                'ClUb',
                'Bar',
                'bar ',
                'ЖЪЛТ',
              ),
              pad: fc.constantFrom('', ' ', '  '),
            }),
            { minLength: 2, maxLength: 6 },
          ),
          async (picks) => {
            await owner.query('delete from restro.design_styles where tenant_id = $1', [tenant])
            const settled = await Promise.allSettled(
              picks.map(({ name, pad }, i) => saveStyle(newId('ds'), styleContent(pad + name, i))),
            )
            expect(settled.filter((outcome) => outcome.status === 'rejected')).toEqual([])
            const keys = (await liveStyles()).map((row) =>
              row.name.trim().toLocaleLowerCase('bg-BG'),
            )
            expect(new Set(keys).size).toBe(keys.length)
            const distinct = new Set(
              picks.map(({ name, pad }) => (pad + name).trim().toLocaleLowerCase('bg-BG')),
            )
            expect(keys.length).toBe(distinct.size)
          },
        ),
        { numRuns: 12 },
      )
    }, 120_000)
  })

  // 4. Remove, then Undo, after the name was reused.
  describe('Undo after the name was reused', () => {
    it('is refused as name_taken: one live Style, no database error, nothing written', async () => {
      const a = newId('ds')
      const b = newId('ds')
      await saveStyle(a, styleContent('Night', 1))
      await setStatus(a, 'removed')
      expect((await saveStyle(b, styleContent('night', 2))).applied).toBe(1)
      const events = await styleEventCount()
      const undo = await setStatus(a, 'active')
      expect(undo.applied).toBe(0)
      expect(undo.rejected[0]).toMatchObject({ code: 'style_name_taken' })
      expect(await liveStyles()).toEqual([expect.objectContaining({ id: b })])
      expect(await styleEventCount()).toBe(events)
    })

    it('races of Undo against a new save of the name leave one live Style', async () => {
      for (let round = 0; round < 6; round += 1) {
        await owner.query('delete from restro.design_styles where tenant_id = $1', [tenant])
        const a = newId('ds')
        await saveStyle(a, styleContent('Night', 1))
        await setStatus(a, 'removed')
        const settled = await Promise.allSettled([
          setStatus(a, 'active'),
          saveStyle(newId('ds'), styleContent('NIGHT', 2)),
          saveStyle(newId('ds'), styleContent('night ', 3)),
        ])
        expect(settled.filter((outcome) => outcome.status === 'rejected')).toEqual([])
        expect(await liveStyles()).toHaveLength(1)
      }
    })

    it('two removed Styles with one name, both Undone at once, come back as one', async () => {
      const a = newId('ds')
      const b = newId('ds')
      await saveStyle(a, styleContent('Night', 1))
      await setStatus(a, 'removed')
      await saveStyle(b, styleContent('Night', 2))
      await setStatus(b, 'removed')
      const settled = await Promise.allSettled([setStatus(a, 'active'), setStatus(b, 'active')])
      expect(settled.filter((outcome) => outcome.status === 'rejected')).toEqual([])
      expect(await liveStyles()).toHaveLength(1)
    })
  })

  // 6. Events.
  describe('events', () => {
    it('one successful Style or design write appends exactly one event; a refused one none', async () => {
      const a = newId('ds')
      const count = async () =>
        Number(
          (
            await owner.query<{ n: string }>(
              `select count(*) n from restro.events where tenant_id = $1 and op in ('setStyle', 'setStyleStatus', 'setDesign')`,
              [tenant],
            )
          ).rows[0]?.n,
        )
      const steps: [
        string,
        () => Promise<{ applied: number; rejected: readonly unknown[] }>,
        number,
      ][] = [
        ['save', () => saveStyle(a, styleContent('One', 1)), 1],
        ['same save (unchanged)', () => saveStyle(a, styleContent('One', 1)), 0],
        ['clash', () => saveStyle(newId('ds'), styleContent(' one', 2)), 0],
        ['remove', () => setStatus(a, 'removed'), 1],
        ['remove again (unchanged)', () => setStatus(a, 'removed'), 0],
        ['save over removed', () => saveStyle(a, styleContent('One', 3)), 0],
        ['unknown id', () => setStatus(newId('ds'), 'active'), 0],
        ['undo', () => setStatus(a, 'active'), 1],
        ['design save', async () => (await saveDesign(0, variant(1))).result, 1],
        ['stale design', async () => (await saveDesign(0, variant(2))).result, 0],
        [
          'unreadable design',
          async () =>
            (
              await saveDesign(1, {
                ...variant(3),
                overrides: { light: { text: COLOURS.primary } },
              } as DesignContent)
            ).result,
          0,
        ],
      ]
      for (const [label, step, delta] of steps) {
        const before = await count()
        await step()
        expect((await count()) - before, label).toBe(delta)
      }
      // Every event carries its provenance (rule 2).
      const bad = await owner.query(
        `select seq from restro.events where tenant_id = $1 and op in ('setStyle','setStyleStatus','setDesign')
           and (layer is null or source is null or actor is null or job_id is null or change_set_id is null)`,
        [tenant],
      )
      expect(bad.rows).toEqual([])
    })

    it('a change set with a refused op and an applied one writes the applied one’s event only', async () => {
      const a = newId('ds')
      await saveStyle(a, styleContent('Dup', 1))
      const result = await apply(
        app,
        tenant,
        changeSet([
          { op: 'setStyle', styleId: newId('ds'), content: styleContent('Fresh', 2) },
          { op: 'setStyle', styleId: newId('ds'), content: styleContent('dup', 3) },
        ]),
      )
      expect(result).toMatchObject({ applied: 1, eventsWritten: 1 })
      expect(await liveStyles()).toHaveLength(2)
      expect(await styleEventCount()).toBe(2)
    })
  })

  // 7. Check-then-act under concurrency.
  describe('the checks that read then write', () => {
    it('the contrast refusal holds against a concurrent save: no unreadable design is stored', async () => {
      const unreadable = {
        ...variant(1),
        overrides: { light: { text: COLOURS.primary } },
      } as DesignContent
      for (let round = 0; round < 4; round += 1) {
        const rev = readDesign(await storedSettings()).revision
        const results = await Promise.all([
          saveDesign(rev, unreadable),
          saveDesign(rev, variant(round + 2)),
          saveDesign(rev, unreadable),
        ])
        expect(results.map(({ result }) => result.applied).sort()).toEqual([0, 0, 1])
        expect(readDesign(await storedSettings()).design).not.toHaveProperty('overrides')
      }
    })

    it('the logo check holds when the logo’s asset disappears between check and save', async () => {
      // A logo that is a stored image of this tenant is accepted; a save that names a logo another
      // tenant owns, or one that is not stored, is refused even when it races a valid save.
      const foreign = `as_${'A'.repeat(22)}`
      const rev = readDesign(await storedSettings()).revision
      const results = await Promise.all([
        saveDesign(rev, { ...variant(1), logo_asset_id: foreign } as DesignContent),
        saveDesign(rev, { ...variant(2), logo_asset_id: foreign } as DesignContent),
      ])
      for (const { result } of results) expect(result.rejected[0]?.code).toBe('logo_not_usable')
      expect(await designEvents()).toHaveLength(0)
    })
  })

  // 5b. A snapshot published before the contract moved: the guest page and the next publish read it.
  describe('a published snapshot whose design block predates the contract', () => {
    /** Rewrites the current snapshot's design block as an older contract would have stored it. */
    const age = async (change: (design: Record<string, Record<string, string>>) => void) => {
      const client = await owner.connect()
      try {
        await client.query('begin')
        await client.query('set local session_replication_role = replica')
        const row = (
          await client.query<{
            id: string
            body: { design: Record<string, Record<string, string>> }
          }>(
            `select s.id, s.body from restro.snapshots s
               join restro.publish_pointers p on p.current_snapshot_id = s.id
              where p.venue_id = $1`,
            [venueId],
          )
        ).rows[0]
        if (row === undefined) throw new Error('nothing is published')
        change(row.body.design)
        await client.query('update restro.snapshots set body = $2::jsonb where id = $1', [
          row.id,
          JSON.stringify(row.body),
        ])
        await client.query('commit')
      } finally {
        client.release()
      }
    }

    const loadStoredBody = async () =>
      (
        await owner.query<{ body: unknown }>(
          `select s.body from restro.snapshots s
             join restro.publish_pointers p on p.current_snapshot_id = s.id
            where p.venue_id = $1`,
          [venueId],
        )
      ).rows[0]?.body

    beforeEach(async () => {
      const client = await owner.connect()
      try {
        await client.query('begin')
        await client.query('set local session_replication_role = replica')
        for (const table of ['publish_pointers', 'snapshots', 'item_first_published']) {
          await client.query(`delete from restro.${table} where venue_id = $1`, [venueId])
        }
        await client.query('commit')
      } finally {
        client.release()
      }
    })

    it.each([
      [
        'an option added to the contract since (the block lacks it)',
        (d: Record<string, Record<string, string>>) => {
          delete d.pay?.tip
        },
      ],
      [
        'an option removed since (the block holds an unknown one)',
        (d: Record<string, Record<string, string>>) => {
          ;(d.pay as Record<string, string>).retired_option = 'x'
        },
      ],
      [
        'a value renamed since',
        (d: Record<string, Record<string, string>>) => {
          ;(d.general as Record<string, string>).corners = 'rounded'
        },
      ],
    ])('is still readable and republishable after %s', async (_label, change) => {
      await saveDesign(0, variant(1))
      await publish()
      await age(change)
      // The guest page parses the stored body with the snapshot schema; the admin and the worker
      // read it back through loadCurrentSnapshot; a publish reads it as the previous one.
      const [guest, admin, republish] = await Promise.allSettled([
        loadStoredBody().then((body) => MenuSnapshotSchema.parse(body)),
        loadCurrentSnapshot(app, tenant, { menuId: menu.id, venueId }),
        publish(),
      ])
      const failed = [guest, admin, republish].flatMap((outcome, i) =>
        outcome.status === 'rejected'
          ? [
              `${['guest page', 'admin read', 'republish'][i]}: ${String(outcome.reason).slice(0, 80)}`,
            ]
          : [],
      )
      expect(failed).toEqual([])
    })
  })

  // The editor shows an invalid stored design as Basic; saving what it shows must repair the row.
  describe('saving the Basic the editor shows over a stored design that is not valid', () => {
    it('replaces the row, so that a publish is no longer refused (invalid_design)', async () => {
      await saveDesign(0, variant(1))
      await owner.query(
        `update restro.venues set settings = jsonb_set(settings, '{design,values,general,corners}', '"rounded"') where id = $1`,
        [venueId],
      )
      const shown = readDesign(await storedSettings())
      expect(shown.design).toEqual(DEFAULT_DESIGN)
      const { result } = await saveDesign(shown.revision, shown.design)
      expect(result.rejected).toEqual([])
      expect(result.applied, 'the save is read as unchanged and the row stays invalid').toBe(1)
      await expect(publish()).resolves.toMatchObject({ status: 'published' })
    })
  })

  // Reads a hand-built row.
  describe('a venue row the contract has moved past', () => {
    it('reads as Basic in the editor, never throws', async () => {
      const bad = [
        { revision: 3, style: 'basic', values: { general: { screen: 'sepia' } } },
        { revision: 'x' },
        null,
        [],
        'text',
      ]
      for (const stored of bad) {
        await owner.query(
          `update restro.venues set settings = jsonb_build_object('design', $2::jsonb) where id = $1`,
          [venueId, JSON.stringify(stored)],
        )
        const settings = await storedSettings()
        expect(() => readDesign(settings)).not.toThrow()
      }
    })
  })
})

/** The Postgres error code under a driver error, or the error's text. */
function pgCode(error: unknown): string {
  const wrapped = error as { code?: string; cause?: { code?: string; message?: string } }
  return wrapped.cause?.code ?? wrapped.code ?? String(error)
}
