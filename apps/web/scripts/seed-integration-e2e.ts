// Fixtures for the end-to-end test of Settings -> Integrations and the venue's Menu source (brief
// S2-05, CF-09b). Run by the e2e global setup (`seed`) and by the test itself, which stands in for
// the worker that does not run:
//
//   seed     an organisation "Integration Club" with its venue, an owner and a plain member (the
//            member only sees), the job queue the web app sends to (pg-boss tables and the two
//            queues, as the worker would create them), and a clean slate: no integration, no
//            barsy venues, no runs, no waiting jobs, only the one venue (what an earlier run added
//            is removed, and its publishing rules are cleared). Idempotent.
//   worker   what a successful `barsy-connect` leaves behind: status connected, the installation's
//            venues, the cached category tree and characteristics, and the queued check gone.
//   history  a finished pull with counters and a refused write for the venue linked to the first
//            till venue, and the queued pulls gone.
//   drop     the waiting pulls gone, nothing else.
//
// Everything goes in through core's writers as the app role; the only owner SQL is the clean slate
// (the app role cannot delete). Like `db:seed:dev` it refuses to run unless NODE_ENV is
// development and the database is on this machine.
import { JOB_NAMES, newId } from '@restro/core'
import {
  appendSourceRecords,
  finishJobRun,
  provisionVenue,
  startJobRun,
  storeCachedTree,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import {
  authMember,
  authOrganization,
  barsyVenues,
  integrations,
  venues,
  withTenant,
} from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'
import { PgBoss } from 'pg-boss'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Integration Club', slug: 'integration-club' }
const VENUE = { name: 'Integration Club Sofia', slug: 'integration-club' }
const OWNER_EMAIL = 'integration-owner@demo-club.test'
const MEMBER_EMAIL = 'integration-member@demo-club.test'

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

async function target(): Promise<{
  tenantId: string
  venueId: string
  integrationId: string | null
}> {
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  if (!organization) throw new Error('Run the `seed` step first: there is no Integration Club.')
  const pool = getPool()
  const [venue] = await withTenant(pool, organization.id, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  if (!venue) throw new Error('Run the `seed` step first: there is no venue.')
  const [integration] = await withTenant(pool, organization.id, (tx) =>
    tx.select({ id: integrations.id }).from(integrations).limit(1),
  )
  return { tenantId: organization.id, venueId: venue.id, integrationId: integration?.id ?? null }
}

/** The pg-boss tables and the two queues the tab sends to; the worker does this when it runs. */
async function ensureQueues(): Promise<void> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL as string,
    schema: 'pgboss',
    createSchema: false,
    migrate: true,
    supervise: false,
    schedule: false,
    max: 2,
    application_name: 'restro-e2e-seed',
  })
  boss.on('error', () => undefined)
  await boss.start()
  try {
    for (const name of [JOB_NAMES.barsyConnect, JOB_NAMES.barsyFullPull]) {
      await boss.createQueue(name, { policy: 'exclusive' })
    }
  } finally {
    await boss.stop({ graceful: false })
  }
}

/** Removes the waiting jobs of this tenant (a worker would have run them). */
async function dropJobs(tenantId: string, names: readonly string[]): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try {
    await pool.query(`delete from pgboss.job where data ->> 'tenantId' = $1 and name = any($2)`, [
      tenantId,
      names,
    ])
  } finally {
    await pool.end()
  }
}

async function seed(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl)
    throw new Error('seed-integration-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const ownerId = await ensureUser(auth, OWNER_EMAIL, 'Integration Owner', password)
  const memberId = await ensureUser(auth, MEMBER_EMAIL, 'Integration Member', password)

  const [found] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
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

  const pool = getPool()
  const [venue] = await withTenant(pool, organizationId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  if (!venue) await provisionVenue(pool, organizationId, { name: VENUE.name, slug: VENUE.slug })

  await ensureQueues()
  await dropJobs(organizationId, [JOB_NAMES.barsyConnect, JOB_NAMES.barsyFullPull])

  // A clean slate: the app role cannot delete these, the owner can.
  const [base] = await withTenant(pool, organizationId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    for (const table of ['job_runs', 'source_records', 'barsy_venues', 'integrations']) {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [organizationId])
    }
    // The venues an earlier run added ("Add as venue") and their empty menus; the base venue
    // keeps nothing of its publishing rules.
    const gone = await owner.query<{ root_node_id: string }>(
      `delete from restro.menus where tenant_id = $1 and venue_id <> $2 returning root_node_id`,
      [organizationId, base?.id],
    )
    await owner.query('delete from restro.nodes where tenant_id = $1 and id = any($2)', [
      organizationId,
      gone.rows.map((row) => row.root_node_id),
    ])
    await owner.query('delete from restro.venues where tenant_id = $1 and id <> $2', [
      organizationId,
      base?.id,
    ])
    await owner.query(
      `update restro.venues set settings = settings - 'publish' where tenant_id = $1`,
      [organizationId],
    )
  } finally {
    await owner.end()
  }
  console.log(JSON.stringify({ level: 'info', event: 'seed_integration_e2e_done', organizationId }))
}

async function worker(): Promise<void> {
  assertDevEnvironment(process.env)
  const { tenantId, integrationId } = await target()
  if (!integrationId)
    throw new Error('Save the credentials in the tab first: there is no integration.')
  const pool = getPool()
  await updateIntegration(pool, tenantId, integrationId, {
    status: 'connected',
    statusDetail: null,
    lastCheckedAt: new Date(),
  })
  await upsertBarsyVenues(pool, tenantId, integrationId, [
    { bid: 1, name: 'Main bar' },
    { bid: 2, name: 'Roof terrace' },
  ])
  await storeCachedTree(pool, tenantId, integrationId, 1, {
    fetched_at: new Date().toISOString(),
    categories: [
      { cat_id: 1091, parent_id: null, name: 'Каса Kiosk' },
      { cat_id: 1171, parent_id: null, name: 'Публично меню' },
      { cat_id: 1172, parent_id: 1171, name: 'Коктейли' },
      { cat_id: 1173, parent_id: 1171, name: 'Бира' },
      { cat_id: 1174, parent_id: 1173, name: 'Наливна' },
      { cat_id: 1175, parent_id: 1171, name: 'Храна' },
    ],
  })
  const details = [
    {
      group_id: 1,
      group_name: 'Основна',
      details: {
        k101: { detail_name: 'Годност в дни' },
        k102: { detail_name: 'Алергени' },
      },
    },
  ]
  await appendSourceRecords(pool, tenantId, integrationId, [
    {
      externalType: 'article_details',
      externalId: 'tree',
      scope: 'master',
      raw: JSON.stringify(details),
      payload: details,
    },
  ])
  const check = await startJobRun(pool, tenantId, { kind: 'barsy_connect', integrationId })
  await finishJobRun(pool, tenantId, check.id, {
    status: 'completed',
    counters: { venues: 2, languages: 2, currencies: 1, trees_cached: 1 },
  })
  await dropJobs(tenantId, [JOB_NAMES.barsyConnect])
}

async function history(): Promise<void> {
  assertDevEnvironment(process.env)
  const { tenantId, integrationId } = await target()
  if (!integrationId)
    throw new Error('Save the credentials in the tab first: there is no integration.')
  const pool = getPool()
  // The venue the first till venue serves: the run names it, as the worker's runs do.
  const [link] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ venueId: barsyVenues.venueId })
      .from(barsyVenues)
      .where(and(eq(barsyVenues.integrationId, integrationId), eq(barsyVenues.bid, 1))),
  )
  const venueId = link?.venueId ?? undefined
  const pull = await startJobRun(pool, tenantId, {
    kind: 'barsy_full_pull',
    integrationId,
    ...(venueId ? { venueId } : {}),
  })
  await finishJobRun(pool, tenantId, pull.id, {
    status: 'completed',
    ...(venueId ? { venueId } : {}),
    counters: {
      categories_seen: 6,
      articles_seen: 58,
      created: 52,
      updated: 4,
      unchanged: 2,
      missing: 0,
      deleted: 0,
      reactivated: 0,
      failed_pages: 1,
    },
    summary: 'deletion check skipped: 1 of 3 pages failed',
    refused: [
      {
        opIndex: 4,
        code: 'less_cautious',
        reason: 'the write would put the item back on sale',
        nodeRef: newId('nd'),
        fieldKey: 'for_sale',
      },
      {
        opIndex: 9,
        code: 'layer_not_allowed',
        reason: 'price is owned by barsy',
        nodeRef: newId('nd'),
        fieldKey: 'price',
      },
    ],
  })
  await dropJobs(tenantId, [JOB_NAMES.barsyFullPull])
}

async function drop(): Promise<void> {
  assertDevEnvironment(process.env)
  const { tenantId } = await target()
  await dropJobs(tenantId, [JOB_NAMES.barsyConnect, JOB_NAMES.barsyFullPull])
}

const modes = { seed, worker, history, drop } as const
const mode = process.argv[2] as keyof typeof modes | undefined

if (!mode || !(mode in modes)) {
  console.error('usage: seed-integration-e2e.ts seed | worker | history | drop')
  process.exit(1)
}

modes[mode]()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-integration-e2e ${mode} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
