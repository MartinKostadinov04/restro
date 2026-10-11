// Fixtures for the navigation end-to-end test (CF-09a, D74). Run by the test itself (`seed`):
//
//   seed   an organisation "Navigation Club" with an owner, a plain member and three venues (Aurora
//          Bar, Boulevard Club, zenith Lounge: the last one in lower case, to see the sidebar sort by
//          name and not by letter case). Idempotent: what an earlier run made (the venue the test
//          creates from the sidebar, with its menu and jobs) is removed first, so the organisation
//          always starts with the same three. It is a fixture of its own, so the other specs, which
//          count the demo organisation's venues, are not affected.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on
// this machine.
import { provisionMenu, provisionVenue } from '@restro/core/apply'
import { authMember, authOrganization } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Navigation Club', slug: 'navigation-club' }
const OWNER_EMAIL = 'navigation-owner@demo-club.test'
const MEMBER_EMAIL = 'navigation-member@demo-club.test'
const VENUES = [
  { name: 'zenith Lounge', slug: 'zenith-lounge' },
  { name: 'Boulevard Club', slug: 'boulevard-club' },
  { name: 'Aurora Bar', slug: 'aurora-bar' },
] as const

async function ensureUser(
  auth: ReturnType<typeof createAuth>,
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const context = await auth.$context
  const hash = await context.password.hash(password)
  const existing = await context.internalAdapter.findUserByEmail(email)
  if (existing) {
    await context.internalAdapter.updatePassword(existing.user.id, hash)
    return existing.user.id
  }
  const user = await context.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: 'admin' },
  )
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  })
  return user.id
}

/** Every table that holds an organisation's menus, children before parents. */
const TENANT_TABLES = [
  'publish_pointers',
  'item_first_published',
  'snapshots',
  'job_runs',
  'tags',
  'events',
  'placements',
  'field_values',
  'menus',
  'nodes',
  'venues',
] as const

/** Removes what earlier runs made in the organisation, as the database owner (dev machine only). */
async function clearOrganization(organizationId: string): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-navigation-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    for (const table of TENANT_TABLES) {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [organizationId])
    }
    await owner.query(`delete from pgboss.job where data ->> 'tenantId' = $1`, [organizationId])
  } finally {
    await owner.end()
  }
}

async function seed(): Promise<void> {
  assertDevEnvironment(process.env)
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const ownerId = await ensureUser(auth, OWNER_EMAIL, 'Navigation Owner', password)
  const memberId = await ensureUser(auth, MEMBER_EMAIL, 'Navigation Member', password)

  const [found] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  // Creating the organisation provisions its tenant row too (server/auth.ts).
  const organizationId =
    found?.id ??
    (
      await auth.api.createOrganization({
        body: { name: ORGANIZATION.name, slug: ORGANIZATION.slug, userId: ownerId },
      })
    ).id
  for (const [userId, role] of [
    [ownerId, 'owner'],
    [memberId, 'member'],
  ] as const) {
    const [membership] = await db
      .select({ id: authMember.id, role: authMember.role })
      .from(authMember)
      .where(and(eq(authMember.organizationId, organizationId), eq(authMember.userId, userId)))
      .limit(1)
    if (!membership) {
      await db
        .insert(authMember)
        .values({ id: authModelId('member'), organizationId, userId, role })
    } else if (membership.role !== role) {
      await db.update(authMember).set({ role }).where(eq(authMember.id, membership.id))
    }
  }

  await clearOrganization(organizationId)
  const pool = getPool()
  for (const venue of VENUES) {
    const made = await provisionVenue(pool, organizationId, venue)
    await provisionMenu(pool, organizationId, made.id)
  }
  console.log(JSON.stringify({ level: 'info', event: 'seed_navigation_e2e_done', organizationId }))
}

const [step] = process.argv.slice(2)
if (step !== 'seed') {
  console.error(`seed-navigation-e2e: unknown step "${step}" (seed)`)
  process.exit(1)
}
seed()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-navigation-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
