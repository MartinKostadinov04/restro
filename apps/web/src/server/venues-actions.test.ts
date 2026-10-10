// "New venue" against a real Postgres, as the restro_app role (CF-01): what the server action
// writes (a venue and its empty menu), who may call it, and every refusal. The session is the
// only fake: it says which organisation and role is asking.
import { newId } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'
import { createVenueAction } from './venues-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_cf01tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'CF-01 club', slug: 'cf01-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))

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
    await getPool().end()
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

  it('maps a taken address to slug_taken, also when another organisation has it', async () => {
    const slug = testSlug('taken')
    expect((await createVenueAction(valid({ slug }))).ok).toBe(true)
    expect(await createVenueAction(valid({ slug, name: 'Second' }))).toEqual({
      ok: false,
      error: 'slug_taken',
    })
    // Public addresses are global: the other organisation's venue holds it as well.
    const elsewhere = testSlug('elsewhere')
    await provisionVenue(getPool(), otherTenant, { name: 'Elsewhere', slug: elsewhere })
    expect(await createVenueAction(valid({ slug: elsewhere }))).toEqual({
      ok: false,
      error: 'slug_taken',
    })
    expect(await venueRows(slug)).toHaveLength(1)
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
