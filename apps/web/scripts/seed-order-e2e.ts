// Fixtures for the shared order's end-to-end test (#75). Run by the test itself (`seed`):
//
//   seed   an organisation "Order Club" of its own (no people: the guest page is public) with one
//          hand-made venue, published, and one table with a code the test knows and an open
//          sitting, its order empty. The phones' menu is the shell's `features-on` fixture (every
//          guest feature on, orderable items) drawn by the reference template, written under the
//          fixed code `ORDER_PUBLIC_ID` like the look fixture: a hand-made item is never orderable
//          (only an item the till prices and sells is), so the database venue can't publish one.
//          The table's file points at that menu; the guest API finds the table by its code.
//          The venue checks location (#76) with its spot at `ORDER_SPOT`.
//          Idempotent: each run gives the table a new code, ends its sitting and opens a new one.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on
// this machine. It prints one JSON line with the code (`seed_order_e2e_done`).
import {
  createPublishStore,
  currentPath,
  livePath,
  publishPutOptions,
  publishStoreConfig,
  snapshotPath,
  venueIndexBytes,
  venueIndexPath,
  writeTableTokenFile,
} from '@restro/assets'
import {
  type ChangeSet,
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  menuPath,
  type NodeId,
  newId,
  newTableToken,
  type SnapshotId,
  serviceDate,
  type VenueId,
} from '@restro/core'
import {
  apply,
  createArea,
  createTable,
  listVenueTables,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
} from '@restro/core/apply'
import { venues, withTenant } from '@restro/db'
import { fixture } from '@restro/shell/testing'
import { eq } from 'drizzle-orm'
import pg from 'pg'

import { ORDER_PUBLIC_ID, ORDER_SLUG, ORDER_SPOT } from '../e2e/support'
import { getPool } from '../src/server/db'
import { assertDevEnvironment } from './lib/guard'

const TENANT_ID = `tn_${'E2eOrderClub'.padEnd(22, '0')}`
const VENUE_SLUG = 'order-bar'
const TABLE_LABEL = '5'
const SEED = ['restro', 'system', 'e2e-seed'] as const

/** The venue, made and published the first time. */
async function ensureVenue(pool: ReturnType<typeof getPool>) {
  await provisionTenant(pool, { tenantId: TENANT_ID, name: 'Order Club' })
  const [found] = await withTenant(pool, TENANT_ID, (tx) =>
    tx.select().from(venues).where(eq(venues.slug, VENUE_SLUG)).limit(1),
  )
  if (found) return found
  const venue = await provisionVenue(pool, TENANT_ID, { name: 'Order Bar', slug: VENUE_SLUG })
  const menu = await provisionMenu(pool, TENANT_ID, venue.id)
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
  const applied = await apply(pool, TENANT_ID, {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:us_e2e',
    observedAt: new Date().toISOString(),
    ops: [
      manual(menu.id, 'title', text('Order Bar')),
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', text('Drinks')),
      { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
      manual(item, 'name', text('House lemonade')),
      manual(item, 'price', { amount_minor: 450, currency: 'EUR' }),
      manual(item, 'allergens', []),
      { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
    ],
  } as ChangeSet)
  if (applied.rejected.length > 0) throw new Error('the order e2e menu was refused')
  // A venue with nothing published is not live: its codes find nothing.
  const published = await publishMenu(pool, TENANT_ID, {
    menuId: menu.id,
    venueId: venue.id as never,
    reason: 'manual',
    actor: 'system',
  })
  if (published.status !== 'published') throw new Error('the order e2e menu was not published')
  return venue
}

/** The venue's one table, made the first time. */
async function ensureTable(pool: ReturnType<typeof getPool>, venueId: string): Promise<string> {
  const [table] = await listVenueTables(pool, TENANT_ID, venueId)
  if (table) return table.id
  const area = await createArea(pool, TENANT_ID, venueId, 'Hall')
  if (!area.ok) throw new Error(`the area was refused: ${area.error}`)
  const made = await createTable(pool, TENANT_ID, {
    areaId: area.area.id,
    name: null,
    number: TABLE_LABEL,
  })
  if (!made.ok) throw new Error(`the table was refused: ${made.error}`)
  return made.table.id
}

async function seed(face: string): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('seed-order-e2e needs DATABASE_URL_OWNER (see .env.example).')
  const pool = getPool()
  const venue = await ensureVenue(pool)
  const tableId = await ensureTable(pool, venue.id)

  // A fresh code the test knows (kept in plain beside its hash, as one from before #70), and a
  // fresh sitting with an empty order. As the database owner: these stand in for the staff's
  // "Open table" and the code's reissue, which need a signed-in person.
  const code = newTableToken()
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await owner.query(
      'update restro.tables set qr_token = $1, qr_code_hash = $2, qr_code_sealed = null where id = $3',
      [code, await hashTableCode(code), tableId],
    )
    await owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where table_id = $1 and ended_at is null`,
      [tableId],
    )
    await owner.query('delete from restro.table_orders where table_id = $1', [tableId])
    // The location check on, with the venue's spot set (with none it fails closed).
    await owner.query(
      `update restro.venues
          set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ordering}', $2::jsonb)
        where id = $1`,
      [
        venue.id,
        JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: true, spot: ORDER_SPOT }),
      ],
    )
    await owner.query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
      [
        newId('st'),
        TENANT_ID,
        venue.id,
        tableId,
        serviceDate(new Date(), venue.timezone, venue.serviceDayEndsAt),
        ...SEED,
      ],
    )
  } finally {
    await owner.end()
  }

  // The phones' menu: the fixture under ids of its own, drawn by the template the test asks for
  // (the reference template unless the test names another, #239).
  const store = await createPublishStore(publishStoreConfig(process.env))
  const base = fixture('features-on').snapshot
  const ids = {
    snapshot: `sn_${'E2eOrderSnapshot'.padEnd(22, '0')}`,
    menu: `nd_${'E2eOrderMenu'.padEnd(22, '0')}`,
    venue: `vn_${'E2eOrderVenue'.padEnd(22, '0')}`,
  }
  const snapshot = {
    ...base,
    snapshot: { ...base.snapshot, id: ids.snapshot, menu_id: ids.menu, venue_id: ids.venue },
    menu: { ...base.menu, id: ids.menu },
    presentation: { face, options: {} },
  }
  const put = (file: string, value: unknown) =>
    store.put(file, new TextEncoder().encode(JSON.stringify(value)), publishPutOptions(file))
  const menuId = ids.menu as NodeId
  const venueId = ids.venue as VenueId
  await put(snapshotPath(ids.snapshot as SnapshotId), snapshot)
  await put(currentPath(menuId, venueId), {
    snapshot_id: ids.snapshot,
    version: snapshot.snapshot.version,
    hash: snapshot.snapshot.hash,
  })
  await put(livePath(menuId, venueId), { version: snapshot.snapshot.version, items: {} })
  await store.put(
    venueIndexPath(ORDER_PUBLIC_ID),
    venueIndexBytes({ venue_id: venueId, menu_id: menuId, slug: ORDER_SLUG }),
    publishPutOptions(venueIndexPath(ORDER_PUBLIC_ID)),
  )
  await writeTableTokenFile(store, await hashTableCode(code), {
    venue_public_id: ORDER_PUBLIC_ID,
    venue_slug: ORDER_SLUG,
    table_label: TABLE_LABEL,
  })

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_order_e2e_done',
      path: menuPath({ slug: ORDER_SLUG, publicId: ORDER_PUBLIC_ID }),
      code,
    }),
  )
}

const [step, face = 'qr-phone'] = process.argv.slice(2)
if (step !== 'seed' || !/^[a-z][a-z0-9-]{0,31}$/.test(face)) {
  console.error(`seed-order-e2e: unknown step "${step}" (seed [template id])`)
  process.exit(1)
}
seed(face)
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-order-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
