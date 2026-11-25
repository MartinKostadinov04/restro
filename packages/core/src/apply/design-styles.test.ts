// The organisation's saved Styles through the one write path (D129 My styles, rules 1 and 2):
// `setStyle` and `setStyleStatus` against a real Postgres as restro_app. One event with provenance
// per write, a name no second live Style may hold, a delete that is a soft removal the toast's Undo
// puts back, a venue's design left alone by all of it, and the row-level security that keeps a
// Style to its organisation for reading and for writing alike.
import { createPool, type DbPool, designStyles, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import type { DesignValues } from '../design/contract'
import { DEFAULT_DESIGN, readDesign } from '../design/record'
import { type SavedStyleContent, styleValuesOf } from '../design/saved-style'
import { newId } from '../ids'
import { ApplyError, apply } from './apply'
import { provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

const CLUB: SavedStyleContent = {
  name: 'Club night',
  style: 'club',
  values: styleValuesOf(DEFAULT_DESIGN.values),
}

describe.skipIf(!hasDatabase)('the organisation’s saved Styles (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string

  const change = (
    ops: unknown[],
    fields: { tenantId?: string; source?: string; actor?: string },
  ) => {
    const set = {
      id: newId('cs'),
      source: fields.source ?? 'manual',
      jobId: newId('jb'),
      actor: fields.actor ?? 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    }
    return apply(app, fields.tenantId ?? tenant, set as ChangeSet).then((result) => ({
      set,
      result,
    }))
  }

  const save = (
    styleId: string,
    content: SavedStyleContent,
    fields: { tenantId?: string; source?: string; actor?: string } = {},
  ) => change([{ op: 'setStyle', styleId, content }], fields)

  const setStatus = (
    styleId: string,
    status: 'active' | 'removed',
    fields: { tenantId?: string } = {},
  ) => change([{ op: 'setStyleStatus', styleId, status }], fields)

  /** Every style row of a tenant, read past row-level security. */
  const storedStyles = async (tenantId: string) =>
    (
      await owner.query<Record<string, unknown>>(
        `select id, name, style, style_values, removed_at, layer, source, actor, job_id,
                change_set_id
         from restro.design_styles where tenant_id = $1 order by id`,
        [tenantId],
      )
    ).rows

  const styleEvents = async () =>
    (
      await owner.query<Record<string, unknown>>(
        `select op, node_id, field_key, layer, scope, old_value, new_value, actor, job_id,
                change_set_id
         from restro.events where op in ('setStyle', 'setStyleStatus') order by seq`,
      )
    ).rows

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-design-styles-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Styles club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('styles') })).id
  }, 60_000)

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  beforeEach(async () => {
    await owner.query(`delete from restro.events where op in ('setStyle', 'setStyleStatus')`)
    await owner.query('delete from restro.design_styles where tenant_id = any($1)', [
      [tenant, otherTenant],
    ])
    await owner.query(`update restro.venues set settings = '{}'::jsonb where id = $1`, [venueId])
  })

  it('stores the Style with its provenance and appends one event', async () => {
    const id = newId('ds')
    const { set, result } = await save(id, CLUB)
    expect(result).toMatchObject({ applied: 1, eventsWritten: 1, rejected: [] })

    expect(await storedStyles(tenant)).toEqual([
      {
        id,
        name: 'Club night',
        style: 'club',
        style_values: CLUB.values,
        removed_at: null,
        layer: 'manual',
        source: 'manual',
        actor: 'user:us_test',
        job_id: set.jobId,
        change_set_id: set.id,
      },
    ])
    expect(await styleEvents()).toEqual([
      {
        op: 'setStyle',
        node_id: null,
        field_key: 'style',
        layer: 'manual',
        scope: 'master',
        old_value: null,
        new_value: { id, name: 'Club night', style: 'club', values: CLUB.values },
        actor: 'user:us_test',
        job_id: set.jobId,
        change_set_id: set.id,
      },
    ])
  })

  it('updates a Style’s values, with the event holding both, and changes no venue’s design', async () => {
    const id = newId('ds')
    await save(id, CLUB)
    const before = readDesign(
      (
        await withTenant(app, tenant, (tx) =>
          tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
        )
      )[0]?.settings,
    )
    const dark = {
      ...CLUB,
      values: styleValuesOf({
        ...DEFAULT_DESIGN.values,
        general: { ...DEFAULT_DESIGN.values.general, screen: 'dark' },
      } as DesignValues),
    }
    const { result } = await save(id, dark)
    expect(result).toMatchObject({ applied: 1, rejected: [] })
    const rows = await storedStyles(tenant)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id, name: 'Club night', style_values: dark.values })

    const events = await styleEvents()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      op: 'setStyle',
      old_value: { name: 'Club night', values: CLUB.values },
      new_value: { id, values: dark.values },
    })

    const after = readDesign(
      (
        await withTenant(app, tenant, (tx) =>
          tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
        )
      )[0]?.settings,
    )
    expect(after).toEqual(before)
  })

  it('writes nothing when a save changes nothing', async () => {
    const id = newId('ds')
    await save(id, CLUB)
    const { result } = await save(id, CLUB)
    expect(result).toMatchObject({ applied: 0, unchanged: 1, eventsWritten: 0, rejected: [] })
    expect(await styleEvents()).toHaveLength(1)
  })

  it('refuses a name another live Style of the organisation holds, whatever the case', async () => {
    await save(newId('ds'), CLUB)
    for (const name of ['Club night', 'club NIGHT', '  Club night  ']) {
      const { result } = await save(newId('ds'), { ...CLUB, name })
      expect(result.applied).toBe(0)
      expect(result.rejected[0]).toMatchObject({ code: 'style_name_taken' })
    }
    expect(await storedStyles(tenant)).toHaveLength(1)
  })

  it('lets another organisation use the same name', async () => {
    await save(newId('ds'), CLUB)
    const { result } = await save(newId('ds'), CLUB, { tenantId: otherTenant })
    expect(result).toMatchObject({ applied: 1, rejected: [] })
    expect(await storedStyles(otherTenant)).toHaveLength(1)
  })

  it('removes a Style softly and puts it back, each with an event', async () => {
    const id = newId('ds')
    await save(id, CLUB)
    expect((await setStatus(id, 'removed')).result).toMatchObject({ applied: 1, rejected: [] })
    expect((await storedStyles(tenant))[0]?.removed_at).not.toBeNull()
    // The row is still there: only the purge deletes rows (D83).
    expect(await storedStyles(tenant)).toHaveLength(1)

    // Removing it again is a no-op, and the name is free while it is removed.
    expect((await setStatus(id, 'removed')).result).toMatchObject({ applied: 0, unchanged: 1 })
    const other = newId('ds')
    expect((await save(other, CLUB)).result).toMatchObject({ applied: 1, rejected: [] })

    // Undo: the name is taken now, so the restore is refused and nothing moves.
    const refused = await setStatus(id, 'active')
    expect(refused.result.rejected[0]).toMatchObject({ code: 'style_name_taken' })
    expect((await storedStyles(tenant)).find((row) => row.id === id)?.removed_at).not.toBeNull()

    // With the name free again, Undo brings it back.
    await setStatus(other, 'removed')
    expect((await setStatus(id, 'active')).result).toMatchObject({ applied: 1, rejected: [] })
    expect((await storedStyles(tenant)).find((row) => row.id === id)?.removed_at).toBeNull()

    // Three status changes wrote a row: the first removal, the other Style's, and the restore. The
    // second removal was a no-op and the refused restore wrote nothing.
    const events = await styleEvents()
    expect(events.filter((row) => row.op === 'setStyleStatus')).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({
      op: 'setStyleStatus',
      node_id: null,
      field_key: 'style_status',
      layer: 'manual',
      scope: 'master',
      old_value: { id, status: 'removed' },
      new_value: { id, status: 'active' },
    })
  })

  it('refuses a save over a removed Style, and a status for one it does not have', async () => {
    const id = newId('ds')
    await save(id, CLUB)
    await setStatus(id, 'removed')
    expect((await save(id, CLUB)).result.rejected[0]).toMatchObject({ code: 'unknown_style' })
    expect((await setStatus(newId('ds'), 'removed')).result.rejected[0]).toMatchObject({
      code: 'unknown_style',
    })
  })

  describe('row-level security', () => {
    it('hides another organisation’s Styles from a read', async () => {
      const id = newId('ds')
      await save(id, CLUB)
      const mine = await withTenant(app, tenant, (tx) => tx.select().from(designStyles))
      expect(mine.map((row) => row.id)).toEqual([id])
      // The same query in the other organisation's scope sees nothing, `where` or no `where`.
      const theirs = await withTenant(app, otherTenant, (tx) => tx.select().from(designStyles))
      expect(theirs).toEqual([])
      const byId = await withTenant(app, otherTenant, (tx) =>
        tx.select().from(designStyles).where(eq(designStyles.id, id)),
      )
      expect(byId).toEqual([])
    })

    it('hides them from another organisation’s write, which then creates its own row', async () => {
      const id = newId('ds')
      await save(id, CLUB)
      // The other organisation cannot see the row, so the same id is a new Style for it — and the
      // global primary key refuses it. Nothing of this organisation's moves either way.
      await expect(
        save(id, { ...CLUB, name: 'Theirs' }, { tenantId: otherTenant }),
      ).rejects.toThrow()
      expect(await storedStyles(tenant)).toMatchObject([{ id, name: 'Club night' }])
      expect(await storedStyles(otherTenant)).toEqual([])
    })

    it('refuses a status change from another organisation: it has no such Style', async () => {
      const id = newId('ds')
      await save(id, CLUB)
      const { result } = await setStatus(id, 'removed', { tenantId: otherTenant })
      expect(result.rejected[0]).toMatchObject({ code: 'unknown_style' })
      expect((await storedStyles(tenant))[0]?.removed_at).toBeNull()
    })
  })

  it('is manual only: a till change set cannot save a Style', async () => {
    await expect(
      save(newId('ds'), CLUB, { source: 'till:in_0123456789ABCDEFGHIJKL' }),
    ).rejects.toBeInstanceOf(ApplyError)
    await expect(save(newId('ds'), CLUB, { actor: 'integration:in_1' })).rejects.toBeInstanceOf(
      ApplyError,
    )
    expect(await storedStyles(tenant)).toEqual([])
  })
})
