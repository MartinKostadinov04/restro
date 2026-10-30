// Fixtures for the Send's end-to-end test (#77). Run by the test itself (`seed <sim host>`):
//
//   seed   an organisation "Send Club" of its own (no people: the guest page is public) with Demo
//          Bar on a simulated POS (scripts/lib/seed-demo-bar.ts), its instance pointed at the
//          simulator the test runs (`<sim host>`, 127.0.0.1:<port>). Its table 1 is written as the
//          worker's floor reading writes it (`applyFloor`; the web may not import the worker's job,
//          which builds a connector), the menu is published through the reference template,
//          and table 1 gets a code the test knows and a fresh sitting, its order empty, nothing in
//          flight and no pause. The location check is off: the Send is under test here, not the
//          check (#76's spec covers it). The menu's items are the POS's, so they are orderable.
//          Idempotent: each run gives the table a new code, ends its sitting and opens a new one.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on
// this machine. It prints one JSON line with the menu's path and the code (`seed_send_e2e_done`).
import {
  createPublishStore,
  publishPutOptions,
  publishStoreConfig,
  snapshotPath,
  writeTableTokenFile,
} from '@restro/assets'
import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  menuPath,
  newId,
  newTableToken,
  posRef,
  serviceDate,
  type VenueId,
} from '@restro/core'
import {
  applyFloor,
  finishJobRun,
  listVenueTables,
  provisionMenu,
  provisionTenant,
  publishMenu,
  setGuestFeatures,
  startJobRun,
  updateIntegration,
} from '@restro/core/apply'
import { integrations, venues, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'
import pg from 'pg'

import { writeLiveOverlay, writePublishFiles } from '../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../worker/src/publish/organization-index'
import { getPool } from '../src/server/db'
import { DEMO_BAR_BID, DEMO_BAR_VENUE } from './lib/demo-bar'
import { assertDevEnvironment } from './lib/guard'
import { seedDemoBar } from './lib/seed-demo-bar'

const TENANT_ID = `tn_${'E2eSendClub'.padEnd(22, '0')}`
const ORGANIZATION_SLUG = 'send-club'
/** Demo Bar's table 1, the simulator's table "30001" in its hall and bar (scenarios/demo-bar.json). */
const TABLE_NUMBER = '1'
const FLOOR = {
  tables: [
    {
      ref: posRef('30001'),
      name: TABLE_NUMBER,
      area: 'Main hall',
      bar: posRef('2001'),
      paymentTable: null,
    },
  ],
  bars: [{ ref: posRef('2001'), name: 'Main bar' }],
}
const SEED = ['restro', 'system', 'e2e-seed'] as const

/** Demo Bar in the tenant, made the first time, and its simulated instance. */
async function ensureDemoBar(
  pool: ReturnType<typeof getPool>,
): Promise<{ venueId: VenueId; integrationId: IntegrationId }> {
  const [found] = await withTenant(pool, TENANT_ID, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, DEMO_BAR_VENUE.slug)).limit(1),
  )
  if (found === undefined) {
    const seeded = await seedDemoBar(pool, TENANT_ID)
    return {
      venueId: seeded.venueId as VenueId,
      integrationId: seeded.integrationId as IntegrationId,
    }
  }
  const [instance] = await withTenant(pool, TENANT_ID, (tx) =>
    tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.kind, 'sim'), isNull(integrations.removedAt)))
      .limit(1),
  )
  if (instance === undefined) throw new Error('Send Club has Demo Bar but no simulated instance')
  return { venueId: found.id as VenueId, integrationId: instance.id as IntegrationId }
}

async function seed(simHost: string): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-send-e2e needs DATABASE_URL_OWNER (see .env.example).')
  if (!/^127\.0\.0\.1:\d+$/.test(simHost)) {
    throw new Error(`name the simulator as 127.0.0.1:<port>, not "${simHost}"`)
  }
  const pool = getPool()
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await provisionTenant(pool, { tenantId: TENANT_ID, name: 'Send Club' })
    await owner.query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Send Club', $2)
         on conflict (id) do nothing`,
      [TENANT_ID, ORGANIZATION_SLUG],
    )
    const demo = await ensureDemoBar(pool)
    // The instance points at the test's simulator; any of the scenarios shares Demo Bar's switches.
    await updateIntegration(pool, TENANT_ID, demo.integrationId, {
      host: simHost,
      config: { sim_scenario: 'demo-bar' },
      status: 'connected',
    })

    // Table 1, as the simulator's floor reading gives it, written as the worker's `floor-read` does.
    const run = await startJobRun(pool, TENANT_ID, { kind: 'floor_read', ...demo })
    const floor = await applyFloor(pool, TENANT_ID, {
      integrationId: demo.integrationId,
      bid: DEMO_BAR_BID,
      jobId: run.id,
      reading: { complete: true, value: FLOOR },
    })
    await finishJobRun(pool, TENANT_ID, run.id, { status: 'completed', venueId: demo.venueId })
    if (floor.kind !== 'applied') throw new Error(`the floor was not written: ${floor.kind}`)
    const table = (await listVenueTables(pool, TENANT_ID, demo.venueId)).find(
      (one) => one.number === TABLE_NUMBER,
    )
    if (table === undefined) throw new Error(`Demo Bar has no table ${TABLE_NUMBER}`)

    // A fresh code the test knows, a fresh sitting with an empty order, nothing in flight and no
    // pause (an Unconfirmed Send of an earlier run pauses the table). As the database owner: these
    // stand in for the staff's "Open table", "Resume ordering" and the code's reissue.
    const code = newTableToken()
    await owner.query(
      'update restro.tables set qr_token = $1, qr_code_hash = $2, qr_code_sealed = null where id = $3',
      [code, await hashTableCode(code), table.id],
    )
    await owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where table_id = $1 and state in ('waiting', 'sending', 'checking')`,
      [table.id],
    )
    await owner.query(
      `update restro.locks set holder = null, deadline = null, released_at = now()
        where scope = 'order_slot' and key = $1`,
      [table.id],
    )
    await owner.query(
      'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
      [table.id],
    )
    await owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where table_id = $1 and ended_at is null`,
      [table.id],
    )
    await owner.query('delete from restro.table_orders where table_id = $1', [table.id])
    await owner.query(
      `update restro.venues
          set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ordering}', $2::jsonb)
        where id = $1`,
      [demo.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    const [venue] = await withTenant(pool, TENANT_ID, (tx) =>
      tx.select().from(venues).where(eq(venues.id, demo.venueId)),
    )
    if (venue === undefined) throw new Error('Demo Bar went missing')
    await owner.query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
      [
        newId('st'),
        TENANT_ID,
        demo.venueId,
        table.id,
        serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt),
        ...SEED,
      ],
    )

    // The menu with the venue's ordering on, published as the publish job does: the snapshot, then
    // its files. It is drawn by the reference template (the one with the Send): new snapshots name
    // no template (D129), so its file says so before the files are written, as the other seeds'
    // files do; the file writer leaves a snapshot file that exists alone.
    await setGuestFeatures(pool, TENANT_ID, {
      venueId: demo.venueId,
      features: {
        filters: true,
        call_waiter: { enabled: false, kinds: [] },
        bill: false,
        ordering: true,
        pay: false,
      },
    })
    const menu = await provisionMenu(pool, TENANT_ID, demo.venueId)
    const published = await publishMenu(pool, TENANT_ID, {
      menuId: menu.id,
      venueId: demo.venueId,
      reason: 'manual',
      actor: 'system',
    })
    if (published.status === 'held') throw new Error('the Send e2e menu was held, not published')
    const store = await createPublishStore(publishStoreConfig(process.env))
    const snapshotFile = snapshotPath(published.snapshot.id)
    await store.put(
      snapshotFile,
      new TextEncoder().encode(
        JSON.stringify({
          ...published.snapshot.body,
          presentation: { face: 'qr-phone', options: {} },
        }),
      ),
      publishPutOptions(snapshotFile),
    )
    const deps = { pool, store, now: () => new Date() }
    const scope = { tenantId: TENANT_ID, menuId: menu.id, venueId: demo.venueId }
    await writePublishFiles(deps, scope)
    await writeLiveOverlay(deps, scope)
    await writeOrganizationIndex(deps, TENANT_ID)
    await writeTableTokenFile(store, await hashTableCode(code), {
      venue_public_id: venue.publicId,
      venue_slug: DEMO_BAR_VENUE.slug,
      organization_slug: ORGANIZATION_SLUG,
      table_label: TABLE_NUMBER,
    })

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'seed_send_e2e_done',
        path: menuPath({ slug: DEMO_BAR_VENUE.slug, publicId: venue.publicId }),
        code,
      }),
    )
  } finally {
    await owner.end()
  }
}

const [step, simHost] = process.argv.slice(2)
if (step !== 'seed' || simHost === undefined) {
  console.error(`seed-send-e2e: unknown step "${step}" (seed <sim host>)`)
  process.exit(1)
}
seed(simHost)
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-send-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
