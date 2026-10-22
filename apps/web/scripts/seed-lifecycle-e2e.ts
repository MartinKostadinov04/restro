// Fixtures for the venue lifecycle end-to-end test (CF-18, D76). Run by the test itself (`seed`):
//
//   seed   an organisation "Lifecycle Club" with an owner, an admin and a plain member, and two
//          venues: "Lifecycle Bar" (published: a menu with one item in the e2e publish folder, a
//          till venue linked to it and one table with a QR code and its file) and "Lifecycle
//          Keeper" (a menu with nothing published). The test renames, deletes and restores the
//          first one and checks the guest page and the QR address at each step. Idempotent: what
//          an earlier run made is removed first, so the organisation always starts the same. It is
//          a fixture of its own, so the other specs, which count the demo organisation's venues,
//          are not affected.
//
// The publish goes the real way, like seed-guest-e2e.ts: `publishMenu` (core/apply), then the
// worker's own `writePublishFiles`. Like `db:seed:dev` this refuses to run unless NODE_ENV is
// development and the database is on this machine. It prints one JSON line with the ids the test
// needs (`seed_lifecycle_e2e_done`).
import { createPublishStore, publishStoreConfig, writeTableTokenFile } from '@restro/assets'
import { type ChangeSet, hashTableCode, newId, newTableToken } from '@restro/core'
import {
  apply,
  createIntegration,
  listVenueTables,
  mapBarsyVenue,
  provisionMenu,
  provisionVenue,
  publishMenu,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'
import { authMember, authOrganization } from '@restro/db'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'
import { writeLiveOverlay, writePublishFiles } from '../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../worker/src/publish/organization-index'
import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Lifecycle Club', slug: 'lifecycle-club' }
const PEOPLE = [
  { email: 'lifecycle-owner@demo-club.test', name: 'Lifecycle Owner', role: 'owner' },
  { email: 'lifecycle-admin@demo-club.test', name: 'Lifecycle Admin', role: 'admin' },
  { email: 'lifecycle-member@demo-club.test', name: 'Lifecycle Member', role: 'member' },
] as const
const TABLE_LABEL = '7'

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
  'source_links',
  'places',
  'menu_routes',
  'tables',
  'areas',
  'barsy_venues',
  'integrations',
  'menus',
  'nodes',
  'venue_slug_history',
  'venues',
] as const

/** Removes what earlier runs made in the organisation, as the database owner (dev machine only). */
async function clearOrganization(organizationId: string): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-lifecycle-e2e needs DATABASE_URL_OWNER (see .env.example).')
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

/**
 * Gives the table a code as one from before #70 is kept (in plain beside its hash, not sealed), as
 * the database owner: a new code is sealed for the worker, and the test needs to know it. The
 * worker's seal job seals it like any other old code.
 */
async function giveKnownCode(tableId: string): Promise<string> {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const code = newTableToken()
    await owner.query(
      'update restro.tables set qr_token = $1, qr_code_hash = $2, qr_code_sealed = null where id = $3',
      [code, await hashTableCode(code), tableId],
    )
    return code
  } finally {
    await owner.end()
  }
}

async function seed(): Promise<void> {
  assertDevEnvironment(process.env)
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const userIds = new Map<string, string>()
  for (const person of PEOPLE) {
    userIds.set(person.email, await ensureUser(auth, person.email, person.name, password))
  }
  const ownerId = userIds.get(PEOPLE[0].email) ?? ''

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
  for (const person of PEOPLE) {
    const userId = userIds.get(person.email) ?? ''
    const [membership] = await db
      .select({ id: authMember.id, role: authMember.role })
      .from(authMember)
      .where(and(eq(authMember.organizationId, organizationId), eq(authMember.userId, userId)))
      .limit(1)
    if (!membership) {
      await db
        .insert(authMember)
        .values({ id: authModelId('member'), organizationId, userId, role: person.role })
    } else if (membership.role !== person.role) {
      await db.update(authMember).set({ role: person.role }).where(eq(authMember.id, membership.id))
    }
  }

  await clearOrganization(organizationId)
  const pool = getPool()

  // --- "Lifecycle Bar": a menu with one item, a till venue, a table, all of it published -------
  const bar = await provisionVenue(pool, organizationId, {
    name: 'Lifecycle Bar',
    slug: 'lifecycle-bar',
  })
  const barMenu = await provisionMenu(pool, organizationId, bar.id)
  const section = newId('nd')
  const item = newId('nd')
  const text = (value: string) => ({ bg_BG: value, en_US: value })
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const applied = await apply(pool, organizationId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:us_e2e',
    observedAt: new Date().toISOString(),
    ops: [
      manual(barMenu.id, 'title', text('Lifecycle Bar')),
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: barMenu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', text('Cocktails')),
      { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
      manual(item, 'name', text('Lifecycle Negroni')),
      manual(item, 'price', { amount_minor: 1250, currency: 'EUR' }),
      manual(item, 'allergens', []),
      { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
    ],
  } as ChangeSet)
  if (applied.rejected.length > 0) throw new Error('the lifecycle e2e fixtures were refused')

  const integration = await createIntegration(pool, organizationId, {
    kind: 'barsy',
    host: 'lifecycle.barsyonline.com',
  })
  const bid = 5001
  await upsertBarsyVenues(pool, organizationId, integration.id, [{ bid, name: 'Lifecycle till' }])
  const linked = await mapBarsyVenue(pool, organizationId, integration.id, bid, bar.id)
  if (!linked.ok) throw new Error('the till venue could not be linked')
  await upsertPlaces(
    pool,
    organizationId,
    integration.id,
    bid,
    [{ placeId: 'lifecycle-table', placeNum: TABLE_LABEL, salonName: 'Hall', isPublic: true }],
    { pagesOk: [true] },
  )
  const [table] = await listVenueTables(pool, organizationId, bar.id)
  if (!table) throw new Error('the table was not stored')
  const token = await giveKnownCode(table.id)

  const publishStore = await createPublishStore(publishStoreConfig(process.env))
  const published = await publishMenu(pool, organizationId, {
    menuId: barMenu.id,
    venueId: bar.id as never,
    reason: 'manual',
    actor: 'system',
  })
  if (published.status !== 'published') throw new Error('the menu was not published')
  const deps = { pool, store: publishStore, now: () => new Date() }
  const scope = { tenantId: organizationId, menuId: barMenu.id, venueId: bar.id as never }
  await writePublishFiles(deps, scope)
  await writeLiveOverlay(deps, scope)
  // The organisation's index (D84), as the publish job writes it after the files.
  await writeOrganizationIndex(deps, organizationId)
  await writeTableTokenFile(publishStore, await hashTableCode(token), {
    venue_public_id: bar.publicId,
    venue_slug: bar.slug,
    table_label: TABLE_LABEL,
  })

  // --- "Lifecycle Keeper": a venue that stays, with a menu and nothing published ---------------
  const keeper = await provisionVenue(pool, organizationId, {
    name: 'Lifecycle Keeper',
    slug: 'lifecycle-keeper',
  })
  await provisionMenu(pool, organizationId, keeper.id)

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_lifecycle_e2e_done',
      organizationId,
      barId: bar.id,
      barSlug: bar.slug,
      barPublicId: bar.publicId,
      keeperId: keeper.id,
      token,
    }),
  )
}

const [step] = process.argv.slice(2)
if (step !== 'seed') {
  console.error(`seed-lifecycle-e2e: unknown step "${step}" (seed)`)
  process.exit(1)
}
seed()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-lifecycle-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
