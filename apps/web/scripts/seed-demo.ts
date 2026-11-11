// `pnpm db:seed:demo`: the demo club of Martin's acceptance walk, set up in one command — a venue
// on the simulated POS with the real club's floor plan ported from its earlier prototype, a
// Bulgarian club menu, a design, the settings and guest features ordering and paying need, the
// staff to switch between, and a night already in progress (open tables, bills, rounds in the bag,
// waiter calls, bookings in every state, a waiting list, a blocked booth), with the snapshot
// published so the guest page serves.
//
// It prints, at the end, every address and sign-in it made, because the venue's public code is
// drawn at random (D68) and no URL can be known in advance.
//
// Like `db:seed:dev` it refuses to run unless NODE_ENV is "development" and the database is on
// this machine, and it connects as the app role. Repeat it and it brings the club back to this
// state: the organisation, the venue, the instance, the menu, the plan and the staff are found
// before they are made, and the night is keyed by the service day, so a second run on the same
// night adds nothing twice.
import { provisionTenant } from '@restro/core/apply'
import { authMember, authOrganization } from '@restro/db'
import { and, eq } from 'drizzle-orm'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { DEMO_ORGANIZATION, DEMO_PEOPLE, DEMO_VENUE } from './lib/demo-club'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'
import { seedDemoClub } from './lib/seed-demo-club'
import { seedDemoNight, seedDemoPeople } from './lib/seed-demo-night'

const SCRIPT = 'db:seed:demo'

async function main(): Promise<void> {
  assertDevEnvironment(process.env, SCRIPT)
  // One local development password for every account of the demo club, from the environment: the
  // seed invents no secret and commits none (`.env.example` publishes the pair it ships with).
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const context = await auth.$context
  const db = getAuthDb()
  const pool = getPool()
  const passwordHash = await context.password.hash(password)

  // 1. The accounts: the owner first, then the people who work the night.
  const accounts = new Map<string, string>()
  for (const person of DEMO_PEOPLE) {
    const existing = await context.internalAdapter.findUserByEmail(person.email)
    if (existing) {
      accounts.set(person.email, existing.user.id)
      await context.internalAdapter.updatePassword(existing.user.id, passwordHash)
      continue
    }
    const user = await context.internalAdapter.createUser(
      { email: person.email, name: person.name, emailVerified: true },
      { method: 'admin' },
    )
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: passwordHash,
    })
    accounts.set(person.email, user.id)
  }
  const ownerEmail = DEMO_PEOPLE[0]?.email ?? ''
  const ownerId = accounts.get(ownerEmail)
  if (ownerId === undefined) throw new Error('the demo club has no owner account')

  // 2. The organisation (= tenant), through Better Auth so its hook provisions the tenant row.
  const [found] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, DEMO_ORGANIZATION.slug))
    .limit(1)
  let tenantId: string
  if (found) {
    tenantId = found.id
    await provisionTenant(pool, { tenantId, name: DEMO_ORGANIZATION.name })
  } else {
    const created = await auth.api.createOrganization({
      body: { name: DEMO_ORGANIZATION.name, slug: DEMO_ORGANIZATION.slug, userId: ownerId },
    })
    tenantId = created.id
  }

  // 3. Everyone is a member of it: the owner as owner, the rest as members, which is what a staff
  // record needs before it can be linked to an account.
  for (const person of DEMO_PEOPLE) {
    const userId = accounts.get(person.email)
    if (userId === undefined) continue
    const [membership] = await db
      .select({ id: authMember.id })
      .from(authMember)
      .where(and(eq(authMember.organizationId, tenantId), eq(authMember.userId, userId)))
      .limit(1)
    if (membership) continue
    await db.insert(authMember).values({
      id: authModelId('member'),
      organizationId: tenantId,
      userId,
      role: person.defaultRole === null ? 'owner' : 'member',
    })
  }

  // 4. The club itself, up to the published snapshot.
  const club = await seedDemoClub(pool, tenantId, {
    userId: ownerId,
    organizationSlug: DEMO_ORGANIZATION.slug,
  })

  // 5. The staff and the night, as the owner's own screens write them.
  const scope = {
    pool,
    tenantId,
    venueId: club.venueId,
    userId: ownerId,
    sessionId: 'seed-demo',
    signedInAt: new Date(),
    operator: false,
  }
  const people = await seedDemoPeople(scope, accounts)
  const night = await seedDemoNight(pool, tenantId, club, scope)

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_demo_done',
      organization: DEMO_ORGANIZATION.name,
      organizationSlug: DEMO_ORGANIZATION.slug,
      tenantId,
      venue: DEMO_VENUE.name,
      venueId: club.venueId,
      // The guest address: the slug and the venue's random public code (D68).
      menuPath: club.path,
      tables: club.tables,
      tablesWithCodes: club.codeHashes.size,
      codesIssuedNow: club.codesIssued,
      spots: club.spots,
      plan: club.planId,
      areas: club.areas,
      menuSections: club.sections,
      menuItems: club.articles,
      night,
      staff: people.staff,
      staffSkipped: people.skipped,
      signIns: DEMO_PEOPLE.map((person) => ({ email: person.email, role: person.role })),
    }),
  )
  if (night.skipped.length > 0 || people.skipped.length > 0) {
    console.log(`${SCRIPT}: ${[...night.skipped, ...people.skipped].join('; ')}`)
  }
}

main()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(`${SCRIPT} failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
