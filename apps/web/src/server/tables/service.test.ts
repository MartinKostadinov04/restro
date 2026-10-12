// The Tables & QR tab's service against a real Postgres, as the restro_app role (brief S3-07): what
// the tab reads (tables by hall, codes drawn from the venue's address setting, the default base
// address), what the actions do and queue (a new code names the old token to remove), who may do
// what, and the file downloads. The queue is a fake.
import { JOB_NAMES, newId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionTenant,
  provisionVenue,
  setVenueQrSettings,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'
import { createPool, type DbPool, type Venue, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { buildQrDownload, fileNamePart, parseFormat } from './download'
import {
  createAllCodes,
  issueCode,
  loadTablesView,
  renameTable,
  saveQrSettings,
  type TablesScope,
  type TablesServices,
  turnOffCode,
} from './service'

const DEFAULT_BASE = 'http://localhost:3000'

describe.skipIf(!hasDatabase)('the Tables & QR tab service (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venue: Venue
  let integrationId: string

  const sent: { name: string; data: Record<string, unknown> }[] = []
  let enqueueFails = false
  const services: TablesServices = {
    enqueue: async (name, data) => {
      if (enqueueFails) throw new Error('queue is down')
      sent.push({ name, data: data as Record<string, unknown> })
      return 'job-1'
    },
  }
  const errors: string[] = []
  let spy: { mockRestore: () => void }

  const current = async (): Promise<Venue> => {
    const [row] = await withTenant(app, tenant, (tx) =>
      tx.select().from(venues).where(eq(venues.id, venue.id)),
    )
    if (!row) throw new Error('no venue')
    return row
  }
  const scope = async (overrides: Partial<TablesScope> = {}): Promise<TablesScope> => ({
    pool: app,
    tenantId: tenant,
    venue: await current(),
    canManage: true,
    ...overrides,
  })
  const view = async (overrides: Partial<TablesScope> = {}) =>
    loadTablesView(await scope(overrides), DEFAULT_BASE, async (text) => `<svg>${text}</svg>`)

  beforeAll(async () => {
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-tables-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Tables tab club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venue = await provisionVenue(app, tenant, {
      name: 'Tables tab venue',
      slug: testSlug('tables-tab'),
    })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'tt.test' })).id
    await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 5, name: 'Barsy five' }])
    await mapBarsyVenue(app, tenant, integrationId, 5, venue.id)
    const place = (id: string, num: string | null, salon: string | null) => ({
      placeId: id,
      placeNum: num,
      salonName: salon,
      isPublic: id !== '4',
    })
    await upsertPlaces(
      app,
      tenant,
      integrationId,
      5,
      [
        place('1', '10', 'Terrace'),
        place('2', '2', 'Terrace'),
        place('3', 'VIP', 'Main hall'),
        place('4', '4', 'Main hall'),
        place('5', '1', null),
        place('6', null, 'Main hall'),
      ],
      { pagesOk: [true] },
    )
  })

  afterEach(() => {
    sent.length = 0
    enqueueFails = false
  })

  afterAll(async () => {
    spy?.mockRestore()
    await app?.end()
    if (owner) {
      for (const table of [
        'places',
        'barsy_venues',
        'integrations',
        'menu_routes',
        'tables',
        'areas',
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

  const rowByNumber = async (num: string | null) => {
    const found = (await view()).halls
      .flatMap((hall) => hall.tables)
      .find((row) => row.number === num)
    if (!found) throw new Error(`no table ${num}`)
    return found
  }

  describe('what the tab reads', () => {
    it('groups the tables by area (tables in no hall last), numbers in number order, with no till id anywhere', async () => {
      const read = await view()
      expect(read.halls.map((hall) => hall.name)).toEqual(['Main hall', 'Terrace', 'Tables'])
      expect(read.halls.every((hall) => /^ar_[0-9A-Za-z]{22}$/.test(hall.id))).toBe(true)
      expect(read.halls[1]?.tables.map((row) => row.number)).toEqual(['2', '10'])
      // A place with no number shows a dash and starts hidden (D95).
      expect(read.halls[0]?.tables.map((row) => row.number)).toEqual(['4', 'VIP', '—'])
      expect(read.total).toBe(6)
      expect(read.coded).toBe(0)
      expect(read.sample).toBeNull()
      expect(read.canManage).toBe(true)
      expect(read.qr).toMatchObject({
        mode: 'ours',
        baseUrl: DEFAULT_BASE,
        baseIsDefault: true,
        defaultBaseUrl: DEFAULT_BASE,
        ownPattern: null,
      })
      const json = JSON.stringify(read)
      expect(json).not.toContain('place_id')
      expect(json).not.toContain('placeId')
      expect(read.halls[1]?.tables[0]).toMatchObject({
        isPublic: true,
        token: null,
        address: null,
        qrSvg: null,
        label: null,
        shownAs: '2',
      })
      expect(read.halls[0]?.tables[0]).toMatchObject({ number: '4', isPublic: false })
      expect(read.halls[0]?.tables[2]).toMatchObject({ number: '—', isPublic: false })
    })

    it("another organisation's tab is empty, and a member who may not manage reads without acting", async () => {
      const other = await loadTablesView(
        { ...(await scope()), tenantId: otherTenant },
        DEFAULT_BASE,
        async () => '',
      )
      expect(other.total).toBe(0)
      expect((await view({ canManage: false })).canManage).toBe(false)
    })
  })

  describe('the actions', () => {
    it('create all: codes the shown tables, not the hidden ones, queues the files, and drew the codes', async () => {
      const result = await createAllCodes(await scope(), services)
      expect(result).toEqual({ ok: true, queued: true, issued: 4, skippedNoLabel: 0 })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishTableTokens,
          data: { tenantId: tenant, venueId: venue.id, retired: [] },
        },
      ])
      const read = await view()
      expect(read.coded).toBe(4)
      // The hidden table (4) has no code; the first shown one is the sample.
      expect(read.halls[0]?.tables[0]).toMatchObject({ number: '4', token: null })
      const first = read.halls[0]?.tables[1]
      expect(first?.token).toMatch(/^[0-9A-Za-z]{22}$/)
      expect(first?.address).toBe(`${DEFAULT_BASE}/t/${first?.token}`)
      expect(first?.qrSvg).toBe(`<svg>${first?.address}</svg>`)
      expect(read.sample).toEqual({ token: first?.token, shownAs: 'VIP' })
      // The nameless table has no code and the area it is in still lists it.
      expect(read.halls[0]?.tables.at(-1)).toMatchObject({ number: '—', token: null })

      // Asking again changes nothing and queues nothing.
      sent.length = 0
      expect(await createAllCodes(await scope(), services)).toMatchObject({
        ok: true,
        issued: 0,
        skippedNoLabel: 0,
      })
      expect(sent).toEqual([])
    })

    it('a new code names the old token for removal; turning off names it too; both queue the venue', async () => {
      const before = await rowByNumber('VIP')
      const renewed = await issueCode(await scope(), services, before.id)
      expect(renewed).toEqual({ ok: true, queued: true })
      const after = await rowByNumber('VIP')
      expect(after.token).not.toBe(before.token)
      expect(sent.at(-1)).toEqual({
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: tenant, venueId: venue.id, retired: [before.token] },
      })

      const off = await turnOffCode(await scope(), services, after.id)
      expect(off).toEqual({ ok: true, queued: true })
      expect((await rowByNumber('VIP')).token).toBeNull()
      expect(sent.at(-1)?.data.retired).toEqual([after.token])

      // Turning off what is off retires and queues nothing.
      sent.length = 0
      expect(await turnOffCode(await scope(), services, after.id)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([])
      // And a code can be created again.
      expect(await issueCode(await scope(), services, after.id)).toEqual({ ok: true, queued: true })
    })

    it('a name is queued only for a table that has a code, and it shows on the tab', async () => {
      const coded = await rowByNumber('10')
      expect(coded.token).not.toBeNull()
      sent.length = 0
      expect(await renameTable(await scope(), services, coded.id, '  Corner   10 ')).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toHaveLength(1)
      const renamed = await rowByNumber('10')
      expect(renamed).toMatchObject({ label: 'Corner 10', shownAs: 'Corner 10' })

      const nameless = (await view()).halls[0]?.tables.at(-1)
      if (!nameless) throw new Error('no nameless table')
      sent.length = 0
      expect(await renameTable(await scope(), services, nameless.id, 'Bar 1')).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([])
      // It is hidden (no number from the till): no code until it is shown.
      expect(await issueCode(await scope(), services, nameless.id)).toEqual({
        ok: false,
        error: 'hidden',
      })
      expect(await renameTable(await scope(), services, coded.id, 'x'.repeat(41))).toEqual({
        ok: false,
        error: 'invalid',
      })
    })

    it('a change that is saved but could not be queued says so, and logs it without a token', async () => {
      const row = await rowByNumber('2')
      enqueueFails = true
      errors.length = 0
      const result = await issueCode(await scope(), services, row.id)
      expect(result).toEqual({ ok: true, queued: false })
      expect((await rowByNumber('2')).token).not.toBeNull()
      expect(errors.join('\n')).toContain('table_token_job_not_queued')
      expect(errors.join('\n')).not.toContain((await rowByNumber('2')).token as string)
    })

    it('only owners and admins act: a member is refused and nothing changes or is queued', async () => {
      const row = await rowByNumber('2')
      const member = await scope({ canManage: false })
      sent.length = 0
      for (const result of [
        await createAllCodes(member, services),
        await issueCode(member, services, row.id),
        await turnOffCode(member, services, row.id),
        await renameTable(member, services, row.id, 'Hacked'),
        await saveQrSettings(member, { mode: 'ours', baseUrl: null, ownPattern: null }),
      ]) {
        expect(result).toEqual({ ok: false, error: 'forbidden' })
      }
      expect(sent).toEqual([])
      expect((await rowByNumber('2')).label).toBeNull()
    })

    it("another organisation cannot act on this one's tables", async () => {
      const row = await rowByNumber('2')
      const foreign: TablesScope = { ...(await scope()), tenantId: otherTenant }
      expect(await issueCode(foreign, services, row.id)).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(await turnOffCode(foreign, services, row.id)).toEqual({
        ok: false,
        error: 'not_found',
      })
    })
  })

  describe('the address setting', () => {
    it('saves a base address, then the own pattern; the codes on the tab follow the saved mode', async () => {
      expect(
        await saveQrSettings(await scope(), {
          mode: 'ours',
          baseUrl: 'http://192.168.1.20:3000/',
          ownPattern: null,
        }),
      ).toEqual({ ok: true, queued: true })
      let read = await view()
      expect(read.qr).toMatchObject({
        mode: 'ours',
        baseUrl: 'http://192.168.1.20:3000',
        baseIsDefault: false,
      })
      expect(read.sample?.token).toBeDefined()
      const sample = read.halls.flatMap((hall) => hall.tables).find((row) => row.token !== null)
      expect(sample?.address).toBe(`http://192.168.1.20:3000/t/${sample?.token}`)

      expect(
        await saveQrSettings(await scope(), {
          mode: 'own',
          baseUrl: 'http://192.168.1.20:3000',
          ownPattern: 'https://menu.club.bg/t/{token}',
        }),
      ).toEqual({ ok: true, queued: true })
      read = await view()
      expect(read.qr.mode).toBe('own')
      const own = read.halls.flatMap((hall) => hall.tables).find((row) => row.token !== null)
      expect(own?.address).toBe(`https://menu.club.bg/t/${own?.token}`)
      // The QR is drawn from the venue's own address, nothing was fetched.
      expect(own?.qrSvg).toBe(`<svg>${own?.address}</svg>`)
    })

    it('refuses a bad address and says which field and why', async () => {
      expect(
        await saveQrSettings(await scope(), {
          mode: 'own',
          baseUrl: null,
          ownPattern: 'https://menu.club.bg/t/',
        }),
      ).toEqual({ ok: false, error: 'invalid', field: 'ownPattern', problem: 'missing_token' })
      expect(
        await saveQrSettings(await scope(), {
          mode: 'ours',
          baseUrl: 'http://club.bg',
          ownPattern: null,
        }),
      ).toEqual({ ok: false, error: 'invalid', field: 'baseUrl', problem: 'not_https' })
    })

    it('the setting kept by the writer is what the core reader sees', async () => {
      await setVenueQrSettings(app, tenant, {
        venueId: venue.id as never,
        mode: 'ours',
        baseUrl: null,
        ownPattern: null,
      })
      expect((await view()).qr).toMatchObject({ mode: 'ours', baseUrl: DEFAULT_BASE })
    })
  })

  describe('the downloads', () => {
    const deps = () => ({ pool: app, defaultBaseUrl: DEFAULT_BASE })

    it('makes a PNG and an SVG of the address the setting gives, for the right table only', async () => {
      const row = await rowByNumber('2')
      expect(row.token).not.toBeNull()
      const png = await buildQrDownload(deps(), tenant, row.id, 'png')
      if (!png.ok) throw new Error('no png')
      expect(png.contentType).toBe('image/png')
      expect(png.filename).toBe('restro-table-2.png')
      expect(Array.from((png.body as Uint8Array).slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])

      const svg = await buildQrDownload(deps(), tenant, row.id, 'svg')
      if (!svg.ok) throw new Error('no svg')
      expect(svg.contentType).toContain('image/svg+xml')
      expect(svg.filename).toBe('restro-table-2.svg')
      expect(String(svg.body)).toMatch(/^<\?xml|^<svg/)
      expect(String(svg.body)).toContain('width="1024"')

      // Another organisation, a made-up id and a table without a code are all just "no".
      expect(await buildQrDownload(deps(), otherTenant, row.id, 'png')).toEqual({ ok: false })
      expect(await buildQrDownload(deps(), tenant, 'tb_nope', 'png')).toEqual({ ok: false })
      const off = await rowByNumber('VIP')
      await turnOffCode(await scope(), services, off.id)
      expect(await buildQrDownload(deps(), tenant, off.id, 'png')).toEqual({ ok: false })
    })

    it('names the file from the table, in ASCII only; and reads the format', () => {
      expect(fileNamePart('12')).toBe('12')
      expect(fileNamePart('VIP 3')).toBe('VIP-3')
      expect(fileNamePart('Бар 1')).toBe('1')
      expect(fileNamePart('Тераса')).toBe('qr')
      expect(fileNamePart(null)).toBe('qr')
      expect(fileNamePart('../../etc/passwd')).toBe('etc-passwd')
      expect(parseFormat('svg')).toBe('svg')
      expect(parseFormat('png')).toBe('png')
      expect(parseFormat('exe')).toBe('png')
      expect(parseFormat(null)).toBe('png')
    })
  })
})
