// Fixtures for the sold-out end-to-end test (brief S3-08). Run by the test itself (`seed`):
//
//   seed        an organisation "Sold Out Club" with its venue (slug `sold-out-club`), an owner and a
//               plain member, and a small menu: four hand-made drinks and one barsy-linked drink
//               that barsy has OFF SALE (`for_sale = false` in the barsy layer, so rule 5 has
//               something to protect). The menu is PUBLISHED into the e2e publish folder the
//               real way (`publishMenu`, then the worker's `writePublishFiles` / `writeLiveOverlay`),
//               so `/m/sold-out-club` shows it at once. Every earlier sold-out mark and the
//               venue's service-day setting are put back to a clean slate. Idempotent.
//   day-ends <HH:MM>   moves the end of the venue's service day (the rollover test uses it to make
//               "now" belong to the previous service day without waiting for 07:00).
//
// What the test does after that goes through the web app and the REAL worker started by
// playwright.config.ts. Like `db:seed:dev` this refuses to run unless NODE_ENV is development and
// the database is on this machine.
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { createPublishStore, publishStoreConfig } from '@restro/assets'
import { type ChangeSet, type ChangeSetOp, type NodeId, newId } from '@restro/core'
import { apply, provisionMenu, provisionVenue, publishMenu } from '@restro/core/apply'
import { authMember, authOrganization, nodes, venues, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import pg from 'pg'

import { writeLiveOverlay, writePublishFiles } from '../../worker/src/publish/files'
import { createAuth } from '../src/server/auth'
import { getAuthDb, getPool } from '../src/server/db'
import { authModelId } from '../src/server/ids'
import { assertDevEnvironment, readAdminCredentials } from './lib/guard'

const ORGANIZATION = { name: 'Sold Out Club', slug: 'sold-out-club' }
const VENUE = { name: 'Sold Out Club Sofia', slug: 'sold-out-club' }
const OWNER_EMAIL = 'sold-out-owner@demo-club.test'
const MEMBER_EMAIL = 'sold-out-member@demo-club.test'
const HOST = 'e2e.sold-out.test'
const ARTICLE = 'e2e-sold-out-campari'

/** Fixed node ids, so running the seed again finds the same document. */
const nodeId = (name: string) => `nd_${name.padEnd(22, '0')}` as NodeId
const COCKTAILS = nodeId('E2eSoCocktails')
const BEER = nodeId('E2eSoBeer')
const HAND_MADE = [
  { id: nodeId('E2eSoNegroni'), bg: 'Негрони', en: 'Negroni', price: 1250, section: COCKTAILS },
  { id: nodeId('E2eSoMojito'), bg: 'Мохито', en: 'Mojito', price: 900, section: COCKTAILS },
  { id: nodeId('E2eSoSpritz'), bg: 'Шприц', en: 'Spritz', price: 1000, section: COCKTAILS },
  { id: nodeId('E2eSoLager'), bg: 'Светла бира', en: 'Lager', price: 450, section: BEER },
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
const changeSet = (source: string, actor: string, ops: unknown[]): ChangeSet =>
  ({
    id: newId('cs'),
    source,
    jobId: newId('jb'),
    actor,
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
  if (!ownerUrl) throw new Error('seed-sold-out-e2e needs DATABASE_URL_OWNER (see .env.example).')
  assertDevEnvironment({ ...process.env, DATABASE_URL: ownerUrl })
  const { password } = readAdminCredentials(process.env)

  const auth = createAuth({ scripts: true })
  const db = getAuthDb()
  const ownerId = await ensureUser(auth, OWNER_EMAIL, 'Sold Out Owner', password)
  const memberId = await ensureUser(auth, MEMBER_EMAIL, 'Sold Out Member', password)

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

  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    // --- the barsy side: an integration and the source record of one article -----------------
    const integrationRows = await owner.query<{ id: string }>(
      `select id from restro.integrations where tenant_id = $1 and host = $2`,
      [organizationId, HOST],
    )
    const integration = integrationRows.rows[0]?.id ?? newId('in')
    if (!integrationRows.rows[0]) {
      await owner.query(
        `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'barsy', $3)`,
        [integration, organizationId, HOST],
      )
    }
    const recordRows = await owner.query<{ id: string }>(
      `select id from restro.source_records where integration_id = $1 and external_id = $2`,
      [integration, ARTICLE],
    )
    const record = recordRows.rows[0]?.id ?? newId('sr')
    if (!recordRows.rows[0]) {
      await owner.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
         values ($1, $2, $3, 'article', $4, 'master', $5, '{}', '{}'::jsonb)`,
        [
          record,
          organizationId,
          integration,
          ARTICLE,
          createHash('sha256').update(ARTICLE).digest('hex'),
        ],
      )
    }

    // --- the hand-made document -----------------------------------------------------------------
    const known = new Set(
      (
        await withTenant(pool, organizationId, (tx) =>
          tx
            .select({ id: nodes.id })
            .from(nodes)
            .where(inArray(nodes.id, [COCKTAILS, BEER, ...HAND_MADE.map((item) => item.id)])),
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
    const made = await apply(
      pool,
      organizationId,
      changeSet('manual', 'system', [
        manual(menu.id, 'title', { bg_BG: 'Клуб Изчерпано', en_US: 'Sold Out Club' }),
        ...create(COCKTAILS, 'section', menu.id),
        manual(COCKTAILS, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
        ...create(BEER, 'section', menu.id),
        manual(BEER, 'title', { bg_BG: 'Бира', en_US: 'Beer' }),
        ...HAND_MADE.flatMap((item) => [
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
                  section: { id: item.section },
                  sortKey: 'end',
                },
              ]),
        ]),
      ]),
    )
    if (made.rejected.length > 0) throw new Error('the sold-out e2e fixtures were refused')

    // --- the barsy-linked drink that barsy has OFF SALE ---------------------------------------
    const article = { integration, externalType: 'article', externalId: ARTICLE }
    const barsyItem = nodeId('E2eSoCampari')
    const field = (fieldKey: string, value: unknown, scope = 'master'): ChangeSetOp =>
      ({
        op: 'setField',
        node: { link: article },
        fieldKey,
        layer: 'barsy',
        scope,
        value,
        sourceRecordId: record,
        mappingVersion: 1,
      }) as ChangeSetOp
    const linked = await apply(
      pool,
      organizationId,
      changeSet(`barsy:${integration}`, `integration:${integration}`, [
        { op: 'createNode', id: barsyItem, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: barsyItem }, link: article },
        field('name', { bg_BG: 'Кампари', en_US: 'Campari' }),
        field('price', eur(800), `venue:${venueId}`),
        field('for_sale', false, `venue:${venueId}`),
        field('visible', true),
        field('allergens', []),
        {
          op: 'setPlacement',
          item: { link: article },
          section: { id: COCKTAILS },
          sortKey: 'end',
        },
      ] as ChangeSetOp[]),
    )
    if (linked.rejected.length > 0) throw new Error('the barsy-linked fixture was refused')

    // --- a clean slate: no marks of an earlier run, a normal service day, nothing published -----
    await owner.query(
      `delete from restro.field_values where tenant_id = $1 and layer like 'edition:%'`,
      [organizationId],
    )
    await owner.query(`update restro.venues set service_day_ends_at = '07:00' where id = $1`, [
      venueId,
    ])
    for (const table of ['job_runs', 'item_first_published', 'publish_pointers', 'snapshots']) {
      await owner.query(`delete from restro.${table} where tenant_id = $1`, [organizationId])
    }
    await owner.query(`delete from pgboss.job where data ->> 'tenantId' = $1`, [organizationId])
  } finally {
    await owner.end()
  }

  // --- publish it the real way, into the e2e publish folder -------------------------------------
  const config = publishStoreConfig(process.env)
  if (config.kind !== 'local') throw new Error('the e2e publish store must be local')
  await rm(path.join(config.dir, 'v', `${VENUE.slug}.json`), { force: true })
  await rm(path.join(config.dir, 'm', menu.id), { recursive: true, force: true })
  const store = await createPublishStore(config)
  const published = await publishMenu(pool, organizationId, {
    menuId: menu.id,
    venueId: venueId as never,
    reason: 'manual',
    actor: 'system',
  })
  const deps = { pool, store, now: () => new Date() }
  const scope = { tenantId: organizationId, menuId: menu.id, venueId: venueId as never }
  await writePublishFiles(deps, scope)
  await writeLiveOverlay(deps, scope)
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_sold_out_e2e_done',
      organizationId,
      venueId,
      menuId: menu.id,
      snapshotId: published.snapshot.id,
    }),
  )
}

async function dayEnds(time: string | undefined): Promise<void> {
  assertDevEnvironment(process.env)
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('day-ends needs HH:MM')
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-sold-out-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const [organization] = await getAuthDb()
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, ORGANIZATION.slug))
    .limit(1)
  if (!organization) throw new Error('Run the `seed` step first: there is no Sold Out Club.')
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await owner.query(`update restro.venues set service_day_ends_at = $2 where tenant_id = $1`, [
      organization.id,
      time,
    ])
  } finally {
    await owner.end()
  }
}

const [step, argument] = process.argv.slice(2)
const steps: Record<string, () => Promise<void>> = {
  seed,
  'day-ends': () => dayEnds(argument),
}
const run = step === undefined ? undefined : steps[step]
if (!run) {
  console.error(`seed-sold-out-e2e: unknown step "${step}" (seed | day-ends <HH:MM>)`)
  process.exit(1)
}
run()
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-sold-out-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
