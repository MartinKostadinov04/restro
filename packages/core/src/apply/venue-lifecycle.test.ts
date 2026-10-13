// Renaming, deleting (archiving) and restoring a venue, and the shared check every other writer of
// a venue makes (brief CF-18, D76), as the restro_app role on a real Postgres: rename rules, the
// delete that releases the till link in the same transaction (and rolls both back together), the
// idempotence of archive and restore, tenant isolation, one table over every guarded writer, the
// guard inside apply(), and that a save and a delete never interleave (the row lock).
import { barsyVenues, createPool, type DbPool, venues, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ChangeSet, tillSource } from '../change-set'
import { newId } from '../ids'
import { apply } from './apply'
import { mapBarsyVenue, type PlaceInput, upsertBarsyVenues, upsertPlaces } from './barsy-venues'
import * as applyEntry from './index'
import { ProvisionError, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { createIntegration } from './sources'
import { issueTableToken, listVenueTables, loadTokenFiles } from './tables'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import {
  archiveVenue,
  MAX_VENUE_NAME_LENGTH,
  renameVenue,
  restoreVenue,
  unpublishVenue,
} from './venue-lifecycle'
import { lockLiveVenue } from './venue-lock'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

describe('module boundary', () => {
  it('exports the venue lifecycle and the shared lock from @restro/core/apply', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining(['renameVenue', 'archiveVenue', 'restoreVenue', 'lockLiveVenue']),
    )
  })
})

describe('input checks (no database needed)', () => {
  it.each([
    ['an empty name', ' '],
    ['a name of only spaces', '   \t '],
    ['a name over 120 characters', 'x'.repeat(MAX_VENUE_NAME_LENGTH + 1)],
  ])('renameVenue refuses %s before touching the database', async (_label, name) => {
    await expect(renameVenue(unusedPool, newId('tn'), newId('vn'), name)).rejects.toMatchObject({
      name: 'ProvisionError',
      code: 'invalid_input',
    })
  })

  it.each([
    ['archiveVenue', archiveVenue],
    ['restoreVenue', restoreVenue],
  ])('%s refuses a malformed id', async (_label, run) => {
    await expect(run(unusedPool, 'tn_short', newId('vn'))).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(run(unusedPool, newId('tn'), 'nd_not_a_venue')).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

const changeSet = (ops: unknown[]): ChangeSet =>
  ({
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:us_test',
    observedAt: new Date().toISOString(),
    ops,
  }) as ChangeSet

const manual = (node: string, fieldKey: string, value: unknown, scope = 'master') => ({
  op: 'setField',
  node: { id: node },
  fieldKey,
  layer: 'manual',
  scope,
  value,
})

describe.skipIf(!hasDatabase)('the life of a venue (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let integrationId: string
  let bid = 700
  let otherTenantVenue: string

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-cf18-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'CF-18 club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'cf18.test' })).id
    otherTenantVenue = (
      await provisionVenue(app, otherTenant, { name: 'Other venue', slug: testSlug('other') })
    ).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  /** A live venue with its menu. */
  async function liveVenue(name = 'Club') {
    const venue = await provisionVenue(app, tenant, { name, slug: testSlug('cf18') })
    const menu = await provisionMenu(app, tenant, venue.id)
    return { venueId: venue.id, menuId: menu.id, publicId: venue.publicId, slug: venue.slug }
  }

  /** A till venue of its own, linked to `venueId`. */
  async function linkTill(venueId: string) {
    bid += 1
    await upsertBarsyVenues(app, tenant, integrationId, [{ bid, name: `Till ${bid}` }])
    expect(await mapBarsyVenue(app, tenant, integrationId, bid, venueId)).toMatchObject({
      ok: true,
    })
    return bid
  }

  const place = (id: string, num: string): PlaceInput => ({
    placeId: id,
    placeNum: num,
    salonName: 'Hall',
    isPublic: true,
  })

  const rowOf = async (venueId: string) => {
    const result = await owner.query<{
      name: string
      archived_at: Date | null
      updated_at: Date
      public_id: string
      slug: string
    }>('select name, archived_at, updated_at, public_id, slug from restro.venues where id = $1', [
      venueId,
    ])
    return result.rows[0]
  }
  const linkOf = async (tillBid: number) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(barsyVenues).where(eq(barsyVenues.bid, tillBid)),
      )
    )[0]
  /** Archives a venue directly, leaving its till link as it is (what a race could leave behind). */
  const archiveDirectly = (venueId: string) =>
    owner.query('update restro.venues set archived_at = now() where id = $1', [venueId])

  describe('renameVenue', () => {
    it('stores the trimmed name, and the same name again writes nothing', async () => {
      const { venueId } = await liveVenue('Before')
      const first = await renameVenue(app, tenant, venueId, '  Neon Cellar  ')
      expect(first).toEqual({ venueId, name: 'Neon Cellar', changed: true })
      const stored = await rowOf(venueId)
      expect(stored?.name).toBe('Neon Cellar')

      const again = await renameVenue(app, tenant, venueId, 'Neon Cellar ')
      expect(again).toEqual({ venueId, name: 'Neon Cellar', changed: false })
      // Nothing was written: the row was not touched (its updated_at trigger did not run).
      expect((await rowOf(venueId))?.updated_at).toEqual(stored?.updated_at)
    })

    it('accepts exactly 120 characters, refuses 121 and an empty name, and keeps the old name', async () => {
      const { venueId } = await liveVenue('Stays')
      const longest = 'n'.repeat(MAX_VENUE_NAME_LENGTH)
      await expect(renameVenue(app, tenant, venueId, longest)).resolves.toMatchObject({
        changed: true,
      })
      await expect(renameVenue(app, tenant, venueId, `${longest}n`)).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(renameVenue(app, tenant, venueId, '  ')).rejects.toMatchObject({
        code: 'invalid_input',
      })
      expect((await rowOf(venueId))?.name).toBe(longest)
    })

    it("changes neither the address nor the code, and not another tenant's venue", async () => {
      const { venueId, publicId, slug } = await liveVenue('Same address')
      await renameVenue(app, tenant, venueId, 'Another name')
      expect(await rowOf(venueId)).toMatchObject({ public_id: publicId, slug })

      await expect(renameVenue(app, tenant, otherTenantVenue, 'Mine now')).rejects.toMatchObject({
        code: 'venue_missing',
      })
      await expect(renameVenue(app, tenant, newId('vn'), 'Nobody')).rejects.toMatchObject({
        code: 'venue_missing',
      })
      expect((await rowOf(otherTenantVenue))?.name).toBe('Other venue')
    })

    it('refuses a deleted venue', async () => {
      const { venueId } = await liveVenue('Gone')
      await archiveVenue(app, tenant, venueId)
      const error = await renameVenue(app, tenant, venueId, 'Still here?').catch((e) => e)
      expect(error).toBeInstanceOf(ProvisionError)
      expect(error.code).toBe('venue_archived')
      expect((await rowOf(venueId))?.name).toBe('Gone')
    })
  })

  describe('archiveVenue', () => {
    it('archives the venue, releases its till link, reports its table codes and erases nothing', async () => {
      const { venueId, menuId, publicId, slug } = await liveVenue('To delete')
      const till = await linkTill(venueId)
      await upsertPlaces(app, tenant, integrationId, till, [place('p1', '1'), place('p2', '2')], {
        pagesOk: [true],
      })
      const tables = await listVenueTables(app, tenant, venueId)
      const codes: string[] = []
      for (const table of tables) {
        const issued = await issueTableToken(app, tenant, table.id)
        if (!issued.ok) throw new Error(issued.reason)
        codes.push(issued.table.token ?? '')
      }
      const before = await rowOf(venueId)
      expect(before?.archived_at).toBeNull()

      const result = await archiveVenue(app, tenant, venueId)
      expect(result.changed).toBe(true)
      expect(result.releasedTill).toBe(true)
      expect(result.tableTokens).toEqual([...codes].sort())

      const after = await rowOf(venueId)
      expect(after?.archived_at).toBeInstanceOf(Date)
      expect(after).toMatchObject({ name: 'To delete', public_id: publicId, slug })
      // The till venue is free again.
      expect((await linkOf(till))?.venueId).toBeNull()
      // Nothing was erased: the menu is still there, and so are the tables and their codes (kept
      // for a restore).
      const menu = await owner.query('select id from restro.menus where id = $1', [menuId])
      expect(menu.rowCount).toBe(1)
      const stored = await owner.query<{ qr_token: string }>(
        'select qr_token from restro.tables where venue_id = $1',
        [venueId],
      )
      expect(stored.rows.map((row) => row.qr_token).sort()).toEqual([...codes].sort())
      expect(await listVenueTables(app, tenant, venueId)).toHaveLength(codes.length)
      // The token job sees a deleted venue.
      await expect(loadTokenFiles(app, tenant, venueId)).resolves.toMatchObject({
        archived: true,
        files: [],
      })
    })

    it('archives a venue without a till link, and reports nothing to release', async () => {
      const { venueId } = await liveVenue('No till')
      const result = await archiveVenue(app, tenant, venueId)
      expect(result).toMatchObject({ changed: true, releasedTill: false, tableTokens: [] })
    })

    it('is idempotent: a second delete changes nothing and keeps the first time', async () => {
      const { venueId } = await liveVenue('Twice')
      const first = await archiveVenue(app, tenant, venueId)
      const stored = await rowOf(venueId)
      const second = await archiveVenue(app, tenant, venueId)
      expect(second).toMatchObject({ changed: false, releasedTill: false, tableTokens: [] })
      expect(second.archivedAt).toEqual(first.archivedAt)
      // The row was not written: updated_at is what the first delete left.
      expect((await rowOf(venueId))?.updated_at).toEqual(stored?.updated_at)
    })

    it('leaves another tenant\'s venue alone ("missing"), and so does a made-up id', async () => {
      await expect(archiveVenue(app, tenant, otherTenantVenue)).rejects.toMatchObject({
        code: 'venue_missing',
      })
      await expect(archiveVenue(app, tenant, newId('vn'))).rejects.toMatchObject({
        code: 'venue_missing',
      })
      expect((await rowOf(otherTenantVenue))?.archived_at).toBeNull()
    })

    it('rolls the archive back when the till link cannot be released (one transaction)', async () => {
      const { venueId } = await liveVenue('Atomic')
      const till = await linkTill(venueId)
      // A trigger that refuses to release this one integration's link, as a failing write would.
      const suffix = integrationId.replace(/\W/g, '').toLowerCase().slice(-12)
      const name = `cf18_block_release_${suffix}_${till}`
      await owner.query(
        `create function restro.${name}() returns trigger language plpgsql as
         $$ begin raise exception 'cf18 test: the link cannot be released'; end $$`,
      )
      await owner.query(
        `create trigger ${name} before update on restro.barsy_venues for each row
         when (old.integration_id = '${integrationId}' and old.bid = ${till}
               and new.venue_id is null and old.venue_id is not null)
         execute function restro.${name}()`,
      )
      try {
        await expect(archiveVenue(app, tenant, venueId)).rejects.toThrow()
        // Neither half happened.
        expect((await rowOf(venueId))?.archived_at).toBeNull()
        expect((await linkOf(till))?.venueId).toBe(venueId)
      } finally {
        await owner.query(`drop trigger ${name} on restro.barsy_venues`)
        await owner.query(`drop function restro.${name}()`)
      }
      // With the obstacle gone the same call works.
      await expect(archiveVenue(app, tenant, venueId)).resolves.toMatchObject({
        changed: true,
        releasedTill: true,
      })
    })

    it('frees the till venue for another venue, which does not touch the deleted one', async () => {
      const first = await liveVenue('First owner')
      const till = await linkTill(first.venueId)
      await archiveVenue(app, tenant, first.venueId)
      const second = await liveVenue('Second owner')
      expect(await mapBarsyVenue(app, tenant, integrationId, till, second.venueId)).toMatchObject({
        ok: true,
      })
      expect((await linkOf(till))?.venueId).toBe(second.venueId)
      // The deleted venue cannot take it back.
      const third = await liveVenue('Third')
      await archiveVenue(app, tenant, third.venueId)
      expect(await mapBarsyVenue(app, tenant, integrationId, till, third.venueId)).toEqual({
        ok: false,
        error: 'venue_archived',
      })
      expect((await linkOf(till))?.venueId).toBe(second.venueId)
    })
  })

  describe('restoreVenue', () => {
    /** The venue's settings as stored. */
    const settingsOf = async (venueId: string) =>
      (
        await owner.query<{ settings: Record<string, unknown> }>(
          'select settings from restro.venues where id = $1',
          [venueId],
        )
      ).rows[0]?.settings

    it('brings the venue back with its till linked again, the same address and table codes', async () => {
      const { venueId, publicId, slug } = await liveVenue('Back again')
      const till = await linkTill(venueId)
      await upsertPlaces(app, tenant, integrationId, till, [place('r1', '1')], { pagesOk: [true] })
      const [table] = await listVenueTables(app, tenant, venueId)
      const issued = await issueTableToken(app, tenant, table?.id ?? '')
      if (!issued.ok) throw new Error(issued.reason)
      await archiveVenue(app, tenant, venueId)
      // The delete released the till venue and remembered it (adjustments V1).
      expect((await linkOf(till))?.venueId).toBeNull()
      expect((await settingsOf(venueId))?.till_before_delete).toEqual({
        integration_id: integrationId,
        bid: till,
      })

      const result = await restoreVenue(app, tenant, venueId)
      expect(result).toEqual({ venueId, changed: true, relinked: true })
      expect(await rowOf(venueId)).toMatchObject({
        archived_at: null,
        public_id: publicId,
        slug,
        name: 'Back again',
      })
      // Linked again, the memory of it gone, and the same table code back; nothing was published.
      expect((await linkOf(till))?.venueId).toBe(venueId)
      expect((await settingsOf(venueId))?.till_before_delete).toBeUndefined()
      const back = await listVenueTables(app, tenant, venueId)
      expect(back.map((row) => row.token)).toEqual([issued.table.token])
      // The venue is live for the writers again.
      await expect(renameVenue(app, tenant, venueId, 'Renamed after')).resolves.toMatchObject({
        changed: true,
      })
    })

    it('is refused, and changes nothing, when another venue serves the till venue now', async () => {
      const { venueId } = await liveVenue('First owner')
      const till = await linkTill(venueId)
      await archiveVenue(app, tenant, venueId)
      const holder = await liveVenue('Holder of the till')
      expect(await mapBarsyVenue(app, tenant, integrationId, till, holder.venueId)).toMatchObject({
        ok: true,
      })

      await expect(restoreVenue(app, tenant, venueId)).rejects.toMatchObject({
        code: 'till_taken',
        details: { holder: 'Holder of the till' },
      })
      expect((await rowOf(venueId))?.archived_at).toBeInstanceOf(Date)
      expect((await linkOf(till))?.venueId).toBe(holder.venueId)
      expect((await settingsOf(venueId))?.till_before_delete).toEqual({
        integration_id: integrationId,
        bid: till,
      })
    })

    it('comes back without a link when the till venue it served is not listed any more', async () => {
      const { venueId } = await liveVenue('Till gone')
      const till = await linkTill(venueId)
      await archiveVenue(app, tenant, venueId)
      await owner.query('delete from restro.barsy_venues where integration_id = $1 and bid = $2', [
        integrationId,
        till,
      ])
      expect(await restoreVenue(app, tenant, venueId)).toEqual({
        venueId,
        changed: true,
        relinked: false,
      })
      expect((await rowOf(venueId))?.archived_at).toBeNull()
      expect((await settingsOf(venueId))?.till_before_delete).toBeUndefined()
    })

    it('is idempotent, and refuses what the tenant does not have', async () => {
      const { venueId } = await liveVenue('Live already')
      expect(await restoreVenue(app, tenant, venueId)).toEqual({
        venueId,
        changed: false,
        relinked: false,
      })
      await expect(restoreVenue(app, tenant, otherTenantVenue)).rejects.toMatchObject({
        code: 'venue_missing',
      })
      await expect(restoreVenue(app, tenant, newId('vn'))).rejects.toMatchObject({
        code: 'venue_missing',
      })
    })
  })

  /** What a writer answered: the `code` of the error it threw, or the `error` of its refusal. */
  async function answer(work: Promise<unknown>): Promise<string | null> {
    try {
      const result = await work
      if (typeof result === 'object' && result !== null && 'error' in result) {
        return String((result as { error: unknown }).error)
      }
      return null
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return typeof code === 'string' ? code : `threw ${String(error)}`
    }
  }

  describe('unpublishVenue', () => {
    it('marks the venue unpublished, reports its table codes, and is idempotent', async () => {
      const { venueId } = await liveVenue('Off the phones')
      const till = await linkTill(venueId)
      await upsertPlaces(app, tenant, integrationId, till, [place('u1', '1'), place('u2', '2')], {
        pagesOk: [true],
      })
      const tokens: string[] = []
      for (const table of await listVenueTables(app, tenant, venueId)) {
        const issued = await issueTableToken(app, tenant, table.id)
        if (!issued.ok) throw new Error(issued.reason)
        tokens.push(issued.table.token ?? '')
      }

      const first = await unpublishVenue(app, tenant, venueId)
      expect(first).toMatchObject({ venueId, changed: true })
      expect(first.unpublishedAt).toBeInstanceOf(Date)
      // Both sides sorted here (the database's order by collates differently in CI).
      expect([...first.tableTokens].sort()).toEqual([...tokens].sort())
      // The tokens stay on the tables: the next publish brings the files back.
      expect((await listVenueTables(app, tenant, venueId)).map((row) => row.token).sort()).toEqual(
        [...tokens].sort(),
      )

      const again = await unpublishVenue(app, tenant, venueId)
      expect(again).toEqual({
        venueId,
        changed: false,
        unpublishedAt: first.unpublishedAt,
        tableTokens: [],
      })
    })

    it('refuses a deleted venue, and what the tenant does not have', async () => {
      const { venueId } = await liveVenue('Deleted first')
      await archiveVenue(app, tenant, venueId)
      await expect(unpublishVenue(app, tenant, venueId)).rejects.toMatchObject({
        code: 'venue_archived',
      })
      await expect(unpublishVenue(app, tenant, otherTenantVenue)).rejects.toMatchObject({
        code: 'venue_missing',
      })
    })
  })

  describe('every writer of one venue refuses a deleted venue', () => {
    // One row per writer: how to call it for a venue id, the code it gives a deleted venue, and
    // the code it keeps for a venue the tenant does not have.
    type Call = (venueId: string, menuId: string) => Promise<unknown>
    const goneId = newId('vn')
    const snapshotId = newId('sn')
    const writers: readonly (readonly [string, Call, string, string])[] = [
      [
        'renameVenueSlug',
        (venueId) => applyEntry.renameVenueSlug(app, tenant, venueId, 'new-slug'),
        'venue_archived',
        'venue_missing',
      ],
      [
        'renameVenue',
        (venueId) => applyEntry.renameVenue(app, tenant, venueId, 'New name'),
        'venue_archived',
        'venue_missing',
      ],
      [
        'provisionMenu',
        (venueId) => applyEntry.provisionMenu(app, tenant, venueId),
        'venue_archived',
        'venue_missing',
      ],
      [
        'setVenueTheme',
        (venueId) => applyEntry.setVenueTheme(app, tenant, { venueId, theme: null }),
        'venue_archived',
        'venue_not_found',
      ],
      [
        'setVenuePresentation',
        (venueId) => applyEntry.setVenuePresentation(app, tenant, { venueId, presentation: null }),
        'venue_archived',
        'venue_not_found',
      ],
      [
        'setGuestFeatures',
        (venueId) => applyEntry.setGuestFeatures(app, tenant, { venueId, features: null }),
        'venue_archived',
        'venue_not_found',
      ],
      [
        'setVenuePublishRules',
        (venueId) =>
          applyEntry.setVenuePublishRules(app, tenant, {
            venueId,
            rules: { after_sync: 'manual', new_items: 'hold' },
          }),
        'venue_archived',
        'venue_missing',
      ],
      [
        'setVenueQrSettings',
        (venueId) =>
          applyEntry.setVenueQrSettings(app, tenant, {
            venueId,
            mode: 'ours',
            baseUrl: null,
            ownPattern: null,
          }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'issueAllTableTokens',
        (venueId) => applyEntry.issueAllTableTokens(app, tenant, venueId),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'setSoldOutTonight',
        (venueId) =>
          applyEntry.setSoldOutTonight(app, tenant, {
            venueId,
            itemIds: [newId('nd')],
            soldOut: true,
            actor: 'system',
          }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'createTag',
        (venueId) => applyEntry.createTag(app, tenant, { venueId, label: { bg_BG: 'Таг' } }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'updateTag',
        (venueId) =>
          applyEntry.updateTag(app, tenant, { venueId, id: newId('tg'), color: 'accent' }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'moveTag',
        (venueId) => applyEntry.moveTag(app, tenant, { venueId, id: newId('tg'), position: 'end' }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'archiveTag',
        (venueId) => applyEntry.archiveTag(app, tenant, { venueId, id: newId('tg') }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'restoreTag',
        (venueId) => applyEntry.restoreTag(app, tenant, { venueId, id: newId('tg') }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'setItemTags',
        (venueId) =>
          applyEntry.setItemTags(app, tenant, {
            venueId,
            itemIds: [newId('nd')],
            add: [newId('tg')],
            remove: [],
            actor: 'system',
          }),
        'venue_archived',
        'unknown_venue',
      ],
      [
        'publishMenu',
        (venueId, menuId) =>
          applyEntry.publishMenu(app, tenant, {
            menuId: menuId as never,
            venueId: venueId as never,
            reason: 'manual',
            actor: 'system',
          }),
        'venue_archived',
        'menu_not_found',
      ],
      [
        'rollbackTo',
        (venueId, menuId) =>
          applyEntry.rollbackTo(app, tenant, {
            menuId: menuId as never,
            venueId: venueId as never,
            snapshotId,
            actor: 'system',
          }),
        'venue_archived',
        'nothing_published',
      ],
      [
        'rejectHeld',
        (venueId, menuId) =>
          applyEntry.rejectHeld(app, tenant, {
            menuId: menuId as never,
            venueId: venueId as never,
            snapshotId,
            actor: 'system',
          }),
        'venue_archived',
        'held_not_found',
      ],
      [
        'loadDraft',
        (venueId, menuId) => applyEntry.loadDraft(app, tenant, { menuId, venueId }),
        'venue_archived',
        'menu_not_found',
      ],
      [
        'mapBarsyVenue',
        async (venueId) => {
          bid += 1
          await upsertBarsyVenues(app, tenant, integrationId, [{ bid, name: `Free ${bid}` }])
          return applyEntry.mapBarsyVenue(app, tenant, integrationId, bid, venueId)
        },
        'venue_archived',
        'venue_missing',
      ],
    ]

    it.each(writers)('%s', async (_name, call, archivedCode, missingCode) => {
      const { venueId, menuId } = await liveVenue('Guarded')
      await archiveDirectly(venueId)
      expect(await answer(call(venueId, menuId))).toBe(archivedCode)
      // A venue the tenant does not have keeps the code it always had. (The made-up venue has
      // no menu either, so a publisher's own "no such menu" is what it says.)
      expect(await answer(call(goneId, newId('nd')))).toBe(missingCode)
      // Another tenant's venue looks the same as a missing one.
      expect(await answer(call(otherTenantVenue, newId('nd')))).toBe(missingCode)
    })

    it('refuses the edits of a table whose venue was deleted while its link was still there', async () => {
      const { venueId } = await liveVenue('Tables guarded')
      const till = await linkTill(venueId)
      await upsertPlaces(app, tenant, integrationId, till, [place('g1', '1')], { pagesOk: [true] })
      const [table] = await listVenueTables(app, tenant, venueId)
      const tableId = table?.id ?? ''
      const issued = await issueTableToken(app, tenant, tableId)
      if (!issued.ok) throw new Error(issued.reason)
      await archiveDirectly(venueId)
      const refused = { ok: false, error: 'venue_archived' }
      await expect(issueTableToken(app, tenant, tableId)).resolves.toMatchObject(refused)
      await expect(applyEntry.retireTableToken(app, tenant, tableId)).resolves.toMatchObject(
        refused,
      )
      await expect(applyEntry.setTableName(app, tenant, tableId, 'Booth')).resolves.toMatchObject(
        refused,
      )
      // The code is untouched.
      const stored = await owner.query<{ qr_token: string }>(
        'select qr_token from restro.tables where id = $1',
        [tableId],
      )
      expect(stored.rows[0]?.qr_token).toBe(issued.table.token)
    })

    it("does not take a venue's lock away from the reader of its published scopes", async () => {
      const { venueId } = await liveVenue('Scopes')
      await archiveVenue(app, tenant, venueId)
      const scopes = await applyEntry.listPublishedScopes(app, tenant)
      expect(scopes.map((scope) => scope.venueId)).not.toContain(venueId)
    })
  })

  describe('apply() and a deleted venue', () => {
    it('refuses writes into the menu and into the venue scope, and still takes master values of items', async () => {
      const { venueId, menuId } = await liveVenue('Apply guard')
      const section = newId('nd')
      const item = newId('nd')
      const setup = await apply(
        app,
        tenant,
        changeSet([
          {
            op: 'createNode',
            id: section,
            nodeType: 'section',
            parent: { id: menuId },
            status: 'active',
            sortKey: 'end',
          },
          manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
          { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
          manual(item, 'name', { bg_BG: 'Негрони', en_US: 'Negroni' }),
        ]),
      )
      expect(setup.rejected).toEqual([])

      await archiveVenue(app, tenant, venueId)

      const section2 = newId('nd')
      const result = await apply(
        app,
        tenant,
        changeSet([
          // 0: a new section in the deleted venue's menu
          {
            op: 'createNode',
            id: section2,
            nodeType: 'section',
            parent: { id: menuId },
            status: 'active',
            sortKey: 'end',
          },
          // 1: a value of an existing section
          manual(section, 'title', { bg_BG: 'Нова', en_US: 'New' }),
          // 2: a placement into one of its sections
          { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
          // 3: a master value of the item, which is no part of any menu
          manual(item, 'name', { bg_BG: 'Негрони 2', en_US: 'Negroni 2' }),
        ]),
      )
      expect(result.rejected.map((r) => [r.opIndex, r.code])).toEqual([
        [0, 'venue_archived'],
        [1, 'venue_archived'],
        [2, 'venue_archived'],
      ])
      expect(result.applied).toBe(1)

      // A till change set (the only kind with a venue scope) refuses the deleted venue's scope
      // before it asks anything else about the write, and takes the live venue's.
      const live = await liveVenue('Apply guard, live')
      const tillSet = {
        ...changeSet([
          {
            op: 'setField',
            node: { id: item },
            fieldKey: 'visible',
            layer: 'till',
            scope: `venue:${venueId}`,
            value: false,
            sourceRecordId: newId('sr'),
            mappingVersion: 1,
          },
          {
            op: 'clearField',
            node: { id: item },
            fieldKey: 'visible',
            layer: 'till',
            scope: `venue:${venueId}`,
          },
          {
            op: 'clearField',
            node: { id: item },
            fieldKey: 'visible',
            layer: 'till',
            scope: `venue:${live.venueId}`,
          },
        ]),
        source: tillSource(integrationId),
        actor: `integration:${integrationId}`,
      } as ChangeSet
      const tillResult = await apply(app, tenant, tillSet)
      expect(tillResult.rejected.map((r) => [r.opIndex, r.code])).toEqual([
        [0, 'venue_archived'],
        [1, 'venue_archived'],
        // The live venue's scope gets as far as the question about the item's till link.
        [2, 'not_linked'],
      ])
      const nodes = await owner.query('select id from restro.nodes where id = $1', [section2])
      expect(nodes.rowCount).toBe(0)

      // Restored, the same writes are accepted again.
      await restoreVenue(app, tenant, venueId)
      const again = await apply(
        app,
        tenant,
        changeSet([
          { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
        ]),
      )
      expect(again.rejected).toEqual([])
      expect(again.applied).toBe(1)
    })
  })

  describe('a save and a delete never interleave', () => {
    const pending = async (work: Promise<unknown>, ms = 400): Promise<boolean> => {
      const settled = Symbol('settled')
      const winner = await Promise.race([
        work.then(
          () => settled,
          () => settled,
        ),
        new Promise<symbol>((resolve) => setTimeout(() => resolve(Symbol('waiting')), ms)),
      ])
      return winner !== settled
    }

    it('makes a save that comes while the venue is being deleted wait, then refuses it', async () => {
      const { venueId } = await liveVenue('Delete first')
      // The deletion: a transaction that holds the row for update and has set the flag.
      const deleting = await owner.connect()
      await deleting.query('begin')
      await deleting.query('select id from restro.venues where id = $1 for update', [venueId])
      await deleting.query('update restro.venues set archived_at = now() where id = $1', [venueId])

      const save = applyEntry.setVenueTheme(app, tenant, { venueId, theme: null })
      const savePromise = save.catch((error) => error)
      expect(await pending(savePromise)).toBe(true)

      await deleting.query('commit')
      deleting.release()
      const error = await savePromise
      expect(error).toMatchObject({ name: 'VenueThemeError', code: 'venue_archived' })
    })

    it('makes a delete that comes while a save is running wait for the save', async () => {
      const { venueId } = await liveVenue('Save first')
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let saving: Promise<void> = Promise.resolve()
      const locked = new Promise<void>((resolveLocked) => {
        saving = withTenantWrite(app, tenant, async (tx) => {
          expect((await lockLiveVenue(tx, venueId)).refused).toBeNull()
          resolveLocked()
          await gate
        })
      })
      await locked

      const deleting = archiveVenue(app, tenant, venueId)
      const deletion = deleting.catch((error) => error)
      expect(await pending(deletion)).toBe(true)
      expect((await rowOf(venueId))?.archived_at).toBeNull()

      release()
      await saving
      await expect(deletion).resolves.toMatchObject({ changed: true })
      expect((await rowOf(venueId))?.archived_at).toBeInstanceOf(Date)
    })

    it('does not let a venue of another tenant be locked, deleted or restored from here', async () => {
      const result = await withTenantWrite(app, tenant, (tx) => lockLiveVenue(tx, otherTenantVenue))
      expect(result).toEqual({ refused: 'venue_missing', venue: null })
      const stored = await withTenant(app, otherTenant, (tx) =>
        tx
          .select({ archivedAt: venues.archivedAt })
          .from(venues)
          .where(eq(venues.id, otherTenantVenue)),
      )
      expect(stored[0]?.archivedAt).toBeNull()
    })
  })
})
