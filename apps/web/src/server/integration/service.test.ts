// Settings -> Integrations and the venue's Menu source card, against a real Postgres, as the
// restro_app role (adjustments I1 and I2, D81, D82): the systems an organisation chose, named
// instances (adding one with sealed credentials, saving its connection, renaming, removing it
// under the has_venues refusal), the system settings a connector supplies, the run history per
// instance and per venue, the gates of "Sync everything now" and "Sync this venue", who may do
// what, and another tenant's instances being invisible. The queue is a fake except in the last
// block, which uses a real pg-boss.
import { generateKeyPairSync } from 'node:crypto'

import { JOB_NAMES, newId } from '@restro/core'
import {
  appendSourceRecords,
  archiveVenue,
  createIntegration,
  finishJobRun,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  readOrganizationSystems,
  startJobRun,
  updateIntegration,
  updateSyncState,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { sealKeyId } from '@restro/core/seal'
import {
  barsyVenues,
  createPool,
  type DbPool,
  type Integration,
  integrations,
  withTenant,
} from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { enqueueJob } from '../jobs'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import {
  addInstance,
  checkConnection,
  HISTORY_LENGTH,
  type IntegrationScope,
  type IntegrationServices,
  loadIntegrationsView,
  loadMenuSourceView,
  readActiveJob,
  removeInstance,
  renameInstance,
  saveConnection,
  saveInstanceSettings,
  saveSystems,
  saveVenueSource,
  syncAll,
  syncNow,
  type VenueScope,
} from './service'
import type { InstanceView, LinkedMenuSource, MenuSourceView } from './view'

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
    let venueC: { id: string; name: string; timezone: string }
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
    const newInstance = { kind: 'barsy', ...connection }

    // Everything the server code prints, to check that no secret is in it.
    const logged: string[] = []
    let spies: { mockRestore: () => void }[] = []

    async function integrationRows() {
      return (await owner.query('select * from restro.integrations where tenant_id = $1', [tenant]))
        .rows as {
        id: string
        name: string
        host: string
        status: string
        credentials_sealed: string | null
        config: Record<string, unknown>
        removed_at: Date | null
      }[]
    }
    const rowOfHost = async (host: string) => (await integrationRows()).find((r) => r.host === host)
    const stored = (row: { id: string } | undefined) => row?.id ?? ''
    const viewOf = async (scope: IntegrationScope = orgScope()) =>
      loadIntegrationsView(scope, services())
    const instanceOf = async (id: string, scope: IntegrationScope = orgScope()) => {
      const found = (await viewOf(scope)).instances.find((instance) => instance.id === id)
      if (!found) throw new Error(`the view has no instance ${id}`)
      return found as InstanceView
    }
    const linked = (view: MenuSourceView): LinkedMenuSource => {
      if (view.state !== 'linked') throw new Error(`the card is ${view.state}, not linked`)
      return view
    }
    const linkOf = async (integrationId: string, bid: number) =>
      (
        await withTenant(app, tenant, (tx) =>
          tx.select().from(barsyVenues).where(eq(barsyVenues.integrationId, integrationId)),
        )
      ).find((row) => row.bid === bid)

    /** A connected instance with its credentials (as a connection check leaves it). */
    async function connectedInstance(host: string, name?: string): Promise<string> {
      const created = await createIntegration(app, tenant, {
        kind: 'barsy',
        host,
        ...(name ? { name } : {}),
        credentialsSealed: 'rs1.AAAA.BBBB.CCCC.DDDD',
      })
      await updateIntegration(app, tenant, created.id, {
        status: 'connected',
        lastCheckedAt: new Date('2026-10-09T10:00:00.000Z'),
      })
      return created.id
    }
    /** Gives one till venue of an instance to a venue of ours, with menu roots as the venue list reports. */
    async function giveVenue(
      integrationId: string,
      bid: number,
      venue: { id: string },
      roots: { publicCatId?: number | null; treeCatId?: number | null } = { publicCatId: 1171 },
    ) {
      await upsertBarsyVenues(app, tenant, integrationId, [
        { bid, name: `Till venue ${bid}`, ...roots },
      ])
      const mapped = await mapBarsyVenue(app, tenant, integrationId, bid, venue.id)
      expect(mapped.ok).toBe(true)
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
      venueC = await make(tenant, 'Venue C', 'venue-c')
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

    describe('before anything is chosen or connected', () => {
      it('shows the systems we support, none chosen, no instance, and whether the sync keys are set up', async () => {
        const view = await viewOf()
        expect(view).toEqual({
          canManage: true,
          sealReady: true,
          systems: [{ kind: 'barsy', label: 'barsy', instances: 0 }],
          chosen: [],
          instances: [],
        })
        const without = await loadIntegrationsView(orgScope(), { sealPublicKey: undefined })
        expect(without.sealReady).toBe(false)
        const broken = await loadIntegrationsView(orgScope(), { sealPublicKey: 'not-a-key' })
        expect(broken.sealReady).toBe(false)
        expect(
          (await loadIntegrationsView(orgScope({ canManage: false }), services())).canManage,
        ).toBe(false)
      })

      it('a venue made by hand has no Menu source, and nothing to sync', async () => {
        expect(await loadMenuSourceView(venueScope(venueA))).toEqual({ state: 'none' })
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(
          await saveVenueSource(venueScope(venueA), { settings: { priceSource: 'current_price' } }),
        ).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(await syncAll(orgScope(), services(), newId('in'))).toEqual({
          ok: false,
          error: 'not_found',
        })
      })
    })

    describe('the systems an organisation uses', () => {
      it('refuses everyone but owners and admins, and unknown systems', async () => {
        expect(await saveSystems(orgScope({ canManage: false }), ['barsy'])).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await saveSystems(orgScope(), ['nope'])).toEqual({ ok: false, error: 'invalid' })
        expect(await saveSystems(orgScope(), ['barsy', 'barsy'])).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(await readOrganizationSystems(app, tenant)).toEqual([])
      })

      it('saves the choice, and the page shows it', async () => {
        expect(await saveSystems(orgScope(), ['barsy'])).toEqual({ ok: true })
        expect((await viewOf()).chosen).toEqual(['barsy'])
        expect(await saveSystems(orgScope(), [])).toEqual({ ok: true })
        expect((await viewOf()).chosen).toEqual([])
        await saveSystems(orgScope(), ['barsy'])
      })

      it('another organisation’s choice is its own', async () => {
        expect((await viewOf(orgScope({ tenantId: otherTenant }))).chosen).toEqual([])
      })
    })

    describe('adding an instance', () => {
      it('refuses everyone but owners and admins, and writes nothing', async () => {
        const result = await addInstance(orgScope({ canManage: false }), services(), newInstance)
        expect(result).toEqual({ ok: false, error: 'not_allowed' })
        expect(await integrationRows()).toEqual([])
        expect(sent).toEqual([])
      })

      it('checks the system, the address, the keys, the name and the credentials before touching anything', async () => {
        const add = (input: object, over?: Partial<IntegrationServices>) =>
          addInstance(orgScope(), services(over), { ...newInstance, ...input })
        expect(await add({ kind: 'nope' })).toEqual({ ok: false, error: 'invalid' })
        expect(await add({ host: 'http://club.barsyonline.com' })).toEqual({
          ok: false,
          error: 'invalid_host',
        })
        expect(await add({ host: 'https://club.barsyonline.com:8443' })).toEqual({
          ok: false,
          error: 'invalid_host',
        })
        expect(await add({}, { sealPublicKey: undefined })).toEqual({
          ok: false,
          error: 'sync_keys_missing',
        })
        expect(await add({}, { sealPublicKey: 'definitely-not-a-key' })).toEqual({
          ok: false,
          error: 'sync_keys_missing',
        })
        expect(await add({ name: 'x'.repeat(81) })).toEqual({ ok: false, error: 'invalid' })
        expect(await add({ password: '' })).toEqual({ ok: false, error: 'invalid' })
        expect(await add({ user: '' })).toEqual({ ok: false, error: 'invalid' })
        expect(await integrationRows()).toEqual([])
        expect(sent).toEqual([])
      })

      it('needs a system the organisation chose', async () => {
        await saveSystems(orgScope(), [])
        expect(await addInstance(orgScope(), services(), newInstance)).toEqual({
          ok: false,
          error: 'system_not_chosen',
        })
        expect(await integrationRows()).toEqual([])
        await saveSystems(orgScope(), ['barsy'])
      })

      it('seals the credentials for the key, stores only the envelope, names the instance and queues the check', async () => {
        const result = await addInstance(orgScope(), services(), {
          ...newInstance,
          name: '  barsy – Sofia ',
        })
        expect(result).toMatchObject({ ok: true, queued: true })
        const [row] = await integrationRows()
        expect(row).toMatchObject({
          host: 'club.barsyonline.com',
          name: 'barsy – Sofia',
          status: 'new',
          removed_at: null,
        })
        expect(result.ok && result.integrationId).toBe(row?.id)
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
        expect(JSON.stringify(sent)).not.toContain(PASSWORD)
      })

      it('shows the saved credentials as a fact, never as a value', async () => {
        const view = await viewOf()
        const [instance] = view.instances
        expect(view.instances).toHaveLength(1)
        expect(instance).toMatchObject({
          kind: 'barsy',
          source: 'barsy',
          name: 'barsy – Sofia',
          host: 'club.barsyonline.com',
          hasCredentials: true,
          status: 'new',
          venues: [],
          gate: { enabled: false, reason: 'not_connected' },
        })
        expect(view.systems).toEqual([{ kind: 'barsy', label: 'barsy', instances: 1 }])
        const json = JSON.stringify(view)
        const row = await rowOfHost('club.barsyonline.com')
        expect(json).not.toContain(PASSWORD)
        expect(json).not.toContain(API_USER)
        expect(json).not.toContain(row?.credentials_sealed ?? 'missing')
      })

      it('names an instance after the system and the address when no name is given', async () => {
        const result = await addInstance(orgScope(), services(), {
          ...newInstance,
          host: 'plovdiv.barsyonline.com',
        })
        expect(result.ok).toBe(true)
        expect((await rowOfHost('plovdiv.barsyonline.com'))?.name).toBe(
          'barsy – plovdiv.barsyonline.com',
        )
      })

      it('lists several instances of one system, oldest first', async () => {
        const names = (await viewOf()).instances.map((instance) => instance.name)
        expect(names).toEqual(['barsy – Sofia', 'barsy – plovdiv.barsyonline.com'])
        expect((await viewOf()).systems[0]?.instances).toBe(2)
      })

      it('refuses an address another instance of the system uses already', async () => {
        const result = await addInstance(orgScope(), services(), newInstance)
        expect(result).toEqual({ ok: false, error: 'host_in_use' })
        expect(await integrationRows()).toHaveLength(2)
      })

      it('still saves when the queue cannot be reached, and says the check was not queued', async () => {
        enqueueFails = true
        const result = await addInstance(orgScope(), services(), {
          ...newInstance,
          host: 'varna.barsyonline.com',
        })
        expect(result).toMatchObject({ ok: true, queued: false })
        expect(logged.some((line) => line.includes('integration_connect_not_queued'))).toBe(true)
      })
    })

    describe('saving the connection of an instance', () => {
      let id = ''
      beforeAll(async () => {
        id = stored(await rowOfHost('club.barsyonline.com'))
      })

      it('refuses everyone but owners and admins, and unknown, foreign or malformed instances', async () => {
        const save = (scope: IntegrationScope, integrationId: string) =>
          saveConnection(scope, services(), { ...connection, integrationId })
        expect(await save(orgScope({ canManage: false }), id)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await save(orgScope(), newId('in'))).toEqual({ ok: false, error: 'not_found' })
        expect(await save(orgScope(), 'nope')).toEqual({ ok: false, error: 'not_found' })
        // Another organisation's person cannot reach this organisation's instance.
        expect(await save(orgScope({ tenantId: otherTenant }), id)).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(sent).toEqual([])
      })

      it('checks the address, the keys and the credentials before touching anything', async () => {
        const before = await rowOfHost('club.barsyonline.com')
        const save = (input: Partial<typeof connection>, over?: Partial<IntegrationServices>) =>
          saveConnection(orgScope(), services(over), { ...connection, integrationId: id, ...input })
        expect(await save({ host: 'ftp://x' })).toEqual({ ok: false, error: 'invalid_host' })
        expect(await save({}, { sealPublicKey: undefined })).toEqual({
          ok: false,
          error: 'sync_keys_missing',
        })
        expect(await save({ password: '' })).toEqual({ ok: false, error: 'invalid' })
        expect(await save({ user: '' })).toEqual({ ok: false, error: 'invalid' })
        expect((await rowOfHost('club.barsyonline.com'))?.credentials_sealed).toBe(
          before?.credentials_sealed,
        )
        expect(sent).toEqual([])
      })

      it('on the same host replaces the envelope, resets the status, keeps the instance, and queues the check', async () => {
        const before = await rowOfHost('club.barsyonline.com')
        await updateIntegration(app, tenant, id, {
          status: 'error',
          statusDetail: 'Wrong user or password',
        })
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          integrationId: id,
        })
        expect(result).toEqual({ ok: true, queued: true })
        const after = await rowOfHost('club.barsyonline.com')
        expect(after).toMatchObject({ id, status: 'new', name: 'barsy – Sofia' })
        expect(after?.credentials_sealed).not.toBe(before?.credentials_sealed)
        const [detail] = (
          await owner.query('select status_detail from restro.integrations where id = $1', [id])
        ).rows
        expect(detail.status_detail).toBeNull()
        expect(sent).toEqual([
          { name: JOB_NAMES.barsyConnect, data: { tenantId: tenant, integrationId: id } },
        ])
      })

      it('moves to another address when nothing depends on the old one, forgetting what was cached for it', async () => {
        await updateIntegration(app, tenant, id, {
          config: {
            default_locale: 'en_US',
            catalogue_trees: { '1': { fetched_at: '2026-10-09T10:00:00.000Z', categories: [] } },
            not_used: [3],
          },
        })
        await updateSyncState(app, tenant, id, 1, { last_full_pull_at: '2026-10-09T10:00:00.000Z' })
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          host: 'https://sofia-new.barsyonline.com',
          integrationId: id,
        })
        expect(result).toEqual({ ok: true, queued: true })
        const row = await rowOfHost('sofia-new.barsyonline.com')
        expect(row).toMatchObject({ id, status: 'new' })
        // What belongs to the old installation is gone; the instance's own settings stay.
        expect(row?.config).toEqual({ default_locale: 'en_US' })
      })

      it('refuses an address that another instance uses', async () => {
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          host: 'https://plovdiv.barsyonline.com',
          integrationId: id,
        })
        expect(result).toEqual({ ok: false, error: 'host_in_use' })
        expect((await rowOfHost('sofia-new.barsyonline.com'))?.id).toBe(id)
      })

      it('refuses to change the address of an instance that serves a venue (a venue’s source never changes)', async () => {
        const instance = await connectedInstance('serves.barsyonline.com')
        await giveVenue(instance, 1, venueC)
        const result = await saveConnection(orgScope(), services(), {
          ...connection,
          host: 'https://serves-new.barsyonline.com',
          integrationId: instance,
        })
        expect(result).toEqual({ ok: false, error: 'host_change_blocked' })
        expect((await rowOfHost('serves.barsyonline.com'))?.id).toBe(instance)
        expect((await linkOf(instance, 1))?.venueId).toBe(venueC.id)
        // The same address with new credentials is not a change.
        expect(
          await saveConnection(orgScope(), services(), {
            ...connection,
            host: 'https://serves.barsyonline.com',
            integrationId: instance,
          }),
        ).toEqual({ ok: true, queued: true })
      })
    })

    describe('checking the connection again', () => {
      it('queues the check of this instance for managers only, and says why not when it cannot', async () => {
        const id = stored(await rowOfHost('plovdiv.barsyonline.com'))
        expect(await checkConnection(orgScope({ canManage: false }), services(), id)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await checkConnection(orgScope(), services(), newId('in'))).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await checkConnection(orgScope(), services(), id)).toEqual({
          ok: true,
          queued: true,
        })
        expect(sent).toEqual([
          { name: JOB_NAMES.barsyConnect, data: { tenantId: tenant, integrationId: id } },
        ])
        enqueueFails = true
        expect(await checkConnection(orgScope(), services(), id)).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
      })

      it('needs credentials first', async () => {
        const bare = await createIntegration(app, tenant, {
          kind: 'barsy',
          host: 'bare.barsyonline.com',
        })
        expect(await checkConnection(orgScope(), services(), bare.id)).toEqual({
          ok: false,
          error: 'not_ready',
        })
        await owner.query('update restro.integrations set removed_at = now() where id = $1', [
          bare.id,
        ])
      })
    })

    describe('renaming an instance', () => {
      it('renames it, trimmed, and refuses an empty or overlong name, a stranger and a non-manager', async () => {
        const id = stored(await rowOfHost('plovdiv.barsyonline.com'))
        expect(
          await renameInstance(orgScope(), { integrationId: id, name: ' barsy – Plovdiv ' }),
        ).toEqual({
          ok: true,
        })
        expect((await instanceOf(id)).name).toBe('barsy – Plovdiv')
        for (const name of ['', '   ', 'x'.repeat(81)]) {
          expect(await renameInstance(orgScope(), { integrationId: id, name })).toEqual({
            ok: false,
            error: 'invalid',
          })
        }
        expect(
          await renameInstance(orgScope({ canManage: false }), { integrationId: id, name: 'x' }),
        ).toEqual({ ok: false, error: 'not_allowed' })
        expect(await renameInstance(orgScope(), { integrationId: newId('in'), name: 'x' })).toEqual(
          { ok: false, error: 'not_found' },
        )
        expect(
          await renameInstance(orgScope({ tenantId: otherTenant }), {
            integrationId: id,
            name: 'x',
          }),
        ).toEqual({ ok: false, error: 'not_found' })
        expect((await instanceOf(id)).name).toBe('barsy – Plovdiv')
      })
    })

    describe('removing an instance', () => {
      it('is refused while a venue links to it, and the instance stays', async () => {
        const id = await connectedInstance('linked-remove.barsyonline.com', 'barsy – Linked')
        await giveVenue(id, 1, venueB)
        expect(await removeInstance(orgScope(), { integrationId: id })).toEqual({
          ok: false,
          error: 'has_venues',
        })
        expect((await instanceOf(id)).venues).toEqual([{ id: venueB.id, name: 'Venue B' }])
        expect((await rowOfHost('linked-remove.barsyonline.com'))?.removed_at).toBeNull()
      })

      it('refuses everyone but owners and admins, and strangers', async () => {
        const id = stored(await rowOfHost('plovdiv.barsyonline.com'))
        expect(await removeInstance(orgScope({ canManage: false }), { integrationId: id })).toEqual(
          {
            ok: false,
            error: 'not_allowed',
          },
        )
        expect(await removeInstance(orgScope(), { integrationId: newId('in') })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await removeInstance(orgScope(), { integrationId: 'nope' })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(
          await removeInstance(orgScope({ tenantId: otherTenant }), { integrationId: id }),
        ).toEqual({ ok: false, error: 'not_found' })
        expect((await rowOfHost('plovdiv.barsyonline.com'))?.removed_at).toBeNull()
      })

      it('hides the instance everywhere, never erases it, and syncs nothing of it', async () => {
        const id = stored(await rowOfHost('plovdiv.barsyonline.com'))
        const before = await rowOfHost('plovdiv.barsyonline.com')
        expect(await removeInstance(orgScope(), { integrationId: id })).toEqual({ ok: true })
        const after = await rowOfHost('plovdiv.barsyonline.com')
        expect(after?.removed_at).toBeInstanceOf(Date)
        // The row and its credentials are kept.
        expect(after).toMatchObject({ id, name: before?.name })
        expect(after?.credentials_sealed).toBe(before?.credentials_sealed)

        const view = await viewOf()
        expect(view.instances.map((instance) => instance.id)).not.toContain(id)
        expect(view.systems[0]?.instances).toBe(view.instances.length)
        // Nothing can be done to it any more.
        expect(await removeInstance(orgScope(), { integrationId: id })).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(await syncAll(orgScope(), services(), id)).toEqual({ ok: false, error: 'not_found' })
        expect(await checkConnection(orgScope(), services(), id)).toEqual({
          ok: false,
          error: 'not_found',
        })
        expect(
          await saveConnection(orgScope(), services(), { ...connection, integrationId: id }),
        ).toEqual({ ok: false, error: 'not_found' })
        expect(
          await saveInstanceSettings(orgScope(), {
            integrationId: id,
            settings: { allergenKey: null, defaultLocale: 'en_US' },
          }),
        ).toEqual({ ok: false, error: 'not_found' })
        expect(sent).toEqual([])
      })

      it('lets the same address be added again as a new instance', async () => {
        const result = await addInstance(orgScope(), services(), {
          ...newInstance,
          host: 'plovdiv.barsyonline.com',
          name: 'barsy – Plovdiv again',
        })
        expect(result).toMatchObject({ ok: true })
        const rows = (await integrationRows()).filter(
          (row) => row.host === 'plovdiv.barsyonline.com',
        )
        expect(rows).toHaveLength(2)
        expect(rows.filter((row) => row.removed_at === null)).toHaveLength(1)
      })

      it('lets a system with no instance left be unselected, and refuses it before', async () => {
        expect(await saveSystems(orgScope(), [])).toEqual({ ok: false, error: 'has_instances' })
        for (const instance of (await viewOf()).instances) {
          // Free the venues of the instances still in the way, as deleting the venues would.
          await owner.query(
            'update restro.barsy_venues set venue_id = null where integration_id = $1',
            [instance.id],
          )
          expect(await removeInstance(orgScope(), { integrationId: instance.id })).toEqual({
            ok: true,
          })
        }
        expect((await viewOf()).instances).toEqual([])
        expect(await saveSystems(orgScope(), [])).toEqual({ ok: true })
        expect((await viewOf()).systems[0]?.instances).toBe(0)
        await saveSystems(orgScope(), ['barsy'])
      })
    })

    describe('an instance as the screen reads it', () => {
      let id = ''
      beforeAll(async () => {
        id = await connectedInstance('read.barsyonline.com', 'barsy – Reads')
        await giveVenue(id, 1, venueA)
        await giveVenue(id, 2, venueB, { publicCatId: null })
        const payload = [
          {
            group_id: 1,
            group_name: 'Основна',
            details: { k102: { detail_name: 'Алергени' }, k103: { detail_name: 'Грамаж' } },
          },
        ]
        await appendSourceRecords(app, tenant, id, [
          {
            externalType: 'article_details',
            externalId: 'tree',
            scope: 'master',
            raw: JSON.stringify(payload),
            payload,
          },
        ])
      })

      it('shows the connection, the status, the venues that use it and the clock', async () => {
        const instance = await instanceOf(id)
        expect(instance).toMatchObject({
          name: 'barsy – Reads',
          source: 'barsy',
          host: 'read.barsyonline.com',
          hasCredentials: true,
          status: 'connected',
          lastCheckedAt: '2026-10-09T10:00:00.000Z',
          timeZone: 'Europe/Sofia',
          activeJob: null,
        })
        expect(instance.venues.map((venue) => venue.name)).toEqual(['Venue A', 'Venue B'])
      })

      it('supplies the connector’s system settings: the allergen characteristics and the language', async () => {
        expect((await instanceOf(id)).settings).toEqual({
          kind: 'barsy',
          allergenKey: null,
          allergenDetected: { key: 'k102', name: 'Алергени' },
          allergenOptions: [
            { key: 'k102', name: 'Алергени' },
            { key: 'k103', name: 'Грамаж' },
          ],
          defaultLocale: 'bg_BG',
        })
      })

      it('saves the allergen characteristic and the language, and checks both', async () => {
        const save = (settings: unknown, scope: IntegrationScope = orgScope()) =>
          saveInstanceSettings(scope, { integrationId: id, settings })
        expect(await save({ allergenKey: 'k103', defaultLocale: 'en_US' })).toEqual({ ok: true })
        expect((await instanceOf(id)).settings).toMatchObject({
          allergenKey: 'k103',
          defaultLocale: 'en_US',
        })
        // Back to detection: the key is removed from the config.
        expect(await save({ allergenKey: null, defaultLocale: 'en_US' })).toEqual({ ok: true })
        expect((await rowOfHost('read.barsyonline.com'))?.config).not.toHaveProperty(
          'allergen_detail_key',
        )
        // A characteristic the till never listed, a language we do not know, other keys, nobody.
        expect(await save({ allergenKey: 'k999', defaultLocale: 'en_US' })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(await save({ allergenKey: null, defaultLocale: 'xx_XX' })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(await save({ allergenKey: null, defaultLocale: 'en_US', extra: 1 })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(await save({})).toEqual({ ok: false, error: 'invalid' })
        expect(
          await save({ allergenKey: null, defaultLocale: 'bg_BG' }, orgScope({ canManage: false })),
        ).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(
          await save(
            { allergenKey: null, defaultLocale: 'bg_BG' },
            orgScope({ tenantId: otherTenant }),
          ),
        ).toEqual({ ok: false, error: 'not_found' })
        // The sync schedule is not an instance setting any more: nothing here writes it.
        expect((await rowOfHost('read.barsyonline.com'))?.config).not.toHaveProperty('schedule')
        await save({ allergenKey: null, defaultLocale: 'bg_BG' })
      })

      it('keeps another organisation out', async () => {
        const view = await viewOf(orgScope({ tenantId: otherTenant }))
        expect(view.instances).toEqual([])
        expect(view.systems[0]?.instances).toBe(0)
      })
    })

    describe('"Sync everything now" and "Sync this venue"', () => {
      let id = ''
      beforeAll(async () => {
        id = await connectedInstance('sync.barsyonline.com', 'barsy – Sync')
        // Venue A and B are on other instances; give this instance two other venues.
        await owner.query(
          'update restro.barsy_venues set venue_id = null where venue_id = any($1)',
          [[venueA.id, venueB.id, venueC.id]],
        )
      })

      it('is closed until a venue uses the instance, then until the system reported its menus', async () => {
        expect((await instanceOf(id)).gate).toEqual({ enabled: false, reason: 'no_till_venue' })
        expect(await syncAll(orgScope(), services(), id)).toEqual({ ok: false, error: 'not_ready' })
        await giveVenue(id, 1, venueA, { publicCatId: null })
        expect((await instanceOf(id)).gate).toEqual({ enabled: false, reason: 'no_menu' })
        expect(await syncAll(orgScope(), services(), id)).toEqual({ ok: false, error: 'not_ready' })
        expect(sent).toEqual([])
      })

      it('queues one pull for every live venue of the instance whose menus are known, and no secret', async () => {
        await owner.query(
          'update restro.barsy_venues set public_cat_id = 1171 where integration_id = $1 and bid = 1',
          [id],
        )
        await giveVenue(id, 2, venueB, { treeCatId: 1091 })
        await giveVenue(id, 3, venueC, { publicCatId: null })
        expect((await instanceOf(id)).gate).toEqual({ enabled: true })
        const result = await syncAll(orgScope(), services(), id)
        // C is linked but cannot be read yet: it is left out, A and B are queued.
        expect(result).toEqual({ ok: true, pulls: 2 })
        expect(
          sent.map((job) => [job.name, (job.data as { venueId: string }).venueId]).sort(),
        ).toEqual(
          [
            [JOB_NAMES.barsyFullPull, venueA.id],
            [JOB_NAMES.barsyFullPull, venueB.id],
          ].sort(),
        )
        for (const job of sent) {
          expect(Object.keys(job.data).sort()).toEqual(['integrationId', 'tenantId', 'venueId'])
          expect((job.data as { integrationId: string }).integrationId).toBe(id)
        }
        expect(JSON.stringify(sent)).not.toContain(PASSWORD)
      })

      it('refuses non-managers, strangers, a broken queue and a pull that is already waiting', async () => {
        expect(await syncAll(orgScope({ canManage: false }), services(), id)).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await syncAll(orgScope({ tenantId: otherTenant }), services(), id)).toEqual({
          ok: false,
          error: 'not_found',
        })
        enqueueFails = true
        expect(await syncAll(orgScope(), services(), id)).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
        enqueueFails = false
        // The queue says an identical pull is waiting for each: nothing new was queued.
        enqueueResult = null
        expect(await syncAll(orgScope(), services(), id)).toEqual({
          ok: false,
          error: 'already_running',
        })
      })

      it('leaves a deleted venue out', async () => {
        await archiveVenue(app, tenant, venueB.id)
        sent.length = 0
        const result = await syncAll(orgScope(), services(), id)
        expect(result).toEqual({ ok: true, pulls: 1 })
        expect(sent.map((job) => (job.data as { venueId: string }).venueId)).toEqual([venueA.id])
        expect((await instanceOf(id)).venues.map((venue) => venue.name)).not.toContain('Venue B')
      })

      it('"Sync this venue" queues one pull of this venue under the same gate', async () => {
        expect(await syncNow(venueScope(venueA, { canManage: false }), services())).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        expect(await syncNow(venueScope(venueA), services())).toEqual({ ok: true })
        expect(sent).toEqual([
          {
            name: JOB_NAMES.barsyFullPull,
            data: { tenantId: tenant, integrationId: id, venueId: venueA.id },
          },
        ])
        // Venue C is linked but its menus are not known yet.
        sent.length = 0
        expect(linked(await loadMenuSourceView(venueScope(venueC))).gate).toEqual({
          enabled: false,
          reason: 'no_menu',
        })
        expect(await syncNow(venueScope(venueC), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        expect(sent).toEqual([])
        enqueueFails = true
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'queue_unavailable',
        })
        enqueueFails = false
        enqueueResult = null
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'already_running',
        })
      })

      it('is closed while the connection is not working', async () => {
        await updateIntegration(app, tenant, id, { status: 'error' })
        expect((await instanceOf(id)).gate).toEqual({ enabled: false, reason: 'not_connected' })
        expect(await syncAll(orgScope(), services(), id)).toEqual({ ok: false, error: 'not_ready' })
        expect(await syncNow(venueScope(venueA), services())).toEqual({
          ok: false,
          error: 'not_ready',
        })
        await updateIntegration(app, tenant, id, { status: 'connected' })
      })
    })

    describe('a venue’s Menu source: the common part and the connector’s', () => {
      let id = ''
      beforeAll(async () => {
        id = await connectedInstance('source.barsyonline.com', 'barsy – Source')
        // Venue B was deleted above: restore it for these cases by using venue A and a fresh venue.
        await owner.query('update restro.barsy_venues set venue_id = null where venue_id = $1', [
          venueA.id,
        ])
        await giveVenue(id, 7, venueA)
      })

      it('shows the instance, the venue’s name in the system, and nothing it cannot change', async () => {
        const card = linked(await loadMenuSourceView(venueScope(venueA)))
        expect(card).toMatchObject({
          canManage: true,
          timeZone: 'Europe/Sofia',
          source: 'barsy',
          instanceName: 'barsy – Source',
          tillVenueName: 'Till venue 7',
          lastSyncedAt: null,
          heldSync: null,
          activeJob: null,
          gate: { enabled: true },
          runs: [],
          connector: { kind: 'barsy', priceSource: 'actual_price' },
        })
        // No picker, no category tree, no options to move to another venue (D87, D88).
        expect(Object.keys(card).sort()).toEqual([
          'activeJob',
          'canManage',
          'connector',
          'gate',
          'heldSync',
          'instanceName',
          'lastSyncedAt',
          'runs',
          'source',
          'state',
          'tillVenueName',
          'timeZone',
        ])
      })

      it('saves the price for this venue only, through the connector, and checks it', async () => {
        const save = (settings: unknown, scope: VenueScope = venueScope(venueA)) =>
          saveVenueSource(scope, { settings })
        expect(await save({ priceSource: 'current_price' })).toEqual({ ok: true })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).connector).toEqual({
          kind: 'barsy',
          priceSource: 'current_price',
        })
        expect((await linkOf(id, 7))?.priceSource).toBe('current_price')
        expect(await save({ priceSource: 'list_price' })).toEqual({ ok: false, error: 'invalid' })
        expect(await save({ priceSource: 'actual_price', extra: true })).toEqual({
          ok: false,
          error: 'invalid',
        })
        expect(
          await save({ priceSource: 'actual_price' }, venueScope(venueA, { canManage: false })),
        ).toEqual({
          ok: false,
          error: 'not_allowed',
        })
        // The price is the venue's own: another venue of the same instance is untouched.
        await giveVenue(id, 8, venueC)
        expect(linked(await loadMenuSourceView(venueScope(venueC))).connector).toEqual({
          kind: 'barsy',
          priceSource: 'actual_price',
        })
        await save({ priceSource: 'actual_price' })
      })

      it('uses the instance’s old default price for a venue that never saved its own', async () => {
        await updateIntegration(app, tenant, id, { config: { price_source: 'current_price' } })
        expect(linked(await loadMenuSourceView(venueScope(venueC))).connector).toMatchObject({
          priceSource: 'current_price',
        })
        await updateIntegration(app, tenant, id, { config: { price_source: null } })
      })

      it('shows when it last synced, from the venue’s own sync state', async () => {
        await updateSyncState(app, tenant, id, 7, {
          last_full_pull_at: '2026-10-09T09:00:00.000Z',
          last_incremental_at: '2026-10-09T09:30:00.000Z',
        })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).lastSyncedAt).toBe(
          '2026-10-09T09:30:00.000Z',
        )
        expect(linked(await loadMenuSourceView(venueScope(venueC))).lastSyncedAt).toBeNull()
      })

      it('keeps another organisation’s venue and a hand-made venue out', async () => {
        expect(
          await loadMenuSourceView({
            pool: app,
            tenantId: otherTenant,
            venue: foreignVenue,
            canManage: true,
          }),
        ).toEqual({ state: 'none' })
        // This organisation's person asking about a venue that belongs to nobody they can see.
        expect(await loadMenuSourceView({ ...venueScope(foreignVenue), canManage: true })).toEqual({
          state: 'none',
        })
      })

      it('gives a venue its own history, with its runs only, newest first', async () => {
        const run = async (venue: { id: string } | null, kind = 'barsy_full_pull') => {
          const started = await startJobRun(app, tenant, {
            kind,
            integrationId: id,
            ...(venue ? { venueId: venue.id } : {}),
          })
          await finishJobRun(app, tenant, started.id, {
            status: 'completed',
            counters: { created: 3 },
            ...(venue ? { venueId: venue.id } : {}),
          })
        }
        await run(venueC)
        await run(venueA, 'barsy_incremental')
        await run(venueA)
        await run(null, 'barsy_connect')
        const photo = await startJobRun(app, tenant, {
          kind: 'asset_fetch',
          integrationId: id,
          venueId: venueA.id,
        })
        await finishJobRun(app, tenant, photo.id, { status: 'completed', venueId: venueA.id })

        const card = linked(await loadMenuSourceView(venueScope(venueA)))
        expect(card.runs.map((r) => r.kind)).toEqual(['barsy_full_pull', 'barsy_incremental'])
        expect(card.runs.every((r) => r.venue?.id === venueA.id)).toBe(true)
        expect(JSON.stringify(card.runs)).not.toContain('nd_')
      })

      it('shows the held sync of this venue only', async () => {
        const held = await startJobRun(app, tenant, {
          kind: 'barsy_full_pull',
          integrationId: id,
          venueId: venueA.id,
        })
        await finishJobRun(app, tenant, held.id, {
          status: 'completed',
          venueId: venueA.id,
          counters: { articles_seen: 4, failed_pages: 0 },
          deletionCheckSkipped: true,
          absenceHeld: { reason: 'too_many_missing', wouldHide: 61, active: 65 },
          summary: 'deletion check skipped',
        })
        expect(linked(await loadMenuSourceView(venueScope(venueA))).heldSync).toMatchObject({
          reason: 'too_many_missing',
          wouldHide: 61,
          active: 65,
        })
        expect(linked(await loadMenuSourceView(venueScope(venueC))).heldSync).toBeNull()
        // The screen names the venue the warning concerns.
        const warnings = (await instanceOf(id)).heldSyncs
        expect(warnings).toHaveLength(1)
        expect(warnings[0]?.venue).toEqual({ id: venueA.id, name: 'Venue A' })
      })
    })

    describe('the run history of an instance', () => {
      let id = ''
      beforeAll(async () => {
        id = await connectedInstance('history.barsyonline.com', 'barsy – History')
        await owner.query(
          'update restro.barsy_venues set venue_id = null where venue_id = any($1)',
          [[venueA.id, venueC.id]],
        )
        await giveVenue(id, 1, venueA)
      })

      it('lists the latest runs of the instance, newest first, without photo downloads', async () => {
        // 25 photo downloads, then a connection check, then a pull with refusals.
        for (let i = 0; i < 25; i += 1) {
          const photo = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId: id })
          await finishJobRun(app, tenant, photo.id, { status: 'completed' })
        }
        const check = await startJobRun(app, tenant, { kind: 'barsy_connect', integrationId: id })
        await finishJobRun(app, tenant, check.id, { status: 'completed', counters: { venues: 2 } })
        const pull = await startJobRun(app, tenant, {
          kind: 'barsy_full_pull',
          integrationId: id,
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
        const legacy = await startJobRun(app, tenant, {
          kind: 'barsy_incremental',
          integrationId: id,
        })
        // A run recorded before details existed: text only.
        await owner.query(
          `update restro.job_runs set status = 'failed', error_summary = 'barsy refused the credentials', finished_at = now(), details = null where id = $1`,
          [legacy.id],
        )

        const instance = await instanceOf(id)
        expect(instance.runs.length).toBeLessThanOrEqual(HISTORY_LENGTH)
        expect(instance.runs.map((run) => run.kind)).toEqual([
          'barsy_incremental',
          'barsy_full_pull',
          'barsy_connect',
        ])
        const [legacyRun, pullRun, checkRun] = instance.runs
        expect(legacyRun).toMatchObject({
          status: 'failed',
          errorSummary: 'barsy refused the credentials',
          details: null,
          venue: null,
        })
        expect(pullRun).toMatchObject({
          status: 'completed',
          venue: { id: venueA.id, name: 'Venue A' },
          counters: { articles_seen: 58, created: 58, failed_pages: 1, refused_writes: 1 },
          details: {
            notes: ['deletion check skipped: 1 of 3 pages failed'],
            refused: [{ fieldKey: 'for_sale', code: 'less_cautious' }],
          },
        })
        expect(checkRun?.counters).toEqual({ venues: 2 })
        expect(checkRun?.venue).toBeNull()
        expect(JSON.stringify(instance.runs)).not.toContain('nd_')
      })

      it('shows only the latest twenty', async () => {
        for (let i = 0; i < 25; i += 1) {
          const run = await startJobRun(app, tenant, {
            kind: 'barsy_incremental',
            integrationId: id,
          })
          await finishJobRun(app, tenant, run.id, { status: 'completed' })
        }
        expect((await instanceOf(id)).runs).toHaveLength(HISTORY_LENGTH)
      })

      it('keeps one instance’s runs apart from another’s', async () => {
        const other = await connectedInstance('history-other.barsyonline.com')
        expect((await instanceOf(other)).runs).toEqual([])
        expect((await instanceOf(id)).runs.length).toBeGreaterThan(0)
      })

      it('another organisation’s runs are invisible', async () => {
        const view = await viewOf(orgScope({ tenantId: otherTenant }))
        expect(view.instances).toEqual([])
      })
    })

    describe('the password stays out of results and logs', () => {
      it('is in no result, no log line and no stored row, whatever happened', async () => {
        const id = stored(await rowOfHost('read.barsyonline.com'))
        const here = { ...connection, host: 'https://read.barsyonline.com', integrationId: id }
        const results = [
          await saveConnection(orgScope({ canManage: false }), services(), here),
          await saveConnection(orgScope(), services(), { ...here, host: 'ftp://x' }),
          await saveConnection(orgScope(), services({ sealPublicKey: 'bad' }), here),
          await saveConnection(orgScope(), services(), { ...here, user: '' }),
          await saveConnection(orgScope(), services(), here),
          await addInstance(orgScope({ canManage: false }), services(), newInstance),
          await addInstance(orgScope(), services(), { ...newInstance, host: 'ftp://x' }),
          await addInstance(orgScope(), services(), {
            ...newInstance,
            host: 'secret.barsyonline.com',
          }),
        ]
        enqueueFails = true
        results.push(await saveConnection(orgScope(), services(), here))
        expect(JSON.stringify(results)).not.toContain(PASSWORD)
        expect(logged.join('\n')).not.toContain(PASSWORD)
        expect(logged.join('\n')).not.toContain(API_USER)
        const storedRows = JSON.stringify(
          (await owner.query('select to_jsonb(i) as j from restro.integrations i')).rows,
        )
        expect(storedRows).not.toContain(PASSWORD)
        expect(storedRows).not.toContain(API_USER)
      })
    })

    describe('queued and running jobs (a real pg-boss)', () => {
      let boss: PgBoss
      let id = ''
      let instance: Integration

      beforeAll(async () => {
        id = await connectedInstance('queue.barsyonline.com', 'barsy – Queue')
        instance = (
          await withTenant(app, tenant, (tx) =>
            tx.select().from(integrations).where(eq(integrations.id, id)),
          )
        )[0] as Integration
        await owner.query(
          'update restro.barsy_venues set venue_id = null where venue_id = any($1)',
          [[venueA.id, venueC.id]],
        )
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

      it('knows a connection check and a full pull of this instance are waiting', async () => {
        expect(await readActiveJob(app, tenant, instance)).toBeNull()

        const connectId = await enqueueJob(
          JOB_NAMES.barsyConnect,
          { tenantId: tenant as never, integrationId: id as never },
          boss,
        )
        expect(connectId).toEqual(expect.any(String))
        expect(await readActiveJob(app, tenant, instance)).toBe('connect')

        const pullPayload = {
          tenantId: tenant as never,
          integrationId: id as never,
          venueId: venueA.id as never,
        }
        const pullId = await enqueueJob(JOB_NAMES.barsyFullPull, pullPayload, boss)
        expect(pullId).toEqual(expect.any(String))
        expect(await readActiveJob(app, tenant, instance)).toBe('pull')
        // The queue is exclusive per instance and venue: a second press for A is not queued.
        expect(await enqueueJob(JOB_NAMES.barsyFullPull, pullPayload, boss)).toBeNull()

        // Another organisation's view of the same instance id sees nothing.
        expect(await readActiveJob(app, otherTenant, instance)).toBeNull()
        // A kind this build does not know has no job to look for.
        expect(await readActiveJob(app, tenant, { id, kind: 'nope' })).toBeNull()

        await boss.cancel(JOB_NAMES.barsyFullPull, pullId as string)
        expect(await readActiveJob(app, tenant, instance)).toBe('connect')
        await boss.cancel(JOB_NAMES.barsyConnect, connectId as string)
        expect(await readActiveJob(app, tenant, instance)).toBeNull()
      })

      it('a pull of one venue keeps its own button shut, not another venue’s', async () => {
        const real = services({ enqueue: (name, data) => enqueueJob(name, data, boss) })
        // Venue A and venue C use this instance, both with their menus known.
        await giveVenue(id, 1, venueA)
        await giveVenue(id, 2, venueC)
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
        // Venue C is not held up by A's pull ...
        const cardC = linked(await loadMenuSourceView(venueScope(venueC)))
        expect(cardC.activeJob).toBeNull()
        expect(cardC.gate).toEqual({ enabled: true })
        // ... but the instance shows that something is running, and "Sync everything now" waits for it.
        const shown = await instanceOf(id)
        expect(shown.activeJob).toBe('pull')
        expect(shown.gate).toEqual({ enabled: false, reason: 'busy' })
        expect(await syncAll(orgScope(), real, id)).toEqual({ ok: false, error: 'already_running' })

        const rows = await owner.query(
          `select name, state, data ->> 'venueId' as venue from pgboss.job
         where data ->> 'integrationId' = $1 and state <> 'cancelled'`,
          [id],
        )
        expect(rows.rows).toEqual([
          { name: JOB_NAMES.barsyFullPull, state: 'created', venue: venueA.id },
        ])

        // Now venue C's press queues its own, and A's is still the one waiting.
        expect(await syncNow(venueScope(venueC), real)).toEqual({ ok: true })
        const both = await owner.query(
          `select data ->> 'venueId' as venue from pgboss.job
         where data ->> 'integrationId' = $1 and state <> 'cancelled' order by venue`,
          [id],
        )
        expect(both.rows.map((row) => row.venue).sort()).toEqual([venueA.id, venueC.id].sort())
      })
    })
  },
)
