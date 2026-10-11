// Settings -> Integrations and the venue's Menu source card, against a real Postgres, as the
// restro_app role (briefs S2-05 and CF-09b): saving the connection (sealed with a public key
// generated here, host rules, the password never stored, returned or logged), the list of venues
// in the till and what can be done with each (Add as venue, Link to an existing venue, Not used,
// Change…), the venue's menu category and price, how the data is read, the automatic sync and its
// gates ("Sync everything now", "Sync this venue"), the run history with its venue column, who may
// do what, and another tenant's integration being invisible. The queue is a fake except in the
// last block, which uses a real pg-boss.
import { generateKeyPairSync } from 'node:crypto'

import { autoPublishPaused, JOB_NAMES, newId, parseSyncSettings } from '@restro/core'
import {
  appendSourceRecords,
  finishJobRun,
  provisionTenant,
  provisionVenue,
  setAutoPublishPaused,
  startJobRun,
  storeCachedTree,
  updateIntegration,
  updateSyncState,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { sealKeyId } from '@restro/core/seal'
import { barsyVenues, createPool, type DbPool, integrations, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { enqueueJob } from '../jobs'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import {
  addTillVenueAsVenue,
  checkConnection,
  chooseCatalogueRoot,
  chooseTillVenue,
  HISTORY_LENGTH,
  type IntegrationScope,
  type IntegrationServices,
  linkTillVenue,
  loadIntegrationView,
  loadMenuSourceView,
  markTillVenue,
  readActiveJob,
  saveConnection,
  saveMappingSettings,
  saveSyncSettings,
  saveVenuePrice,
  syncAll,
  syncNow,
  type VenueScope,
} from './service'
import type { LinkedMenuSource, MenuSourceView } from './view'

const keys = generateKeyPairSync('x25519')
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
const PASSWORD = 'correct horse battery staple 8F3kZ'
const API_USER = 'api-user-for-tests'

describe.skipIf(!hasDatabase)(
  'Settings -> Integrations and the Menu source (as the restro_app role)',
  () => {
    const tenant = newId('tn')
    const otherTenant = newId('tn')
    let app: DbPool
    let owner: pg.Pool
    let venueA: { id: string; name: string; timezone: string }
    let venueB: { id: string; name: string; timezone: string }
    let foreignVenue: { id: string; name: string; timezone: string }

    const sent: { name: string; data: object }[] = []
    let enqueueResult: string | null = 'job-1'
    let enqueueFails = false
    const services = (overrides: Partial<IntegrationServices> = {}): IntegrationServices => ({
      sealPublicKey: PUBLIC_KEY,
      enqueue: async (name, data) => {
        if (enqueueFails) throw new Error('queue is down')
        sent.push({ name, data })
        return enqueueResult
      },
      ...overrides,
    })
    /** The organisation's scope (the Settings page). */
    const orgScope = (overrides: Partial<IntegrationScope> = {}): IntegrationScope => ({
      pool: app,
      tenantId: tenant,
      canManage: true,
      ...overrides,
    })
    /** One venue's scope (its Menu source card). */
    const venueScope = (
      venue: { id: string; name: string; timezone: string },
      overrides: Partial<VenueScope> = {},
    ): VenueScope => ({ pool: app, tenantId: tenant, venue, canManage: true, ...overrides })
    const connection = { host: 'https://Club.BarsyOnline.com/', user: API_USER, password: PASSWORD }

    // Everything the server code prints, to check that no secret is in it.
    const logged: string[] = []
    let spies: { mockRestore: () => void }[] = []

    async function integrationRows() {
      return (await owner.query('select * from restro.integrations where tenant_id = $1', [tenant]))
        .rows as {
        id: string
        host: string
        status: string
        credentials_sealed: string | null
        config: Record<string, unknown>
      }[]
    }
    const venueCount = async () =>
      (await withTenant(app, tenant, (tx) => tx.select({ id: venues.id }).from(venues))).length
    const linkOf = async (bid: number) =>
      (
        await withTenant(app, tenant, (tx) =>
          tx.select().from(barsyVenues).where(eq(barsyVenues.bid, bid)),
        )
      )[0]
    const linked = (view: MenuSourceView): LinkedMenuSource => {
      if (view.state !== 'linked') throw new Error(`the card is ${view.state}, not linked`)
      return view
    }

    beforeAll(async () => {
      spies = (['error', 'warn', 'info', 'log'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '))
        }),
      )
      owner = openOwnerPool()
      app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-integration-tests' })
      await provisionTenant(app, { tenantId: tenant, name: 'Integration club' })
      await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
      const make = async (id: string, name: string, slug: string) => {
        const venue = await provisionVenue(app, id, { name, slug: testSlug(slug) })
        return { id: venue.id, name: venue.name, timezone: venue.timezone }
      }
      venueA = await make(tenant, 'Venue A', 'venue-a')
      venueB = await make(tenant, 'Venue B', 'venue-b')
      foreignVenue = await make(otherTenant, 'Foreign', 'foreign')
    })

    afterEach(() => {
      sent.length = 0
      enqueueResult = 'job-1'
      enqueueFails = false
    })

    afterAll(async () => {
      for (const spy of spies) spy.mockRestore()
      await app?.end()
      if (owner) {
        for (const table of [
          'job_runs',
          'source_records',
          'menus',
          'nodes',
          'barsy_venues',
          'integrations',
          'venues',
        ]) {
          await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [
            [tenant, otherTenant],
          ])
        }
        await owner.query('delete from restro.tenants where id = any($1)', [[tenant, otherTenant]])
        await owner.end()
      }
    })

    describe('before anything is connected', () => {
      it('shows an empty page, closed "Sync everything now", and whether the sync keys are set up', async () => {
        const view = await loadIntegrationView(orgScope(), services())
        expect(view).toMatchObject({
          canManage: true,
          sealReady: true,
          timeZone: 'Europe/Sofia',
          integration: null,
          activeJob: null,
          tillVenues: [],
          heldSyncs: [],
          runs: [],
          gate: { enabled: false, reason: 'no_credentials' },
          mapping: { allergenKey: null, defaultLocale: 'bg_BG' },
          // The defaults are what ran before the settings existed; nothing is scheduled yet.
          syncSettings: {
            incrementalEnabled: true,
            incrementalMinutes: 5,
            fullPullEnabled: true,
            fullPullTime: '12:00',
            scheduleActive: false,
            nextIncrementalAt: null,
            nextFullPullAt: null,
          },
        })
        // Both venues of ours wait for a till venue.
        expect(view.linkableVenues.map((venue) => venue.name)).toEqual(['Venue A', 'Venue B'])
        const without = await loadIntegrationView(orgScope(), { sealPublicKey: undefined } as never)
        expect(without.sealReady).toBe(false)
        const broken = await loadIntegrationView(orgScope(), {
          sealPublicKey: 'not-a-key',
        } as never)
        expect(broken.sealReady).toBe(false)
      })

      it('a venue’s Menu source says there is no integration, and links nothing', async () => {
        expect(await loadMenuSourceView(venueScope(venueA))).toEqual({
          state: 'no_integration',
          canManage: true,
        })
        expect(await chooseTillVenue(venueScope(venueA), { bid: 1 })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await syncAll(orgScope(), services())).toEqual({ ok: false, error: 'not_ready' })
      })
    })

    describe('saveConnection', () => {
      it('refuses everyone but owners and admins, and writes nothing', async () => {
        const result = await saveConnection(orgScope({ canManage: false }), services(), connection)
        expect(result).toEqual({ ok: false, error: 'not_allowed' })
        expect(await integrationRows()).toEqual([])
        expect(sent).toEqual([])
      })

      it('checks the address, the keys and the credentials before touching anything', async () => {
        const save = (input: Partial<typeof connection>, over?: Partial<IntegrationServices>) =>
          saveConnection(orgScope(), services(over), { ...connection, ...input })
        expect(await save({ host: 'http://club.barsyonline.com' })).toEqual({
          ok: false,
          error: 'invalid_host',
        })
        expect(await save({ host: 'https://club.barsyonline.com:8443' })).toEqual({
          ok: false,
          error: 'invalid_host',
        })
        expect(await save({}, { sealPublicKey: undefined })).toEqual({
          ok: false,
          error: 'sync_keys_missing',
        })
        expect(await save({}, { sealPublicKey: 'definitely-not-a-key' })).toEqual({
          ok: false,
          error: 'sync_keys_missing',
        })
        expect(await save({ password: '' })).toEqual({ ok: false, error: 'invalid' })
        expect(await save({ user: '' })).toEqual({ ok: false, error: 'invalid' })
        expect(await integrationRows()).toEqual([])
        expect(sent).toEqual([])
      })

      it('seals the credentials for the key, stores only the envelope, and queues the check', async () => {
        const result = await saveConnection(orgScope(), services(), connection)
        expect(result).toEqual({ ok: true, queued: true })

        const [row] = await integrationRows()
        expect(row).toMatchObject({ host: 'club.barsyonline.com', status: 'new' })
        // An rs1 envelope addressed to our key: <version>.<key id>.<ephemeral>.<nonce>.<sealed>.
        const parts = row?.credentials_sealed?.split('.') ?? []
        expect(parts).toHaveLength(5)
        expect(parts[0]).toBe('rs1')
        expect(parts[1]).toBe(sealKeyId(PUBLIC_KEY))
        // Neither the password nor the user name is in anything stored.
        const everything = JSON.stringify(
          (await owner.query('select to_jsonb(i) as j from restro.integrations i')).rows,
        )
        expect(everything).not.toContain(PASSWORD)
        expect(everything).not.toContain(API_USER)

        expect(sent).toEqual([
          { name: JOB_NAMES.barsyConnect, data: { tenantId: tenant, integrationId: row?.id } },
        ])
        // The payload carries no secret.
        expect(JSON.stringify(sent)).not.toContain(PASSWORD)
      })

      it('shows the saved credentials as a fact, never as a value', async () => {
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.integration).toMatchObject({
          host: 'club.barsyonline.com',
          hasCredentials: true,
          status: 'new',
        })
        const [row] = await integrationRows()
        const json = JSON.stringify(view)
        expect(json).not.toContain(PASSWORD)
        expect(json).not.toContain(API_USER)
        expect(json).not.toContain(row?.credentials_sealed ?? 'missing')
        expect(view.gate).toEqual({ enabled: false, reason: 'not_connected' })
      })

      it('saving again on the same host replaces the envelope, resets the status, keeps one row', async () => {
        const [before] = await integrationRows()
        await updateIntegration(app, tenant, before?.id ?? '', {
          status: 'error',
          statusDetail: 'Wrong user or password',
        })
        const result = await saveConnection(orgScope(), services(), connection)
        expect(result).toEqual({ ok: true, queued: true })
        const rows = await integrationRows()
        expect(rows).toHaveLength(1)
        expect(rows[0]?.id).toBe(before?.id)
        expect(rows[0]?.status).toBe('new')
        expect(rows[0]?.credentials_sealed).not.toBe(before?.credentials_sealed)
        const [detail] = (
          await owner.query('select status_detail from restro.integrations where id = $1', [
            before?.id,
          ])
        ).rows
        expect(detail.status_detail).toBeNull()
      })

      it('still saves when the queue cannot be reached, and says the check was not queued', async () => {
        enqueueFails = true
        const result = await saveConnection(orgScope(), services(), connection)
        expect(result).toEqual({ ok: true, queued: false })
        expect(logged.some((line) => line.includes('integration_connect_not_queued'))).toBe(true)
      })
    })

    describe('what the worker would have cached (simulated through the writers)', () => {
      let integrationId = ''
      beforeAll(async () => {
        integrationId = (await integrationRows())[0]?.id ?? ''
        await updateIntegration(app, tenant, integrationId, {
          status: 'connected',
          statusDetail: null,
          lastCheckedAt: new Date(),
        })
        await upsertBarsyVenues(app, tenant, integrationId, [
          { bid: 1, name: 'Main bar' },
          { bid: 2, name: 'Roof' },
          { bid: 3, name: 'Shop' },
          { bid: 4, name: 'Catering' },
        ])
        await storeCachedTree(app, tenant, integrationId, 1, {
          fetched_at: '2026-10-09T10:00:00.000Z',
          categories: [
            { cat_id: 1171, parent_id: null, name: 'Публично меню' },
            { cat_id: 1172, parent_id: 1171, name: 'Коктейли' },
            { cat_id: 1091, parent_id: null, name: 'Каса Kiosk' },
          ],
        })
        const payload = [
          {
            group_id: 1,
            group_name: 'Основна',
            details: { k102: { detail_name: 'Алергени' }, k103: { detail_name: 'Грамаж' } },
          },
        ]
        await appendSourceRecords(app, tenant, integrationId, [
          {
            externalType: 'article_details',
            externalId: 'tree',
            scope: 'master',
            raw: JSON.stringify(payload),
            payload,
          },
        ])
      })

      it('lists every venue of the till by name, all still to do, and the venues that could take one', async () => {
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.integration?.status).toBe('connected')
        expect(view.tillVenues).toEqual([
          { key: 4, name: 'Catering', state: 'unlinked', venue: null, hasMenuCategory: false },
          { key: 1, name: 'Main bar', state: 'unlinked', venue: null, hasMenuCategory: false },
          { key: 2, name: 'Roof', state: 'unlinked', venue: null, hasMenuCategory: false },
          { key: 3, name: 'Shop', state: 'unlinked', venue: null, hasMenuCategory: false },
        ])
        expect(view.linkableVenues.map((venue) => venue.name)).toEqual(['Venue A', 'Venue B'])
        expect(view.gate).toEqual({ enabled: false, reason: 'no_till_venue' })
      })

      it('"Link to an existing venue" links a venue that has no link, and refuses the rest', async () => {
        const link = (scope: IntegrationScope, bid: number, venueId: string) =>
          linkTillVenue(scope, { bid, venueId })
        expect(await link(orgScope({ canManage: false }), 1, venueA.id)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await link(orgScope(), 1, venueA.id)).toEqual({ ok: true })
        expect((await linkOf(1))?.venueId).toBe(venueA.id)
        // One till venue per venue: venue B cannot take what venue A has ...
        expect(await link(orgScope(), 1, venueB.id)).toEqual({
          ok: false,
          error: 'till_venue_taken',
        })
        // ... and a venue that has a link cannot be given a second one (moving is "Change…").
        expect(await link(orgScope(), 2, venueA.id)).toEqual({
          ok: false,
          error: 'venue_already_linked',
        })
        expect((await linkOf(1))?.venueId).toBe(venueA.id)
        expect((await linkOf(2))?.venueId).toBeNull()
        // Unknown till venue, unknown venue, another organisation's venue.
        expect(await link(orgScope(), 99, venueB.id)).toEqual({ ok: false, error: 'not_found' })
        expect(await link(orgScope(), 2, newId('vn'))).toEqual({ ok: false, error: 'not_found' })
        expect(await link(orgScope(), 2, foreignVenue.id)).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect((await linkOf(2))?.venueId).toBeNull()
      })

      it('the list shows the link, and the venue’s card shows its tree and what is left to choose', async () => {
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.tillVenues.find((row) => row.key === 1)).toEqual({
          key: 1,
          name: 'Main bar',
          state: 'linked',
          venue: { id: venueA.id, name: 'Venue A' },
          hasMenuCategory: false,
        })
        expect(view.linkableVenues.map((venue) => venue.name)).toEqual(['Venue B'])
        // "Sync everything now" needs a linked venue with a menu category.
        expect(view.gate).toEqual({ enabled: false, reason: 'no_root' })

        const card = linked(await loadMenuSourceView(venueScope(venueA)))
        expect(card).toMatchObject({
          tillVenueName: 'Main bar',
          rootCatId: null,
          priceSource: 'actual_price',
          lastSyncedAt: null,
          heldSync: null,
          gate: { enabled: false, reason: 'no_root' },
          tree: [
            {
              id: 1171,
              name: 'Публично меню',
              children: [{ id: 1172, name: 'Коктейли', children: [] }],
            },
            { id: 1091, name: 'Каса Kiosk', children: [] },
          ],
          treeFetchedAt: '2026-10-09T10:00:00.000Z',
        })
        // The other venues of the till are offered for "Change…", the venue it serves is not.
        expect(card.options.map((option) => [option.name, option.usedBy])).toEqual([
          ['Catering', null],
          ['Roof', null],
          ['Shop', null],
        ])
      })

      it('a venue with no link gets the venues of the till that serve none', async () => {
        const card = await loadMenuSourceView(venueScope(venueB))
        expect(card).toMatchObject({ state: 'unlinked', canManage: true })
        if (card.state !== 'unlinked') throw new Error('expected an unlinked card')
        expect(card.options.map((option) => option.name)).toEqual(['Catering', 'Roof', 'Shop'])
      })

      it('hints at the public address and menu from the stored record of each venue, and suggests its public category (B1-Q6)', async () => {
        const venueRecord = (bid: number, payload: Record<string, unknown>) => ({
          externalType: 'barsy_venue',
          externalId: String(bid),
          scope: 'master' as const,
          raw: JSON.stringify(payload),
          payload,
        })
        const before = await loadIntegrationView(orgScope(), services())
        const cardBefore = linked(await loadMenuSourceView(venueScope(venueA)))
        // An older record of venue 1 and a newer one: the newer one speaks.
        await appendSourceRecords(app, tenant, integrationId, [
          venueRecord(1, { barsy_id: 1, name: 'Main bar', public_address: 'Old street 1' }),
        ])
        await appendSourceRecords(app, tenant, integrationId, [
          venueRecord(1, {
            barsy_id: 1,
            name: 'Main bar',
            public_address: '  Sofia, 108 Vitosha Blvd ',
            public_cat_id: 1171,
          }),
          // Venue 2 has a record that says nothing: no hint at all.
          venueRecord(2, { barsy_id: 2, name: 'Roof', public_address: null, public_cat_id: null }),
        ])
        try {
          const view = await loadIntegrationView(orgScope(), services())
          expect(view.tillVenues.find((row) => row.key === 1)).toMatchObject({
            address: 'Sofia, 108 Vitosha Blvd',
            publicMenuSetUp: true,
          })
          expect(view.tillVenues.find((row) => row.key === 2)).not.toHaveProperty('address')
          const card = linked(await loadMenuSourceView(venueScope(venueA)))
          // The venue's public category is suggested in its own tree, and nothing else is.
          expect(card.tree).toEqual([
            {
              id: 1171,
              name: 'Публично меню',
              suggested: true,
              children: [{ id: 1172, name: 'Коктейли', children: [] }],
            },
            { id: 1091, name: 'Каса Kiosk', children: [] },
          ])
          // Hints only: what was chosen stays chosen, and no number or field name of the till reaches the view.
          expect(card.rootCatId).toBe(cardBefore.rootCatId)
          expect(JSON.stringify([view, card])).not.toContain('public_cat_id')
          // Another venue sees the hints of the venues, but no tree of this one.
          const asB = await loadMenuSourceView(venueScope(venueB))
          expect(asB.state).toBe('unlinked')
        } finally {
          await owner.query(
            `delete from restro.source_records where tenant_id = $1 and external_type = 'barsy_venue'`,
            [tenant],
          )
        }
        const after = await loadIntegrationView(orgScope(), services())
        expect(after.tillVenues).toEqual(before.tillVenues)
      })

      it('chooses the menu category only from the cached tree', async () => {
        expect(await chooseCatalogueRoot(venueScope(venueA), { catId: 5555 })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(
          await chooseCatalogueRoot(venueScope(venueA, { canManage: false }), { catId: 1171 }),
        ).toEqual({ ok: false, error: 'not_allowed' })
        // Venue B has no till venue yet, so it has no tree to choose from.
        expect(await chooseCatalogueRoot(venueScope(venueB), { catId: 1171 })).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await chooseCatalogueRoot(venueScope(venueA), { catId: 1171 })).toEqual({ ok: true })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).rootCatId).toBe(1171)
        expect((await linkOf(1))?.catalogueRootCatId).toBe(1171)
        // The list now knows venue A has its category, and "Sync everything now" opens.
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.tillVenues.find((row) => row.key === 1)?.hasMenuCategory).toBe(true)
        expect(view.gate).toEqual({ enabled: true })
      })

      it('"Change…" moves a venue to another till venue, freeing the first; a taken one is refused', async () => {
        expect(await chooseTillVenue(venueScope(venueA, { canManage: false }), { bid: 2 })).toEqual(
          {
            ok: false,
            error: 'not_allowed',
          },
        )
        expect(await chooseTillVenue(venueScope(venueA), { bid: 2 })).toEqual({ ok: true })
        expect((await linkOf(1))?.venueId).toBeNull()
        expect((await linkOf(2))?.venueId).toBe(venueA.id)
        // Venue B can take the freed one, but not the one venue A has now.
        expect(await chooseTillVenue(venueScope(venueB), { bid: 2 })).toEqual({
          ok: false,
          error: 'till_venue_taken',
        })
        expect(await chooseTillVenue(venueScope(venueB), { bid: 99 })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await chooseTillVenue(venueScope(venueB), { bid: 1 })).toEqual({ ok: true })
        const asB = linked(await loadMenuSourceView(venueScope(venueB)))
        expect(asB.tillVenueName).toBe('Main bar')
        expect(asB.options.find((option) => option.name === 'Roof')).toMatchObject({
          usedBy: 'Venue A',
        })
        // Put things back for the next tests: A on bid 1 with its category, B on nothing.
        await owner.query('update restro.barsy_venues set venue_id = null where tenant_id = $1', [
          tenant,
        ])
        expect(await chooseTillVenue(venueScope(venueA), { bid: 1 })).toEqual({ ok: true })
      })

      describe('"Not used"', () => {
        it('round-trips, and is kept in the integration’s config', async () => {
          expect(
            await markTillVenue(orgScope({ canManage: false }), { bid: 3, notUsed: true }),
          ).toEqual({
            ok: false,
            error: 'not_allowed',
          })
          expect(await markTillVenue(orgScope(), { bid: 3, notUsed: true })).toEqual({ ok: true })
          expect((await integrationRows())[0]?.config).toMatchObject({ not_used: { '3': true } })
          const view = await loadIntegrationView(orgScope(), services())
          expect(view.tillVenues.find((row) => row.key === 3)?.state).toBe('not_used')
          // A venue set aside is not left to do, and the venue's own picker still shows it, marked.
          expect(
            view.tillVenues.filter((row) => row.state === 'unlinked').map((row) => row.key),
          ).toEqual([4, 2])
          const card = linked(await loadMenuSourceView(venueScope(venueA)))
          expect(card.options.find((option) => option.name === 'Shop')).toMatchObject({
            notUsed: true,
          })

          expect(await markTillVenue(orgScope(), { bid: 3, notUsed: false })).toEqual({ ok: true })
          const back = await loadIntegrationView(orgScope(), services())
          expect(back.tillVenues.find((row) => row.key === 3)?.state).toBe('unlinked')
          expect((await integrationRows())[0]?.config.not_used).toEqual({})
        })

        it('refuses a venue that serves a venue, and one that does not exist', async () => {
          expect(await markTillVenue(orgScope(), { bid: 1, notUsed: true })).toEqual({
            ok: false,
            error: 'till_venue_linked',
          })
          expect(await markTillVenue(orgScope(), { bid: 99, notUsed: true })).toEqual({
            ok: false,
            error: 'not_found',
          })
          expect((await integrationRows())[0]?.config.not_used).toEqual({})
        })

        it('linking a venue that was set aside takes the mark off', async () => {
          await markTillVenue(orgScope(), { bid: 3, notUsed: true })
          expect(await linkTillVenue(orgScope(), { bid: 3, venueId: venueB.id })).toEqual({
            ok: true,
          })
          const view = await loadIntegrationView(orgScope(), services())
          expect(view.tillVenues.find((row) => row.key === 3)).toMatchObject({
            state: 'linked',
            venue: { id: venueB.id },
          })
          expect((await integrationRows())[0]?.config.not_used).toEqual({})
          await owner.query(
            'update restro.barsy_venues set venue_id = null where tenant_id = $1 and bid = 3',
            [tenant],
          )
        })
      })

      describe('"Add as venue"', () => {
        it('creates exactly one venue and one link, named after the till venue, and answers with it', async () => {
          const before = await venueCount()
          const result = await addTillVenueAsVenue(orgScope(), { bid: 4 })
          expect(result).toMatchObject({ ok: true, venueId: expect.stringMatching(/^vn_/) })
          if (!result.ok || !result.venueId) return
          expect(await venueCount()).toBe(before + 1)

          const [venue] = await withTenant(app, tenant, (tx) =>
            tx
              .select()
              .from(venues)
              .where(eq(venues.id, result.venueId as string)),
          )
          expect(venue).toMatchObject({
            name: 'Catering',
            slug: 'catering',
            timezone: 'Europe/Sofia',
            currency: 'EUR',
            defaultLocale: 'bg_BG',
            enabledLocales: ['bg_BG', 'en_US'],
          })
          expect(venue?.publicId).toMatch(/^[a-z0-9]{12}$/)
          expect((await linkOf(4))?.venueId).toBe(result.venueId)
          const { rows: menus } = await owner.query(
            'select id from restro.menus where venue_id = $1',
            [result.venueId],
          )
          expect(menus).toHaveLength(1)

          // The new venue's card is ready for the category.
          const card = linked(
            await loadMenuSourceView(
              venueScope({ id: venue?.id ?? '', name: 'Catering', timezone: 'Europe/Sofia' }),
            ),
          )
          expect(card).toMatchObject({ tillVenueName: 'Catering', rootCatId: null })
        })

        it('makes no second venue for a till venue that has one already', async () => {
          const before = await venueCount()
          expect(await addTillVenueAsVenue(orgScope(), { bid: 4 })).toEqual({
            ok: false,
            error: 'till_venue_taken',
          })
          expect(await addTillVenueAsVenue(orgScope(), { bid: 1 })).toEqual({
            ok: false,
            error: 'till_venue_taken',
          })
          expect(await venueCount()).toBe(before)
        })

        it('is for owners and admins, needs a till venue that exists, and makes nothing otherwise', async () => {
          const before = await venueCount()
          expect(await addTillVenueAsVenue(orgScope({ canManage: false }), { bid: 3 })).toEqual({
            ok: false,
            error: 'not_allowed',
          })
          expect(await addTillVenueAsVenue(orgScope(), { bid: 99 })).toEqual({
            ok: false,
            error: 'not_found',
          })
          expect(await venueCount()).toBe(before)
          expect((await linkOf(3))?.venueId).toBeNull()
        })

        it('gives a name made of letters the address cannot use a generic one, and still works', async () => {
          await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 5, name: '日本の店' }])
          const result = await addTillVenueAsVenue(orgScope(), { bid: 5 })
          expect(result.ok).toBe(true)
          const [venue] = await withTenant(app, tenant, (tx) =>
            tx.select().from(venues).where(eq(venues.name, '日本の店')),
          )
          expect(venue?.slug).toBe('venue')
        })

        it('"Add as venue" of a till venue that was set aside takes the mark off', async () => {
          await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 6, name: 'Bakery' }])
          await markTillVenue(orgScope(), { bid: 6, notUsed: true })
          expect(await addTillVenueAsVenue(orgScope(), { bid: 6 })).toMatchObject({ ok: true })
          expect((await integrationRows())[0]?.config.not_used).toEqual({})
        })
      })

      it('saves how the data is read and shows it back (no price: it is the venue’s)', async () => {
        const before = await loadIntegrationView(orgScope(), services())
        expect(before.mapping).toMatchObject({
          allergenKey: null,
          allergenDetected: { key: 'k102', name: 'Алергени' },
          defaultLocale: 'bg_BG',
        })
        expect(before.mapping.allergenOptions.map((option) => option.key)).toEqual(['k102', 'k103'])

        expect(
          await saveMappingSettings(orgScope(), { allergenKey: 'k103', defaultLocale: 'en_US' }),
        ).toEqual({ ok: true })
        const after = await loadIntegrationView(orgScope(), services())
        expect(after.mapping).toMatchObject({ allergenKey: 'k103', defaultLocale: 'en_US' })
        const [row] = await integrationRows()
        expect(row?.config).toMatchObject({ allergen_detail_key: 'k103', default_locale: 'en_US' })
        // The price is not the integration's any more: nothing here wrote it.
        expect(row?.config).not.toHaveProperty('price_source')

        // Automatic again: the key goes away, the rest stays.
        await saveMappingSettings(orgScope(), { allergenKey: null, defaultLocale: 'bg_BG' })
        const [auto] = await integrationRows()
        expect(auto?.config).not.toHaveProperty('allergen_detail_key')
        expect(auto?.config).toHaveProperty('catalogue_trees')
      })

      it('refuses settings that are not valid or not allowed', async () => {
        const valid = { allergenKey: null, defaultLocale: 'bg_BG' }
        expect(await saveMappingSettings(orgScope({ canManage: false }), valid)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await saveMappingSettings(orgScope(), { ...valid, allergenKey: 'k999' })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(await saveMappingSettings(orgScope(), { ...valid, defaultLocale: 'xx_XX' })).toEqual(
          {
            ok: false,
            error: 'invalid',
          },
        )
      })

      describe('the price of a venue (D73)', () => {
        it('is written on that venue’s link only, and shown back', async () => {
          expect(linked(await loadMenuSourceView(venueScope(venueA))).priceSource).toBe(
            'actual_price',
          )
          expect(
            await saveVenuePrice(venueScope(venueA), { priceSource: 'current_price' }),
          ).toEqual({ ok: true })
          expect(linked(await loadMenuSourceView(venueScope(venueA))).priceSource).toBe(
            'current_price',
          )
          const { rows } = await owner.query<{ bid: number; price_source: string | null }>(
            'select bid, price_source from restro.barsy_venues where tenant_id = $1 order by bid',
            [tenant],
          )
          expect(rows.find((link) => link.bid === 1)?.price_source).toBe('current_price')
          expect(
            rows.filter((link) => link.bid !== 1).every((link) => link.price_source === null),
          ).toBe(true)
          // Not the integration's: its config is not touched.
          expect((await integrationRows())[0]?.config).not.toHaveProperty('price_source')
          await saveVenuePrice(venueScope(venueA), { priceSource: 'actual_price' })
        })

        it('falls back to the integration’s old default until the venue saves its own', async () => {
          await updateIntegration(app, tenant, integrationId, {
            config: { price_source: 'current_price' },
          })
          expect(linked(await loadMenuSourceView(venueScope(venueA))).priceSource).toBe(
            'actual_price',
          )
          await owner.query(
            'update restro.barsy_venues set price_source = null where tenant_id = $1 and bid = 1',
            [tenant],
          )
          expect(linked(await loadMenuSourceView(venueScope(venueA))).priceSource).toBe(
            'current_price',
          )
          await updateIntegration(app, tenant, integrationId, { config: { price_source: null } })
        })

        it('is refused for someone who may not manage, a venue with no link and a price that is not one', async () => {
          expect(
            await saveVenuePrice(venueScope(venueA, { canManage: false }), {
              priceSource: 'current_price',
            }),
          ).toEqual({ ok: false, error: 'not_allowed' })
          expect(
            await saveVenuePrice(venueScope(venueB), { priceSource: 'current_price' }),
          ).toEqual({
            ok: false,
            error: 'not_ready',
          })
          expect(
            await saveVenuePrice(venueScope(venueA), { priceSource: 'cost_price' as never }),
          ).toEqual({ ok: false, error: 'invalid' })
        })
      })

      it('reads the last sync time of a venue from the sync state', async () => {
        await updateSyncState(app, tenant, integrationId, 1, {
          last_full_pull_at: '2026-10-09T09:00:00.000Z',
          last_incremental_at: '2026-10-09T09:30:00.000Z',
        })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).lastSyncedAt).toBe(
          '2026-10-09T09:30:00.000Z',
        )
      })

      describe('the automatic sync (D59, D73)', () => {
        const DEFAULTS = {
          schedule: {
            incremental_enabled: true,
            incremental_minutes: 5,
            full_pull_enabled: true,
            full_pull_time: '12:00',
          },
        } as const
        // 12:07:20 in Sofia (summer time).
        const NOW = new Date('2026-10-10T09:07:20Z')
        const configOf = async () => (await integrationRows())[0]?.config ?? {}

        afterEach(async () => {
          // Back to a clean slate for the next test: no settings, no planned-run marks.
          await owner.query(
            `update restro.integrations set config = config - 'schedule' - 'publish' - 'publish_after_sync'
           where tenant_id = $1`,
            [tenant],
          )
          await owner.query(
            `update restro.integrations set config = jsonb_set(config, '{sync,1}', (config #> '{sync,1}')
             - 'last_incremental_queued_at' - 'last_full_pull_slot')
           where tenant_id = $1 and config #> '{sync,1}' is not null`,
            [tenant],
          )
        })

        it('shows the defaults and when the next syncs are planned, in the integration’s clock', async () => {
          const view = await loadIntegrationView(orgScope(), services(), NOW)
          expect(view.syncSettings).toMatchObject({
            incrementalEnabled: true,
            incrementalMinutes: 5,
            fullPullEnabled: true,
            fullPullTime: '12:00',
            scheduleActive: true,
          })
          expect(view.timeZone).toBe('Europe/Sofia')
          // Both are overdue (the last runs are from yesterday): they start at the next tick.
          expect(view.syncSettings.nextIncrementalAt).toBe('2026-10-10T09:08:00.000Z')
          expect(view.syncSettings.nextFullPullAt).toBe('2026-10-10T09:08:00.000Z')

          // After the tick queued them: five minutes on, and tomorrow's noon (09:00 UTC).
          await updateSyncState(app, tenant, integrationId, 1, {
            last_incremental_queued_at: '2026-10-10T09:05:00.200Z',
            last_full_pull_slot: '2026-10-10T09:00:00.000Z',
          })
          const planned = (await loadIntegrationView(orgScope(), services(), NOW)).syncSettings
          expect(planned.nextIncrementalAt).toBe('2026-10-10T09:10:00.000Z')
          expect(planned.nextFullPullAt).toBe('2026-10-11T09:00:00.000Z')
        })

        it('names the integration’s own time zone when it has one', async () => {
          await updateIntegration(app, tenant, integrationId, {
            config: { schedule: { time_zone: 'Europe/London' } },
          })
          expect((await loadIntegrationView(orgScope(), services(), NOW)).timeZone).toBe(
            'Europe/London',
          )
        })

        it('names no times for what is switched off, or while nothing is scheduled', async () => {
          await saveSyncSettings(orgScope(), {
            schedule: {
              ...DEFAULTS.schedule,
              incremental_enabled: false,
              full_pull_enabled: false,
            },
          })
          const off = (await loadIntegrationView(orgScope(), services(), NOW)).syncSettings
          expect(off).toMatchObject({
            incrementalEnabled: false,
            fullPullEnabled: false,
            scheduleActive: true,
            nextIncrementalAt: null,
            nextFullPullAt: null,
          })
          // No linked venue has a category: the worker's tick would skip them all.
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = null where tenant_id = $1',
            [tenant],
          )
          const idle = (await loadIntegrationView(orgScope(), services(), NOW)).syncSettings
          expect(idle).toMatchObject({
            scheduleActive: false,
            nextIncrementalAt: null,
            nextFullPullAt: null,
          })
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = 1171 where tenant_id = $1 and bid = 1',
            [tenant],
          )
        })

        it('plans the earliest of the venues’ runs', async () => {
          // Venue B takes the Roof and its own category, and is slower than A.
          await chooseTillVenue(venueScope(venueB), { bid: 2 })
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = 1171 where tenant_id = $1 and bid = 2',
            [tenant],
          )
          await updateSyncState(app, tenant, integrationId, 1, {
            last_incremental_queued_at: '2026-10-10T09:05:00.200Z',
            last_full_pull_slot: '2026-10-10T09:00:00.000Z',
          })
          await updateSyncState(app, tenant, integrationId, 2, {
            last_incremental_queued_at: '2026-10-10T09:06:00.200Z',
            last_full_pull_slot: '2026-10-10T09:00:00.000Z',
          })
          const planned = (await loadIntegrationView(orgScope(), services(), NOW)).syncSettings
          expect(planned.nextIncrementalAt).toBe('2026-10-10T09:10:00.000Z')
          await owner.query(
            'update restro.barsy_venues set venue_id = null, catalogue_root_cat_id = null where tenant_id = $1 and bid = 2',
            [tenant],
          )
        })

        it('saves the schedule whole, shows it back, and leaves the old publishing rule alone', async () => {
          await updateIntegration(app, tenant, integrationId, {
            config: {
              publish_after_sync: false,
              publish: { after_sync: 'manual', new_items: 'hold' },
            },
          })
          const input = {
            schedule: {
              incremental_enabled: false,
              incremental_minutes: 15,
              full_pull_enabled: true,
              full_pull_time: '03:30',
            },
          } as const
          expect(await saveSyncSettings(orgScope(), input)).toEqual({ ok: true })

          const view = await loadIntegrationView(orgScope(), services(), NOW)
          expect(view.syncSettings).toMatchObject({
            incrementalEnabled: false,
            incrementalMinutes: 15,
            fullPullEnabled: true,
            fullPullTime: '03:30',
          })
          const config = await configOf()
          expect(config).toMatchObject(input)
          // The publishing rules are the venues' now: what a venue inherits stays as it was.
          expect(config).toMatchObject({
            publish_after_sync: false,
            publish: { after_sync: 'manual', new_items: 'hold' },
          })
          expect(config).toHaveProperty('catalogue_trees')
          expect(config).toHaveProperty('sync')
          expect(parseSyncSettings(config).schedule).toEqual(input.schedule)
          await updateIntegration(app, tenant, integrationId, {
            config: { publish_after_sync: null, publish: null },
          })
        })

        it('keeps the pause a return to an older version set (the form does not own it)', async () => {
          await setAutoPublishPaused(app, tenant, integrationId, true)
          expect(await saveSyncSettings(orgScope(), DEFAULTS)).toEqual({ ok: true })
          expect(autoPublishPaused(await configOf())).toBe(true)
          expect(parseSyncSettings(await configOf()).schedule).toEqual(DEFAULTS.schedule)
          await setAutoPublishPaused(app, tenant, integrationId, false)
          expect(await saveSyncSettings(orgScope(), DEFAULTS)).toEqual({ ok: true })
          expect(autoPublishPaused(await configOf())).toBe(false)
        })

        it('a pause set after the form was loaded is still set after the save (S3-10)', async () => {
          await setAutoPublishPaused(app, tenant, integrationId, false)
          await loadIntegrationView(orgScope(), services(), NOW) // the form is open ...
          await setAutoPublishPaused(app, tenant, integrationId, true) // ... a return to an older version lands
          const input = { schedule: { ...DEFAULTS.schedule, incremental_minutes: 10 } } as const
          expect(await saveSyncSettings(orgScope(), input)).toEqual({ ok: true })
          expect(autoPublishPaused(await configOf())).toBe(true)
          expect(parseSyncSettings(await configOf()).schedule).toEqual(input.schedule)
          await setAutoPublishPaused(app, tenant, integrationId, false)
        })

        it('a pause cleared after the form was loaded is still cleared after the save (S3-10)', async () => {
          await setAutoPublishPaused(app, tenant, integrationId, true)
          await loadIntegrationView(orgScope(), services(), NOW) // the form is open ...
          await setAutoPublishPaused(app, tenant, integrationId, false) // ... a manual publish resumes
          expect(await saveSyncSettings(orgScope(), DEFAULTS)).toEqual({ ok: true })
          expect(autoPublishPaused(await configOf())).toBe(false)
        })

        it('puts the defaults back when they are saved again', async () => {
          await saveSyncSettings(orgScope(), {
            schedule: { ...DEFAULTS.schedule, incremental_minutes: 30 },
          })
          expect(await saveSyncSettings(orgScope(), DEFAULTS)).toEqual({ ok: true })
          expect(parseSyncSettings(await configOf()).schedule).toEqual(DEFAULTS.schedule)
        })

        it('is for owners and admins only, and refuses anything outside the lists', async () => {
          expect(await saveSyncSettings(orgScope({ canManage: false }), DEFAULTS)).toEqual({
            ok: false,
            error: 'not_allowed',
          })
          const invalid = (patch: Record<string, unknown>) =>
            saveSyncSettings(orgScope(), { ...DEFAULTS, ...patch } as never)
          for (const patch of [
            { schedule: { ...DEFAULTS.schedule, incremental_minutes: 7 } },
            { schedule: { ...DEFAULTS.schedule, incremental_minutes: '5' } },
            { schedule: { ...DEFAULTS.schedule, full_pull_time: '24:00' } },
            { schedule: { ...DEFAULTS.schedule, full_pull_time: '9:00' } },
            { schedule: { ...DEFAULTS.schedule, incremental_enabled: 'yes' } },
            { schedule: { incremental_minutes: 5 } },
            // The publishing rules are per venue: this form takes none.
            { publish: { after_sync: 'auto', new_items: 'show' } },
            { extra: true },
          ]) {
            expect(await invalid(patch), JSON.stringify(patch)).toEqual({
              ok: false,
              error: 'invalid',
            })
          }
          // Nothing was written by any of them.
          expect(await configOf()).not.toHaveProperty('schedule')
          expect(await configOf()).not.toHaveProperty('publish')
        })
      })

      describe('"Sync everything now"', () => {
        it('queues a full pull of every linked venue that has a menu category, and no other', async () => {
          // A has its category; the new Catering venue is linked without one.
          expect(await syncAll(orgScope({ canManage: false }), services())).toEqual({
            ok: false,
            error: 'not_allowed',
          })
          expect(sent).toEqual([])
          expect(await syncAll(orgScope(), services())).toEqual({ ok: true, pulls: 1 })
          expect(sent).toEqual([
            {
              name: JOB_NAMES.barsyFullPull,
              data: { tenantId: tenant, integrationId, venueId: venueA.id },
            },
          ])
        })

        it('queues one per venue when several are ready, in the order of the list', async () => {
          const catering = await linkOf(4)
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = 1171 where tenant_id = $1 and bid = 4',
            [tenant],
          )
          expect(await syncAll(orgScope(), services())).toEqual({ ok: true, pulls: 2 })
          expect(sent.map((job) => (job.data as { venueId: string }).venueId).sort()).toEqual(
            [venueA.id, catering?.venueId ?? ''].sort(),
          )
          expect(new Set(sent.map((job) => job.name))).toEqual(new Set([JOB_NAMES.barsyFullPull]))
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = null where tenant_id = $1 and bid = 4',
            [tenant],
          )
        })

        it('says so when every pull is waiting already, and when the queue is down', async () => {
          enqueueResult = null
          expect(await syncAll(orgScope(), services())).toEqual({
            ok: false,
            error: 'already_running',
          })
          enqueueFails = true
          expect(await syncAll(orgScope(), services())).toEqual({
            ok: false,
            error: 'queue_unavailable',
          })
        })

        it('is closed when no linked venue has a category, and when the connection does not work', async () => {
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = null where tenant_id = $1 and bid = 1',
            [tenant],
          )
          expect(await syncAll(orgScope(), services())).toEqual({ ok: false, error: 'not_ready' })
          expect((await loadIntegrationView(orgScope(), services())).gate).toEqual({
            enabled: false,
            reason: 'no_root',
          })
          await owner.query(
            'update restro.barsy_venues set catalogue_root_cat_id = 1171 where tenant_id = $1 and bid = 1',
            [tenant],
          )
          await updateIntegration(app, tenant, integrationId, {
            status: 'error',
            statusDetail: 'x',
          })
          expect(await syncAll(orgScope(), services())).toEqual({ ok: false, error: 'not_ready' })
          expect((await loadIntegrationView(orgScope(), services())).gate).toEqual({
            enabled: false,
            reason: 'not_connected',
          })
          await updateIntegration(app, tenant, integrationId, { status: 'connected' })
        })
      })

      it('"Sync this venue" queues a full pull of that venue only when its gate is open', async () => {
        expect(await syncNow(venueScope(venueA, { canManage: false }), services())).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        // Venue B has no till venue.
        expect(await syncNow(venueScope(venueB), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(sent).toEqual([])

        expect(await syncNow(venueScope(venueA), services())).toEqual({ ok: true })
        expect(sent).toEqual([
          {
            name: JOB_NAMES.barsyFullPull,
            data: { tenantId: tenant, integrationId, venueId: venueA.id },
          },
        ])
      })

      it('"Sync this venue" says so when a pull is already waiting, and when the queue is down', async () => {
        enqueueResult = null
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'already_running',
        })
        enqueueFails = true
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
      })

      it('"Sync this venue" is closed again when the integration is not connected', async () => {
        await updateIntegration(app, tenant, integrationId, { status: 'error', statusDetail: 'x' })
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).gate).toEqual({
          enabled: false,
          reason: 'not_connected',
        })
        await updateIntegration(app, tenant, integrationId, { status: 'connected' })
      })

      it('"Check again" queues the connection check for managers only', async () => {
        expect(await checkConnection(orgScope({ canManage: false }), services())).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await checkConnection(orgScope(), services())).toEqual({ ok: true, queued: true })
        expect(sent.at(-1)).toEqual({
          name: JOB_NAMES.barsyConnect,
          data: { tenantId: tenant, integrationId },
        })
        enqueueFails = true
        expect(await checkConnection(orgScope(), services())).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
      })

      it('another organisation sees none of this, and cannot change any of it', async () => {
        const foreign = orgScope({ tenantId: otherTenant })
        const foreignVenueScope = venueScope(foreignVenue, { tenantId: otherTenant })
        const view = await loadIntegrationView(foreign, services())
        expect(view.integration).toBeNull()
        expect(view.tillVenues).toEqual([])
        expect(view.linkableVenues.map((venue) => venue.name)).toEqual(['Foreign'])
        expect(view.runs).toEqual([])
        expect(await loadMenuSourceView(foreignVenueScope)).toEqual({
          state: 'no_integration',
          canManage: true,
        })
        expect(await linkTillVenue(foreign, { bid: 2, venueId: foreignVenue.id })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await addTillVenueAsVenue(foreign, { bid: 2 })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await markTillVenue(foreign, { bid: 2, notUsed: true })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await chooseTillVenue(foreignVenueScope, { bid: 2 })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await chooseCatalogueRoot(foreignVenueScope, { catId: 1171 })).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await saveVenuePrice(foreignVenueScope, { priceSource: 'current_price' })).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await syncNow(foreignVenueScope, services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await syncAll(foreign, services())).toEqual({ ok: false, error: 'not_ready' })
        expect(
          await saveMappingSettings(foreign, { allergenKey: null, defaultLocale: 'bg_BG' }),
        ).toEqual({ ok: false, error: 'not_found' })
        expect(
          await saveSyncSettings(foreign, {
            schedule: {
              incremental_enabled: true,
              incremental_minutes: 5,
              full_pull_enabled: true,
              full_pull_time: '12:00',
            },
          }),
        ).toEqual({ ok: false, error: 'not_found' })
        // Their own save creates their own integration; ours is untouched.
        const saved = await saveConnection(foreign, services(), {
          ...connection,
          host: 'other.barsyonline.com',
        })
        expect(saved).toEqual({ ok: true, queued: true })
        const mine = (await integrationRows()).map((row) => row.host)
        expect(mine).toEqual(['club.barsyonline.com'])
      })
    })

    describe('changing the host', () => {
      it('is a new installation: status new, caches, marks and choices forgotten, credentials sealed again', async () => {
        await markTillVenue(orgScope(), { bid: 3, notUsed: true })
        const [before] = await integrationRows()
        expect(before?.config).toHaveProperty('not_used')
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          host: 'https://second.barsyonline.com',
        })
        expect(result).toEqual({ ok: true, queued: true })

        const [after] = await integrationRows()
        expect(after).toMatchObject({
          id: before?.id,
          host: 'second.barsyonline.com',
          status: 'new',
        })
        expect(after?.credentials_sealed).not.toBe(before?.credentials_sealed)
        expect(after?.config).not.toHaveProperty('catalogue_trees')
        expect(after?.config).not.toHaveProperty('sync')
        expect(after?.config).not.toHaveProperty('not_used')
        // The settings the manager chose for the integration are not about the host: they stay.
        expect(after?.config).toHaveProperty('default_locale')
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.tillVenues.every((row) => row.venue === null)).toBe(true)
        expect(view.gate).toEqual({ enabled: false, reason: 'not_connected' })
        expect(await loadMenuSourceView(venueScope(venueA))).toMatchObject({ state: 'unlinked' })
      })

      it('refuses a host another integration of the organisation already uses', async () => {
        await owner.query(
          `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'taken.barsyonline.com')`,
          [newId('in'), tenant],
        )
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          host: 'taken.barsyonline.com',
        })
        expect(result).toEqual({ ok: false, error: 'host_in_use' })
        const hosts = (await integrationRows()).map((row) => row.host).sort()
        expect(hosts).toEqual(['second.barsyonline.com', 'taken.barsyonline.com'])
      })
    })

    describe('the run history', () => {
      const secondIntegration = async () =>
        (await integrationRows()).find((row) => row.host === 'second.barsyonline.com')?.id ?? ''

      it('lists the latest runs of the integration, newest first, without photo downloads', async () => {
        const integrationId = await secondIntegration()
        // 25 photo downloads, then a connection check, then a pull with refusals.
        for (let i = 0; i < 25; i += 1) {
          const photo = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId })
          await finishJobRun(app, tenant, photo.id, { status: 'completed' })
        }
        const check = await startJobRun(app, tenant, { kind: 'barsy_connect', integrationId })
        await finishJobRun(app, tenant, check.id, { status: 'completed', counters: { venues: 2 } })
        const pull = await startJobRun(app, tenant, {
          kind: 'barsy_full_pull',
          integrationId,
          venueId: venueA.id,
        })
        await finishJobRun(app, tenant, pull.id, {
          status: 'completed',
          counters: { articles_seen: 58, created: 58, failed_pages: 1 },
          summary: 'deletion check skipped: 1 of 3 pages failed',
          venueId: venueA.id,
          refused: [
            {
              opIndex: 1,
              code: 'less_cautious',
              reason: 'would put the item back on sale',
              nodeRef: 'nd_0123456789ABCDEFGHIJKL',
              fieldKey: 'for_sale',
            },
          ],
        })
        const legacy = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
        // A run recorded before details existed: text only.
        await owner.query(
          `update restro.job_runs set status = 'failed', error_summary = 'barsy refused the credentials', finished_at = now(), details = null where id = $1`,
          [legacy.id],
        )

        const view = await loadIntegrationView(orgScope(), services())
        expect(view.runs.length).toBeLessThanOrEqual(HISTORY_LENGTH)
        expect(view.runs.map((run) => run.kind)).toEqual([
          'barsy_incremental',
          'barsy_full_pull',
          'barsy_connect',
        ])
        const [legacyRun, pullRun, checkRun] = view.runs
        expect(legacyRun).toMatchObject({
          status: 'failed',
          errorSummary: 'barsy refused the credentials',
          details: null,
          venue: null,
        })
        expect(pullRun).toMatchObject({
          status: 'completed',
          // The venue column: the run knows the venue it was for, by name.
          venue: { id: venueA.id, name: 'Venue A' },
          counters: { articles_seen: 58, created: 58, failed_pages: 1, refused_writes: 1 },
          details: {
            notes: ['deletion check skipped: 1 of 3 pages failed'],
            refused: [{ fieldKey: 'for_sale', code: 'less_cautious' }],
          },
        })
        expect(checkRun?.counters).toEqual({ venues: 2 })
        expect(checkRun?.venue).toBeNull()
        // No node id and no till id reaches the view.
        expect(JSON.stringify(view.runs)).not.toContain('nd_')
      })

      it('shows the runs of every venue together, each with its own', async () => {
        const integrationId = await secondIntegration()
        for (const venue of [venueB, venueA]) {
          const run = await startJobRun(app, tenant, {
            kind: 'barsy_incremental',
            integrationId,
            venueId: venue.id,
          })
          await finishJobRun(app, tenant, run.id, { status: 'completed', venueId: venue.id })
        }
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.runs.slice(0, 2).map((run) => run.venue?.name)).toEqual(['Venue A', 'Venue B'])
      })

      it('shows only the latest twenty', async () => {
        const integrationId = await secondIntegration()
        for (let i = 0; i < 25; i += 1) {
          const run = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
          await finishJobRun(app, tenant, run.id, { status: 'completed' })
        }
        const view = await loadIntegrationView(orgScope(), services())
        expect(view.runs).toHaveLength(HISTORY_LENGTH)
      })

      describe('a held full sync (CF-02), per venue', () => {
        const fullPull = async (
          venue: { id: string } | null,
          finish: Parameters<typeof finishJobRun>[3],
        ): Promise<void> => {
          const integrationId = await secondIntegration()
          const pull = await startJobRun(app, tenant, {
            kind: 'barsy_full_pull',
            integrationId,
            ...(venue ? { venueId: venue.id } : {}),
          })
          await finishJobRun(app, tenant, pull.id, {
            ...finish,
            ...(venue ? { venueId: venue.id } : {}),
          })
        }
        const heldViews = async () => (await loadIntegrationView(orgScope(), services())).heldSyncs
        const linkVenueToSecond = async () => {
          // Venue A serves a till venue of the second installation, as the warning needs a link to name.
          const integrationId = await secondIntegration()
          await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 1, name: 'Main bar' }])
          await chooseTillVenue(venueScope(venueA), { bid: 1 })
        }

        it('is not held when no full pull read everything (the one so far skipped a failed page)', async () => {
          expect(await heldViews()).toEqual([])
        })

        it('carries the held conclusion of a complete full pull into the run and the warning, naming the venue', async () => {
          await linkVenueToSecond()
          await fullPull(venueA, {
            status: 'completed',
            counters: { articles_seen: 4, failed_pages: 0, missing: 0 },
            deletionCheckSkipped: true,
            absenceHeld: { reason: 'too_many_missing', wouldHide: 61, active: 65 },
            summary: 'deletion check skipped: the read would have hidden 61 of 65 items',
          })
          const view = await loadIntegrationView(orgScope(), services())
          expect(view.heldSyncs).toHaveLength(1)
          expect(view.heldSyncs[0]).toMatchObject({
            reason: 'too_many_missing',
            wouldHide: 61,
            active: 65,
            venue: { id: venueA.id, name: 'Venue A' },
          })
          expect(view.heldSyncs[0]?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
          expect(view.runs[0]?.details?.absenceHeld).toEqual({
            reason: 'too_many_missing',
            wouldHide: 61,
            active: 65,
          })
          // A run that held nothing has no such field.
          expect(view.runs.slice(1).every((run) => run.details?.absenceHeld === undefined)).toBe(
            true,
          )
          // The venue's own card shows it too; another venue's does not.
          expect(linked(await loadMenuSourceView(venueScope(venueA))).heldSync).toMatchObject({
            reason: 'too_many_missing',
            wouldHide: 61,
          })
        })

        it('stays after more than twenty later runs have pushed the held run out of the history', async () => {
          const integrationId = await secondIntegration()
          for (let i = 0; i < 25; i += 1) {
            const run = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
            await finishJobRun(app, tenant, run.id, { status: 'completed' })
          }
          const view = await loadIntegrationView(orgScope(), services())
          expect(view.runs).toHaveLength(HISTORY_LENGTH)
          expect(view.runs.some((run) => run.details?.absenceHeld !== undefined)).toBe(false)
          expect(view.heldSyncs).toHaveLength(1)
          expect(view.heldSyncs[0]).toMatchObject({ reason: 'too_many_missing', wouldHide: 61 })
        })

        it('is not changed by a later full pull that read nothing conclusive: a failed page, or one queued again', async () => {
          await fullPull(venueA, {
            status: 'completed',
            counters: { articles_seen: 30, failed_pages: 2 },
            deletionCheckSkipped: true,
          })
          // A full pull that found another pull running and queued itself again records no counters.
          await fullPull(venueA, {
            status: 'completed',
            notes: ['another pull is running; this full pull was queued again to start in 60 s'],
          })
          // A failed run says nothing either.
          await fullPull(venueA, { status: 'failed', summary: 'timeout' })
          expect((await heldViews())[0]).toMatchObject({
            reason: 'too_many_missing',
            wouldHide: 61,
          })
        })

        it('holds are per venue: another venue’s clean pull does not clear this one’s', async () => {
          await fullPull(venueB, {
            status: 'completed',
            counters: { articles_seen: 65, failed_pages: 0, missing: 0 },
          })
          const held = await heldViews()
          expect(held.map((entry) => entry.venue?.name)).toEqual(['Venue A'])
        })

        it('shows the newest complete full pull of the venue: a new hold replaces the old, a clean one clears it', async () => {
          await fullPull(venueA, {
            status: 'completed',
            counters: { articles_seen: 0, failed_pages: 0 },
            deletionCheckSkipped: true,
            absenceHeld: { reason: 'empty_read', wouldHide: 65, active: 65 },
          })
          expect((await heldViews())[0]).toMatchObject({
            reason: 'empty_read',
            wouldHide: 65,
            active: 65,
          })

          await fullPull(venueA, {
            status: 'completed',
            counters: { articles_seen: 65, failed_pages: 0, missing: 0 },
          })
          expect(await heldViews()).toEqual([])
          expect(linked(await loadMenuSourceView(venueScope(venueA))).heldSync).toBeNull()
        })

        it('an old run that names no venue is read as the only linked venue’s, until a named pull replaces it', async () => {
          await fullPull(null, {
            status: 'completed',
            counters: { articles_seen: 4, failed_pages: 0 },
            absenceHeld: { reason: 'empty_read', wouldHide: 3, active: 3 },
            deletionCheckSkipped: true,
          })
          const shift = (interval: string) =>
            owner.query(
              `update restro.job_runs set created_at = created_at + $2::interval
             where tenant_id = $1 and kind = 'barsy_full_pull' and details ->> 'venue_id' is null
               and details -> 'absence_held' is not null`,
              [tenant, interval],
            )
          // Older than the named pulls above it: old news.
          await shift('-2 hours')
          expect(await heldViews()).toEqual([])
          // Newer than every named pull: it counts, for the only linked venue.
          await shift('4 hours')
          const held = await heldViews()
          expect(held).toHaveLength(1)
          expect(held[0]).toMatchObject({ venue: { name: 'Venue A' }, reason: 'empty_read' })
          await shift('-2 hours')
        })

        it('is not shown for an organisation without an integration', async () => {
          const view = await loadIntegrationView(orgScope({ tenantId: otherTenant }), services())
          expect(view.heldSyncs).toEqual([])
        })
      })

      it('another organisation’s runs are invisible', async () => {
        const view = await loadIntegrationView(orgScope({ tenantId: otherTenant }), services())
        expect(view.runs).toEqual([])
      })
    })

    describe('the password stays out of results and logs', () => {
      it('is in no result, no log line and no stored row, whatever happened', async () => {
        // Every way a save can end, with the password in the input each time (on the current host).
        const here = { ...connection, host: 'https://second.barsyonline.com' }
        const results = [
          await saveConnection(orgScope({ canManage: false }), services(), here),
          await saveConnection(orgScope(), services(), { ...here, host: 'ftp://x' }),
          await saveConnection(orgScope(), services({ sealPublicKey: 'bad' }), here),
          await saveConnection(orgScope(), services(), { ...here, user: '' }),
          await saveConnection(orgScope(), services(), here),
        ]
        enqueueFails = true
        results.push(await saveConnection(orgScope(), services(), here))
        expect(JSON.stringify(results)).not.toContain(PASSWORD)
        expect(logged.join('\n')).not.toContain(PASSWORD)
        expect(logged.join('\n')).not.toContain(API_USER)
        const stored = JSON.stringify(
          (await owner.query('select to_jsonb(i) as j from restro.integrations i')).rows,
        )
        expect(stored).not.toContain(PASSWORD)
      })
    })

    describe('queued and running jobs (a real pg-boss)', () => {
      let boss: PgBoss
      let integrationId = ''

      beforeAll(async () => {
        integrationId =
          (await integrationRows()).find((row) => row.host === 'second.barsyonline.com')?.id ?? ''
        boss = new PgBoss({
          connectionString: appDatabaseUrl(),
          schema: 'pgboss',
          createSchema: false,
          migrate: true,
          supervise: false,
          schedule: false,
          max: 2,
          application_name: 'restro-web-integration-test-queue',
        })
        boss.on('error', () => undefined)
        await boss.start()
        for (const name of [JOB_NAMES.barsyConnect, JOB_NAMES.barsyFullPull]) {
          await boss.createQueue(name, { policy: 'exclusive' })
        }
      }, 60_000)

      afterAll(async () => {
        if (boss) {
          await owner.query(`delete from pgboss.job where data ->> 'tenantId' = $1`, [tenant])
          await boss.stop({ graceful: false })
        }
      })

      it('knows a connection check and a full pull of this integration are waiting', async () => {
        expect(await readActiveJob(app, tenant, integrationId)).toBeNull()

        const connectId = await enqueueJob(
          JOB_NAMES.barsyConnect,
          { tenantId: tenant as never, integrationId: integrationId as never },
          boss,
        )
        expect(connectId).toEqual(expect.any(String))
        expect(await readActiveJob(app, tenant, integrationId)).toBe('connect')

        const pullPayload = {
          tenantId: tenant as never,
          integrationId: integrationId as never,
          venueId: venueA.id as never,
        }
        const pullId = await enqueueJob(JOB_NAMES.barsyFullPull, pullPayload, boss)
        expect(pullId).toEqual(expect.any(String))
        expect(await readActiveJob(app, tenant, integrationId)).toBe('pull')
        // The queue is exclusive per integration and venue: a second press for A is not queued.
        expect(await enqueueJob(JOB_NAMES.barsyFullPull, pullPayload, boss)).toBeNull()

        // Another organisation's view of the same integration id sees nothing.
        expect(await readActiveJob(app, otherTenant, integrationId)).toBeNull()

        await boss.cancel(JOB_NAMES.barsyFullPull, pullId as string)
        expect(await readActiveJob(app, tenant, integrationId)).toBe('connect')
        await boss.cancel(JOB_NAMES.barsyConnect, connectId as string)
        expect(await readActiveJob(app, tenant, integrationId)).toBeNull()
      })

      it('a pull of one venue keeps its own button shut, not another venue’s', async () => {
        const real = services({ enqueue: (name, data) => enqueueJob(name, data, boss) })
        await owner.query(`update restro.integrations set status = 'connected' where id = $1`, [
          integrationId,
        ])
        // Venue A serves till venue 1 of this installation with its category; venue B serves 2.
        await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 2, name: 'Roof' }])
        await chooseTillVenue(venueScope(venueB), { bid: 2 })
        await owner.query(
          `update restro.barsy_venues set catalogue_root_cat_id = 1171 where integration_id = $1 and bid in (1, 2)`,
          [integrationId],
        )
        expect(linked(await loadMenuSourceView(venueScope(venueA))).gate).toEqual({ enabled: true })

        expect(await syncNow(venueScope(venueA), real)).toEqual({ ok: true })
        const cardA = linked(await loadMenuSourceView(venueScope(venueA)))
        expect(cardA.activeJob).toBe('pull')
        expect(cardA.gate).toEqual({ enabled: false, reason: 'busy' })
        // A second press for A is refused by the gate before it reaches the queue.
        expect(await syncNow(venueScope(venueA), real)).toEqual({
          ok: false,
          error: 'already_running',
        })
        // Venue B is not held up by A's pull ...
        const cardB = linked(await loadMenuSourceView(venueScope(venueB)))
        expect(cardB.activeJob).toBeNull()
        expect(cardB.gate).toEqual({ enabled: true })
        // ... but the page shows that something is running, and "Sync everything now" waits for it.
        const view = await loadIntegrationView(orgScope(), real)
        expect(view.activeJob).toBe('pull')
        expect(view.gate).toEqual({ enabled: false, reason: 'busy' })
        expect(await syncAll(orgScope(), real)).toEqual({ ok: false, error: 'already_running' })

        const rows = await owner.query(
          `select name, state, data ->> 'venueId' as venue from pgboss.job
         where data ->> 'integrationId' = $1 and state <> 'cancelled'`,
          [integrationId],
        )
        expect(rows.rows).toEqual([
          { name: JOB_NAMES.barsyFullPull, state: 'created', venue: venueA.id },
        ])

        // Now venue B's press queues its own, and A's is still the one waiting.
        expect(await syncNow(venueScope(venueB), real)).toEqual({ ok: true })
        const both = await owner.query(
          `select data ->> 'venueId' as venue from pgboss.job
         where data ->> 'integrationId' = $1 and state <> 'cancelled' order by venue`,
          [integrationId],
        )
        expect(both.rows.map((row) => row.venue).sort()).toEqual([venueA.id, venueB.id].sort())
      })
    })

    it('the integration table keeps one row per host and is reachable for the owner', async () => {
      const rows = await withTenant(app, tenant, (tx) => tx.select().from(integrations))
      expect(rows.map((row) => row.host).sort()).toEqual([
        'second.barsyonline.com',
        'taken.barsyonline.com',
      ])
    })
  },
)
