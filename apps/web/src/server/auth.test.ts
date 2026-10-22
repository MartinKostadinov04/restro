// Integration tests on a real Postgres: organisation = tenant, the tenant-scoped venue reads, and
// what Better Auth refuses over HTTP. They go through the same createAuth() the app uses.
import { isId } from '@restro/core'
import { provisionVenue } from '@restro/core/apply'
import { tenants, withTenant } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import { assertAuthRoleIsSafe, getAuthDb, getPool } from './db'
import { authModelId } from './ids'
import {
  cleanUp,
  hasDatabase,
  openOwnerPool,
  testSlug,
  useTestServerEnvironment,
} from './test-database'
import { getVenue, listVenues } from './venues'

const PASSWORD = 'a-test-password-1'

describe.skipIf(!hasDatabase)('organisation = tenant (Better Auth over the app role)', () => {
  const suffix = authModelId('suffix').slice(0, 10).toLowerCase()
  const emailA = `owner-a-${suffix}@example.test`
  const emailB = `owner-b-${suffix}@example.test`
  const created = { userIds: [] as string[], organizationIds: [] as string[] }
  let owner: pg.Pool
  let auth: ReturnType<typeof createAuth>
  let orgA = ''
  let orgB = ''
  let userA = ''

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    auth = createAuth({ scripts: true })
    const context = await auth.$context
    const make = async (email: string) => {
      const user = await context.internalAdapter.createUser(
        { email, name: email, emailVerified: true },
        { method: 'admin' },
      )
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await context.password.hash(PASSWORD),
      })
      created.userIds.push(user.id)
      return user.id
    }
    userA = await make(emailA)
    const userB = await make(emailB)
    // Server code creates organisations by naming the user; people cannot do it themselves.
    const a = await auth.api.createOrganization({
      body: { name: `Club A ${suffix}`, slug: `club-a-${suffix}`, userId: userA },
    })
    const b = await auth.api.createOrganization({
      body: { name: `Club B ${suffix}`, slug: `club-b-${suffix}`, userId: userB },
    })
    orgA = a.id
    orgB = b.id
    created.organizationIds.push(orgA, orgB)
  })

  afterAll(async () => {
    await getPool().end()
    if (owner) {
      await cleanUp(owner, created)
      await owner.end()
    }
  })

  it('connects Better Auth as a role that cannot bypass row-level security', async () => {
    await expect(assertAuthRoleIsSafe()).resolves.toBeUndefined()
  })

  it('uses a tenant id (tn_…) as the organisation id and makes the tenant row in the same call', async () => {
    expect(isId('tn', orgA)).toBe(true)
    const rows = await withTenant(getPool(), orgA, (tx) => tx.select().from(tenants))
    expect(rows).toEqual([expect.objectContaining({ id: orgA, name: `Club A ${suffix}` })])
    // A tenant sees only its own row.
    expect(rows.map((row) => row.id)).not.toContain(orgB)
  })

  it('makes the creator an owner of the organisation', async () => {
    const { rows } = await owner.query(
      'select role from restro.auth_member where organization_id = $1 and user_id = $2',
      [orgA, userA],
    )
    expect(rows).toEqual([{ role: 'owner' }])
  })

  it('shows each organisation only its own venues (listVenues and getVenue)', async () => {
    const venueA = await provisionVenue(getPool(), orgA, {
      name: 'Venue A',
      slug: testSlug('main'),
    })
    const venueB = await provisionVenue(getPool(), orgB, {
      name: 'Venue B',
      slug: testSlug('main'),
    })
    expect((await listVenues(orgA)).map((venue) => venue.id)).toEqual([venueA.id])
    expect((await listVenues(orgB)).map((venue) => venue.id)).toEqual([venueB.id])
    expect((await getVenue(orgA, venueA.id))?.name).toBe('Venue A')
    // Another tenant's venue, a made-up id and a malformed id all come back as nothing.
    expect(await getVenue(orgA, venueB.id)).toBeNull()
    expect(await getVenue(orgA, 'vn_doesnotexistdoesnotex')).toBeNull()
    expect(await getVenue(orgA, "vn_x' or '1'='1")).toBeNull()
  })

  it('starts a new session in the person’s organisation', async () => {
    const signedIn = await auth.api.signInEmail({
      body: { email: emailA, password: PASSWORD },
      returnHeaders: true,
    })
    const cookie = (signedIn.headers.getSetCookie?.() ?? [])
      .map((line) => line.split(';')[0])
      .join('; ')
    expect(cookie).toContain('restro.session_token=')
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(session?.session.activeOrganizationId).toBe(orgA)
    expect(session?.user.email).toBe(emailA)
    // A person's own session lasts 30 days from the password (D122 §7, #72).
    const lasts =
      new Date(session?.session.expiresAt ?? 0).getTime() -
      new Date(session?.session.createdAt ?? 0).getTime()
    expect(Math.abs(lasts - 30 * 24 * 60 * 60_000)).toBeLessThan(60_000)

    // A signed-in person still cannot create an organisation (it is switched off for people).
    await expect(
      auth.api.createOrganization({
        body: { name: 'Mine', slug: `mine-${suffix}` },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('refuses a wrong password', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: emailA, password: 'not-the-password-1' } }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
  })

  it.each([
    '/api/auth/sign-up/email',
    '/api/auth/organization/create',
    '/api/auth/organization/invite-member',
    '/api/auth/organization/remove-member',
    '/api/auth/delete-user',
  ])('does not answer %s over HTTP', async (path) => {
    const response = await auth.handler(
      new Request(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: `new-${suffix}@example.test`,
          password: PASSWORD,
          name: 'X',
        }),
      }),
    )
    expect(response.status).toBe(404)
  })

  it('leaves no new user behind after a refused sign-up', async () => {
    const { rows } = await owner.query('select id from restro.auth_user where email = $1', [
      `new-${suffix}@example.test`,
    ])
    expect(rows).toEqual([])
    // Keep the type of the database handle exercised (and the helper used) by the module under test.
    expect(getAuthDb()).toBeDefined()
  })
})
