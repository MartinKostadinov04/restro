// The Integration tab's service against a real Postgres, as the restro_app role (brief S2-05):
// saving the connection (sealed with a public key generated here, host rules, the password never
// stored, returned or logged), the pickers and their conflicts, the mapping settings, "Sync now"
// and its gate, the run history, who may do what, and another tenant's integration being
// invisible. The queue is a fake except in the last block, which uses a real pg-boss.
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
import { barsyVenues, createPool, type DbPool, integrations, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { enqueueJob } from '../jobs'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import {
  checkConnection,
  chooseBarsyVenue,
  chooseCatalogueRoot,
  HISTORY_LENGTH,
  type IntegrationScope,
  type IntegrationServices,
  loadIntegrationView,
  readActiveJob,
  saveConnection,
  saveMappingSettings,
  saveSyncSettings,
  syncNow,
} from './service'

const keys = generateKeyPairSync('x25519')
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
const PASSWORD = 'correct horse battery staple 8F3kZ'
const API_USER = 'api-user-for-tests'

describe.skipIf(!hasDatabase)('the Integration tab service (as the restro_app role)', () => {
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
  const scopeFor = (
    venue: { id: string; name: string; timezone: string },
    overrides: Partial<IntegrationScope> = {},
  ): IntegrationScope => ({
    pool: app,
    tenantId: tenant,
    venue,
    canManage: true,
    ...overrides,
  })
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

  beforeAll(async () => {
    spies = (['error', 'warn', 'info', 'log'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      }),
    )
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-integration-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Integration tab club' })
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
    it('shows an empty tab, closed Sync now, and whether the sync keys are set up', async () => {
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view).toMatchObject({
        canManage: true,
        sealReady: true,
        integration: null,
        activeJob: null,
        barsyVenues: [],
        tree: null,
        runs: [],
        gate: { enabled: false, reason: 'no_credentials' },
        settings: { priceSource: 'actual_price', defaultLocale: 'bg_BG' },
        // The defaults are what ran before the settings existed; nothing is scheduled yet.
        syncSettings: {
          incrementalEnabled: true,
          incrementalMinutes: 5,
          fullPullEnabled: true,
          fullPullTime: '12:00',
          afterSync: 'auto',
          newItems: 'show',
          scheduleActive: false,
          nextIncrementalAt: null,
          nextFullPullAt: null,
        },
      })
      const without = await loadIntegrationView(scopeFor(venueA), {
        sealPublicKey: undefined,
      } as never)
      expect(without.sealReady).toBe(false)
      const broken = await loadIntegrationView(scopeFor(venueA), {
        sealPublicKey: 'not-a-key',
      } as never)
      expect(broken.sealReady).toBe(false)
    })
  })

  describe('saveConnection', () => {
    it('refuses everyone but owners and admins, and writes nothing', async () => {
      const result = await saveConnection(
        scopeFor(venueA, { canManage: false }),
        services(),
        connection,
      )
      expect(result).toEqual({ ok: false, error: 'not_allowed' })
      expect(await integrationRows()).toEqual([])
      expect(sent).toEqual([])
    })

    it('checks the address, the keys and the credentials before touching anything', async () => {
      const save = (input: Partial<typeof connection>, over?: Partial<IntegrationServices>) =>
        saveConnection(scopeFor(venueA), services(over), { ...connection, ...input })
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
      const result = await saveConnection(scopeFor(venueA), services(), connection)
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
      const view = await loadIntegrationView(scopeFor(venueA), services())
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
      const result = await saveConnection(scopeFor(venueA), services(), connection)
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
      const result = await saveConnection(scopeFor(venueA), services(), connection)
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

    it('lists the barsy venues by name and the connected status', async () => {
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view.integration?.status).toBe('connected')
      expect(view.barsyVenues).toEqual([
        { key: 1, name: 'Main bar', mappedHere: false, usedBy: null },
        { key: 2, name: 'Roof', mappedHere: false, usedBy: null },
      ])
      expect(view.venueMapped).toBe(false)
      expect(view.tree).toBeNull()
      expect(view.gate).toEqual({ enabled: false, reason: 'no_barsy_venue' })
    })

    it('chooses the barsy venue for this venue, and refuses it for another', async () => {
      expect(await chooseBarsyVenue(scopeFor(venueA, { canManage: false }), { bid: 1 })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(await chooseBarsyVenue(scopeFor(venueA), { bid: 1 })).toEqual({ ok: true })
      // One barsy venue per venue: venue B cannot take what venue A has.
      expect(await chooseBarsyVenue(scopeFor(venueB), { bid: 1 })).toEqual({
        ok: false,
        error: 'barsy_venue_taken',
      })
      expect(await chooseBarsyVenue(scopeFor(venueB), { bid: 99 })).toEqual({
        ok: false,
        error: 'not_found',
      })
      const asB = await loadIntegrationView(scopeFor(venueB), services())
      expect(asB.barsyVenues).toContainEqual({
        key: 1,
        name: 'Main bar',
        mappedHere: false,
        usedBy: 'Venue A',
      })
      const asA = await loadIntegrationView(scopeFor(venueA), services())
      expect(asA.venueMapped).toBe(true)
      expect(asA.barsyVenues.find((option) => option.key === 1)?.mappedHere).toBe(true)
      expect(asA.gate).toEqual({ enabled: false, reason: 'no_root' })
    })

    it('shows the cached tree to the venue that owns the barsy venue', async () => {
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view.tree).toEqual([
        {
          id: 1171,
          name: 'Публично меню',
          children: [{ id: 1172, name: 'Коктейли', children: [] }],
        },
        { id: 1091, name: 'Каса Kiosk', children: [] },
      ])
      expect(view.treeFetchedAt).toBe('2026-10-09T10:00:00.000Z')
    })

    it('hints at the public address and menu from the stored record of each venue, and suggests its public category (B1-Q6)', async () => {
      const venueRecord = (bid: number, payload: Record<string, unknown>) => ({
        externalType: 'barsy_venue',
        externalId: String(bid),
        scope: 'master' as const,
        raw: JSON.stringify(payload),
        payload,
      })
      const before = await loadIntegrationView(scopeFor(venueA), services())
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
        const view = await loadIntegrationView(scopeFor(venueA), services())
        expect(view.barsyVenues).toEqual([
          {
            key: 1,
            name: 'Main bar',
            mappedHere: true,
            usedBy: null,
            address: 'Sofia, 108 Vitosha Blvd',
            publicMenuSetUp: true,
          },
          { key: 2, name: 'Roof', mappedHere: false, usedBy: null },
        ])
        // The venue's public category is suggested in its own tree, and nothing else is.
        expect(view.tree).toEqual([
          {
            id: 1171,
            name: 'Публично меню',
            suggested: true,
            children: [{ id: 1172, name: 'Коктейли', children: [] }],
          },
          { id: 1091, name: 'Каса Kiosk', children: [] },
        ])
        // Hints only: what was chosen stays chosen, and no barsy number or field name reaches the view.
        expect(view.rootCatId).toBe(before.rootCatId)
        expect(view.venueMapped).toBe(before.venueMapped)
        expect(JSON.stringify(view)).not.toContain('public_cat_id')
        // Another venue of the organisation sees the hints of the venues, but no tree of this one.
        const asB = await loadIntegrationView(scopeFor(venueB), services())
        expect(asB.tree).toBeNull()
      } finally {
        await owner.query(
          `delete from restro.source_records where tenant_id = $1 and external_type = 'barsy_venue'`,
          [tenant],
        )
      }
      const after = await loadIntegrationView(scopeFor(venueA), services())
      expect(after.barsyVenues).toEqual(before.barsyVenues)
      expect(after.tree).toEqual(before.tree)
    })

    it('chooses the catalogue root only from the cached tree', async () => {
      expect(await chooseCatalogueRoot(scopeFor(venueA), { catId: 5555 })).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(
        await chooseCatalogueRoot(scopeFor(venueA, { canManage: false }), { catId: 1171 }),
      ).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      // Venue B has no barsy venue yet, so it has no tree to choose from.
      expect(await chooseCatalogueRoot(scopeFor(venueB), { catId: 1171 })).toEqual({
        ok: false,
        error: 'not_ready',
      })
      expect(await chooseCatalogueRoot(scopeFor(venueA), { catId: 1171 })).toEqual({ ok: true })
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view.rootCatId).toBe(1171)
      const [row] = await withTenant(app, tenant, (tx) =>
        tx.select().from(barsyVenues).where(eq(barsyVenues.bid, 1)),
      )
      expect(row?.catalogueRootCatId).toBe(1171)
    })

    it('moves a venue to another barsy venue, freeing the first', async () => {
      expect(await chooseBarsyVenue(scopeFor(venueA), { bid: 2 })).toEqual({ ok: true })
      expect(await chooseBarsyVenue(scopeFor(venueB), { bid: 1 })).toEqual({ ok: true })
      expect(await chooseBarsyVenue(scopeFor(venueB), { bid: 2 })).toEqual({
        ok: false,
        error: 'barsy_venue_taken',
      })
      // Put things back for the next tests: A on bid 1 with its root, B on nothing.
      expect(await chooseBarsyVenue(scopeFor(venueB), { bid: 1 })).toEqual({ ok: true })
      await owner.query('update restro.barsy_venues set venue_id = null where tenant_id = $1', [
        tenant,
      ])
      expect(await chooseBarsyVenue(scopeFor(venueA), { bid: 1 })).toEqual({ ok: true })
    })

    it('saves the mapping settings and shows them back', async () => {
      const before = await loadIntegrationView(scopeFor(venueA), services())
      expect(before.settings).toMatchObject({
        priceSource: 'actual_price',
        allergenKey: null,
        allergenDetected: { key: 'k102', name: 'Алергени' },
        defaultLocale: 'bg_BG',
      })
      expect(before.settings.allergenOptions.map((option) => option.key)).toEqual(['k102', 'k103'])

      expect(
        await saveMappingSettings(scopeFor(venueA), {
          priceSource: 'current_price',
          allergenKey: 'k103',
          defaultLocale: 'en_US',
        }),
      ).toEqual({ ok: true })
      const after = await loadIntegrationView(scopeFor(venueA), services())
      expect(after.settings).toMatchObject({
        priceSource: 'current_price',
        allergenKey: 'k103',
        defaultLocale: 'en_US',
      })
      const [row] = await integrationRows()
      expect(row?.config).toMatchObject({
        allergen_detail_key: 'k103',
        default_locale: 'en_US',
      })
      // The price is the setting of this venue's barsy venue (D73, CF-16), not the integration's.
      expect(row?.config).not.toHaveProperty('price_source')
      const { rows: links } = await owner.query<{ bid: number; price_source: string | null }>(
        'select bid, price_source from restro.barsy_venues where tenant_id = $1 order by bid',
        [tenant],
      )
      expect(links.find((link) => link.bid === 1)?.price_source).toBe('current_price')
      expect(links.filter((link) => link.bid !== 1).every((l) => l.price_source === null)).toBe(
        true,
      )

      // Automatic again: the key goes away, the rest stays.
      await saveMappingSettings(scopeFor(venueA), {
        priceSource: 'actual_price',
        allergenKey: null,
        defaultLocale: 'bg_BG',
      })
      const [auto] = await integrationRows()
      expect(auto?.config).not.toHaveProperty('allergen_detail_key')
      expect(auto?.config).toHaveProperty('catalogue_trees')
    })

    it('refuses settings that are not valid or not allowed', async () => {
      const valid = {
        priceSource: 'actual_price',
        allergenKey: null,
        defaultLocale: 'bg_BG',
      } as const
      expect(await saveMappingSettings(scopeFor(venueA, { canManage: false }), valid)).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(
        await saveMappingSettings(scopeFor(venueA), { ...valid, allergenKey: 'k999' }),
      ).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(
        await saveMappingSettings(scopeFor(venueA), { ...valid, defaultLocale: 'xx_XX' }),
      ).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect(
        await saveMappingSettings(scopeFor(venueA), {
          ...valid,
          priceSource: 'cost_price' as never,
        }),
      ).toEqual({ ok: false, error: 'invalid' })
    })

    it('reads the last sync time from the sync state', async () => {
      await updateSyncState(app, tenant, integrationId, 1, {
        last_full_pull_at: '2026-10-09T09:00:00.000Z',
        last_incremental_at: '2026-10-09T09:30:00.000Z',
      })
      expect((await loadIntegrationView(scopeFor(venueA), services())).lastSyncedAt).toBe(
        '2026-10-09T09:30:00.000Z',
      )
    })

    describe('the sync settings (D59)', () => {
      const DEFAULTS = {
        schedule: {
          incremental_enabled: true,
          incremental_minutes: 5,
          full_pull_enabled: true,
          full_pull_time: '12:00',
        },
        publish: { after_sync: 'auto', new_items: 'show' },
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

      it('shows the defaults and when the next syncs are planned, in the venue’s clock', async () => {
        const view = await loadIntegrationView(scopeFor(venueA), services(), NOW)
        expect(view.syncSettings).toMatchObject({
          incrementalEnabled: true,
          incrementalMinutes: 5,
          fullPullEnabled: true,
          fullPullTime: '12:00',
          afterSync: 'auto',
          newItems: 'show',
          scheduleActive: true,
        })
        // Both are overdue (the last runs are from yesterday): they start at the next tick.
        expect(view.syncSettings.nextIncrementalAt).toBe('2026-10-10T09:08:00.000Z')
        expect(view.syncSettings.nextFullPullAt).toBe('2026-10-10T09:08:00.000Z')

        // After the tick queued them: five minutes on, and tomorrow's noon (09:00 UTC).
        await updateSyncState(app, tenant, integrationId, 1, {
          last_incremental_queued_at: '2026-10-10T09:05:00.200Z',
          last_full_pull_slot: '2026-10-10T09:00:00.000Z',
        })
        const planned = (await loadIntegrationView(scopeFor(venueA), services(), NOW)).syncSettings
        expect(planned.nextIncrementalAt).toBe('2026-10-10T09:10:00.000Z')
        expect(planned.nextFullPullAt).toBe('2026-10-11T09:00:00.000Z')
      })

      it('names no times for what is switched off, or while nothing is scheduled', async () => {
        await saveSyncSettings(scopeFor(venueA), {
          ...DEFAULTS,
          schedule: { ...DEFAULTS.schedule, incremental_enabled: false, full_pull_enabled: false },
        })
        const off = (await loadIntegrationView(scopeFor(venueA), services(), NOW)).syncSettings
        expect(off).toMatchObject({
          incrementalEnabled: false,
          fullPullEnabled: false,
          scheduleActive: true,
          nextIncrementalAt: null,
          nextFullPullAt: null,
        })
        // Venue B has no barsy venue: the worker's tick would skip it, so the card names no times.
        const idle = (await loadIntegrationView(scopeFor(venueB), services(), NOW)).syncSettings
        expect(idle).toMatchObject({
          scheduleActive: false,
          nextIncrementalAt: null,
          nextFullPullAt: null,
        })
      })

      it('saves them whole, shows them back, and the worker reads what the card saved', async () => {
        await updateIntegration(app, tenant, integrationId, {
          config: { publish_after_sync: false },
        })
        const input = {
          schedule: {
            incremental_enabled: false,
            incremental_minutes: 15,
            full_pull_enabled: true,
            full_pull_time: '03:30',
          },
          publish: { after_sync: 'manual', new_items: 'hold' },
        } as const
        expect(await saveSyncSettings(scopeFor(venueA), input)).toEqual({ ok: true })

        const view = await loadIntegrationView(scopeFor(venueA), services(), NOW)
        expect(view.syncSettings).toMatchObject({
          incrementalEnabled: false,
          incrementalMinutes: 15,
          fullPullEnabled: true,
          fullPullTime: '03:30',
          afterSync: 'manual',
          newItems: 'hold',
        })
        const config = await configOf()
        expect(config).toMatchObject(input)
        // The old flat key is gone (publish.after_sync says it now); other keys are untouched.
        expect(config).not.toHaveProperty('publish_after_sync')
        expect(config).toHaveProperty('catalogue_trees')
        expect(config).toHaveProperty('sync')
        expect(parseSyncSettings(config)).toEqual(input)
      })

      it('keeps the pause a return to an older version set (the form does not own it)', async () => {
        await setAutoPublishPaused(app, tenant, integrationId, true)
        expect(await saveSyncSettings(scopeFor(venueA), DEFAULTS)).toEqual({ ok: true })
        expect(autoPublishPaused(await configOf())).toBe(true)
        expect(parseSyncSettings(await configOf())).toEqual(DEFAULTS)
        await setAutoPublishPaused(app, tenant, integrationId, false)
        expect(await saveSyncSettings(scopeFor(venueA), DEFAULTS)).toEqual({ ok: true })
        expect(autoPublishPaused(await configOf())).toBe(false)
      })

      it('a pause set after the form was loaded is still set after the save (S3-10)', async () => {
        await setAutoPublishPaused(app, tenant, integrationId, false)
        await loadIntegrationView(scopeFor(venueA), services(), NOW) // the form is open ...
        await setAutoPublishPaused(app, tenant, integrationId, true) // ... a return to an older version lands
        const input = {
          schedule: { ...DEFAULTS.schedule, incremental_minutes: 10 },
          publish: { after_sync: 'manual', new_items: 'hold' },
        } as const
        expect(await saveSyncSettings(scopeFor(venueA), input)).toEqual({ ok: true })
        expect(autoPublishPaused(await configOf())).toBe(true)
        expect(parseSyncSettings(await configOf())).toEqual(input)
        await setAutoPublishPaused(app, tenant, integrationId, false)
      })

      it('a pause cleared after the form was loaded is still cleared after the save (S3-10)', async () => {
        await setAutoPublishPaused(app, tenant, integrationId, true)
        await loadIntegrationView(scopeFor(venueA), services(), NOW) // the form is open ...
        await setAutoPublishPaused(app, tenant, integrationId, false) // ... a manual publish resumes
        expect(await saveSyncSettings(scopeFor(venueA), DEFAULTS)).toEqual({ ok: true })
        expect(autoPublishPaused(await configOf())).toBe(false)
        expect((await configOf())?.publish).toEqual(DEFAULTS.publish)
      })

      it('puts the defaults back when they are saved again', async () => {
        await saveSyncSettings(scopeFor(venueA), {
          schedule: { ...DEFAULTS.schedule, incremental_minutes: 30 },
          publish: { after_sync: 'manual', new_items: 'hold' },
        })
        expect(await saveSyncSettings(scopeFor(venueA), DEFAULTS)).toEqual({ ok: true })
        expect(parseSyncSettings(await configOf())).toEqual(DEFAULTS)
      })

      it('is for owners and admins only, and refuses anything outside the lists', async () => {
        expect(await saveSyncSettings(scopeFor(venueA, { canManage: false }), DEFAULTS)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        const invalid = (patch: Record<string, unknown>) =>
          saveSyncSettings(scopeFor(venueA), { ...DEFAULTS, ...patch } as never)
        for (const patch of [
          { schedule: { ...DEFAULTS.schedule, incremental_minutes: 7 } },
          { schedule: { ...DEFAULTS.schedule, incremental_minutes: '5' } },
          { schedule: { ...DEFAULTS.schedule, full_pull_time: '24:00' } },
          { schedule: { ...DEFAULTS.schedule, full_pull_time: '9:00' } },
          { schedule: { ...DEFAULTS.schedule, incremental_enabled: 'yes' } },
          { schedule: { incremental_minutes: 5 } },
          { publish: { ...DEFAULTS.publish, after_sync: 'later' } },
          { publish: { ...DEFAULTS.publish, new_items: 'hide' } },
          { publish: { after_sync: 'auto' } },
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

    it('"Sync now" queues a full pull of this venue only when the gate is open', async () => {
      expect(await syncNow(scopeFor(venueA, { canManage: false }), services())).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      // Venue B has no barsy venue.
      expect(await syncNow(scopeFor(venueB), services())).toEqual({ ok: false, error: 'not_ready' })
      expect(sent).toEqual([])

      expect(await syncNow(scopeFor(venueA), services())).toEqual({ ok: true })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.barsyFullPull,
          data: { tenantId: tenant, integrationId, venueId: venueA.id },
        },
      ])
    })

    it('"Sync now" says so when a pull is already waiting, and when the queue is down', async () => {
      enqueueResult = null
      expect(await syncNow(scopeFor(venueA), services())).toEqual({
        ok: false,
        error: 'already_running',
      })
      enqueueFails = true
      expect(await syncNow(scopeFor(venueA), services())).toEqual({
        ok: false,
        error: 'queue_unavailable',
      })
    })

    it('is closed again when the integration is not connected', async () => {
      await updateIntegration(app, tenant, integrationId, { status: 'error', statusDetail: 'x' })
      expect(await syncNow(scopeFor(venueA), services())).toEqual({ ok: false, error: 'not_ready' })
      expect((await loadIntegrationView(scopeFor(venueA), services())).gate).toEqual({
        enabled: false,
        reason: 'not_connected',
      })
      await updateIntegration(app, tenant, integrationId, { status: 'connected' })
    })

    it('"Check again" queues the connection check for managers only', async () => {
      expect(await checkConnection(scopeFor(venueA, { canManage: false }), services())).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect(await checkConnection(scopeFor(venueA), services())).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent.at(-1)).toEqual({
        name: JOB_NAMES.barsyConnect,
        data: { tenantId: tenant, integrationId },
      })
      enqueueFails = true
      expect(await checkConnection(scopeFor(venueA), services())).toEqual({
        ok: false,
        error: 'queue_unavailable',
      })
    })

    it('another organisation sees none of this, and cannot change any of it', async () => {
      const foreign = scopeFor(foreignVenue, { tenantId: otherTenant })
      const view = await loadIntegrationView(foreign, services())
      expect(view.integration).toBeNull()
      expect(view.barsyVenues).toEqual([])
      expect(view.runs).toEqual([])
      expect(await chooseBarsyVenue(foreign, { bid: 2 })).toEqual({ ok: false, error: 'not_found' })
      expect(await chooseCatalogueRoot(foreign, { catId: 1171 })).toEqual({
        ok: false,
        error: 'not_ready',
      })
      expect(await syncNow(foreign, services())).toEqual({ ok: false, error: 'not_ready' })
      expect(
        await saveMappingSettings(foreign, {
          priceSource: 'current_price',
          allergenKey: null,
          defaultLocale: 'bg_BG',
        }),
      ).toEqual({ ok: false, error: 'not_found' })
      expect(
        await saveSyncSettings(foreign, {
          schedule: {
            incremental_enabled: true,
            incremental_minutes: 5,
            full_pull_enabled: true,
            full_pull_time: '12:00',
          },
          publish: { after_sync: 'auto', new_items: 'show' },
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
    it('is a new installation: status new, caches and choices forgotten, credentials sealed again', async () => {
      const [before] = await integrationRows()
      const result = await saveConnection(scopeFor(venueA), services(), {
        ...connection,
        host: 'https://second.barsyonline.com',
      })
      expect(result).toEqual({ ok: true, queued: true })

      const [after] = await integrationRows()
      expect(after).toMatchObject({ id: before?.id, host: 'second.barsyonline.com', status: 'new' })
      expect(after?.credentials_sealed).not.toBe(before?.credentials_sealed)
      expect(after?.config).not.toHaveProperty('catalogue_trees')
      expect(after?.config).not.toHaveProperty('sync')
      // The settings the manager chose for the integration are not about the host: they stay.
      expect(after?.config).toHaveProperty('default_locale')
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view.venueMapped).toBe(false)
      expect(view.rootCatId).toBeNull()
      expect(view.tree).toBeNull()
      expect(view.gate).toEqual({ enabled: false, reason: 'not_connected' })
    })

    it('refuses a host another integration of the organisation already uses', async () => {
      await owner.query(
        `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', 'taken.barsyonline.com')`,
        [newId('in'), tenant],
      )
      const result = await saveConnection(scopeFor(venueA), services(), {
        ...connection,
        host: 'taken.barsyonline.com',
      })
      expect(result).toEqual({ ok: false, error: 'host_in_use' })
      const hosts = (await integrationRows()).map((row) => row.host).sort()
      expect(hosts).toEqual(['second.barsyonline.com', 'taken.barsyonline.com'])
    })
  })

  describe('the run history', () => {
    it('lists the latest runs of the integration, newest first, without photo downloads', async () => {
      const integrationId =
        (await integrationRows()).find((row) => row.host === 'second.barsyonline.com')?.id ?? ''
      // 25 photo downloads, then a connection check, then a pull with refusals.
      for (let i = 0; i < 25; i += 1) {
        const photo = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId })
        await finishJobRun(app, tenant, photo.id, { status: 'completed' })
      }
      const check = await startJobRun(app, tenant, { kind: 'barsy_connect', integrationId })
      await finishJobRun(app, tenant, check.id, { status: 'completed', counters: { venues: 2 } })
      const pull = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      await finishJobRun(app, tenant, pull.id, {
        status: 'completed',
        counters: { articles_seen: 58, created: 58, failed_pages: 1 },
        summary: 'deletion check skipped: 1 of 3 pages failed',
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
        `update restro.job_runs set status = 'failed', error_summary = 'barsy refused the credentials', finished_at = now() where id = $1`,
        [legacy.id],
      )

      const view = await loadIntegrationView(scopeFor(venueA), services())
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
      })
      expect(pullRun).toMatchObject({
        status: 'completed',
        counters: { articles_seen: 58, created: 58, failed_pages: 1, refused_writes: 1 },
        details: {
          notes: ['deletion check skipped: 1 of 3 pages failed'],
          refused: [{ fieldKey: 'for_sale', code: 'less_cautious' }],
        },
      })
      expect(checkRun?.counters).toEqual({ venues: 2 })
      // No node id and no barsy id reaches the view.
      expect(JSON.stringify(view.runs)).not.toContain('nd_')
    })

    it('shows only the latest twenty', async () => {
      const integrationId =
        (await integrationRows()).find((row) => row.host === 'second.barsyonline.com')?.id ?? ''
      for (let i = 0; i < 25; i += 1) {
        const run = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
        await finishJobRun(app, tenant, run.id, { status: 'completed' })
      }
      const view = await loadIntegrationView(scopeFor(venueA), services())
      expect(view.runs).toHaveLength(HISTORY_LENGTH)
    })

    describe('a held full sync (CF-02)', () => {
      const secondIntegration = async () =>
        (await integrationRows()).find((row) => row.host === 'second.barsyonline.com')?.id ?? ''
      const fullPull = async (
        integrationId: string,
        finish: Parameters<typeof finishJobRun>[3],
      ): Promise<void> => {
        const pull = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
        await finishJobRun(app, tenant, pull.id, finish)
      }
      const heldView = async () =>
        (await loadIntegrationView(scopeFor(venueA), services())).heldSync

      it('is not held when no full pull read everything (the one so far skipped a failed page)', async () => {
        expect(await heldView()).toBeNull()
      })

      it('carries the held conclusion of a complete full pull into the run and the warning', async () => {
        const integrationId = await secondIntegration()
        await fullPull(integrationId, {
          status: 'completed',
          counters: { articles_seen: 4, failed_pages: 0, missing: 0 },
          deletionCheckSkipped: true,
          absenceHeld: { reason: 'too_many_missing', wouldHide: 61, active: 65 },
          summary: 'deletion check skipped: the read would have hidden 61 of 65 items',
        })
        const view = await loadIntegrationView(scopeFor(venueA), services())
        expect(view.heldSync).toMatchObject({
          reason: 'too_many_missing',
          wouldHide: 61,
          active: 65,
        })
        expect(view.heldSync?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(view.runs[0]?.details?.absenceHeld).toEqual({
          reason: 'too_many_missing',
          wouldHide: 61,
          active: 65,
        })
        // A run that held nothing has no such field.
        expect(view.runs.slice(1).every((run) => run.details?.absenceHeld === undefined)).toBe(true)
      })

      it('stays after more than twenty later runs have pushed the held run out of the history', async () => {
        const integrationId = await secondIntegration()
        for (let i = 0; i < 25; i += 1) {
          const run = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
          await finishJobRun(app, tenant, run.id, { status: 'completed' })
        }
        const view = await loadIntegrationView(scopeFor(venueA), services())
        expect(view.runs).toHaveLength(HISTORY_LENGTH)
        expect(view.runs.some((run) => run.details?.absenceHeld !== undefined)).toBe(false)
        expect(view.heldSync).toMatchObject({ reason: 'too_many_missing', wouldHide: 61 })
      })

      it('is not changed by a later full pull that read nothing conclusive: a failed page, or one queued again', async () => {
        const integrationId = await secondIntegration()
        await fullPull(integrationId, {
          status: 'completed',
          counters: { articles_seen: 30, failed_pages: 2 },
          deletionCheckSkipped: true,
        })
        // A full pull that found another pull running and queued itself again records no counters.
        await fullPull(integrationId, {
          status: 'completed',
          notes: ['another pull is running; this full pull was queued again to start in 60 s'],
        })
        // A failed run says nothing either.
        await fullPull(integrationId, { status: 'failed', summary: 'timeout' })
        expect(await heldView()).toMatchObject({ reason: 'too_many_missing', wouldHide: 61 })
      })

      it('shows the newest complete full pull: a new hold replaces the old, a clean one clears it', async () => {
        const integrationId = await secondIntegration()
        await fullPull(integrationId, {
          status: 'completed',
          counters: { articles_seen: 0, failed_pages: 0 },
          deletionCheckSkipped: true,
          absenceHeld: { reason: 'empty_read', wouldHide: 65, active: 65 },
        })
        expect(await heldView()).toMatchObject({ reason: 'empty_read', wouldHide: 65, active: 65 })

        await fullPull(integrationId, {
          status: 'completed',
          counters: { articles_seen: 65, failed_pages: 0, missing: 0 },
        })
        expect(await heldView()).toBeNull()
      })

      it('is not shown for an organisation without an integration', async () => {
        const view = await loadIntegrationView(
          scopeFor(foreignVenue, { tenantId: otherTenant }),
          services(),
        )
        expect(view.heldSync).toBeNull()
      })
    })

    it('another organisation’s runs are invisible', async () => {
      const view = await loadIntegrationView(
        scopeFor(foreignVenue, { tenantId: otherTenant }),
        services(),
      )
      expect(view.runs).toEqual([])
    })
  })

  describe('the password stays out of results and logs', () => {
    it('is in no result, no log line and no stored row, whatever happened', async () => {
      // Every way a save can end, with the password in the input each time (on the current host).
      const here = { ...connection, host: 'https://second.barsyonline.com' }
      const results = [
        await saveConnection(scopeFor(venueA, { canManage: false }), services(), here),
        await saveConnection(scopeFor(venueA), services(), { ...here, host: 'ftp://x' }),
        await saveConnection(scopeFor(venueA), services({ sealPublicKey: 'bad' }), here),
        await saveConnection(scopeFor(venueA), services(), { ...here, user: '' }),
        await saveConnection(scopeFor(venueA), services(), here),
      ]
      enqueueFails = true
      results.push(await saveConnection(scopeFor(venueA), services(), here))
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
      // The queue is exclusive per integration: a second "Sync now" is not queued.
      expect(await enqueueJob(JOB_NAMES.barsyFullPull, pullPayload, boss)).toBeNull()

      // Another organisation's view of the same integration id sees nothing.
      expect(await readActiveJob(app, otherTenant, integrationId)).toBeNull()

      await boss.cancel(JOB_NAMES.barsyFullPull, pullId as string)
      expect(await readActiveJob(app, tenant, integrationId)).toBe('connect')
      await boss.cancel(JOB_NAMES.barsyConnect, connectId as string)
      expect(await readActiveJob(app, tenant, integrationId)).toBeNull()
    })

    it('closes "Sync now" while a pull is waiting, and the view says which job it is', async () => {
      // Make venue A's mapping complete on the current host so only the queue is in the way.
      await owner.query(`update restro.integrations set status = 'connected' where id = $1`, [
        integrationId,
      ])
      await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 1, name: 'Main bar' }])
      await chooseBarsyVenue(scopeFor(venueA), { bid: 1 })
      await owner.query(
        `update restro.barsy_venues set catalogue_root_cat_id = 1171 where integration_id = $1 and bid = 1`,
        [integrationId],
      )
      expect((await loadIntegrationView(scopeFor(venueA), services())).gate).toEqual({
        enabled: true,
      })

      const real = services({ enqueue: (name, data) => enqueueJob(name, data, boss) })
      expect(await syncNow(scopeFor(venueA), real)).toEqual({ ok: true })
      const view = await loadIntegrationView(scopeFor(venueA), real)
      expect(view.activeJob).toBe('pull')
      expect(view.gate).toEqual({ enabled: false, reason: 'busy' })
      // A second press is refused by the gate before it reaches the queue.
      expect(await syncNow(scopeFor(venueA), real)).toEqual({ ok: false, error: 'already_running' })

      const rows = await owner.query(
        `select name, state from pgboss.job
         where data ->> 'integrationId' = $1 and state <> 'cancelled'`,
        [integrationId],
      )
      expect(rows.rows).toEqual([{ name: JOB_NAMES.barsyFullPull, state: 'created' }])
    })
  })

  it('the integration table keeps one row per host and is reachable for the owner', async () => {
    const rows = await withTenant(app, tenant, (tx) => tx.select().from(integrations))
    expect(rows.map((row) => row.host).sort()).toEqual([
      'second.barsyonline.com',
      'taken.barsyonline.com',
    ])
  })
})
