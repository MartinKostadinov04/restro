// The Tables & QR tab's service against a real Postgres, as the restro_app role (briefs S3-07 and
// S5): what the tab reads (tables by area, codes drawn from the installation's address, the menu
// each area and table shows), what the actions do and queue (a job only when a public file must
// go, come or change), who may do what, a till's areas and tables against a venue made by hand,
// the menu routes, and the file downloads. The queue is a fake, and so is the worker's reveal:
// a code is stored as its hash and a copy only the worker can open (#70), so the fake "reveals"
// a made-up code per table and the tests compare hashes where they compared codes.
import { generateKeyPairSync } from 'node:crypto'
import { type ChangeSet, JOB_NAMES, newId } from '@restro/core'
import {
  apply,
  createIntegration,
  createMenu,
  deleteMenu,
  loadTokenFiles,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  setVenueQrSettings,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'
import { createPool, type DbPool, type Venue, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { RevealCodes } from '../reveal'
import { appDatabaseUrl, hasDatabase, openOwnerPool, testSlug } from '../test-database'
import { buildQrDownload, fileNamePart, parseFormat } from './download'
import {
  addArea,
  addTable,
  chooseMenu,
  createAllCodes,
  hideArea,
  hideTable,
  issueCode,
  loadTablesView,
  moveAreaOf,
  moveTableOf,
  removeArea,
  removeTable,
  renameAreaOf,
  renameTable,
  renumberTable,
  revealCodes,
  type TablesScope,
  type TablesServices,
  turnOffCode,
} from './service'
import { withRevealed } from './view'

const DEFAULT_BASE = 'http://localhost:3000'
/** The worker's public seal key (base64url DER), as SEAL_PUBLIC_KEY carries it. */
const SEAL_PUBLIC_KEY = generateKeyPairSync('x25519')
  .publicKey.export({ type: 'spki', format: 'der' })
  .toString('base64url')
/** What the fake reveal gives for a table. */
const fakeCode = (tableId: string) => `code${tableId.slice(3)}`
const HASH = /^[0-9a-f]{64}$/

describe.skipIf(!hasDatabase)('the Tables & QR tab service (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  /** The venue with a till (its areas and tables are the till's). */
  let venue: Venue
  /** The venue made by hand, with three menus: live and published, published, never published. */
  let hand: Venue
  let liveMenu: string
  let cocktails: string
  let brunch: string
  let integrationId: string

  const sent: { name: string; data: Record<string, unknown> }[] = []
  let enqueueFails = false
  const services: TablesServices = {
    enqueue: async (name, data) => {
      if (enqueueFails) throw new Error('queue is down')
      sent.push({ name, data: data as Record<string, unknown> })
      return 'job-1'
    },
    sealPublicKey: SEAL_PUBLIC_KEY,
  }
  /** Each batch the fake reveal was asked for. */
  const revealAsked: (readonly string[])[] = []
  const reveal: RevealCodes = async (tableIds) => {
    revealAsked.push(tableIds)
    return new Map(tableIds.map((id) => [id, fakeCode(id)]))
  }
  /** The signed-in owner a re-issue's Log entry names (a member of the organisation). */
  const actor = { userId: `us-tables-${newId('jb').slice(3)}`, sessionId: 'session-tables-test' }
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
    loadTablesView(
      await scope(overrides),
      DEFAULT_BASE,
      async (text) => `<svg>${text}</svg>`,
      reveal,
    )
  const handScope = (overrides: Partial<TablesScope> = {}): TablesScope => ({
    pool: app,
    tenantId: tenant,
    venue: { id: hand.id, name: hand.name },
    canManage: true,
    ...overrides,
  })
  const handView = (overrides: Partial<TablesScope> = {}) =>
    loadTablesView(handScope(overrides), DEFAULT_BASE, async (text) => `<svg>${text}</svg>`, reveal)
  /** A table's stored code hash (what its file is named after), or null. */
  const hashOf = async (tableId: string): Promise<string | null> =>
    (
      await owner.query<{ qr_code_hash: string | null }>(
        'select qr_code_hash from restro.tables where id = $1',
        [tableId],
      )
    ).rows[0]?.qr_code_hash ?? null
  const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`)
    return result as Extract<T, { ok: true }>
  }

  /** Gives a menu a section with one priced item, so it can be published. */
  async function fill(menuId: string, name: string): Promise<void> {
    const section = newId('nd')
    const item = newId('nd')
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const result = await apply(app, tenant, {
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
          parent: { id: menuId },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: name, en_US: name }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: `${name} 1`, en_US: `${name} 1` }),
        manual(item, 'price', { amount_minor: 900, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  }

  beforeAll(async () => {
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-tables-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Tables tab club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    // The organisation and its owner are Better Auth's rows: a re-issue checks the person is a
    // member (the service write path, #70).
    await owner.query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)', [
      tenant,
      'Tables tab club',
      testSlug('tables-org'),
    ])
    await owner.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      actor.userId,
      'Tables owner',
      `${actor.userId}@example.test`,
    ])
    await owner.query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${actor.userId}`, tenant, actor.userId, 'owner'],
    )
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

    hand = await provisionVenue(app, tenant, { name: 'Hand venue', slug: testSlug('tables-hand') })
    liveMenu = (await provisionMenu(app, tenant, hand.id)).id
    cocktails = ok(await createMenu(app, tenant, { venueId: hand.id, name: 'Cocktails' })).menu.id
    brunch = ok(await createMenu(app, tenant, { venueId: hand.id, name: 'Brunch' })).menu.id
    await fill(liveMenu, 'Main')
    await fill(cocktails, 'Cocktails')
    await fill(brunch, 'Brunch')
    for (const menuId of [liveMenu, cocktails]) {
      await publishMenu(app, tenant, {
        menuId,
        venueId: hand.id,
        reason: 'manual',
        actor: 'user:us_test',
      })
    }
  })

  afterEach(() => {
    sent.length = 0
    revealAsked.length = 0
    enqueueFails = false
  })

  afterAll(async () => {
    spy?.mockRestore()
    await app?.end()
    if (owner) {
      for (const table of [
        'log_entries',
        'item_first_published',
        'publish_pointers',
        'snapshots',
        'events',
        'field_values',
        'placements',
        'source_links',
        'menu_routes',
        'menus',
        'nodes',
        'source_records',
        'job_runs',
        'places',
        'tables',
        'areas',
        'venue_slug_history',
        'purge_log',
        'barsy_venues',
        'assets',
        'integrations',
        'tags',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [
          [tenant, otherTenant],
        ])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [[tenant, otherTenant]])
      await owner.query('delete from restro.auth_user where id = $1', [actor.userId])
      await owner.query('delete from restro.auth_organization where id = $1', [tenant])
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
      // The venue is served by a till: its areas and tables are the till's, which {source} names.
      expect(read).toMatchObject({ fromTill: true, sourceLabel: 'barsy', baseUrl: DEFAULT_BASE })
      // It has no menu of its own yet, so nothing is shown for any table.
      expect(read.menus).toEqual([])
      expect(read.halls[1]?.tables[0]).toMatchObject({ menu: null, routeMenuId: null })
      const json = JSON.stringify(read)
      expect(json).not.toContain('place_id')
      expect(json).not.toContain('placeId')
      expect(read.halls[1]?.tables[0]).toMatchObject({
        isPublic: true,
        hasCode: false,
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

    it('asks the worker for the drawn codes in one batch, and never for a member', async () => {
      await createAllCodes(await scope(), services)
      revealAsked.length = 0
      const read = await view()
      expect(revealAsked).toHaveLength(1)
      expect(revealAsked[0]).toHaveLength(read.coded)
      revealAsked.length = 0
      const member = await view({ canManage: false })
      expect(revealAsked).toEqual([])
      // A member sees which tables have a code, but no code.
      const rows = member.halls.flatMap((hall) => hall.tables)
      expect(rows.some((row) => row.hasCode)).toBe(true)
      expect(rows.every((row) => row.address === null && row.qrSvg === null)).toBe(true)
      expect(member.sample).toBeNull()
      // Back to no codes for the tests that follow.
      for (const row of rows) await turnOffCode(await scope(), services, row.id)
    })

    it('the tab reveals its codes apart from its render: once per code, the same as the print sheet', async () => {
      await createAllCodes(await scope(), services)
      const render = async (text: string) => `<svg>${text}</svg>`
      revealAsked.length = 0
      // The tab's own read (no reveal) asks the worker for nothing and draws no code yet.
      const tab = await loadTablesView(await scope(), DEFAULT_BASE, render)
      expect(revealAsked).toEqual([])
      const rows = tab.halls.flatMap((hall) => hall.tables)
      expect(rows.every((row) => row.address === null && row.qrSvg === null)).toBe(true)
      // Each card with a code that leads somewhere names it by a key that is not its hash.
      const keyed = rows.filter((row) => row.codeKey !== null)
      expect(keyed).toHaveLength(tab.coded)
      for (const row of keyed) {
        const hash = (await hashOf(row.id)) ?? ''
        expect(row.codeKey).not.toContain(hash.slice(0, 16))
      }
      expect(rows.filter((row) => !row.isPublic).every((row) => row.codeKey === null)).toBe(true)
      // A member gets no keys and may not ask.
      const member = await loadTablesView(await scope({ canManage: false }), DEFAULT_BASE, render)
      expect(member.halls.flatMap((hall) => hall.tables).every((row) => row.codeKey === null)).toBe(
        true,
      )
      const ids = keyed.map((row) => row.id)
      expect(
        await revealCodes(await scope({ canManage: false }), DEFAULT_BASE, ids, reveal, render),
      ).toEqual({ ok: false, error: 'forbidden' })
      expect(revealAsked).toEqual([])

      // One batch for what the tab asks; a hidden table or another venue's id is left out.
      const hidden = rows.find((row) => !row.isPublic)
      const asked = [...ids, ...(hidden ? [hidden.id] : []), newId('tb')]
      const answer = await revealCodes(await scope(), DEFAULT_BASE, asked, reveal, render)
      if (!answer.ok) throw new Error('refused')
      expect(revealAsked).toHaveLength(1)
      expect([...(revealAsked[0] ?? [])].sort()).toEqual([...ids].sort())
      expect(answer.codes.map((code) => code.id).sort()).toEqual([...ids].sort())
      // Drawn in, the tab shows what the print sheet (which reveals in its render) shows.
      const drawn = withRevealed(tab, new Map(answer.codes.map((code) => [code.codeKey, code])))
      const printed = await loadTablesView(await scope(), DEFAULT_BASE, render, reveal)
      expect(drawn.halls).toEqual(printed.halls)
      expect(drawn.sample).toEqual(printed.sample)
      // A code given to another table, or under another key, draws nothing.
      const [first] = answer.codes
      if (!first) throw new Error('no code')
      const elsewhere = withRevealed(tab, new Map([[first.codeKey, { ...first, id: newId('tb') }]]))
      expect(
        elsewhere.halls.flatMap((hall) => hall.tables).every((row) => row.qrSvg === null),
      ).toBe(true)

      // A code made again gets a new key; the others keep theirs.
      await turnOffCode(await scope(), services, first.id)
      await createAllCodes(await scope(), services)
      const again = (await loadTablesView(await scope(), DEFAULT_BASE, render)).halls.flatMap(
        (hall) => hall.tables,
      )
      const keyOf = (list: typeof rows, id: string) => list.find((row) => row.id === id)?.codeKey
      expect(keyOf(again, first.id)).not.toBe(first.codeKey)
      for (const id of ids.filter((other) => other !== first.id)) {
        expect(keyOf(again, id)).toBe(keyOf(rows, id))
      }
      // Without an address there is nothing to reveal.
      revealAsked.length = 0
      expect(await revealCodes(await scope(), null, ids, reveal, render)).toEqual({
        ok: true,
        codes: [],
      })
      expect(revealAsked).toEqual([])
      for (const row of again) await turnOffCode(await scope(), services, row.id)
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
      expect(read.halls[0]?.tables[0]).toMatchObject({ number: '4', hasCode: false })
      const first = read.halls[0]?.tables[1]
      if (!first) throw new Error('no first table')
      expect(first.hasCode).toBe(true)
      // Stored as its hash and a sealed copy, never in plain (#70).
      const stored = await owner.query(
        'select qr_token, qr_code_hash, qr_code_sealed from restro.tables where id = $1',
        [first.id],
      )
      expect(stored.rows[0]?.qr_token).toBeNull()
      expect(stored.rows[0]?.qr_code_hash).toMatch(HASH)
      expect(stored.rows[0]?.qr_code_sealed).toMatch(/^rs1\./)
      // The address carries the code the worker revealed.
      expect(first.address).toBe(`${DEFAULT_BASE}/t/${fakeCode(first.id)}`)
      expect(first.qrSvg).toBe(`<svg>${first.address}</svg>`)
      expect(read.sample).toEqual({ token: fakeCode(first.id), shownAs: 'VIP' })
      // The nameless table has no code and the area it is in still lists it.
      expect(read.halls[0]?.tables.at(-1)).toMatchObject({ number: '—', hasCode: false })

      // Asking again changes nothing and queues nothing.
      sent.length = 0
      expect(await createAllCodes(await scope(), services)).toMatchObject({
        ok: true,
        issued: 0,
        skippedNoLabel: 0,
      })
      expect(sent).toEqual([])
    })

    it('a new code is a re-issue: it names the old file for removal and writes a record Log entry', async () => {
      const table = await rowByNumber('VIP')
      const before = await hashOf(table.id)
      const generation = async () =>
        (
          await owner.query<{ code_generation: number }>(
            'select code_generation from restro.tables where id = $1',
            [table.id],
          )
        ).rows[0]?.code_generation
      const generationBefore = await generation()
      // A re-issue names the person who asked: without their sign-in, it is refused.
      expect(await issueCode(await scope(), services, table.id)).toEqual({
        ok: false,
        error: 'forbidden',
      })
      // Without the worker's key no code can be sealed: nothing changes.
      errors.length = 0
      expect(
        await issueCode(
          await scope({ actor }),
          { ...services, sealPublicKey: undefined },
          table.id,
        ),
      ).toEqual({ ok: false, error: 'failed' })
      expect(errors.join('\n')).toContain('table_code_seal_key_missing')
      expect(await hashOf(table.id)).toBe(before)

      const renewed = await issueCode(await scope({ actor }), services, table.id)
      expect(renewed).toEqual({ ok: true, queued: true })
      const after = await hashOf(table.id)
      expect(after).toMatch(HASH)
      expect(after).not.toBe(before)
      expect(await generation()).toBe((generationBefore ?? 0) + 1)
      expect(sent.at(-1)).toEqual({
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: tenant, venueId: venue.id, retired: [before] },
      })
      const log = await owner.query<{ retention: string; table_id: string; actor: string }>(
        "select retention, table_id, actor from restro.log_entries where tenant_id = $1 and kind = 'table_code.reissued'",
        [tenant],
      )
      expect(log.rows).toEqual([
        { retention: 'record', table_id: table.id, actor: `user:${actor.userId}` },
      ])

      const off = await turnOffCode(await scope(), services, table.id)
      expect(off).toEqual({ ok: true, queued: true })
      expect(await hashOf(table.id)).toBeNull()
      expect((await rowByNumber('VIP')).hasCode).toBe(false)
      expect(sent.at(-1)?.data.retired).toEqual([after])

      // Turning off what is off retires and queues nothing.
      sent.length = 0
      expect(await turnOffCode(await scope(), services, table.id)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([])
      // And a code can be created again (a first code needs no Log entry).
      expect(await issueCode(await scope(), services, table.id)).toEqual({ ok: true, queued: true })
    })

    it('a name is queued only for a table that has a code, and it shows on the tab', async () => {
      const coded = await rowByNumber('10')
      expect(coded.hasCode).toBe(true)
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

    it('a change that is saved but could not be queued says so, and logs it without a code', async () => {
      const row = await rowByNumber('2')
      enqueueFails = true
      errors.length = 0
      const result = await issueCode(await scope({ actor }), services, row.id)
      expect(result).toEqual({ ok: true, queued: false })
      const hash = await hashOf(row.id)
      expect(hash).toMatch(HASH)
      expect(errors.join('\n')).toContain('table_token_job_not_queued')
      expect(errors.join('\n')).not.toContain(hash as string)
      expect(errors.join('\n')).not.toContain(fakeCode(row.id))
    })

    it('only owners and admins act: a member is refused and nothing changes or is queued', async () => {
      const row = await rowByNumber('2')
      const areaId = (await view()).halls[1]?.id ?? ''
      const member = await scope({ canManage: false })
      sent.length = 0
      for (const result of [
        await createAllCodes(member, services),
        await issueCode(member, services, row.id),
        await turnOffCode(member, services, row.id),
        await renameTable(member, services, row.id, 'Hacked'),
        await addArea(member, 'Hacked'),
        await renameAreaOf(member, areaId, 'Hacked'),
        await hideArea(member, services, areaId, true),
        await moveAreaOf(member, areaId, 0),
        await removeArea(member, services, areaId),
        await addTable(member, areaId, { number: '99', name: null }),
        await renumberTable(member, services, row.id, '99'),
        await hideTable(member, services, row.id, true),
        await moveTableOf(member, services, row.id, undefined, 0),
        await removeTable(member, services, row.id),
        await chooseMenu(member, services, { tableId: row.id as never }, null),
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

  describe('the address of the codes (D94)', () => {
    it("is this installation's address; an own link a venue saved before is not read", async () => {
      // An earlier build let a venue save its own link: core keeps the writer, the tab ignores it.
      await setVenueQrSettings(app, tenant, {
        venueId: venue.id as never,
        mode: 'own',
        baseUrl: null,
        ownPattern: 'https://menu.club.bg/t/{token}',
      })
      const read = await view()
      expect(read.baseUrl).toBe(DEFAULT_BASE)
      const sample = read.halls.flatMap((hall) => hall.tables).find((row) => row.address !== null)
      if (!sample) throw new Error('no coded table')
      expect(sample.address).toBe(`${DEFAULT_BASE}/t/${fakeCode(sample.id)}`)
      // The QR is drawn from that address; nothing was fetched.
      expect(sample?.qrSvg).toBe(`<svg>${sample?.address}</svg>`)
    })

    it('is tidied, and an address that cannot be used leaves the codes undrawn', async () => {
      const render = async (text: string) => `<svg>${text}</svg>`
      const venueScope = await scope()
      expect(
        (await loadTablesView(venueScope, 'http://192.168.1.20:3000/', render, reveal)).baseUrl,
      ).toBe('http://192.168.1.20:3000')
      for (const unusable of [null, 'club.bg', 'http://club.bg']) {
        revealAsked.length = 0
        const read = await loadTablesView(venueScope, unusable, render, reveal)
        expect(read.baseUrl).toBeNull()
        const rows = read.halls.flatMap((hall) => hall.tables)
        expect(rows.every((row) => row.address === null && row.qrSvg === null)).toBe(true)
        // The codes exist; they just have no address to carry yet (so none is revealed).
        expect(rows.some((row) => row.hasCode)).toBe(true)
        expect(revealAsked).toEqual([])
      }
    })
  })

  describe('the downloads', () => {
    const deps = (codes: RevealCodes = reveal) => ({
      pool: app,
      defaultBaseUrl: DEFAULT_BASE,
      reveal: () => codes,
    })

    it('makes a PNG and an SVG of the address the setting gives, for the right table only', async () => {
      const row = await rowByNumber('2')
      expect(row.hasCode).toBe(true)
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
      // A code the worker does not reveal gives no file.
      expect(
        await buildQrDownload(
          deps(async () => new Map()),
          tenant,
          row.id,
          'png',
        ),
      ).toEqual({ ok: false })
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

  describe("a venue with a till: the till's areas and tables (D95)", () => {
    const rows = async () => (await view()).halls.flatMap((hall) => hall.tables)
    const hashesOf = async (...numbers: string[]) =>
      (
        await Promise.all(
          (
            await rows()
          )
            .filter((row) => numbers.includes(row.number ?? ''))
            .map((row) => hashOf(row.id)),
        )
      )
        .map(String)
        .sort()

    it('renames, reorders and hides an area; never creates or deletes one', async () => {
      const halls = (await view()).halls
      const terrace = halls.find((hall) => hall.name === 'Terrace')
      if (!terrace) throw new Error('no terrace')

      expect(await renameAreaOf(await scope(), terrace.id, '  Roof   terrace ')).toEqual({
        ok: true,
        queued: true,
      })
      expect((await view()).halls.find((hall) => hall.id === terrace.id)?.name).toBe('Roof terrace')
      // A rename touches no public file.
      expect(sent).toEqual([])

      expect(await moveAreaOf(await scope(), terrace.id, 0)).toEqual({ ok: true, queued: true })
      expect((await view()).halls[0]?.id).toBe(terrace.id)
      expect(await moveAreaOf(await scope(), terrace.id, 1)).toEqual({ ok: true, queued: true })
      expect((await view()).halls[1]?.id).toBe(terrace.id)
      expect(sent).toEqual([])

      // Hiding takes the files of its tables away (their codes stay); showing brings them back.
      const tokens = await hashesOf('2', '10')
      expect(tokens).toHaveLength(2)
      const codedBefore = (await view()).coded
      expect(await hideArea(await scope(), services, terrace.id, true)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent.at(-1)).toEqual({
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: tenant, venueId: venue.id, retired: tokens },
      })
      const hidden = (await view()).halls.find((hall) => hall.id === terrace.id)
      expect(hidden?.isPublic).toBe(false)
      // The codes are paused: they stay on the rows, but they lead nowhere now.
      expect(
        (await Promise.all((hidden?.tables ?? []).map((row) => hashOf(row.id)))).map(String).sort(),
      ).toEqual(tokens)
      expect(hidden?.tables.every((row) => row.hasCode)).toBe(true)
      expect(hidden?.tables.every((row) => row.address === null && row.qrSvg === null)).toBe(true)
      expect((await view()).coded).toBe(codedBefore - 2)
      sent.length = 0
      expect(await hideArea(await scope(), services, terrace.id, false)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([
        { name: JOB_NAMES.publishTableTokens, data: expect.objectContaining({ retired: [] }) },
      ])
      expect((await view()).coded).toBe(codedBefore)

      // The till's halls are the till's.
      expect(await addArea(await scope(), 'Mine')).toEqual({ ok: false, error: 'from_till' })
      expect(await removeArea(await scope(), services, terrace.id)).toEqual({
        ok: false,
        error: 'from_till',
      })
      expect(await addTable(await scope(), terrace.id, { number: '99', name: null })).toEqual({
        ok: false,
        error: 'from_till',
      })
      expect((await view()).halls).toHaveLength(3)
    })

    it('renames, reorders and hides a table; never creates, deletes, renumbers or moves it to another area', async () => {
      const two = await rowByNumber('2')
      const ten = await rowByNumber('10')
      const terraceId = (await view()).halls.find((hall) =>
        hall.tables.some((r) => r.id === two.id),
      )?.id as string
      sent.length = 0

      // Order within the hall: 10 goes before 2.
      expect(await moveTableOf(await scope(), services, ten.id, undefined, 0)).toEqual({
        ok: true,
        queued: true,
      })
      expect(
        (await view()).halls.find((hall) => hall.id === terraceId)?.tables.map((r) => r.number),
      ).toEqual(['10', '2'])
      expect(sent).toEqual([])
      await moveTableOf(await scope(), services, ten.id, undefined, 1)
      expect(
        (await view()).halls.find((hall) => hall.id === terraceId)?.tables.map((r) => r.number),
      ).toEqual(['2', '10'])

      // Hiding a table with a code takes its file away; showing brings it back.
      const twoHash = await hashOf(two.id)
      expect(await hideTable(await scope(), services, two.id, true)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent.at(-1)?.data.retired).toEqual([twoHash])
      expect(await rowByNumber('2')).toMatchObject({ isPublic: false, hasCode: true })
      expect(await hashOf(two.id)).toBe(twoHash)
      sent.length = 0
      expect(await hideTable(await scope(), services, two.id, false)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]?.data.retired).toEqual([])
      expect(await rowByNumber('2')).toMatchObject({ isPublic: true })

      // The rest is the till's.
      const mainHall = (await view()).halls.find((hall) => hall.name === 'Main hall')
      expect(await removeTable(await scope(), services, two.id)).toEqual({
        ok: false,
        error: 'from_till',
      })
      expect(await renumberTable(await scope(), services, two.id, '99')).toEqual({
        ok: false,
        error: 'from_till',
      })
      expect(await moveTableOf(await scope(), services, two.id, mainHall?.id, 0)).toEqual({
        ok: false,
        error: 'from_till',
      })
      expect((await rowByNumber('2')).number).toBe('2')
    })
  })

  describe('a venue made by hand', () => {
    let hall = ''
    let patio = ''
    let one = ''
    let two = ''
    let three = ''
    const named = async () => (await handView()).halls
    const idsIn = async (areaId: string) =>
      (await named()).find((candidate) => candidate.id === areaId)?.tables.map((r) => r.id)
    const tokenOf = async (tableId: string) => (await hashOf(tableId)) as string

    it('adds areas and tables, which touch no public file', async () => {
      expect(await addArea(handScope(), '  Main   hall ')).toEqual({ ok: true, queued: true })
      expect(await addArea(handScope(), 'Patio')).toEqual({ ok: true, queued: true })
      expect(await addArea(handScope(), '   ')).toEqual({ ok: false, error: 'invalid' })
      expect(await addArea(handScope(), 'x'.repeat(61))).toEqual({ ok: false, error: 'invalid' })
      const read = await handView()
      expect(read).toMatchObject({ fromTill: false, sourceLabel: '', total: 0 })
      expect(read.halls.map((h) => h.name)).toEqual(['Main hall', 'Patio'])
      hall = read.halls[0]?.id as string
      patio = read.halls[1]?.id as string

      expect(await addTable(handScope(), hall, { number: '1', name: null })).toEqual({
        ok: true,
        queued: true,
      })
      expect(await addTable(handScope(), hall, { number: '2', name: null })).toEqual({
        ok: true,
        queued: true,
      })
      expect(await addTable(handScope(), patio, { number: '3', name: ' Corner ' })).toEqual({
        ok: true,
        queued: true,
      })
      // A table needs a name or a number, and an area of this venue.
      expect(await addTable(handScope(), hall, { number: null, name: '  ' })).toEqual({
        ok: false,
        error: 'no_label',
      })
      const tillArea = (await view()).halls[0]?.id as string
      expect(await addTable(handScope(), tillArea, { number: '9', name: null })).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(await addTable(handScope(), 'ar_nope', { number: '9', name: null })).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(sent).toEqual([])

      const tables = (await handView()).halls.map((h) => h.tables)
      expect(tables.map((list) => list.map((r) => r.shownAs))).toEqual([['1', '2'], ['Corner']])
      one = tables[0]?.[0]?.id as string
      two = tables[0]?.[1]?.id as string
      three = tables[1]?.[0]?.id as string
    })

    it('hands out codes, then a number or a name is queued only for a table that has one', async () => {
      expect(await createAllCodes(handScope(), services)).toEqual({
        ok: true,
        queued: true,
        issued: 3,
        skippedNoLabel: 0,
      })
      expect(sent).toHaveLength(1)
      sent.length = 0

      // A table with a code: its file says its label, so the job is queued.
      expect(await renumberTable(handScope(), services, one, ' 11 ')).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toHaveLength(1)
      sent.length = 0
      expect((await handView()).halls[0]?.tables[0]).toMatchObject({ number: '11', shownAs: '11' })
      // The table "Corner" has a name and a number: a number it loses is fine, its name stays.
      expect(await renumberTable(handScope(), services, three, null)).toEqual({
        ok: true,
        queued: true,
      })
      // But a table with neither is refused.
      expect(await renameTable(handScope(), services, three, null)).toEqual({
        ok: false,
        error: 'no_label',
      })
      sent.length = 0

      // A table without a code has no file: nothing is queued.
      expect(await addTable(handScope(), hall, { number: '4', name: null })).toEqual({
        ok: true,
        queued: true,
      })
      const four = (await handView()).halls[0]?.tables.at(-1)?.id as string
      expect(await renumberTable(handScope(), services, four, '44')).toEqual({
        ok: true,
        queued: true,
      })
      expect(await hideTable(handScope(), services, four, true)).toEqual({ ok: true, queued: true })
      expect(await hideTable(handScope(), services, four, false)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([])
      // A hidden table gets no code (D95).
      await hideTable(handScope(), services, four, true)
      expect(await issueCode(handScope(), services, four)).toEqual({ ok: false, error: 'hidden' })
      expect(await removeTable(handScope(), services, four)).toEqual({ ok: true, queued: true })
      expect(sent).toEqual([])
    })

    it('hides and shows a table and an area; only a file that must go or come is queued', async () => {
      const token = await tokenOf(one)
      expect(await hideTable(handScope(), services, one, true)).toEqual({ ok: true, queued: true })
      expect(sent.at(-1)?.data.retired).toEqual([token])
      const hidden = (await handView()).halls[0]?.tables[0]
      expect(hidden).toMatchObject({ isPublic: false, hasCode: true, address: null, qrSvg: null })
      expect(await hashOf(one)).toBe(token)
      expect((await handView()).coded).toBe(2)
      sent.length = 0
      await hideTable(handScope(), services, one, false)
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishTableTokens,
          data: { tenantId: tenant, venueId: hand.id, retired: [] },
        },
      ])
      sent.length = 0

      const patioToken = await tokenOf(three)
      expect(await hideArea(handScope(), services, patio, true)).toEqual({ ok: true, queued: true })
      expect(sent.at(-1)?.data.retired).toEqual([patioToken])
      // A new code for a coded table is a re-issue, which names the person: refused while hidden.
      expect(await issueCode(handScope({ actor }), services, three)).toEqual({
        ok: false,
        error: 'hidden',
      })
      sent.length = 0
      await hideArea(handScope(), services, patio, false)
      expect(sent).toHaveLength(1)
      expect(sent[0]?.data.retired).toEqual([])
    })

    it('moves a table inside its area (no file changes) and to another area (its menu may)', async () => {
      sent.length = 0
      expect(await moveTableOf(handScope(), services, one, undefined, 1)).toEqual({
        ok: true,
        queued: true,
      })
      expect(await idsIn(hall)).toEqual([two, one])
      expect(sent).toEqual([])
      // A position beyond the end is the end; a negative one cannot be asked for.
      expect(await moveTableOf(handScope(), services, one, undefined, 99)).toEqual({
        ok: true,
        queued: true,
      })
      expect(await idsIn(hall)).toEqual([two, one])

      expect(await moveTableOf(handScope(), services, three, hall, 0)).toEqual({
        ok: true,
        queued: true,
      })
      expect(await idsIn(hall)).toEqual([three, two, one])
      expect(await idsIn(patio)).toEqual([])
      expect(sent).toHaveLength(1)
      expect(sent[0]?.data.retired).toEqual([])

      // An area of another venue is not there for this one.
      const tillArea = (await view()).halls[0]?.id as string
      expect(await moveTableOf(handScope(), services, one, tillArea, 0)).toEqual({
        ok: false,
        error: 'not_found',
      })
      // Nor is a table of another venue.
      const tillTable = await rowByNumber('2')
      sent.length = 0
      for (const result of [
        await hideTable(handScope(), services, tillTable.id, true),
        await renumberTable(handScope(), services, tillTable.id, '5'),
        await moveTableOf(handScope(), services, tillTable.id, hall, 0),
        await removeTable(handScope(), services, tillTable.id),
        await renameAreaOf(handScope(), tillArea, 'Mine'),
        await hideArea(handScope(), services, tillArea, true),
        await moveAreaOf(handScope(), tillArea, 0),
        await removeArea(handScope(), services, tillArea),
      ]) {
        expect(result).toEqual({ ok: false, error: 'not_found' })
      }
      expect((await rowByNumber('2')).isPublic).toBe(true)
      expect(sent).toEqual([])

      // Areas: renamed and reordered without a job.
      expect(await renameAreaOf(handScope(), patio, 'Garden')).toEqual({ ok: true, queued: true })
      expect(await moveAreaOf(handScope(), patio, 0)).toEqual({ ok: true, queued: true })
      expect((await handView()).halls.map((h) => h.name)).toEqual(['Garden', 'Main hall'])
      expect(sent).toEqual([])
    })

    it('deletes a table and an area; their codes are named for removal', async () => {
      const threeToken = await tokenOf(three)
      expect(await removeTable(handScope(), services, three)).toEqual({ ok: true, queued: true })
      expect(sent.at(-1)?.data.retired).toEqual([threeToken])
      expect(await idsIn(hall)).toEqual([two, one])
      sent.length = 0

      const tokens = [await tokenOf(one), await tokenOf(two)].sort()
      expect(await removeArea(handScope(), services, hall)).toEqual({ ok: true, queued: true })
      expect(sent.at(-1)?.data.retired).toEqual(tokens)
      expect((await handView()).halls.map((h) => h.name)).toEqual(['Garden'])
      expect((await handView()).total).toBe(0)
      sent.length = 0

      // An empty area has no file to remove.
      expect(await removeArea(handScope(), services, patio)).toEqual({ ok: true, queued: true })
      expect(sent).toEqual([])
      expect((await handView()).halls).toEqual([])
    })
  })

  describe('the menu each area and table shows (D95, M2)', () => {
    let bar = ''
    let lounge = ''
    let barTable = ''
    let loungeTable = ''
    const read = async () => handView()
    const hallOf = async (areaId: string) =>
      (await read()).halls.find((candidate) => candidate.id === areaId)
    const rowOf = async (tableId: string) =>
      (await read()).halls.flatMap((h) => h.tables).find((r) => r.id === tableId)

    it('starts with the venue’s live menu everywhere, and lists the menus in use', async () => {
      await addArea(handScope(), 'Bar')
      await addArea(handScope(), 'Lounge')
      const halls = (await handView()).halls
      bar = halls.at(-2)?.id as string
      lounge = halls.at(-1)?.id as string
      await addTable(handScope(), bar, { number: 'B1', name: null })
      await addTable(handScope(), lounge, { number: 'L1', name: null })
      barTable = (await hallOf(bar))?.tables[0]?.id as string
      loungeTable = (await hallOf(lounge))?.tables[0]?.id as string
      await createAllCodes(handScope(), services)

      const current = await read()
      // A menu with no header name of its own is listed by the venue's name.
      expect(current.menus).toEqual([
        { id: liveMenu, name: 'Hand venue', live: true },
        { id: cocktails, name: 'Cocktails', live: false },
        { id: brunch, name: 'Brunch', live: false },
      ])
      const live = { id: liveMenu, name: 'Hand venue', level: 'venue' }
      expect(await hallOf(bar)).toMatchObject({ menu: live, routeMenuId: null })
      expect(await rowOf(barTable)).toMatchObject({ menu: live, routeMenuId: null })
    })

    it('an area’s choice overrides the venue’s, a table’s overrides its area’s, and each queues the files', async () => {
      sent.length = 0
      expect(await chooseMenu(handScope(), services, { areaId: bar as never }, cocktails)).toEqual({
        ok: true,
        queued: true,
      })
      expect(sent).toEqual([
        {
          name: JOB_NAMES.publishTableTokens,
          data: { tenantId: tenant, venueId: hand.id, retired: [] },
        },
      ])
      const cocktailsFromBar = { id: cocktails, name: 'Cocktails', level: 'area' }
      expect(await hallOf(bar)).toMatchObject({ menu: cocktailsFromBar, routeMenuId: cocktails })
      expect(await rowOf(barTable)).toMatchObject({ menu: cocktailsFromBar, routeMenuId: null })
      // The other area still shows the live menu.
      expect((await hallOf(lounge))?.menu).toMatchObject({ id: liveMenu, level: 'venue' })

      await chooseMenu(handScope(), services, { tableId: barTable as never }, liveMenu)
      expect(await rowOf(barTable)).toMatchObject({
        menu: { id: liveMenu, level: 'table' },
        routeMenuId: liveMenu,
      })
      // The file of the code carries the menu it opens.
      const files = await loadTokenFiles(app, tenant, hand.id)
      expect(files?.files.find((file) => file.tableLabel === 'B1')?.menuId).toBe(liveMenu)
      expect(files?.files.find((file) => file.tableLabel === 'L1')?.menuId).toBe(liveMenu)

      // Taking the choice away goes back to the next level up.
      await chooseMenu(handScope(), services, { tableId: barTable as never }, null)
      expect(await rowOf(barTable)).toMatchObject({
        menu: { id: cocktails, level: 'area' },
        routeMenuId: null,
      })
      await chooseMenu(handScope(), services, { areaId: bar as never }, null)
      expect(await hallOf(bar)).toMatchObject({ menu: { level: 'venue' }, routeMenuId: null })
    })

    it('a menu that is not published falls back to the next level up, and says it was chosen', async () => {
      await chooseMenu(handScope(), services, { tableId: loungeTable as never }, brunch)
      expect(await rowOf(loungeTable)).toMatchObject({
        menu: { id: liveMenu, level: 'venue' },
        routeMenuId: brunch,
      })
      await chooseMenu(handScope(), services, { tableId: loungeTable as never }, null)
    })

    it('refuses what is not the venue’s: a menu in the bin or of nobody, a table of another venue', async () => {
      const tillTable = await rowByNumber('2')
      sent.length = 0
      expect(
        await chooseMenu(handScope(), services, { areaId: bar as never }, newId('nd')),
      ).toEqual({ ok: false, error: 'unknown_menu' })
      expect(
        await chooseMenu(handScope(), services, { tableId: tillTable.id as never }, cocktails),
      ).toEqual({ ok: false, error: 'not_found' })
      // The binned menu is no longer offered, and an entry that names it counts as none.
      await chooseMenu(handScope(), services, { areaId: lounge as never }, brunch)
      sent.length = 0
      ok(await deleteMenu(app, tenant, { venueId: hand.id, menuId: brunch }))
      expect((await read()).menus.map((menu) => menu.id)).toEqual([liveMenu, cocktails])
      expect((await hallOf(lounge))?.routeMenuId).toBeNull()
      expect(await chooseMenu(handScope(), services, { areaId: bar as never }, brunch)).toEqual({
        ok: false,
        error: 'unknown_menu',
      })
      expect(sent).toEqual([])
    })

    it('a queue that is down is told, not hidden', async () => {
      enqueueFails = true
      expect(await chooseMenu(handScope(), services, { areaId: bar as never }, cocktails)).toEqual({
        ok: true,
        queued: false,
      })
      expect((await hallOf(bar))?.routeMenuId).toBe(cocktails)
    })
  })
})
