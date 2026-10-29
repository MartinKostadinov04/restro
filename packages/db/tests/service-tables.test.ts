// Integration tests on a real Postgres for the ordering tables (migration 0028; ticket #66; D122
// §9): every new tenant table keeps tenants apart under row-level security, the app role writes
// them only as table-access.ts says (no deletes; the Log and the notes append-only), and the
// constraints the service path leans on hold in the database itself.
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  alerts,
  areas,
  bars,
  billReadings,
  createPool,
  type DbPool,
  locks,
  logEntries,
  operators,
  pauses,
  pushSubscriptions,
  sentOrderNotes,
  sentOrders,
  serviceDays,
  sharedDevices,
  sittings,
  staffAssignments,
  staffMembers,
  tableOrders,
  tenants,
  venueRoles,
  venues,
  venueTables,
  waiterCalls,
  withTenant,
} from '../src/index'
import { TABLE_ACCESS } from '../src/table-access'
import { withTenantWrite } from '../src/write/index'
import {
  appDatabaseUrl,
  cleanUp,
  databaseError,
  hasDatabase,
  openOwnerPool,
  testId,
  testPublicId,
} from './database'

const RLS_VIOLATION = /violates row-level security policy/
const NO_PRIVILEGE = /permission denied/

/** The provenance every service row carries (rule 2). */
const PROVENANCE = { source: 'worker', actor: 'system', jobId: 'jb_test' } as const
const DAY = '2026-10-22'
const HEX64 = 'a'.repeat(64)

/** The ordering tables this test covers: every tenant table migration 0028 adds. */
const SERVICE_TABLES = [
  'bars',
  'sittings',
  'table_orders',
  'sent_orders',
  'sent_order_notes',
  'locks',
  'bill_readings',
  'log_entries',
  'waiter_calls',
  'alerts',
  'pauses',
  'service_days',
  'staff_members',
  'venue_roles',
  'staff_assignments',
  'shared_devices',
  'push_subscriptions',
] as const

interface Fixture {
  readonly tenantId: string
  readonly venueId: string
  readonly areaId: string
  readonly tableId: string
  readonly barId: string
  readonly sittingId: string
  readonly sentOrderId: string
  readonly staffMemberId: string
  readonly roleId: string
}

function fixture(): Fixture {
  return {
    tenantId: testId('tn'),
    venueId: testId('vn'),
    areaId: testId('ar'),
    tableId: testId('tb'),
    barId: testId('br'),
    sittingId: testId('st'),
    sentOrderId: testId('so'),
    staffMemberId: testId('sm'),
    roleId: testId('rl'),
  }
}

describe.skipIf(!hasDatabase)('ordering tables (migration 0028)', () => {
  const a = fixture()
  const b = fixture()
  const userId = `test-user-${testId('us')}`

  let app: DbPool
  /** restro_app over plain pg, for the tables that are not tenant-scoped. */
  let appRaw: pg.Pool
  let owner: pg.Pool

  /** One row in every service table for the fixture's tenant, written as restro_app. */
  async function seed(f: Fixture): Promise<void> {
    const base = { tenantId: f.tenantId, venueId: f.venueId }
    await withTenantWrite(app, f.tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: f.tenantId, name: 'Club' })
      await tx.insert(venues).values({
        id: f.venueId,
        tenantId: f.tenantId,
        name: 'Club',
        slug: 'main',
        publicId: testPublicId(),
      })
      await tx.insert(areas).values({ id: f.areaId, ...base, name: 'Hall', sortKey: 'a' })
      await tx.insert(bars).values({ id: f.barId, ...base, name: 'Main bar', sourceKey: 'bar-1' })
      await tx.insert(venueTables).values({
        id: f.tableId,
        ...base,
        areaId: f.areaId,
        number: '1',
        sortKey: 'a',
        barId: f.barId,
      })
      await tx.insert(sittings).values({
        id: f.sittingId,
        ...base,
        tableId: f.tableId,
        serviceDate: DAY,
        openedHow: 'one',
        ...PROVENANCE,
      })
      await tx.insert(tableOrders).values({
        id: testId('to'),
        ...base,
        tableId: f.tableId,
        sittingId: f.sittingId,
        ...PROVENANCE,
      })
      await tx.insert(sentOrders).values({
        id: f.sentOrderId,
        ...base,
        tableId: f.tableId,
        sittingId: f.sittingId,
        barId: f.barId,
        serviceDate: DAY,
        kind: 'on_bill',
        reference: 'K7Q',
        state: 'waiting',
        lines: [{ line: 1 }],
        totalMinor: 1250,
        ...PROVENANCE,
      })
      await tx.insert(sentOrderNotes).values({
        ...base,
        sentOrderId: f.sentOrderId,
        lineId: 'ol_1',
        note: 'no ice',
        serviceDate: DAY,
        ...PROVENANCE,
      })
      await tx.insert(locks).values({ ...base, scope: 'order_slot', key: f.tableId, ...PROVENANCE })
      await tx.insert(billReadings).values({
        ...base,
        tableId: f.tableId,
        readAt: new Date(),
        complete: true,
        ...PROVENANCE,
      })
      await tx.insert(logEntries).values({
        ...base,
        serviceDate: DAY,
        kind: 'sent_order.state',
        sentOrderId: f.sentOrderId,
        retention: 'night',
        ...PROVENANCE,
      })
      await tx.insert(waiterCalls).values({
        id: testId('wc'),
        ...base,
        tableId: f.tableId,
        sittingId: f.sittingId,
        serviceDate: DAY,
        ...PROVENANCE,
      })
      await tx.insert(alerts).values({
        id: testId('al'),
        ...base,
        serviceDate: DAY,
        kind: 'sent_order.unconfirmed',
        subjectId: f.sentOrderId,
        ...PROVENANCE,
      })
      await tx.insert(pauses).values({
        id: testId('pa'),
        ...base,
        serviceDate: DAY,
        scope: 'table',
        targetId: f.tableId,
        cause: 'unconfirmed',
        restroStarted: true,
        ...PROVENANCE,
      })
      await tx.insert(serviceDays).values({ ...base, serviceDate: DAY, ...PROVENANCE })
      await tx.insert(staffMembers).values({
        id: f.staffMemberId,
        tenantId: f.tenantId,
        displayName: 'Maria',
        ...PROVENANCE,
      })
      await tx
        .insert(venueRoles)
        .values({ id: f.roleId, ...base, name: 'Staff', defaultKind: 'staff', ...PROVENANCE })
      await tx.insert(staffAssignments).values({
        ...base,
        staffMemberId: f.staffMemberId,
        roleId: f.roleId,
        ...PROVENANCE,
      })
      await tx.insert(sharedDevices).values({
        id: testId('dv'),
        ...base,
        name: 'Bar tablet',
        sessionId: `session-${f.tenantId}`,
        ...PROVENANCE,
      })
      await tx.insert(pushSubscriptions).values({
        tenantId: f.tenantId,
        userId,
        endpointHash: HEX64,
        endpoint: 'https://push.example.test/endpoint',
        p256dh: 'B'.repeat(87),
        auth: 'c'.repeat(22),
        ...PROVENANCE,
      })
    })
  }

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-db-tests' })
    appRaw = new pg.Pool({ connectionString: appDatabaseUrl(), max: 1 })
    await appRaw.query("insert into restro.auth_user (id, name, email) values ($1, 'Test', $2)", [
      userId,
      `${userId}@example.test`,
    ])
    await seed(a)
    await seed(b)
  })

  afterAll(async () => {
    await app?.end()
    await appRaw?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [a.tenantId, b.tenantId] })
      await owner.query('delete from restro.auth_user where id = $1', [userId])
      await owner.end()
    }
  })

  it('covers every tenant table of migration 0028, each declared in table-access.ts', () => {
    for (const table of SERVICE_TABLES) expect(TABLE_ACCESS).toHaveProperty(table)
  })

  it('each tenant sees exactly its own row in every ordering table, with no where clause', async () => {
    for (const f of [a, b]) {
      const counts = await withTenant(app, f.tenantId, async (tx) => {
        const out: Record<string, number> = {}
        for (const table of SERVICE_TABLES) {
          const result = await tx.execute<{ n: number; own: number }>(
            sql.raw(
              `select count(*)::int as n, count(*) filter (where tenant_id = '${f.tenantId}')::int as own from restro.${table}`,
            ),
          )
          const [row] = result.rows
          out[table] = row !== undefined && row.n === row.own ? row.n : -1
        }
        return out
      })
      expect(counts).toEqual(Object.fromEntries(SERVICE_TABLES.map((t) => [t, 1])))
    }
  })

  it('refuses a row for another tenant (WITH CHECK)', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(logEntries).values({
          tenantId: b.tenantId,
          venueId: b.venueId,
          serviceDate: DAY,
          kind: 'sent_order.state',
          retention: 'night',
          ...PROVENANCE,
        }),
      ),
    )
    expect(message).toMatch(RLS_VIOLATION)
  })

  it('updates nothing of another tenant', async () => {
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.update(sentOrders).set({ state: 'added' }).where(eq(sentOrders.id, b.sentOrderId)),
    )
    const { rows } = await owner.query('select state from restro.sent_orders where id = $1', [
      b.sentOrderId,
    ])
    expect(rows[0]?.state).toBe('waiting')
  })

  it('never lets the app role delete an ordering row', async () => {
    for (const table of SERVICE_TABLES) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.execute(sql.raw(`delete from restro.${table} where tenant_id = '${a.tenantId}'`)),
        ),
      )
      expect(message, table).toMatch(NO_PRIVILEGE)
    }
  })

  it('keeps the Log and the notes append-only', async () => {
    for (const table of ['log_entries', 'sent_order_notes']) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.execute(sql.raw(`update restro.${table} set job_id = 'jb_other'`)),
        ),
      )
      expect(message, table).toMatch(NO_PRIVILEGE)
    }
  })

  it('lets the app role only read the operators list', async () => {
    const message = await databaseError(
      appRaw.query("insert into restro.operators (user_id, granted_by) values ($1, 'test')", [
        userId,
      ]),
    )
    expect(message).toMatch(NO_PRIVILEGE)
    await expect(
      withTenant(app, a.tenantId, (tx) => tx.select().from(operators)),
    ).resolves.toBeDefined()
  })

  it('holds one open sitting per table', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(sittings).values({
          id: testId('st'),
          tenantId: a.tenantId,
          venueId: a.venueId,
          tableId: a.tableId,
          serviceDate: DAY,
          openedHow: 'one',
          ...PROVENANCE,
        }),
      ),
    )
    expect(message).toMatch(/sittings_open_table_unique/)
  })

  it('refuses a service row without valid provenance (rule 2)', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(logEntries).values({
          tenantId: a.tenantId,
          venueId: a.venueId,
          serviceDate: DAY,
          kind: 'sent_order.state',
          retention: 'night',
          source: 'worker',
          actor: 'someone@example.com',
          jobId: 'jb_test',
        }),
      ),
    )
    expect(message).toMatch(/log_entries_actor/)
  })

  it('refuses a payment table that has a table code', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx
          .update(venueTables)
          .set({ isPaymentTable: true, qrToken: 'qr-test-token', qrCodeHash: HEX64 })
          .where(eq(venueTables.id, a.tableId)),
      ),
    )
    expect(message).toMatch(/tables_payment_table_no_code/)
  })

  it('refuses a pause whose target is not of its scope', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(pauses).values({
          id: testId('pa'),
          tenantId: a.tenantId,
          venueId: a.venueId,
          serviceDate: DAY,
          scope: 'bar',
          targetId: a.tableId,
          cause: 'staff',
          restroStarted: false,
          ...PROVENANCE,
        }),
      ),
    )
    expect(message).toMatch(/pauses_target_matches_scope/)
  })
})
