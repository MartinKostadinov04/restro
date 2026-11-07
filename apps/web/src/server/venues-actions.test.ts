// "New venue" (by hand and from a POS venue, D85) and "rename the address" against a real
// Postgres, as the restro_app role (CF-01, CF-14): what the server actions write (a venue with its
// public code and its empty menu, a new slug, the link to a POS venue), who may call them, and
// every refusal. The session and the job queue are the only fakes: they say which organisation and
// role is asking, and record the jobs that would be queued.
import { JOB_NAMES, menuPath, newId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  renameVenueSlug,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'
import {
  createVenueAction,
  loadNewVenueSourcesAction,
  renameVenueSlugAction,
} from './venues-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    sessionId: 'session-personal',
    user: { id: 'us_cf01tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'CF-01 club', slug: 'cf01-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))
vi.mock('./jobs', () => ({
  enqueueJob: async (name: string, data: Record<string, unknown>) => {
    if (queue.failing) throw new Error('the queue is down')
    queue.jobs.push({ name, data })
    return 'job-1'
  },
}))

/** A hand-made venue's request (D85: name, address name and languages come from the form). */
const valid = (overrides: Record<string, unknown> = {}) => ({
  source: { kind: 'hand' },
  name: 'Демо Клуб',
  slug: testSlug('demo-klub'),
  languages: { main: 'bg_BG', enabled: ['bg_BG', 'en_US'] },
  ...overrides,
})

describe.skipIf(!hasDatabase)('createVenueAction (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool

  const venueRows = async (slug: string) =>
    (
      await owner.query<{
        id: string
        tenant_id: string
        name: string
        slug: string
        public_id: string
        timezone: string
        currency: string
        default_locale: string
        enabled_locales: string[]
      }>('select * from restro.venues where slug = $1', [slug])
    ).rows
  const menuCount = async (venueId: string) =>
    (
      await owner.query<{ n: string }>(
        'select count(*) as n from restro.menus where venue_id = $1',
        [venueId],
      )
    ).rows[0]?.n

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'CF-01 club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    asked.tenantId = tenant
  })

  beforeEach(() => {
    asked.role = 'owner'
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of ['menus', 'nodes', 'venue_slug_history', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('creates the venue and its empty menu, and answers with the venue id', async () => {
    const input = valid()
    const result = await createVenueAction(input)
    expect(result).toEqual({ ok: true, venueId: expect.stringMatching(/^vn_[0-9A-Za-z]{22}$/) })
    if (!result.ok) return

    const [row] = await venueRows(input.slug)
    expect(row).toMatchObject({
      id: result.venueId,
      tenant_id: tenant,
      name: 'Демо Клуб',
      slug: input.slug,
      // Every venue gets a public code of its own (D68).
      public_id: expect.stringMatching(/^[a-z0-9]{12}$/),
      // Not asked: every new venue gets the same time zone and currency.
      timezone: 'Europe/Sofia',
      currency: 'EUR',
      default_locale: 'bg_BG',
      enabled_locales: ['bg_BG', 'en_US'],
    })
    expect(await menuCount(result.venueId)).toBe('1')
    expect(revalidated).toEqual(['/venues'])
  })

  it('trims the name and keeps the chosen languages and main language', async () => {
    const input = valid({
      name: '  Sea Bar  ',
      slug: testSlug('sea-bar'),
      languages: { main: 'en_US', enabled: ['en_US', 'de_DE'] },
    })
    const result = await createVenueAction(input)
    expect(result.ok).toBe(true)
    const [row] = await venueRows(input.slug)
    expect(row).toMatchObject({
      name: 'Sea Bar',
      default_locale: 'en_US',
      enabled_locales: ['en_US', 'de_DE'],
    })
  })

  it('lets an admin, and a person with several roles that include one, create a venue', async () => {
    for (const role of ['admin', 'member,owner']) {
      asked.role = role
      expect((await createVenueAction(valid({ slug: testSlug('roles') }))).ok).toBe(true)
    }
  })

  it('refuses a plain member and writes nothing', async () => {
    asked.role = 'member'
    const input = valid({ slug: testSlug('member') })
    expect(await createVenueAction(input)).toEqual({ ok: false, error: 'not_allowed' })
    expect(await venueRows(input.slug)).toEqual([])
    expect(revalidated).toEqual([])
  })

  it('keeps a slug unique within the organisation and free across organisations (D84)', async () => {
    const slug = testSlug('shared')
    const first = await createVenueAction(valid({ slug }))
    expect(first.ok).toBe(true)
    // A second venue of this organisation with the same address name is refused, cleanly.
    expect(await createVenueAction(valid({ slug, name: 'Second' }))).toEqual({
      ok: false,
      error: 'taken',
    })
    // The other organisation's venue may carry the same slug.
    await provisionVenue(getPool(), otherTenant, { name: 'Elsewhere', slug })
    const rows = await venueRows(slug)
    expect(rows).toHaveLength(2)
    const codes = rows.map((row) => row.public_id)
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{12}$/)
    expect(new Set(codes).size).toBe(2)
  })

  it('refuses bad input as invalid and writes nothing', async () => {
    const slug = testSlug('bad')
    const bad: Record<string, unknown>[] = [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { slug: 'Not A Slug' },
      { slug: 'UPPER' },
      { slug: '-lead' },
      { slug: '' },
      { languages: { main: 'xx_XX', enabled: ['xx_XX'] } },
      { languages: { main: 'bg_BG', enabled: [] } },
      { languages: { main: 'bg_BG', enabled: ['bg_BG', 'bg_BG'] } },
      { languages: { main: 'bg_BG', enabled: ['en_US'] } },
      { languages: { main: 'bg_BG', enabled: ['klingon'] } },
      { languages: { main: 'bg_BG', enabled: ['bg_BG'], extra: true } },
      // The pieces of the old shape are not accepted any more.
      { defaultLocale: 'bg_BG', enabledLocales: ['bg_BG'] },
      // A hand-made venue needs all three.
      { name: undefined },
      { slug: undefined },
      { languages: undefined },
      // Unknown or malformed sources.
      { source: undefined },
      { source: { kind: 'other' } },
      { source: { kind: 'hand', integrationId: newId('in'), bid: 1 } },
      { extra: 'field' },
    ]
    for (const overrides of bad) {
      expect(
        await createVenueAction(valid({ slug, ...overrides })),
        JSON.stringify(overrides),
      ).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(await createVenueAction(null)).toEqual({ ok: false, error: 'invalid' })
    expect(await createVenueAction('name')).toEqual({ ok: false, error: 'invalid' })
    expect(await venueRows(slug)).toEqual([])
  })

  it('does not take the time zone or currency from the request', async () => {
    const input = {
      ...valid({ slug: testSlug('tz') }),
      timezone: 'America/New_York',
      currency: 'USD',
    }
    expect(await createVenueAction(input)).toEqual({ ok: false, error: 'invalid' })
    expect(await venueRows(input.slug)).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('createVenueAction from a POS venue (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  /** Connected, and reads Bulgarian text as English. */
  let english: string
  /** Connected, with no text language set. */
  let plain: string
  /** Not connected yet. */
  let idle: string
  /** Another organisation's, connected. */
  let foreign: string
  let bid = 7000

  /** A venue of the POS instance, linked to nothing yet; the bid is the till's own number. */
  const tillVenue = async (name: string, instance = english, tenantId = tenant) => {
    bid += 1
    await upsertBarsyVenues(getPool(), tenantId, instance, [{ bid, name }])
    return bid
  }
  const instanceSource = (integrationId: string, tillBid: number) => ({
    source: { kind: 'instance', integrationId, bid: tillBid },
  })
  const venueRow = async (venueId: string) =>
    (
      await owner.query<{
        tenant_id: string
        name: string
        slug: string
        public_id: string
        timezone: string
        currency: string
        default_locale: string
        enabled_locales: string[]
      }>('select * from restro.venues where id = $1', [venueId])
    ).rows[0]
  const linkedVenue = async (integrationId: string, tillBid: number) =>
    (
      await owner.query<{ venue_id: string | null }>(
        'select venue_id from restro.barsy_venues where integration_id = $1 and bid = $2',
        [integrationId, tillBid],
      )
    ).rows[0]?.venue_id
  const venueCount = async () =>
    Number(
      (
        await owner.query<{ n: string }>(
          'select count(*) as n from restro.venues where tenant_id = $1',
          [tenant],
        )
      ).rows[0]?.n,
    )
  const menuCount = async (venueId: string) =>
    Number(
      (
        await owner.query<{ n: string }>(
          'select count(*) as n from restro.menus where venue_id = $1',
          [venueId],
        )
      ).rows[0]?.n,
    )

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'S2 club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    const connect = async (tenantId: string, host: string, config: Record<string, unknown>) => {
      const created = await createIntegration(getPool(), tenantId, { kind: 'barsy', host })
      await updateIntegration(getPool(), tenantId, created.id, { status: 'connected', config })
      return created.id
    }
    english = await connect(tenant, 's2-english.test', { default_locale: 'en_US' })
    plain = await connect(tenant, 's2-plain.test', {})
    idle = (await createIntegration(getPool(), tenant, { kind: 'barsy', host: 's2-idle.test' })).id
    foreign = await connect(otherTenant, 's2-foreign.test', {})
    asked.tenantId = tenant
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'barsy_venues',
        'integrations',
        'menus',
        'nodes',
        'venue_slug_history',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('makes the venue from the POS venue alone: its name, an address made from it, the instance’s language, its menu and the link', async () => {
    const name = testSlug('Club Neon')
    const till = await tillVenue(name)
    const result = await createVenueAction(instanceSource(english, till))
    expect(result).toEqual({ ok: true, venueId: expect.stringMatching(/^vn_[0-9A-Za-z]{22}$/) })
    if (!result.ok) return

    expect(await venueRow(result.venueId)).toMatchObject({
      tenant_id: tenant,
      name,
      slug: name.toLowerCase().replaceAll(' ', '-'),
      public_id: expect.stringMatching(/^[a-z0-9]{12}$/),
      // The same time zone and currency as every new venue; the language is the instance's, and
      // the languages the POS offers join it with later reads (D77).
      timezone: 'Europe/Sofia',
      currency: 'EUR',
      default_locale: 'en_US',
      enabled_locales: ['en_US'],
    })
    expect(await menuCount(result.venueId)).toBe(1)
    expect(await linkedVenue(english, till)).toBe(result.venueId)
    expect(revalidated).toEqual(['/venues'])
    expect(queue.jobs).toEqual([])
  })

  it('makes it Bulgarian when the instance has no text language, and turns Bulgarian letters into Latin ones', async () => {
    const till = await tillVenue(`Мазе ${testSlug('x')}`, plain)
    const result = await createVenueAction(instanceSource(plain, till))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = await venueRow(result.venueId)
    expect(row).toMatchObject({ default_locale: 'bg_BG', enabled_locales: ['bg_BG'] })
    expect(row?.slug).toMatch(/^maze-x-[0-9a-f]{8}$/)
  })

  it('finds a free address name by itself when the one made from the name is taken (-2, -3)', async () => {
    const name = testSlug('Twin Bar')
    const slug = name.toLowerCase().replaceAll(' ', '-')
    // A hand-made venue holds the plain name.
    await provisionVenue(getPool(), tenant, { name: 'Taken', slug })
    const slugs: string[] = []
    for (let n = 0; n < 2; n += 1) {
      const result = await createVenueAction(instanceSource(english, await tillVenue(name)))
      expect(result.ok).toBe(true)
      if (result.ok) slugs.push((await venueRow(result.venueId))?.slug ?? '')
    }
    expect(slugs).toEqual([`${slug}-2`, `${slug}-3`])
  })

  it('does not take an address name a venue of the organisation was called before (D84)', async () => {
    const name = testSlug('Old Name')
    const slug = name.toLowerCase().replaceAll(' ', '-')
    const venue = await provisionVenue(getPool(), tenant, { name: 'Renamed', slug })
    await renameVenueSlug(getPool(), tenant, venue.id, testSlug('new-name'))
    const result = await createVenueAction(instanceSource(english, await tillVenue(name)))
    expect(result.ok).toBe(true)
    if (result.ok) expect((await venueRow(result.venueId))?.slug).toBe(`${slug}-2`)
  })

  it('uses "venue" for a name with no letters it can use, and cuts a long name at 120 characters', async () => {
    const odd = await createVenueAction(instanceSource(english, await tillVenue('★★★')))
    expect(odd.ok).toBe(true)
    if (odd.ok) expect((await venueRow(odd.venueId))?.slug).toMatch(/^venue(-\d+)?$/)

    const long = `${'N'.repeat(125)}`
    const cut = await createVenueAction(instanceSource(english, await tillVenue(long)))
    expect(cut.ok).toBe(true)
    if (cut.ok) {
      const row = await venueRow(cut.venueId)
      expect(row?.name).toBe('N'.repeat(120))
      expect(row?.slug).toBe('n'.repeat(60))
    }
  })

  it('refuses a POS venue that serves a venue already, and makes nothing', async () => {
    const till = await tillVenue(testSlug('Once'))
    const first = await createVenueAction(instanceSource(english, till))
    expect(first.ok).toBe(true)
    const before = await venueCount()
    expect(await createVenueAction(instanceSource(english, till))).toEqual({
      ok: false,
      error: 'link_taken',
    })
    expect(await venueCount()).toBe(before)
    if (first.ok) expect(await linkedVenue(english, till)).toBe(first.venueId)
  })

  it('lets two requests for the same POS venue make one venue, and says link_taken to the other', async () => {
    const till = await tillVenue(testSlug('Race'))
    const before = await venueCount()
    const answers = await Promise.all([
      createVenueAction(instanceSource(english, till)),
      createVenueAction(instanceSource(english, till)),
    ])
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1)
    expect(answers.filter((answer) => !answer.ok)).toEqual([{ ok: false, error: 'link_taken' }])
    expect(await venueCount()).toBe(before + 1)
  })

  it('refuses an instance or a POS venue that is not this organisation’s or not connected, as invalid', async () => {
    const mine = await tillVenue(testSlug('Mine'))
    const idleTill = await tillVenue(testSlug('Idle'), idle)
    const theirs = await tillVenue(testSlug('Theirs'), foreign, otherTenant)
    const before = await venueCount()
    for (const request of [
      // The instance is not connected.
      instanceSource(idle, idleTill),
      // Another organisation's instance and venue: row-level security hides them.
      instanceSource(foreign, theirs),
      // A POS venue the instance does not report.
      instanceSource(english, 999_999),
      // The right number under another instance.
      instanceSource(plain, mine),
      // An instance that does not exist.
      instanceSource(newId('in'), mine),
    ]) {
      expect(await createVenueAction(request), JSON.stringify(request)).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(await venueCount()).toBe(before)
    expect(await linkedVenue(english, mine)).toBeNull()
  })

  it('takes nothing typed: a name, an address name or languages with a POS source are refused', async () => {
    const till = await tillVenue(testSlug('Nothing typed'))
    const before = await venueCount()
    const request = instanceSource(english, till)
    for (const extra of [
      { name: 'My own name' },
      { slug: 'my-own' },
      { languages: { main: 'bg_BG', enabled: ['bg_BG'] } },
    ]) {
      expect(await createVenueAction({ ...request, ...extra })).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(await venueCount()).toBe(before)
  })

  it('refuses malformed sources as invalid', async () => {
    const bad: unknown[] = [
      { source: { kind: 'instance' } },
      { source: { kind: 'instance', integrationId: english } },
      { source: { kind: 'instance', integrationId: english, bid: -1 } },
      { source: { kind: 'instance', integrationId: english, bid: 1.5 } },
      { source: { kind: 'instance', integrationId: english, bid: '5' } },
      { source: { kind: 'instance', integrationId: 'not-an-id', bid: 5 } },
      { source: { kind: 'instance', integrationId: newId('vn'), bid: 5 } },
      { source: { kind: 'instance', integrationId: english, bid: 5, host: 'evil.test' } },
    ]
    for (const request of bad) {
      expect(await createVenueAction(request), JSON.stringify(request)).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
  })

  it('lets owners and admins create, and refuses a plain member without writing anything', async () => {
    for (const role of ['admin', 'member,owner']) {
      asked.role = role
      const result = await createVenueAction(
        instanceSource(english, await tillVenue(testSlug('Roles'))),
      )
      expect(result.ok, role).toBe(true)
    }
    asked.role = 'member'
    revalidated.length = 0
    const till = await tillVenue(testSlug('Member'))
    const before = await venueCount()
    expect(await createVenueAction(instanceSource(english, till))).toEqual({
      ok: false,
      error: 'not_allowed',
    })
    expect(await venueCount()).toBe(before)
    expect(await linkedVenue(english, till)).toBeNull()
    expect(revalidated).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('loadNewVenueSourcesAction (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const organizationSlug = testSlug('night-group')
  let owner: pg.Pool
  let sofia: string
  let varna: string
  let linkedVenueId: string

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'S2 sources' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    // The organisation rows are Better Auth's; the test makes the one the address preview reads.
    await owner.query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)', [
      tenant,
      'S2 sources',
      organizationSlug,
    ])
    const connect = async (tenantId: string, host: string, name: string) => {
      const created = await createIntegration(getPool(), tenantId, { kind: 'barsy', host, name })
      await updateIntegration(getPool(), tenantId, created.id, { status: 'connected' })
      return created.id
    }
    // Names that sort the same in every collation.
    varna = await connect(tenant, 's2-sources-varna.test', 'Till B')
    sofia = await connect(tenant, 's2-sources-sofia.test', 'Till A')
    const idle = await createIntegration(getPool(), tenant, {
      kind: 'barsy',
      host: 's2-sources-idle.test',
      name: 'Till C',
    })
    const foreign = await connect(otherTenant, 's2-sources-foreign.test', 'Till Z')
    const venue = await provisionVenue(getPool(), tenant, {
      name: 'Linked Venue',
      slug: testSlug('linked'),
    })
    linkedVenueId = venue.id
    await upsertBarsyVenues(getPool(), tenant, sofia, [
      { bid: 8002, name: 'Beta' },
      { bid: 8001, name: 'Alpha' },
    ])
    await upsertBarsyVenues(getPool(), tenant, idle.id, [{ bid: 8003, name: 'Hidden' }])
    await upsertBarsyVenues(getPool(), otherTenant, foreign, [{ bid: 8004, name: 'Foreign' }])
    await mapBarsyVenue(getPool(), tenant, sofia, 8002, linkedVenueId)
    asked.tenantId = tenant
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      await owner.query('delete from restro.auth_organization where id = $1', [tenant])
      for (const table of ['barsy_venues', 'integrations', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('lists the connected instances by name with their venues, and the venue each serves already', async () => {
    expect(await loadNewVenueSourcesAction()).toEqual({
      ok: true,
      sources: {
        organizationSlug,
        instances: [
          {
            id: sofia,
            name: 'Till A',
            tillVenues: [
              { bid: 8001, name: 'Alpha', linkedVenueName: null },
              { bid: 8002, name: 'Beta', linkedVenueName: 'Linked Venue' },
            ],
          },
          { id: varna, name: 'Till B', tillVenues: [] },
        ],
      },
    })
  })

  it('lets admins ask, and refuses a plain member', async () => {
    asked.role = 'admin'
    expect((await loadNewVenueSourcesAction()).ok).toBe(true)
    asked.role = 'member'
    expect(await loadNewVenueSourcesAction()).toEqual({ ok: false, error: 'not_allowed' })
  })

  it('shows another organisation only its own instances', async () => {
    asked.tenantId = otherTenant
    const answer = await loadNewVenueSourcesAction()
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.sources.instances.map((instance) => instance.name)).toEqual(['Till Z'])
    // That organisation has no row of Better Auth's here: no slug to preview.
    expect(answer.sources.organizationSlug).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('renameVenueSlugAction (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool

  const rowOf = async (venueId: string) =>
    (
      await owner.query<{ slug: string; public_id: string; updated_at: Date }>(
        'select slug, public_id, updated_at from restro.venues where id = $1',
        [venueId],
      )
    ).rows[0]
  /** A venue of `tenantId` with its menu, made the way the app makes it. */
  const makeVenue = async (tenantId: string, slug = testSlug('before')) => {
    const venue = await provisionVenue(getPool(), tenantId, { name: 'Renamed Club', slug })
    const menu = await provisionMenu(getPool(), tenantId, venue.id)
    return { venue, menu }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'CF-14 club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    asked.tenantId = tenant
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of ['menus', 'nodes', 'venue_slug_history', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
  })

  it('changes the slug, keeps the public code, and queues the files that carry the slug', async () => {
    const { venue, menu } = await makeVenue(tenant)
    const slug = testSlug('after')
    const result = await renameVenueSlugAction({ venueId: venue.id, slug })
    expect(result).toEqual({
      ok: true,
      slug,
      path: menuPath({ slug, publicId: venue.publicId }),
      filesQueued: true,
    })
    expect(result.ok && result.path).toBe(`/m/${slug}-${venue.publicId}`)

    // The slug changed; the code did not.
    expect(await rowOf(venue.id)).toMatchObject({ slug, public_id: venue.publicId })
    // The worker is asked to write the venue index (publish-files) and the table files again.
    expect(queue.jobs).toEqual([
      {
        name: JOB_NAMES.publishFiles,
        data: { tenantId: tenant, menuId: menu.id, venueId: venue.id },
      },
      {
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: tenant, venueId: venue.id, retired: [] },
      },
    ])
    expect(revalidated).toEqual(['/venues', `/venues/${venue.id}`])
  })

  it('keeps the public code through any number of renames', async () => {
    const { venue } = await makeVenue(tenant)
    for (const slug of [testSlug('one'), testSlug('two'), 'a', testSlug('three')]) {
      expect((await renameVenueSlugAction({ venueId: venue.id, slug })).ok).toBe(true)
      expect(await rowOf(venue.id)).toMatchObject({ slug, public_id: venue.publicId })
    }
  })

  it('accepts the slug it already has (and queues the files again, which is harmless)', async () => {
    const { venue } = await makeVenue(tenant, 'same-slug')
    const before = await rowOf(venue.id)
    const result = await renameVenueSlugAction({ venueId: venue.id, slug: 'same-slug' })
    expect(result.ok).toBe(true)
    // Nothing was written: not even updated_at moved.
    expect((await rowOf(venue.id))?.updated_at).toEqual(before?.updated_at)
    expect(queue.jobs.map((job) => job.name)).toEqual([
      JOB_NAMES.publishFiles,
      JOB_NAMES.publishTableTokens,
    ])
  })

  it('refuses an address another venue of the organisation holds; another organisation may hold it (D84)', async () => {
    const mine = await makeVenue(tenant)
    const theirs = await makeVenue(otherTenant)
    const slug = testSlug('twin')
    expect((await renameVenueSlugAction({ venueId: mine.venue.id, slug })).ok).toBe(true)
    await provisionVenue(getPool(), otherTenant, { name: 'Twin', slug })
    expect((await rowOf(mine.venue.id))?.slug).toBe(slug)
    expect((await rowOf(theirs.venue.id))?.slug).not.toBe(slug)
    const other = await makeVenue(tenant)
    expect(await renameVenueSlugAction({ venueId: other.venue.id, slug })).toEqual({
      ok: false,
      error: 'taken',
    })
    expect((await rowOf(other.venue.id))?.slug).not.toBe(slug)
  })

  it('queues only the table files for a venue that has no menu yet', async () => {
    const venue = await provisionVenue(getPool(), tenant, {
      name: 'No menu',
      slug: testSlug('nomenu'),
    })
    expect((await renameVenueSlugAction({ venueId: venue.id, slug: testSlug('nm') })).ok).toBe(true)
    expect(queue.jobs.map((job) => job.name)).toEqual([JOB_NAMES.publishTableTokens])
  })

  it('saves the new slug even when the queue is down, and says the files are late', async () => {
    const { venue } = await makeVenue(tenant)
    queue.failing = true
    const slug = testSlug('late')
    const result = await renameVenueSlugAction({ venueId: venue.id, slug })
    expect(result).toMatchObject({ ok: true, slug, filesQueued: false })
    expect((await rowOf(venue.id))?.slug).toBe(slug)
  })

  it('refuses a plain member and writes and queues nothing', async () => {
    const { venue } = await makeVenue(tenant, 'members-slug')
    asked.role = 'member'
    expect(await renameVenueSlugAction({ venueId: venue.id, slug: 'changed' })).toEqual({
      ok: false,
      error: 'not_allowed',
    })
    expect((await rowOf(venue.id))?.slug).toBe('members-slug')
    expect(queue.jobs).toEqual([])
    expect(revalidated).toEqual([])
  })

  it('lets an admin, and a person with several roles that include one, rename', async () => {
    const { venue } = await makeVenue(tenant)
    for (const role of ['admin', 'member,owner']) {
      asked.role = role
      const slug = testSlug('roles')
      expect((await renameVenueSlugAction({ venueId: venue.id, slug })).ok).toBe(true)
      expect((await rowOf(venue.id))?.slug).toBe(slug)
    }
  })

  it('refuses a venue of another organisation as invalid, and changes nothing', async () => {
    const theirs = await makeVenue(otherTenant, 'their-slug')
    expect(await renameVenueSlugAction({ venueId: theirs.venue.id, slug: 'mine-now' })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect((await rowOf(theirs.venue.id))?.slug).toBe('their-slug')
    expect(queue.jobs).toEqual([])
  })

  it('refuses bad input as invalid and writes nothing', async () => {
    const { venue } = await makeVenue(tenant, 'good-slug')
    const bad: unknown[] = [
      { venueId: venue.id, slug: 'Not A Slug' },
      { venueId: venue.id, slug: 'UPPER' },
      { venueId: venue.id, slug: '-lead' },
      { venueId: venue.id, slug: 'trail-' },
      { venueId: venue.id, slug: 'double--hyphen' },
      { venueId: venue.id, slug: '' },
      { venueId: venue.id, slug: 'x'.repeat(64) },
      { venueId: venue.id, slug: 5 },
      { venueId: venue.id },
      { venueId: 'nd_0123456789ABCDEFGHIJKL', slug: 'fine' },
      { venueId: 'not-an-id', slug: 'fine' },
      { venueId: venue.id, slug: 'fine', publicId: 'abcdefghijkl' },
      null,
      'slug',
    ]
    for (const input of bad) {
      expect(await renameVenueSlugAction(input), JSON.stringify(input)).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(await rowOf(venue.id)).toMatchObject({ slug: 'good-slug', public_id: venue.publicId })
    expect(queue.jobs).toEqual([])
  })
})

// Both suites share the server's pool; it is closed once, after the last of them.
afterAll(async () => {
  if (hasDatabase) await getPool().end()
})
