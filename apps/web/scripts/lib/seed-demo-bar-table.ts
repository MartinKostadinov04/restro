// What the ordering and Send fixtures share: an organisation of its own (no people: the guest page
// is public) with Demo Bar on a simulated POS (seed-demo-bar.ts), table 1 written as the worker's
// floor reading writes it (`applyFloor`; the web may not import the worker's job, which builds a
// connector), a fresh code the test knows and a fresh sitting (its order empty, nothing in flight,
// no pause), the venue in the Style the test asks for, and the menu published through the real
// publisher. The menu's items are the POS's, so they are orderable: a hand-made item never is.
// Idempotent: each run gives the table a new code, ends its sitting and opens a new one.
import { createPublishStore, publishStoreConfig, writeTableTokenFile } from '@restro/assets'
import {
  type ChangeSet,
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  menuPath,
  newId,
  newTableToken,
  posRef,
  readDesign,
  serviceDate,
  type VenueId,
} from '@restro/core'
import {
  apply,
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
import { styleCases } from '@restro/shell/testing'
import { and, eq, isNull } from 'drizzle-orm'
import pg from 'pg'

import { writeLiveOverlay, writePublishFiles } from '../../../worker/src/publish/files'
import { writeOrganizationIndex } from '../../../worker/src/publish/organization-index'
import { getPool } from '../../src/server/db'
import { DEMO_BAR_BID, DEMO_BAR_VENUE } from './demo-bar'
import { assertDevEnvironment } from './guard'
import { seedDemoBar } from './seed-demo-bar'

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

/** The Styles a fixture can draw. */
export const SEED_STYLES = ['basic', 'editorial'] as const
export type SeedStyle = (typeof SEED_STYLES)[number]
export const isSeedStyle = (value: string): value is SeedStyle =>
  (SEED_STYLES as readonly string[]).includes(value)

type Pool = ReturnType<typeof getPool>

export interface DemoBarTable {
  readonly tenantId: string
  readonly organizationName: string
  readonly organizationSlug: string
  /** The simulator the instance points at, as 127.0.0.1:<port>. */
  readonly simHost: string
  readonly style: SeedStyle
  /** The venue's ordering settings, over the defaults. */
  readonly ordering: Record<string, unknown>
  readonly features: Parameters<typeof setGuestFeatures>[2]['features']
}

/** Demo Bar in the tenant, made the first time, and its simulated instance. */
async function ensureDemoBar(
  pool: Pool,
  tenantId: string,
): Promise<{ venueId: VenueId; integrationId: IntegrationId }> {
  const [found] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, DEMO_BAR_VENUE.slug)).limit(1),
  )
  if (found === undefined) {
    const seeded = await seedDemoBar(pool, tenantId)
    return {
      venueId: seeded.venueId as VenueId,
      integrationId: seeded.integrationId as IntegrationId,
    }
  }
  const [instance] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.kind, 'sim'), isNull(integrations.removedAt)))
      .limit(1),
  )
  if (instance === undefined) throw new Error(`${tenantId} has Demo Bar but no simulated instance`)
  return { venueId: found.id as VenueId, integrationId: instance.id as IntegrationId }
}

/** The venue draws this Style from its next publish: the Style's values through `setDesign`. */
async function setStyle(pool: Pool, tenantId: string, venueId: VenueId, style: SeedStyle) {
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  const values = styleCases().find((one) => one.id === `style:${style}`)?.values
  if (venue === undefined || values === undefined) throw new Error('the Style could not be set')
  const applied = await apply(pool, tenantId, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'system',
    observedAt: new Date().toISOString(),
    ops: [
      {
        op: 'setDesign',
        venueId,
        expectedRevision: readDesign(venue.settings).revision,
        design: { style, values, logo_asset_id: null },
      },
    ],
  } as ChangeSet)
  if (applied.rejected.length > 0) {
    throw new Error(`the Style was refused: ${JSON.stringify(applied.rejected)}`)
  }
}

/** Seeds the table; its guest page's path and its code. */
export async function seedDemoBarTable(
  options: DemoBarTable,
): Promise<{ path: string; code: string }> {
  assertDevEnvironment(process.env)
  const { tenantId, organizationName, organizationSlug, simHost } = options
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('the Demo Bar table needs DATABASE_URL_OWNER (see .env.example).')
  if (!/^127\.0\.0\.1:\d+$/.test(simHost)) {
    throw new Error(`name the simulator as 127.0.0.1:<port>, not "${simHost}"`)
  }
  const pool = getPool()
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await provisionTenant(pool, { tenantId, name: organizationName })
    await owner.query(
      `insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)
         on conflict (id) do nothing`,
      [tenantId, organizationName, organizationSlug],
    )
    const demo = await ensureDemoBar(pool, tenantId)
    // The instance points at the test's simulator; any of the scenarios shares Demo Bar's switches.
    await updateIntegration(pool, tenantId, demo.integrationId, {
      host: simHost,
      config: { sim_scenario: 'demo-bar' },
      status: 'connected',
    })

    // Table 1, as the simulator's floor reading gives it, written as the worker's `floor-read` does.
    const run = await startJobRun(pool, tenantId, { kind: 'floor_read', ...demo })
    const floor = await applyFloor(pool, tenantId, {
      integrationId: demo.integrationId,
      bid: DEMO_BAR_BID,
      jobId: run.id,
      reading: { complete: true, value: FLOOR },
    })
    await finishJobRun(pool, tenantId, run.id, { status: 'completed', venueId: demo.venueId })
    if (floor.kind !== 'applied') throw new Error(`the floor was not written: ${floor.kind}`)
    const table = (await listVenueTables(pool, tenantId, demo.venueId)).find(
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
      [demo.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, ...options.ordering })],
    )
    const [venue] = await withTenant(pool, tenantId, (tx) =>
      tx.select().from(venues).where(eq(venues.id, demo.venueId)),
    )
    if (venue === undefined) throw new Error('Demo Bar went missing')
    await owner.query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
      [
        newId('st'),
        tenantId,
        demo.venueId,
        table.id,
        serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt),
        ...SEED,
      ],
    )

    // The venue's Style and guest features, then the menu published as the publish job does: the
    // snapshot, then its files.
    await setStyle(pool, tenantId, demo.venueId, options.style)
    await setGuestFeatures(pool, tenantId, { venueId: demo.venueId, features: options.features })
    const menu = await provisionMenu(pool, tenantId, demo.venueId)
    const published = await publishMenu(pool, tenantId, {
      menuId: menu.id,
      venueId: demo.venueId,
      reason: 'manual',
      actor: 'system',
    })
    if (published.status === 'held') throw new Error('the e2e menu was held, not published')
    const store = await createPublishStore(publishStoreConfig(process.env))
    const deps = { pool, store, now: () => new Date() }
    const scope = { tenantId, menuId: menu.id, venueId: demo.venueId }
    await writePublishFiles(deps, scope)
    await writeLiveOverlay(deps, scope)
    await writeOrganizationIndex(deps, tenantId)
    await writeTableTokenFile(store, await hashTableCode(code), {
      venue_public_id: venue.publicId,
      venue_slug: DEMO_BAR_VENUE.slug,
      organization_slug: organizationSlug,
      table_label: TABLE_NUMBER,
    })
    return { path: menuPath({ slug: DEMO_BAR_VENUE.slug, publicId: venue.publicId }), code }
  } finally {
    await owner.end()
  }
}
