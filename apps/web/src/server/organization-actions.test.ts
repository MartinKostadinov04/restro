// The organisation's name and address name (Settings › General, D84, D91) against a real Postgres
// and the real Better Auth, as the restro_app role: who may change them (owners only), what is
// written (Better Auth's organisation row, the tenant row's copy of the name, the memory of the
// old address name), what is refused (an address name another organisation holds now or held
// before), the guest-file jobs a new address name queues, and that a failed step puts Better Auth
// back. The session and the job queue are the only fakes: the request carries a real session
// cookie (Better Auth checks the role once more), and the queue records the jobs.

import { JOB_NAMES } from '@restro/core'
import {
  archiveVenue,
  organizationAddress,
  provisionMenu,
  provisionVenue,
  recordOrganizationSlug,
} from '@restro/core/apply'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuth } from './auth'
import { getPool } from './db'
import { authModelId } from './ids'
import { updateOrganizationAction } from './organization-actions'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'

const asked = vi.hoisted(() => ({
  tenantId: '',
  role: 'owner',
  headers: new Headers(),
}))
const revalidated = vi.hoisted(() => [] as { path: string; type: string | undefined }[])
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))
const logged = vi.hoisted(() => [] as string[])

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    sessionId: 'session-personal',
    user: { id: 'us_s3tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'S3 club', slug: 's3-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => revalidated.push({ path, type }),
}))
vi.mock('next/headers', () => ({ headers: async () => asked.headers }))
vi.mock('./jobs', () => ({
  enqueueJob: async (name: string, data: Record<string, unknown>) => {
    if (queue.failing) throw new Error('the queue is down')
    queue.jobs.push({ name, data })
    return 'job-1'
  },
}))
vi.mock('./log', () => ({ logError: (event: string) => logged.push(event) }))
// Better Auth without the Next.js cookie plugin, which only works inside a request.
vi.mock('./auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('./auth')>()
  let instance: ReturnType<typeof original.createAuth> | undefined
  return { ...original, getAuth: () => (instance ??= original.createAuth({ scripts: true })) }
})

const PASSWORD = 'a-test-password-1'

describe.skipIf(!hasDatabase)('updateOrganizationAction (as the restro_app role)', () => {
  const suffix = authModelId('suffix').slice(0, 10).toLowerCase()
  const created = { userIds: [] as string[], organizationIds: [] as string[] }
  let owner: pg.Pool
  let orgA = ''
  let orgB = ''
  let slugA = ''
  let slugB = ''
  let ownerCookie = ''
  let memberCookie = ''
  let liveVenueId = ''
  let liveMenuId = ''
  let bareVenueId = ''

  const cookieOf = async (email: string) => {
    const signedIn = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    })
    return (signedIn.headers.getSetCookie?.() ?? []).map((line) => line.split(';')[0]).join('; ')
  }
  const row = async (id: string) =>
    (
      await owner.query<{ name: string; slug: string; tenant_name: string }>(
        `select o.name, o.slug, t.name as tenant_name
         from restro.auth_organization o join restro.tenants t on t.id = o.id where o.id = $1`,
        [id],
      )
    ).rows[0]
  const history = async (id: string) =>
    (
      await owner.query<{ slug: string }>(
        'select slug from restro.organization_slug_history where organization_id = $1',
        [id],
      )
    ).rows
      .map((entry) => entry.slug)
      // Sorted here, never by the database: its collation differs between machines.
      .sort()
  const asOwner = () => {
    asked.tenantId = orgA
    asked.role = 'owner'
    asked.headers = new Headers({ cookie: ownerCookie })
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    const auth = getAuth()
    const context = await auth.$context
    const makeUser = async (label: string) => {
      const email = `${label}-${suffix}@example.test`
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
      return { id: user.id, email }
    }
    const ownerA = await makeUser('s3-owner-a')
    const ownerB = await makeUser('s3-owner-b')
    const member = await makeUser('s3-member')
    slugA = `s3-club-a-${suffix}`
    slugB = `s3-club-b-${suffix}`
    const a = await auth.api.createOrganization({
      body: { name: `S3 Club A ${suffix}`, slug: slugA, userId: ownerA.id },
    })
    const b = await auth.api.createOrganization({
      body: { name: `S3 Club B ${suffix}`, slug: slugB, userId: ownerB.id },
    })
    orgA = a.id
    orgB = b.id
    created.organizationIds.push(orgA, orgB)
    // A member of A in Better Auth's eyes: it refuses what a member asks, whatever the app says.
    await auth.api.addMember({ body: { userId: member.id, role: 'member', organizationId: orgA } })
    ownerCookie = await cookieOf(ownerA.email)
    memberCookie = await cookieOf(member.email)

    // Venue 1 has its live menu, venue 2 has none, venue 3 is deleted.
    const live = await provisionVenue(getPool(), orgA, { name: 'Live bar', slug: testSlug('s3') })
    liveMenuId = (await provisionMenu(getPool(), orgA, live.id)).id
    liveVenueId = live.id
    const bare = await provisionVenue(getPool(), orgA, { name: 'Bare bar', slug: testSlug('s3') })
    bareVenueId = bare.id
    const gone = await provisionVenue(getPool(), orgA, { name: 'Gone bar', slug: testSlug('s3') })
    await archiveVenue(getPool(), orgA, gone.id)
  })

  beforeEach(() => {
    asOwner()
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
    logged.length = 0
  })

  afterAll(async () => {
    if (owner) {
      for (const table of ['menus', 'nodes', 'venue_slug_history', 'venues']) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [
          created.organizationIds,
        ])
      }
      await owner.query(
        'delete from restro.organization_slug_history where organization_id = any($1)',
        [created.organizationIds],
      )
      await owner.query('delete from restro.auth_organization where id = any($1)', [
        created.organizationIds,
      ])
      await owner.query('delete from restro.auth_member where organization_id = any($1)', [
        created.organizationIds,
      ])
      await owner.query('delete from restro.auth_session where user_id = any($1)', [
        created.userIds,
      ])
      await owner.query('delete from restro.auth_account where user_id = any($1)', [
        created.userIds,
      ])
      await owner.query('delete from restro.auth_user where id = any($1)', [created.userIds])
      await owner.query('delete from restro.tenants where id = any($1)', [created.organizationIds])
      await owner.end()
    }
    await getPool().end()
  })

  it('renames the organisation: Better Auth and the tenant row follow, no files are queued', async () => {
    const result = await updateOrganizationAction({ name: '  Night Group  ' })
    expect(result).toEqual({ ok: true, name: 'Night Group', slug: slugA, filesQueued: true })
    expect(await row(orgA)).toEqual({
      name: 'Night Group',
      slug: slugA,
      tenant_name: 'Night Group',
    })
    // The address did not change: nothing to remember and nothing to publish.
    expect(await history(orgA)).toEqual([])
    expect(queue.jobs).toEqual([])
    expect(revalidated).toEqual([{ path: '/', type: 'layout' }])
  })

  it('changes the address name: remembers the old one and queues the guest files of every live venue', async () => {
    const fresh = `s3-night-${suffix}`
    const result = await updateOrganizationAction({ slug: fresh })
    expect(result).toEqual({ ok: true, name: 'Night Group', slug: fresh, filesQueued: true })
    expect((await row(orgA))?.slug).toBe(fresh)
    expect(await history(orgA)).toEqual([slugA])
    expect((await organizationAddress(getPool(), orgA))?.oldSlugs).toEqual([slugA])

    // The organisation's index (with the redirect), the table files of the two live venues, and
    // the index of the one live menu: nothing for the deleted venue, no menu job without a menu.
    const names = queue.jobs.map((job) => job.name)
    expect(names.filter((name) => name === JOB_NAMES.publishOrganizationIndex)).toHaveLength(1)
    expect(queue.jobs).toContainEqual({
      name: JOB_NAMES.publishOrganizationIndex,
      data: { tenantId: orgA },
    })
    for (const venueId of [liveVenueId, bareVenueId]) {
      expect(queue.jobs).toContainEqual({
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: orgA, venueId, retired: [] },
      })
    }
    expect(queue.jobs.filter((job) => job.name === JOB_NAMES.publishTableTokens)).toHaveLength(2)
    expect(queue.jobs.filter((job) => job.name === JOB_NAMES.publishFiles)).toEqual([
      {
        name: JOB_NAMES.publishFiles,
        data: { tenantId: orgA, menuId: liveMenuId, venueId: liveVenueId },
      },
    ])
    expect(revalidated).toEqual([{ path: '/', type: 'layout' }])
  })

  it('takes an earlier address name of its own back, and remembers the one it leaves', async () => {
    const result = await updateOrganizationAction({ slug: slugA })
    expect(result).toMatchObject({ ok: true, slug: slugA, filesQueued: true })
    expect((await row(orgA))?.slug).toBe(slugA)
    // Both names are remembered now; the current one is never listed as an earlier one.
    expect(await history(orgA)).toEqual([slugA, `s3-night-${suffix}`].sort())
    expect((await organizationAddress(getPool(), orgA))?.oldSlugs).toEqual([`s3-night-${suffix}`])
  })

  it('changes both at once', async () => {
    const result = await updateOrganizationAction({
      name: 'Both Group',
      slug: `s3-both-${suffix}`,
    })
    expect(result).toEqual({
      ok: true,
      name: 'Both Group',
      slug: `s3-both-${suffix}`,
      filesQueued: true,
    })
    expect(await row(orgA)).toEqual({
      name: 'Both Group',
      slug: `s3-both-${suffix}`,
      tenant_name: 'Both Group',
    })
    expect(queue.jobs.length).toBeGreaterThan(0)
  })

  it('saves nothing, and queues nothing, when the values are the ones it has', async () => {
    const before = await row(orgA)
    const result = await updateOrganizationAction({ name: before?.name, slug: before?.slug })
    expect(result).toEqual({
      ok: true,
      name: before?.name,
      slug: before?.slug,
      filesQueued: true,
    })
    expect(await row(orgA)).toEqual(before)
    expect(queue.jobs).toEqual([])
  })

  it('repairs a tenant row whose copy of the name fell behind', async () => {
    const current = await row(orgA)
    await owner.query("update restro.tenants set name = 'Stale copy' where id = $1", [orgA])
    expect(await updateOrganizationAction({ name: current?.name })).toMatchObject({ ok: true })
    expect((await row(orgA))?.tenant_name).toBe(current?.name)
  })

  describe('an address name another organisation has', () => {
    it('is refused when it is that organisation’s current name', async () => {
      const before = await row(orgA)
      expect(await updateOrganizationAction({ slug: slugB })).toEqual({
        ok: false,
        error: 'taken',
      })
      expect(await row(orgA)).toEqual(before)
      expect(queue.jobs).toEqual([])
      expect(revalidated).toEqual([])
    })

    it('is refused when it is one that organisation was called before', async () => {
      const earlier = `s3-b-before-${suffix}`
      expect(
        await recordOrganizationSlug(getPool(), { organizationId: orgB, previousSlug: earlier }),
      ).toEqual({ ok: true, recorded: true })
      const before = await row(orgA)
      expect(await updateOrganizationAction({ slug: earlier })).toEqual({
        ok: false,
        error: 'taken',
      })
      expect(await row(orgA)).toEqual(before)
      // The name sent with it is not saved either: the refusal changes nothing.
      expect(await updateOrganizationAction({ name: 'Never saved', slug: earlier })).toEqual({
        ok: false,
        error: 'taken',
      })
      expect((await row(orgA))?.name).toBe(before?.name)
    })
  })

  it('refuses what is not a name or an address name, or nothing to change', async () => {
    const before = await row(orgA)
    const bad: unknown[] = [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(201) },
      { slug: '' },
      { slug: 'Not a slug' },
      { slug: 'under_score' },
      { slug: '-leading' },
      { slug: 'double--hyphen' },
      { slug: 'a'.repeat(64) },
      { slug: 5 },
      { name: 'Fine', extra: true },
    ]
    for (const input of bad) {
      expect(
        await updateOrganizationAction(input as { name?: string; slug?: string }),
        JSON.stringify(input),
      ).toEqual({ ok: false, error: 'invalid' })
    }
    expect(await row(orgA)).toEqual(before)
    expect(queue.jobs).toEqual([])
  })

  it('is for owners only: an admin and a member are refused, and nothing changes', async () => {
    const before = await row(orgA)
    for (const role of ['admin', 'member', 'member,admin', '']) {
      asked.role = role
      expect(
        await updateOrganizationAction({ name: 'Mine now', slug: `s3-mine-${suffix}` }),
        role,
      ).toEqual({ ok: false, error: 'not_allowed' })
    }
    expect(await row(orgA)).toEqual(before)
    expect(await history(orgA)).not.toContain(before?.slug)
    expect(queue.jobs).toEqual([])
  })

  it('leaves the other organisation alone', async () => {
    const other = await row(orgB)
    await updateOrganizationAction({ name: 'Only A changes', slug: `s3-only-a-${suffix}` })
    expect(await row(orgB)).toEqual(other)
    expect(await history(orgB)).toContain(`s3-b-before-${suffix}`)
  })

  it('is refused by Better Auth too, when the person is only a member there', async () => {
    const before = await row(orgA)
    asked.headers = new Headers({ cookie: memberCookie })
    expect(await updateOrganizationAction({ name: 'Sneaky' })).toEqual({
      ok: false,
      error: 'failed',
    })
    expect(logged).toEqual(['organization_update_failed'])
    expect(await row(orgA)).toEqual(before)
  })

  it('says the files are late when the queue is down, though the change is saved', async () => {
    queue.failing = true
    const fresh = `s3-late-${suffix}`
    const result = await updateOrganizationAction({ slug: fresh })
    expect(result).toEqual({
      ok: true,
      name: (await row(orgA))?.name,
      slug: fresh,
      filesQueued: false,
    })
    expect((await row(orgA))?.slug).toBe(fresh)
    // Every job was tried, so each failure is logged.
    expect(logged.length).toBeGreaterThanOrEqual(4)
    expect(queue.jobs).toEqual([])
  })

  it('puts Better Auth back when the old address name cannot be remembered', async () => {
    const before = await row(orgA)
    // An inconsistent memory: the organisation's current name is filed as B's earlier one.
    await owner.query(
      'insert into restro.organization_slug_history (slug, organization_id) values ($1, $2)',
      [before?.slug, orgB],
    )
    try {
      expect(
        await updateOrganizationAction({ name: 'Never kept', slug: `s3-no-way-${suffix}` }),
      ).toEqual({ ok: false, error: 'failed' })
      expect(await row(orgA)).toEqual(before)
      expect(queue.jobs).toEqual([])
      expect(logged).toEqual(['organization_update_failed'])
    } finally {
      await owner.query('delete from restro.organization_slug_history where slug = $1', [
        before?.slug,
      ])
    }
  })
})
