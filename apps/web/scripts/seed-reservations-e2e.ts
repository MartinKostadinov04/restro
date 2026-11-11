// Fixtures for the owner's Settings › Reservations end-to-end test (#325). Run by the test itself:
//
//   seed         an organisation "Reservations Club" of its own with one venue made by hand
//                (reservations are Restro's own, so no POS is needed), an owner (who holds every
//                permission) and a viewer whose role may only work tonight's reservations (the
//                read-only view). Idempotent.
//   plan-editor  the plan editor's test (#397): an organisation "Plan Editor Club" with its owner,
//                and a venue made by hand that is new on every run, so it starts with no plan, no
//                spot kind and no reservation settings at all. Everything after that is laid out
//                through the screens. Prints `{"venueId": …}` as its last line.
//
// The venue's settings, plan and spots are set by `e2e/reservations-state.ts`: the reservation
// tables are written by core/service alone (write-targets.test.ts), and fixtures in an `e2e` folder
// are the one place a test sets them up, as the pay harness does.
//
// Written the way the service paths write it, as the database owner. Like `db:seed:dev` this
// refuses to run unless NODE_ENV is development and the database is on this machine.
import { newId } from '@restro/core'
import { provisionVenue } from '@restro/core/apply'
import { authMember, authOrganization, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Reservations Club', slug: 'reservations-club' }
const VENUE = { name: 'Reservations Club Sofia', slug: 'reservations-club' }
const EMAILS = {
  owner: 'reservations-owner@demo-club.test',
  viewer: 'reservations-viewer@demo-club.test',
} as const
const SEED = ['restro', 'system', 'e2e-seed'] as const
const PLAN_EDITOR = {
  organization: { name: 'Plan Editor Club', slug: 'plan-editor-club' },
  owner: 'plan-editor-owner@demo-club.test',
} as const

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

/** The organisation by its slug, made if missing, with each member holding the role given. */
async function ensureOrganization(
  auth: ReturnType<typeof createAuth>,
  organization: { readonly name: string; readonly slug: string },
  creatorId: string,
  members: readonly (readonly [string, string])[],
): Promise<string> {
  const db = getAuthDb()
  const [found] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, organization.slug))
    .limit(1)
  const tenantId =
    found?.id ??
    (
      await auth.api.createOrganization({
        body: { name: organization.name, slug: organization.slug, userId: creatorId },
      })
    ).id
  for (const [userId, role] of members) {
    const [membership] = await db
      .select({ id: authMember.id })
      .from(authMember)
      .where(and(eq(authMember.organizationId, tenantId), eq(authMember.userId, userId)))
      .limit(1)
    if (!membership) {
      await db
        .insert(authMember)
        .values({ id: authModelId('member'), organizationId: tenantId, userId, role })
    } else {
      await db.update(authMember).set({ role }).where(eq(authMember.id, membership.id))
    }
  }
  return tenantId
}

function ownerPool(): pg.Pool {
  const url = process.env.DATABASE_URL_OWNER
  if (!url) throw new Error('seed-reservations-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: url })
  return new pg.Pool({ connectionString: url, max: 1 })
}

async function seed(): Promise<void> {
  const owner = ownerPool()
  const { password } = readAdminCredentials(process.env)
  const auth = createAuth({ scripts: true })
  try {
    const ownerId = await ensureUser(auth, EMAILS.owner, 'Reservations Owner', password)
    const viewerId = await ensureUser(auth, EMAILS.viewer, 'Reservations Viewer', password)
    const tenantId = await ensureOrganization(auth, ORGANIZATION, ownerId, [
      [ownerId, 'owner'],
      [viewerId, 'member'],
    ])

    const pool = getPool()
    const findVenue = () =>
      withTenant(pool, tenantId, (tx) =>
        tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
      )
    let [venue] = await findVenue()
    if (!venue) {
      await provisionVenue(pool, tenantId, { name: VENUE.name, slug: VENUE.slug })
      ;[venue] = await findVenue()
    }
    if (!venue) throw new Error('the venue was not made')
    const venueId = venue.id

    // The viewer: a role that works tonight's reservations and nothing of the settings.
    const staff = await owner.query<{ id: string }>(
      'select id from restro.staff_members where tenant_id = $1 and user_id = $2',
      [tenantId, viewerId],
    )
    if (staff.rows.length === 0) {
      const staffId = newId('sm')
      const roleId = newId('rl')
      await owner.query(
        `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [staffId, tenantId, 'Reservations Viewer', viewerId, ...SEED],
      )
      await owner.query(
        `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [roleId, tenantId, venueId, 'Floor', JSON.stringify(['reservations.tonight']), ...SEED],
      )
      await owner.query(
        `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, staffId, venueId, roleId, ...SEED],
      )
    }
    console.log(
      JSON.stringify({ level: 'info', event: 'seed_reservations_e2e_done', tenantId, venueId }),
    )
  } finally {
    await owner.end()
  }
}

/**
 * The plan editor's venue: new on every run, made the way a venue is made (`provisionVenue`), with
 * nothing of reservations written. The owner lays the plan out through the screens themselves.
 */
async function seedPlanEditor(): Promise<void> {
  // The same guard as `seed`: development only, on this machine.
  assertDevEnvironment(process.env)
  const { password } = readAdminCredentials(process.env)
  const auth = createAuth({ scripts: true })
  const ownerId = await ensureUser(auth, PLAN_EDITOR.owner, 'Plan Editor Owner', password)
  const tenantId = await ensureOrganization(auth, PLAN_EDITOR.organization, ownerId, [
    [ownerId, 'owner'],
  ])
  const suffix = newId('vn').slice(-6).toLowerCase()
  const slug = `plan-editor-${suffix}`
  await provisionVenue(getPool(), tenantId, { name: `Plan Editor ${suffix}`, slug })
  const [venue] = await withTenant(getPool(), tenantId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, slug)).limit(1),
  )
  if (!venue) throw new Error('the venue was not made')
  console.log(JSON.stringify({ venueId: venue.id }))
}

const [step] = process.argv.slice(2)
const run =
  step === 'seed'
    ? seed()
    : step === 'plan-editor'
      ? seedPlanEditor()
      : Promise.reject(new Error('seed | plan-editor'))
run
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-reservations-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
