// Fixtures for the owner's Paying settings end-to-end test (#116). Run by the test itself:
//
//   seed             an organisation "Paying Club" of its own with one venue on the simulated POS
//                    (it declares that it closes a bill with a payment type and moves lines to a
//                    payment table, so Settings lists Paying), three tables, an owner, a member
//                    whose role may not connect payments (the read-only view), and a member who
//                    holds the venue's Owner role (it marks payment tables, #215). Idempotent.
//
// The venue's payment account is set by `e2e/paying-account.ts`: the paying tables are written by
// core/service alone (write-targets.test.ts), and fixtures in an `e2e` folder are the one place a
// test sets one up, as the pay harness does.
//
// Written the way the service paths write it, as the database owner. Like `db:seed:dev` this
// refuses to run unless NODE_ENV is development and the database is on this machine. No provider
// is called: the test's connect runs against the worker's simulated provider.
import { newId } from '@restro/core'
import {
  createIntegration,
  mapBarsyVenue,
  provisionVenue,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { authMember, authOrganization, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Paying Club', slug: 'paying-club' }
const VENUE = { name: 'Paying Club Sofia', slug: 'paying-club' }
const EMAILS = {
  owner: 'paying-owner@demo-club.test',
  viewer: 'paying-viewer@demo-club.test',
  venueOwner: 'paying-venue-owner@demo-club.test',
} as const
const SEED = ['restro', 'system', 'e2e-seed'] as const
const HOST = 'paying-club.seed.test'

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

function ownerPool(): pg.Pool {
  const url = process.env.DATABASE_URL_OWNER
  if (!url) throw new Error('seed-paying-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: url })
  return new pg.Pool({ connectionString: url, max: 1 })
}

async function seed(): Promise<void> {
  const owner = ownerPool()
  const { password } = readAdminCredentials(process.env)
  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  try {
    const ownerId = await ensureUser(auth, EMAILS.owner, 'Paying Owner', password)
    const viewerId = await ensureUser(auth, EMAILS.viewer, 'Paying Viewer', password)
    const venueOwnerId = await ensureUser(auth, EMAILS.venueOwner, 'Paying Venue Owner', password)
    const [found] = await db
      .select({ id: authOrganization.id })
      .from(authOrganization)
      .where(eq(authOrganization.slug, ORGANIZATION.slug))
      .limit(1)
    const tenantId =
      found?.id ??
      (
        await auth.api.createOrganization({
          body: { name: ORGANIZATION.name, slug: ORGANIZATION.slug, userId: ownerId },
        })
      ).id
    for (const [userId, role] of [
      [ownerId, 'owner'],
      [viewerId, 'member'],
      [venueOwnerId, 'member'],
    ] as const) {
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

    // The venue is served by the simulated POS, which declares what paying needs. Its places become
    // the venue's tables when the venue is mapped (D95): three, in one hall.
    let integrationId = (
      await owner.query<{ id: string }>(
        `select id from restro.integrations where tenant_id = $1 and kind = 'sim' and removed_at is null`,
        [tenantId],
      )
    ).rows[0]?.id
    if (integrationId === undefined) {
      integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host: HOST })).id
      await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Paying Club' }])
      for (const number of ['1', '2', '3']) {
        await owner.query(
          `insert into restro.places
             (id, tenant_id, integration_id, bid, place_id, place_num, salon_name, salon_id, salon_weight, is_public)
           values ($1, $2, $3, 1, $4, $4, 'Hall', 'hall', 1, true)`,
          [newId('tb'), tenantId, integrationId, number],
        )
      }
      const mapped = await mapBarsyVenue(pool, tenantId, integrationId, 1, venueId)
      if (!mapped.ok) throw new Error('the venue could not be mapped to the simulated POS')
    }
    await owner.query(
      `update restro.integrations
          set config = config || jsonb_build_object('service_capabilities', $2::jsonb)
        where id = $1`,
      [
        integrationId,
        JSON.stringify({
          close_with_payment_type: true,
          move_lines_to_table: true,
          record_tip_on_close: false,
        }),
      ],
    )

    // Two staff members: the viewer, whose role may open and close tables and nothing else, and
    // the venue owner, an organisation member who holds the venue's Owner role (so, unlike an
    // organisation owner or admin, the rights come from the venue role alone).
    const staffRoles = [
      {
        userId: viewerId,
        name: 'Paying Viewer',
        role: 'Floor',
        permissions: ['tables.open_close'],
      },
      {
        userId: venueOwnerId,
        name: 'Paying Venue Owner',
        role: 'Owner',
        // What an Owner role holds that this test needs; the others are not reached from Tables & QR.
        permissions: ['tables.open_close', 'settings.payment_tables'],
      },
    ]
    for (const person of staffRoles) {
      const staff = await owner.query<{ id: string }>(
        'select id from restro.staff_members where tenant_id = $1 and user_id = $2',
        [tenantId, person.userId],
      )
      if (staff.rows.length > 0) continue
      const staffId = newId('sm')
      const roleId = newId('rl')
      await owner.query(
        `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [staffId, tenantId, person.name, person.userId, ...SEED],
      )
      await owner.query(
        `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [roleId, tenantId, venueId, person.role, JSON.stringify(person.permissions), ...SEED],
      )
      await owner.query(
        `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, staffId, venueId, roleId, ...SEED],
      )
    }
    console.log(JSON.stringify({ level: 'info', event: 'seed_paying_e2e_done', tenantId, venueId }))
  } finally {
    await owner.end()
  }
}

const [step] = process.argv.slice(2)
const run = step === 'seed' ? seed() : Promise.reject(new Error('seed'))
run
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-paying-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
