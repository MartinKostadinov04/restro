// Fixtures for the Design tab's end-to-end test (brief SH-05a). Run by the test itself:
//
//   seed   an organisation "Design Club" with its venue (slug `design-club`), an owner, and a small
//          hand-made menu (three drinks in one section, Bulgarian and English names), and a clean
//          slate: no look, no template, nothing published, no held publish, no runs, no waiting
//          jobs, no published files. Idempotent.
//
// The venue is the test's own: choosing Midnight there and publishing it must not change the demo
// venue the guest page's test reads, or the Publish tab's fixture, which expects nothing published.
// The publish itself is the real worker's, started by playwright.config.ts. Like `db:seed:dev` this
// refuses to run unless NODE_ENV is development and the database is on this machine.
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { publishStoreConfig } from '@restro/assets'
import { type ChangeSet, type NodeId, newId } from '@restro/core'
import { apply, provisionMenu, provisionVenue } from '@restro/core/apply'
import { authMember, authOrganization, nodes, venues, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import pg from 'pg'

import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Design Club', slug: 'design-club' }
const VENUE = { name: 'Design Club Sofia', slug: 'design-club' }
const OWNER_EMAIL = 'design-owner@demo-club.test'

/** Fixed node ids, so running the seed again finds the same document. */
const nodeId = (name: string) => `nd_${name.padEnd(22, '0')}` as NodeId
const SECTION = { id: nodeId('E2eDesCocktails'), bg: 'Коктейли', en: 'Cocktails' } as const
const ITEMS = [
  { id: nodeId('E2eDesNegroni'), bg: 'Негрони', en: 'Negroni', price: 1250 },
  { id: nodeId('E2eDesMojito'), bg: 'Мохито', en: 'Mojito', price: 900 },
  { id: nodeId('E2eDesSpritz'), bg: 'Шприц', en: 'Spritz', price: 1000 },
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

async function seed(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-design-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const ownerId = await ensureUser(auth, OWNER_EMAIL, 'Design Owner', password)

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
  const [membership] = await db
    .select({ id: authMember.id, role: authMember.role })
    .from(authMember)
    .where(and(eq(authMember.organizationId, organizationId), eq(authMember.userId, ownerId)))
    .limit(1)
  if (!membership) {
    await db
      .insert(authMember)
      .values({ id: authModelId('member'), organizationId, userId: ownerId, role: 'owner' })
  } else if (membership.role !== 'owner') {
    await db.update(authMember).set({ role: 'owner' }).where(eq(authMember.id, membership.id))
  }

  const pool = getPool()
  const [existing] = await withTenant(pool, organizationId, (tx) =>
    tx
      .select({ id: venues.id, publicId: venues.publicId })
      .from(venues)
      .where(eq(venues.slug, VENUE.slug))
      .limit(1),
  )
  const venue =
    existing ?? (await provisionVenue(pool, organizationId, { name: VENUE.name, slug: VENUE.slug }))
  const menu = await provisionMenu(pool, organizationId, venue.id)

  // The document: created once, its values put back to the baseline every time.
  const known = new Set(
    (
      await withTenant(pool, organizationId, (tx) =>
        tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(inArray(nodes.id, [SECTION.id, ...ITEMS.map((item) => item.id)])),
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
      manual(menu.id, 'title', { bg_BG: 'Дизайн клуб', en_US: 'Design Club' }),
      ...create(SECTION.id, 'section', menu.id),
      manual(SECTION.id, 'title', { bg_BG: SECTION.bg, en_US: SECTION.en }),
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
                section: { id: SECTION.id },
                sortKey: 'end',
              },
            ]),
      ]),
    ]),
  )
  if (result.rejected.length > 0) throw new Error('the design e2e fixtures were refused')

  // A clean slate: no look, no template, nothing published, held, run or queued. The app role
  // cannot delete the publish tables.
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await owner.query(
      `update restro.venues set settings = settings - 'theme' - 'presentation' where id = $1`,
      [venue.id],
    )
    // The menu's layout is the composer's (D92, brief S6): none set (two columns, with the switch).
    await owner.query(`update restro.menus set settings = '{}'::jsonb where venue_id = $1`, [
      venue.id,
    ])
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
  await rm(path.join(store.dir, 'v', `${venue.publicId}.json`), { force: true })
  await rm(path.join(store.dir, 'm', menu.id), { recursive: true, force: true })

  console.log(JSON.stringify({ level: 'info', event: 'seed_design_e2e_done', organizationId }))
}

const [step] = process.argv.slice(2)
if (step !== 'seed') {
  console.error(`seed-design-e2e: unknown step "${step}" (seed)`)
  process.exit(1)
}
seed()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-design-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
