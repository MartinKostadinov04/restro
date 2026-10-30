// `pnpm db:seed:dev`: a demo owner, the organisation "Demo Club" and its venue "Demo Club Sofia"
// (slug `demo-club`), for local development and the e2e test. Idempotent: run it again and it
// brings the demo data back to this state (the owner's password follows DEV_ADMIN_PASSWORD).
//
// It refuses to run unless NODE_ENV is "development" and the database is on this machine
// (scripts/lib/guard.ts). It goes through the real paths: the organisation is created with Better
// Auth's `createOrganization` (whose hook creates the tenant row), the venue with core's
// `provisionVenue`, and the venue's menu with core's `provisionMenu` and `apply()` (a made-up
// barsy integration and pull: see lib/demo-menu.ts). It connects as the app role (DATABASE_URL),
// like the web app.
import { CALL_WAITER_KINDS, menuPath, type VenueId } from '@restro/core'
import { provisionTenant, provisionVenue, setGuestFeatures } from '@restro/core/apply'
import { authMember, authOrganization, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import {
  assertDevEnvironment,
  readAdminCredentials,
  seedsDemoBar,
  seedsDemoMenu,
} from './lib/guard'
import { seedDemoBar } from './lib/seed-demo-bar'
import { seedDemoMenu } from './lib/seed-demo-menu'

const ORGANIZATION = { name: 'Demo Club', slug: 'demo-club' }
const VENUE = { name: 'Demo Club Sofia', slug: 'demo-club' }

async function main(): Promise<void> {
  assertDevEnvironment(process.env)
  const { email, password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const context = await auth.$context
  const db = getAuthDb()
  const pool = getPool()

  // 1. The owner.
  let userId: string
  const existing = await context.internalAdapter.findUserByEmail(email)
  const passwordHash = await context.password.hash(password)
  if (existing) {
    userId = existing.user.id
    await context.internalAdapter.updatePassword(userId, passwordHash)
  } else {
    const user = await context.internalAdapter.createUser(
      { email, name: 'Demo Owner', emailVerified: true },
      { method: 'admin' },
    )
    userId = user.id
    await context.internalAdapter.linkAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: passwordHash,
    })
  }

  // 2. The organisation (= tenant), through Better Auth so that its hook provisions the tenant.
  const [found] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  let organizationId: string
  if (found) {
    organizationId = found.id
    // Safe to repeat: this is a no-op when the tenant row exists.
    await provisionTenant(pool, { tenantId: organizationId, name: ORGANIZATION.name })
  } else {
    const created = await auth.api.createOrganization({
      body: { name: ORGANIZATION.name, slug: ORGANIZATION.slug, userId },
    })
    organizationId = created.id
  }

  // 3. The owner is a member (createOrganization adds the creator; a re-run may need it).
  const [membership] = await db
    .select({ id: authMember.id })
    .from(authMember)
    .where(and(eq(authMember.organizationId, organizationId), eq(authMember.userId, userId)))
    .limit(1)
  if (!membership) {
    await db
      .insert(authMember)
      .values({ id: authModelId('member'), organizationId, userId, role: 'owner' })
  }

  // 4. The venue.
  const [venueRow] = await withTenant(pool, organizationId, (tx) =>
    tx
      .select({ id: venues.id, publicId: venues.publicId })
      .from(venues)
      .where(eq(venues.slug, VENUE.slug))
      .limit(1),
  )
  const venue =
    venueRow ?? (await provisionVenue(pool, organizationId, { name: VENUE.name, slug: VENUE.slug }))
  const venueId = venue.id

  // 5. The demo menu (made-up items), unless SEED_DEMO_MENU=0: then the venue starts empty and
  // its menu comes from a real barsy sync (the Stage 2 acceptance run).
  const menu = seedsDemoMenu(process.env)
    ? await seedDemoMenu(pool, organizationId, venueId, userId)
    : null

  // 6. Demo Bar: a venue on a simulated POS (#71), unless SEED_DEMO_MENU=0. Its menu is written
  // through apply() from the same scenario file the simulator loads; its bars and tables come
  // from the simulator through the worker's floor reading (start `pnpm sim:serve` and the worker).
  const demoBar = seedsDemoBar(process.env) ? await seedDemoBar(pool, organizationId) : null

  // 7. Demo Bar's guest services on, for the ordering and paying walks from a phone. The change
  // reaches guests with the next publish. Its page draws the default template, which shows them
  // once #239 lands.
  if (demoBar !== null) {
    const demoBarId = demoBar.venueId as VenueId
    await setGuestFeatures(pool, organizationId, {
      venueId: demoBarId,
      features: {
        filters: true,
        call_waiter: { enabled: true, kinds: [...CALL_WAITER_KINDS] },
        bill: true,
        ordering: true,
        pay: true,
      },
    })
  }

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_dev_done',
      menu,
      demoBar,
      organization: ORGANIZATION.name,
      organizationId,
      venue: VENUE.name,
      venueId,
      // The guest address: the slug and the venue's random public code (D68).
      menuPath: menuPath({ slug: VENUE.slug, publicId: venue.publicId }),
      owner: email,
    }),
  )
}

main()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(`db:seed:dev failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
