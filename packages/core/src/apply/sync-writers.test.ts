// Integration tests of the sync's side-table writers: barsy venues, places (rule 6 for absence),
// job runs (refused writes are recorded, summaries are scrubbed) and the per-venue sync state in
// the integration's config. As the restro_app role, on a real Postgres.
import { barsyVenues, createPool, type DbPool, jobRuns, places, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import type { ApplyRejection } from './apply'
import { mapBarsyVenue, upsertBarsyVenues, upsertPlaces } from './barsy-venues'
import { describeRefused, finishJobRun, scrubSummary, startJobRun } from './job-runs'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration, updateIntegration } from './sources'
import { readCachedTree, readSyncState, storeCachedTree, updateSyncState } from './sync-config'
import { issueAllTableTokens } from './tables'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('sync writers (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let integrationId: string

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-sync-writer-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Sync writers club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'w.test' })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  describe('upsertBarsyVenues', () => {
    it('adds venues, follows renames and leaves the manager’s choices alone', async () => {
      const first = await upsertBarsyVenues(app, tenant, integrationId, [
        { bid: 10, name: 'Demo' },
        { bid: 11, name: 'Second' },
      ])
      expect(first.map((row) => [row.bid, row.name])).toEqual([
        [10, 'Demo'],
        [11, 'Second'],
      ])
      // The manager picks a catalogue root (S2-05 does this through its own writer; here, owner).
      await owner.query(
        'update restro.barsy_venues set catalogue_root_cat_id = 1091 where integration_id = $1 and bid = 10',
        [integrationId],
      )
      await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 10, name: 'Demo renamed' }])
      const rows = await withTenant(app, tenant, (tx) =>
        tx.select().from(barsyVenues).where(eq(barsyVenues.integrationId, integrationId)),
      )
      expect(rows.find((row) => row.bid === 10)).toMatchObject({
        name: 'Demo renamed',
        catalogueRootCatId: 1091,
      })
      expect(rows).toHaveLength(2)
    })

    it('refuses nonsense and writes nothing for an empty list', async () => {
      expect(await upsertBarsyVenues(app, tenant, integrationId, [])).toEqual([])
      await expect(
        upsertBarsyVenues(app, tenant, integrationId, [{ bid: -1, name: 'x' }]),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(
        upsertBarsyVenues(app, tenant, integrationId, [{ bid: 1, name: '  ' }]),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })

  describe('upsertPlaces', () => {
    const place = (id: string, num: string | null = id) => ({
      placeId: id,
      placeNum: num,
      salonName: 'Hall',
      isPublic: true,
    })
    const stateOf = async (placeId: string) =>
      (
        await withTenant(app, tenant, (tx) =>
          tx
            .select()
            .from(places)
            .where(and(eq(places.integrationId, integrationId), eq(places.placeId, placeId))),
        )
      )[0]

    it('creates, updates, and leaves unchanged places untouched', async () => {
      const t0 = new Date('2026-10-01T10:00:00Z')
      const first = await upsertPlaces(app, tenant, integrationId, 10, [place('1'), place('2')], {
        pagesOk: [true],
        now: t0,
      })
      expect(first).toMatchObject({ created: 2, updated: 0, unchanged: 0, missing: 0 })
      const token = await stateOf('1')
      expect(token?.id).toMatch(/^tb_/)

      const second = await upsertPlaces(
        app,
        tenant,
        integrationId,
        10,
        [place('1', 'VIP'), place('2')],
        { pagesOk: [true], now: t0 },
      )
      expect(second).toMatchObject({ created: 0, updated: 1, unchanged: 1 })
      expect((await stateOf('1'))?.placeNum).toBe('VIP')
    })

    it('absence: missing only after a complete pull; deleted after seven days; listed again is active', async () => {
      // `places.updated_at` (a trigger) stands in for "when it entered its state", so the clock
      // the writer is given is compared with the real one: the grace period is tested by asking
      // eight days into the future.
      const day = 24 * 60 * 60 * 1000
      await upsertPlaces(app, tenant, integrationId, 10, [place('1'), place('2'), place('3')], {
        pagesOk: [true],
      })

      // A pull with a failed page concludes nothing about absence.
      const failed = await upsertPlaces(app, tenant, integrationId, 10, [place('1')], {
        pagesOk: [true, false],
      })
      expect(failed).toMatchObject({ missing: 0, deleted: 0, complete: false })
      expect((await stateOf('2'))?.state).toBe('active')

      // A complete pull that lacks 2 and 3 makes them missing.
      const complete = await upsertPlaces(app, tenant, integrationId, 10, [place('1')], {
        pagesOk: [true],
      })
      expect(complete).toMatchObject({ missing: 2, deleted: 0, complete: true })
      expect((await stateOf('2'))?.state).toBe('missing')

      // Listed again: active. Still absent after the grace period: deleted.
      await upsertPlaces(app, tenant, integrationId, 10, [place('1'), place('2')], {
        pagesOk: [true],
      })
      expect((await stateOf('2'))?.state).toBe('active')
      const late = await upsertPlaces(app, tenant, integrationId, 10, [place('1'), place('2')], {
        pagesOk: [true],
        now: new Date(Date.now() + 8 * day),
      })
      expect(late.deleted).toBe(1)
      expect((await stateOf('3'))?.state).toBe('deleted')
    })

    describe('a read that lists nothing, or far less than is stored, is held (T62)', () => {
      const BID = 13
      const day = 24 * 60 * 60 * 1000
      const ids = Array.from({ length: 10 }, (_, i) => String(300 + i))
      const stateCounts = async () => {
        const rows = await withTenant(app, tenant, (tx) =>
          tx
            .select()
            .from(places)
            .where(and(eq(places.integrationId, integrationId), eq(places.bid, BID))),
        )
        return rows.reduce<Record<string, number>>((counts, row) => {
          counts[row.state] = (counts[row.state] ?? 0) + 1
          return counts
        }, {})
      }

      const stateOfBid = async (placeId: string) =>
        (
          await withTenant(app, tenant, (tx) =>
            tx
              .select()
              .from(places)
              .where(
                and(
                  eq(places.integrationId, integrationId),
                  eq(places.bid, BID),
                  eq(places.placeId, placeId),
                ),
              ),
          )
        )[0]

      it('an empty complete list over active places changes nothing and retires no token', async () => {
        await upsertBarsyVenues(app, tenant, integrationId, [{ bid: BID, name: 'Held venue' }])
        const created = await upsertPlaces(
          app,
          tenant,
          integrationId,
          BID,
          ids.map((id) => place(id)),
          {
            pagesOk: [true],
          },
        )
        expect(created).toMatchObject({ created: 10, held: null })
        // The till venue serves a venue, so the places have tables; give each a code.
        const heldVenue = (
          await provisionVenue(app, tenant, { name: 'Held', slug: testSlug('held-venue') })
        ).id
        expect(await mapBarsyVenue(app, tenant, integrationId, BID, heldVenue)).toMatchObject({
          ok: true,
        })
        expect(await issueAllTableTokens(app, tenant, heldVenue)).toMatchObject({ issued: 10 })

        const empty = await upsertPlaces(app, tenant, integrationId, BID, [], { pagesOk: [true] })
        expect(empty).toMatchObject({
          missing: 0,
          deleted: 0,
          retiredTokens: [],
          complete: true,
          held: { reason: 'empty_read', wouldHide: 10, active: 10 },
        })
        expect(await stateCounts()).toEqual({ active: 10 })

        // Past the grace period, still empty: still nothing happens.
        const later = await upsertPlaces(app, tenant, integrationId, BID, [], {
          pagesOk: [true],
          now: new Date(Date.now() + 8 * day),
        })
        expect(later).toMatchObject({
          deleted: 0,
          retiredTokens: [],
          held: { reason: 'empty_read' },
        })
        expect(await stateCounts()).toEqual({ active: 10 })
        const coded = await owner.query(
          `select count(*)::int as n from restro.tables t
             join restro.places p on p.table_id = t.id
            where p.integration_id = $1 and p.bid = $2 and t.qr_token is not null
              and t.archived_at is null`,
          [integrationId, BID],
        )
        expect(coded.rows[0]?.n).toBe(10)
      })

      it('a list that would mark more than 30% (and at least 5) missing is held; listed places are still stored', async () => {
        const held = await upsertPlaces(
          app,
          tenant,
          integrationId,
          BID,
          [place('300', 'renamed'), place('301')],
          { pagesOk: [true] },
        )
        expect(held).toMatchObject({
          updated: 1,
          unchanged: 1,
          missing: 0,
          held: { reason: 'too_many_missing', wouldHide: 8, active: 10 },
        })
        expect(await stateCounts()).toEqual({ active: 10 })
        expect((await stateOfBid('300'))?.placeNum).toBe('renamed')
      })

      it('a small drop is concluded as before, and an incomplete read is never "held" (it concludes nothing)', async () => {
        const incomplete = await upsertPlaces(app, tenant, integrationId, BID, [], {
          pagesOk: [true, false],
        })
        expect(incomplete).toMatchObject({ complete: false, missing: 0, held: null })

        const small = await upsertPlaces(
          app,
          tenant,
          integrationId,
          BID,
          ids.slice(0, 8).map((id) => place(id)),
          { pagesOk: [true] },
        )
        expect(small).toMatchObject({ missing: 2, deleted: 0, held: null })
        expect(await stateCounts()).toEqual({ active: 8, missing: 2 })
      })
    })

    it('refuses a bid that was never recorded (foreign key) and bad ids', async () => {
      await expect(
        upsertPlaces(app, tenant, integrationId, 999, [place('1')], { pagesOk: [true] }),
      ).rejects.toThrow()
      await expect(
        upsertPlaces(app, tenant, 'in_nope', 10, [], { pagesOk: [true] }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })

  describe('job runs', () => {
    const rejection = (code: string, reason: string): ApplyRejection => ({
      opIndex: 0,
      code: code as ApplyRejection['code'],
      reason,
    })

    it('start and finish: status, counters and the refused writes', async () => {
      const run = await startJobRun(app, tenant, {
        kind: 'barsy_full_pull',
        integrationId,
        startedAt: new Date('2026-10-09T10:00:00Z'),
      })
      expect(run.id).toMatch(/^jb_[0-9A-Za-z]{22}$/)
      expect(run).toMatchObject({ status: 'running', kind: 'barsy_full_pull', integrationId })

      const finished = await finishJobRun(app, tenant, run.id, {
        status: 'completed',
        counters: { articles_seen: 58, created: 58 },
        summary: 'deletion check skipped: 1 page failed',
        refused: [
          rejection('unknown_link', 'article 5 is not linked to a node'),
          rejection('unknown_link', 'article 6 is not linked to a node'),
          rejection('layer_not_allowed', 'price is locked'),
        ],
      })
      expect(finished).toMatchObject({
        status: 'completed',
        counters: {
          articles_seen: 58,
          created: 58,
          refused_writes: 3,
          refused_unknown_link: 2,
          refused_layer_not_allowed: 1,
        },
      })
      expect(finished?.finishedAt).toBeInstanceOf(Date)
      expect(finished?.errorSummary).toContain('deletion check skipped: 1 page failed')
      expect(finished?.errorSummary).toContain('3 writes refused')
      expect(finished?.errorSummary).toContain('unknown_link x2')
      expect(finished?.errorSummary).toContain('price is locked')

      // A finished run stays finished.
      expect(await finishJobRun(app, tenant, run.id, { status: 'failed' })).toBeNull()
    })

    it('a held absence conclusion is recorded in details as absence_held, and only when given', async () => {
      const held = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      const finished = await finishJobRun(app, tenant, held.id, {
        status: 'completed',
        summary:
          'deletion check held: the read would hide 61 of 65 items (94%); nothing was hidden',
        deletionCheckSkipped: true,
        absenceHeld: { reason: 'too_many_missing', wouldHide: 61, active: 65 },
      })
      expect(finished?.details).toEqual({
        notes: [
          'deletion check held: the read would hide 61 of 65 items (94%); nothing was hidden',
        ],
        refused: [],
        deletionCheckSkipped: true,
        absence_held: { reason: 'too_many_missing', would_hide: 61, active: 65 },
      })

      const plain = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      const done = await finishJobRun(app, tenant, plain.id, { status: 'completed' })
      expect(done?.details).not.toHaveProperty('absence_held')
    })

    it('a failed run keeps its summary, without URLs or their query strings', async () => {
      const run = await startJobRun(app, tenant, { kind: 'barsy_connect', integrationId })
      const finished = await finishJobRun(app, tenant, run.id, {
        status: 'failed',
        summary: 'fetch https://demo.barsyonline.com/endpoints/res/files_get?key=SECRET failed',
      })
      expect(finished?.errorSummary).toBe('fetch [url] failed')
      expect(finished?.errorSummary).not.toContain('SECRET')
    })

    it('scrubs and cuts text, describes refusals, refuses bad input', async () => {
      expect(scrubSummary(`a\u0000b http://x.test/p?q=1 ${'z'.repeat(3000)}`)).toHaveLength(2000)
      expect(describeRefused([])).toBeNull()
      expect(describeRefused([rejection('unknown_node', 'gone')])).toBe(
        '1 write refused (unknown_node x1). unknown_node: gone',
      )
      await expect(startJobRun(app, tenant, { kind: 'Bad Kind' })).rejects.toMatchObject({
        code: 'invalid_input',
      })
      const run = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId })
      await expect(
        finishJobRun(app, tenant, run.id, { status: 'completed', counters: { a: 1.5 } }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await finishJobRun(app, tenant, run.id, { status: 'completed' })
      const stored = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, run.id)),
      )
      expect(stored[0]).toMatchObject({ counters: {}, errorSummary: null })
    })

    it('another tenant cannot finish this tenant’s run', async () => {
      const run = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId })
      expect(await finishJobRun(app, otherTenant, run.id, { status: 'failed' })).toBeNull()
    })
  })

  describe('sync state in the integration config', () => {
    const configOf = async () =>
      (await owner.query('select config from restro.integrations where id = $1', [integrationId]))
        .rows[0]?.config as unknown

    it('merges the cursor and hashes per venue without touching other keys', async () => {
      const cursor = '2026-10-09T10:00:00+03:00'
      const hash = 'a'.repeat(64)
      expect(await updateSyncState(app, tenant, integrationId, 10, { cursor })).toBe(true)
      expect(await updateSyncState(app, tenant, integrationId, 10, { tree_hash: hash })).toBe(true)
      await updateSyncState(app, tenant, integrationId, 11, { cursor: '2026-10-09T11:00:00Z' })
      const config = await configOf()
      expect(readSyncState(config, 10)).toEqual({ cursor, tree_hash: hash })
      expect(readSyncState(config, 11)).toEqual({ cursor: '2026-10-09T11:00:00Z' })
      expect(readSyncState(config, 12)).toEqual({})
    })

    it('stores the scope hash of the last complete full pull beside the cursor (B1-Q2)', async () => {
      const scope = 'c'.repeat(64)
      expect(await updateSyncState(app, tenant, integrationId, 14, { scope_hash: scope })).toBe(
        true,
      )
      await updateSyncState(app, tenant, integrationId, 14, { cursor: '2026-10-09T10:00:00Z' })
      expect(readSyncState(await configOf(), 14)).toEqual({
        scope_hash: scope,
        cursor: '2026-10-09T10:00:00Z',
      })
      await expect(
        updateSyncState(app, tenant, integrationId, 14, { scope_hash: 'not a hash' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('keeps the tick’s marks (S3-04) beside the settings, and a settings write keeps the marks', async () => {
      const queuedAt = '2026-10-10T09:00:00.200Z'
      const slot = '2026-10-10T09:00:00.000Z'
      expect(
        await updateSyncState(app, tenant, integrationId, 12, {
          last_incremental_queued_at: queuedAt,
        }),
      ).toBe(true)
      await updateSyncState(app, tenant, integrationId, 12, { last_full_pull_slot: slot })
      // The settings live in other top-level keys of the same config.
      await updateIntegration(app, tenant, integrationId, {
        config: { schedule: { incremental_minutes: 10 }, publish: { after_sync: 'manual' } },
      })
      await updateSyncState(app, tenant, integrationId, 12, { last_incremental_at: queuedAt })
      const config = await configOf()
      expect(readSyncState(config, 12)).toEqual({
        last_incremental_queued_at: queuedAt,
        last_full_pull_slot: slot,
        last_incremental_at: queuedAt,
      })
      expect(config).toMatchObject({
        schedule: { incremental_minutes: 10 },
        publish: { after_sync: 'manual' },
      })
      await expect(
        updateSyncState(app, tenant, integrationId, 12, { last_full_pull_slot: 'noon' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('stores the cached tree per venue; unknown integrations and bad values are refused', async () => {
      const tree = {
        fetched_at: '2026-10-09T10:00:00Z',
        categories: [
          { cat_id: 1, parent_id: null, name: 'Drinks' },
          { cat_id: 2, parent_id: 1, name: 'Beer' },
        ],
      }
      expect(await storeCachedTree(app, tenant, integrationId, 10, tree)).toBe(true)
      expect(readCachedTree(await configOf(), 10)).toEqual(tree)
      expect(readCachedTree(await configOf(), 11)).toBeNull()
      // The sync state written before is still there.
      expect(readSyncState(await configOf(), 10).cursor).toBeDefined()

      expect(await updateSyncState(app, tenant, newId('in'), 10, { cursor: tree.fetched_at })).toBe(
        false,
      )
      expect(
        await updateSyncState(app, otherTenant, integrationId, 10, { cursor: tree.fetched_at }),
      ).toBe(false)
      await expect(
        updateSyncState(app, tenant, integrationId, 10, { cursor: 'yesterday' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(
        updateSyncState(app, tenant, integrationId, 10, { surprise: 1 } as never),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('reads nothing sensible from a config it cannot read', () => {
      expect(readSyncState(null, 10)).toEqual({})
      expect(readSyncState({ sync: 'x' }, 10)).toEqual({})
      expect(readCachedTree({ catalogue_trees: { '10': { nope: 1 } } }, 10)).toBeNull()
    })
  })
})
