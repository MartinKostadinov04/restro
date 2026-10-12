// "New venue" and "rename the address" against a real Postgres, as the restro_app role (CF-01,
// CF-14): what the server actions write (a venue with its public code and its empty menu, a new
// slug), who may call them, and every refusal. The session and the job queue are the only fakes:
// they say which organisation and role is asking, and record the jobs that would be queued.
import { JOB_NAMES, menuPath, newId } from '@restro/core'
import { provisionMenu, provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'
import { createVenueAction, renameVenueSlugAction } from './venues-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
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

const valid = (overrides: Record<string, unknown> = {}) => ({
  name: 'Демо Клуб',
  slug: testSlug('demo-klub'),
  defaultLocale: 'bg_BG',
  enabledLocales: ['bg_BG', 'en_US'],
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
      for (const table of ['menus', 'nodes', 'venues']) {
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
      defaultLocale: 'en_US',
      enabledLocales: ['en_US', 'de_DE'],
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
      { defaultLocale: 'xx_XX' },
      { enabledLocales: [] },
      { enabledLocales: ['bg_BG', 'bg_BG'] },
      { enabledLocales: ['en_US'], defaultLocale: 'bg_BG' },
      { enabledLocales: ['klingon'] },
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
      for (const table of ['menus', 'nodes', 'venues']) {
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
