// Fixtures for the Publish tab's end-to-end test (brief S3-05). Run by the e2e global setup (`seed`)
// and by the test itself, which changes the menu "behind the tab's back" through core's writers:
//
//   seed        an organisation "Publish Club" with its venue (slug `publish-club`), an owner and a
//               plain member (the member only reads the tab), a small hand-made menu (five drinks in
//               two sections, Bulgarian and English names), a barsy integration mapped to the venue
//               (its config holds the pause of automatic publishing), and a clean slate: nothing
//               published, no held publish, no runs, no waiting jobs, no published files. Idempotent.
//   price <n> [i]  the manual price of drink number i (0 = Negroni, the default), in euro cents.
//   hold        hides three of the five drinks and runs an AUTOMATIC publish, which V11 holds.
//   auto        queues an AUTOMATIC publish for the worker to run at once (it is skipped while paused).
//   unhide      shows the five drinks again (clears the hides).
//
// The publish itself is the real worker's, started by playwright.config.ts. Like `db:seed:dev` this
// refuses to run unless NODE_ENV is development and the database is on this machine.
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { publishStoreConfig } from '@restro/assets'
import { type ChangeSet, JOB_NAMES, type NodeId, newId, prepareJob } from '@restro/core'
import {
  apply,
  createIntegration,
  mapBarsyVenue,
  provisionMenu,
  provisionVenue,
  publishMenu,
  setAutoPublishPaused,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { authMember, authOrganization, nodes, venues, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { PgBoss } from 'pg-boss'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Publish Club', slug: 'publish-club' }
const VENUE = { name: 'Publish Club Sofia', slug: 'publish-club' }
const OWNER_EMAIL = 'publish-owner@demo-club.test'
const MEMBER_EMAIL = 'publish-member@demo-club.test'

/** Fixed node ids, so running the seed again finds the same document. */
const nodeId = (name: string) => `nd_${name.padEnd(22, '0')}` as NodeId
const SECTIONS = [
  { id: nodeId('E2ePubCocktails'), bg: 'Коктейли', en: 'Cocktails' },
  { id: nodeId('E2ePubBeer'), bg: 'Бира', en: 'Beer' },
] as const
const ITEMS = [
  { id: nodeId('E2ePubNegroni'), bg: 'Негрони', en: 'Negroni', price: 1250, section: 0 },
  { id: nodeId('E2ePubMojito'), bg: 'Мохито', en: 'Mojito', price: 900, section: 0 },
  { id: nodeId('E2ePubSpritz'), bg: 'Шприц', en: 'Spritz', price: 1000, section: 0 },
  { id: nodeId('E2ePubLager'), bg: 'Светла бира', en: 'Lager', price: 450, section: 1 },
  { id: nodeId('E2ePubStout'), bg: 'Тъмна бира', en: 'Stout', price: 500, section: 1 },
] as const

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
const manual = (node: string, fieldKey: string, value: unknown) => ({
  op: 'setField',
  node: { id: node },
  fieldKey,
  layer: 'manual',
  scope: 'master',
  value,
})
const changeSet = (ops: unknown[]): ChangeSet =>
  ({
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops,
  }) as ChangeSet

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

/** The tenant, venue and menu of this fixture; throws if `seed` has not run. */
async function target() {
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  if (!organization) throw new Error('Run the `seed` step first: there is no Publish Club.')
  const pool = getPool()
  const [venue] = await withTenant(pool, organization.id, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  if (!venue) throw new Error('Run the `seed` step first: there is no venue.')
  const menu = await provisionMenu(pool, organization.id, venue.id)
  return { pool, tenantId: organization.id, venueId: venue.id, menu }
}

async function seed(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-publish-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const ownerId = await ensureUser(auth, OWNER_EMAIL, 'Publish Owner', password)
  const memberId = await ensureUser(auth, MEMBER_EMAIL, 'Publish Member', password)

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
  const [existing] = await withTenant(pool, organizationId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, VENUE.slug)).limit(1),
  )
  const venueId =
    existing?.id ??
    (await provisionVenue(pool, organizationId, { name: VENUE.name, slug: VENUE.slug })).id
  const menu = await provisionMenu(pool, organizationId, venueId)

  // The document: created once, its values put back to the baseline every time.
  const known = new Set(
    (
      await withTenant(pool, organizationId, (tx) =>
        tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(inArray(nodes.id, [...SECTIONS.map((s) => s.id), ...ITEMS.map((i) => i.id)])),
      )
    ).map((row) => row.id),
  )
  const create = (id: NodeId, nodeType: 'section' | 'item', parent: NodeId | null) =>
    known.has(id)
      ? []
      : [
          {
            op: 'createNode',
            id,
            nodeType,
            parent: parent === null ? null : { id: parent },
            status: 'active',
            ...(nodeType === 'section' ? { sortKey: 'end' } : {}),
          },
        ]
  const result = await apply(
    pool,
    organizationId,
    changeSet([
      manual(menu.id, 'title', { bg_BG: 'Публик клуб', en_US: 'Publish Club' }),
      ...SECTIONS.flatMap((section) => [
        ...create(section.id, 'section', menu.id),
        manual(section.id, 'title', { bg_BG: section.bg, en_US: section.en }),
      ]),
      ...ITEMS.flatMap((item) => [
        ...create(item.id, 'item', null),
        manual(item.id, 'name', { bg_BG: item.bg, en_US: item.en }),
        manual(item.id, 'price', eur(item.price)),
        manual(item.id, 'allergens', []),
        ...(known.has(item.id)
          ? []
          : [
              {
                op: 'setPlacement',
                item: { id: item.id },
                section: { id: SECTIONS[item.section]?.id },
                sortKey: 'end',
              },
            ]),
      ]),
    ]),
  )
  if (result.rejected.length > 0) throw new Error('the publish e2e fixtures were refused')
  await unhide()

  // The integration the pause lives in, mapped to the venue (no credentials: nothing syncs).
  const integration = await createIntegration(pool, organizationId, {
    kind: 'barsy',
    host: 'publish-e2e.barsyonline.com',
  })
  await upsertBarsyVenues(pool, organizationId, integration.id, [{ bid: 1, name: 'Main bar' }])
  await mapBarsyVenue(pool, organizationId, integration.id, 1, venueId)
  await setAutoPublishPaused(pool, organizationId, integration.id, false)

  // A clean slate: nothing published, held, run or queued. The app role cannot delete these.
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    for (const table of ['job_runs', 'item_first_published', 'publish_pointers', 'snapshots']) {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [organizationId])
    }
    await owner.query(`delete from pgboss.job where data ->> 'tenantId' = $1`, [organizationId])
  } finally {
    await owner.end()
  }
  // And no published files of an earlier run: the guest page must say "unknown" until the first
  // publish (the other venues' files are left alone).
  const store = publishStoreConfig(process.env)
  if (store.kind !== 'local') throw new Error('the e2e publish store must be local')
  await rm(path.join(store.dir, 'v', `${VENUE.slug}.json`), { force: true })
  await rm(path.join(store.dir, 'm', menu.id), { recursive: true, force: true })

  console.log(JSON.stringify({ level: 'info', event: 'seed_publish_e2e_done', organizationId }))
}

async function price(minor: number, index: number): Promise<void> {
  assertDevEnvironment(process.env)
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('price needs euro cents')
  const item = ITEMS[index]
  if (item === undefined) throw new Error('price needs the number of a drink (0 to 4)')
  const { pool, tenantId } = await target()
  const result = await apply(pool, tenantId, changeSet([manual(item.id, 'price', eur(minor))]))
  if (result.rejected.length > 0) throw new Error('the price was refused')
}

async function hold(): Promise<void> {
  assertDevEnvironment(process.env)
  const { pool, tenantId, venueId, menu } = await target()
  const result = await apply(
    pool,
    tenantId,
    changeSet(ITEMS.slice(0, 3).map((item) => manual(item.id, 'visible', false))),
  )
  if (result.rejected.length > 0) throw new Error('the hides were refused')
  const held = await publishMenu(pool, tenantId, {
    menuId: menu.id,
    venueId: venueId as never,
    reason: 'auto_sync',
    actor: 'system',
  })
  if (held.status !== 'held') throw new Error(`expected a held publish, got ${held.status}`)
}

/**
 * Queues an AUTOMATIC publish, as a sync would, but to run at once instead of after its 30 s merge
 * window (the window is the web app's and the worker's business, tested elsewhere). What matters
 * here is what the worker does with an `auto_sync` job: publish it, or skip it while paused.
 */
async function auto(): Promise<void> {
  assertDevEnvironment(process.env)
  const { tenantId, venueId, menu } = await target()
  const job = prepareJob(JOB_NAMES.publishMenu, {
    tenantId,
    menuId: menu.id,
    venueId,
    reason: 'auto_sync',
    actor: 'system',
  })
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL as string,
    schema: 'pgboss',
    createSchema: false,
    migrate: false,
    supervise: false,
    schedule: false,
    max: 1,
    application_name: 'restro-e2e-publish-seed',
  })
  boss.on('error', () => undefined)
  await boss.start()
  try {
    const id = await boss.send(JOB_NAMES.publishMenu, job.data, { singletonKey: job.singletonKey })
    if (id === null) throw new Error('an automatic publish is already waiting')
  } finally {
    await boss.stop({ graceful: false })
  }
}

async function unhide(): Promise<void> {
  const { pool, tenantId } = await target()
  const result = await apply(
    pool,
    tenantId,
    changeSet(
      ITEMS.map((item) => ({
        op: 'clearField',
        node: { id: item.id },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
      })),
    ),
  )
  if (result.rejected.length > 0) throw new Error('showing the drinks was refused')
}

const [step, argument] = process.argv.slice(2)
const steps: Record<string, () => Promise<void>> = {
  seed,
  price: () => price(Number(argument), Number(process.argv[4] ?? 0)),
  hold,
  auto,
  unhide,
}
const run = step === undefined ? undefined : steps[step]
if (!run) {
  console.error(
    `seed-publish-e2e: unknown step "${step}" (seed | price <cents> [drink] | hold | auto | unhide)`,
  )
  process.exit(1)
}
run()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-publish-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
