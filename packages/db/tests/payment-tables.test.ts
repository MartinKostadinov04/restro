// Integration tests on a real Postgres for the paying tables (migration 0030; ticket #104; D127
// §Records): every new tenant table keeps tenants apart under row-level security, the app role
// writes them only as table-access.ts says (no deletes; the steps append-only), the provider's
// notices stay platform-level and never deleted by the app, and the constraints the payment route
// leans on hold in the database itself, the payment table's deadline-free ownership among them.
import { randomBytes } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  areas,
  bars,
  createPool,
  type DbPool,
  locks,
  paymentAccounts,
  paymentLines,
  paymentSteps,
  payments,
  sentOrders,
  sittings,
  tenants,
  venues,
  venueTables,
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
  PAYING_TABLES_CHILDREN_FIRST,
  testId,
  testPublicId,
} from './database'

const RLS_VIOLATION = /violates row-level security policy/
const NO_PRIVILEGE = /permission denied/

/** The provenance every service row carries (rule 2). */
const PROVENANCE = { source: 'worker', actor: 'system', jobId: 'jb_test' } as const
const DAY = '2026-10-25'

interface Fixture {
  readonly tenantId: string
  readonly venueId: string
  readonly areaId: string
  readonly tableId: string
  readonly paymentTableId: string
  readonly barId: string
  readonly sittingId: string
  readonly sentOrderId: string
  readonly paymentId: string
  readonly handleHash: string
}

function fixture(): Fixture {
  return {
    tenantId: testId('tn'),
    venueId: testId('vn'),
    areaId: testId('ar'),
    tableId: testId('tb'),
    paymentTableId: testId('tb'),
    barId: testId('br'),
    sittingId: testId('st'),
    sentOrderId: testId('so'),
    paymentId: testId('py'),
    handleHash: randomBytes(32).toString('hex'),
  }
}

/** A payment row of the fixture's tenant, with `patch` over the defaults. */
function paymentRow(f: Fixture, patch: Partial<typeof payments.$inferInsert> = {}) {
  return {
    id: testId('py'),
    tenantId: f.tenantId,
    venueId: f.venueId,
    tableId: f.tableId,
    sittingId: f.sittingId,
    serviceDate: DAY,
    kind: 'on_bill',
    state: 'requested',
    handleHash: randomBytes(32).toString('hex'),
    currency: 'EUR',
    providerKind: 'sim',
    ...PROVENANCE,
    ...patch,
  } satisfies typeof payments.$inferInsert
}

describe.skipIf(!hasDatabase)('paying tables (migration 0030)', () => {
  const a = fixture()
  const b = fixture()

  let app: DbPool
  /** restro_app over plain pg, for the platform-level notices. */
  let appRaw: pg.Pool
  let owner: pg.Pool
  const eventIds: string[] = []

  /** One row in every paying table for the fixture's tenant, written as restro_app. */
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
      await tx.insert(venueTables).values([
        { id: f.tableId, ...base, areaId: f.areaId, number: '1', sortKey: 'a', barId: f.barId },
        {
          id: f.paymentTableId,
          ...base,
          areaId: f.areaId,
          number: '90',
          sortKey: 'b',
          barId: f.barId,
          isPaymentTable: true,
        },
      ])
      await tx.insert(sittings).values({
        id: f.sittingId,
        ...base,
        tableId: f.tableId,
        serviceDate: DAY,
        openedHow: 'one',
        ...PROVENANCE,
      })
      await tx.insert(sentOrders).values({
        id: f.sentOrderId,
        ...base,
        tableId: f.tableId,
        sittingId: f.sittingId,
        barId: f.barId,
        serviceDate: DAY,
        kind: 'pay_first',
        reference: 'P4Y',
        state: 'waiting',
        lines: [{ line: 1 }],
        totalMinor: 1250,
        ...PROVENANCE,
      })
      await tx.insert(payments).values(
        paymentRow(f, {
          id: f.paymentId,
          barId: f.barId,
          handleHash: f.handleHash,
          state: 'held',
          amountMinor: 1350,
          tipMinor: 100,
          providerPaymentRef: `pi_${f.paymentId.slice(3)}`,
        }),
      )
      await tx.insert(paymentLines).values({
        ...base,
        paymentId: f.paymentId,
        position: 1,
        posLineRef: 'line-1',
        quantity: '2',
        posAmountMinor: 1250,
        displayName: 'Mojito',
        ...PROVENANCE,
      })
      await tx.insert(paymentSteps).values({
        ...base,
        paymentId: f.paymentId,
        step: 'createHold',
        outcome: 'attempting',
        idempotencyKey: `${f.paymentId}:hold`,
        ...PROVENANCE,
      })
      await tx.insert(paymentAccounts).values({
        ...base,
        providerKind: 'sim',
        accountRef: `acct_${f.venueId.slice(3)}`,
        accountName: 'Club Ltd',
        state: 'connected',
        checks: { cardPayments: true, receiptEmailsOff: true },
        ...PROVENANCE,
      })
    })
  }

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-db-tests' })
    appRaw = new pg.Pool({ connectionString: appDatabaseUrl(), max: 1 })
    await seed(a)
    await seed(b)
  })

  afterAll(async () => {
    await app?.end()
    await appRaw?.end()
    if (owner) {
      await cleanUp(owner, { tenants: [a.tenantId, b.tenantId] })
      await owner.query('delete from restro.provider_notices where event_id = any($1)', [eventIds])
      await owner.end()
    }
  })

  it('covers every tenant table of migration 0030, each declared in table-access.ts', () => {
    for (const table of PAYING_TABLES_CHILDREN_FIRST) {
      expect(TABLE_ACCESS[table].tenancy, table).toBe('tenant')
    }
    expect(TABLE_ACCESS.provider_notices.tenancy).toBe('system')
  })

  it('each tenant sees exactly its own row in every paying table, with no where clause', async () => {
    for (const f of [a, b]) {
      const counts = await withTenant(app, f.tenantId, async (tx) => {
        const out: Record<string, number> = {}
        for (const table of PAYING_TABLES_CHILDREN_FIRST) {
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
      expect(counts).toEqual(Object.fromEntries(PAYING_TABLES_CHILDREN_FIRST.map((t) => [t, 1])))
    }
  })

  it("refuses a payment for another tenant, and reads none of another tenant's", async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) => tx.insert(payments).values(paymentRow(b))),
    )
    expect(message).toMatch(RLS_VIOLATION)
    const seen = await withTenant(app, a.tenantId, (tx) =>
      tx.select({ id: payments.id }).from(payments).where(eq(payments.id, b.paymentId)),
    )
    expect(seen).toEqual([])
  })

  it('updates nothing of another tenant', async () => {
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.update(payments).set({ state: 'queued' }).where(eq(payments.id, b.paymentId)),
    )
    const { rows } = await owner.query('select state from restro.payments where id = $1', [
      b.paymentId,
    ])
    expect(rows[0]?.state).toBe('held')
  })

  it('never lets the app role delete a paying row', async () => {
    for (const table of PAYING_TABLES_CHILDREN_FIRST) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.execute(sql.raw(`delete from restro.${table} where tenant_id = '${a.tenantId}'`)),
        ),
      )
      expect(message, table).toMatch(NO_PRIVILEGE)
    }
  })

  it('keeps the payment steps append-only', async () => {
    for (const statement of [
      `update restro.payment_steps set outcome = 'done' where payment_id = '${a.paymentId}'`,
      `delete from restro.payment_steps where payment_id = '${a.paymentId}'`,
    ]) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) => tx.execute(sql.raw(statement))),
      )
      expect(message, statement).toMatch(NO_PRIVILEGE)
    }
    // The outcome is a new row, not a change of the old one.
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.insert(paymentSteps).values({
        tenantId: a.tenantId,
        venueId: a.venueId,
        paymentId: a.paymentId,
        step: 'createHold',
        outcome: 'done',
        answer: 'held',
        idempotencyKey: `${a.paymentId}:hold`,
        ...PROVENANCE,
      }),
    )
  })

  it('stores a provider notice once by its event id, platform-level, never deleted by the app', async () => {
    const eventId = `evt_${testId('x').slice(2)}`
    eventIds.push(eventId)
    const insert = () =>
      appRaw.query(
        `insert into restro.provider_notices
           (provider_kind, event_id, live, account_ref, type, kind, object_ref, source, actor, job_id)
         values ('sim', $1, false, 'acct_1', 'payment_intent.succeeded', 'other', 'pi_1', 'provider', 'system', 'req_1')
         on conflict (provider_kind, event_id) do nothing`,
        [eventId],
      )
    expect((await insert()).rowCount).toBe(1)
    expect((await insert()).rowCount).toBe(0)
    const message = await databaseError(
      appRaw.query('delete from restro.provider_notices where event_id = $1', [eventId]),
    )
    expect(message).toMatch(NO_PRIVILEGE)
    const handledEarly = await databaseError(
      appRaw.query(
        "update restro.provider_notices set handled_at = received_at - interval '1 second' where event_id = $1",
        [eventId],
      ),
    )
    expect(handledEarly).toMatch(/provider_notices_handled_after_received/)
  })

  it("keeps a notice's kind in the platform's words (migration 0031)", async () => {
    const eventId = `evt_${testId('x').slice(2)}`
    eventIds.push(eventId)
    const message = await databaseError(
      appRaw.query(
        `insert into restro.provider_notices
           (provider_kind, event_id, live, type, kind, source, actor, job_id)
         values ('sim', $1, false, 'charge.refunded', 'charge.refunded', 'provider', 'system', 'req_1')`,
        [eventId],
      ),
    )
    expect(message).toMatch(/provider_notices_kind/)
  })

  it('holds a payment table with no deadline, and every other lease with one (D127)', async () => {
    const base = { tenantId: a.tenantId, venueId: a.venueId, ...PROVENANCE }
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.insert(locks).values({
        ...base,
        scope: 'payment_table',
        key: a.paymentTableId,
        holder: a.paymentId,
        fence: 1,
        takenAt: new Date(),
      }),
    )
    const withDeadline = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx
          .update(locks)
          .set({ deadline: sql`now() + interval '60 seconds'` })
          .where(eq(locks.key, a.paymentTableId)),
      ),
    )
    expect(withDeadline).toMatch(/locks_holder_deadline/)
    for (const scope of ['order_slot'] as const) {
      const heldWithout = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.insert(locks).values({ ...base, scope, key: a.tableId, holder: a.paymentId }),
        ),
      )
      expect(heldWithout, scope).toMatch(/locks_holder_deadline/)
    }
    // Migration 0032: D112's payment leases are gone; a line is in one open payment instead.
    for (const scope of ['order_payment', 'bill_payment']) {
      const gone = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.insert(locks).values({ ...base, scope, key: a.tableId }),
        ),
      )
      expect(gone, scope).toMatch(/locks_scope/)
    }
    // Nothing takes over a deadline-free hold: the take's condition never sees it expire.
    const { rows } = await owner.query(
      `select coalesce(deadline < now(), false) as expired from restro.locks
        where tenant_id = $1 and scope = 'payment_table' and key = $2`,
      [a.tenantId, a.paymentTableId],
    )
    expect(rows[0]?.expired).toBe(false)
  })

  it('keeps the tip inside the amount, the capture under it and a refund under the capture', async () => {
    const cases: [Partial<typeof payments.$inferInsert>, RegExp][] = [
      [{ amountMinor: 500, tipMinor: 600 }, /payments_amounts/],
      [{ tipMinor: -1 }, /payments_amounts/],
      [{ amountMinor: 500, capturedMinor: 501 }, /payments_captured_minor/],
      [{ capturedMinor: 100 }, /payments_captured_minor/],
      [{ currency: 'eur' }, /payments_currency/],
      [{ state: 'paid' }, /payments_state/],
      [{ state: 'captured' }, /payments_settled/],
      [{ kind: 'pay_first' }, /payments_pay_first_sent_order/],
      [{ handleHash: 'not-a-hash' }, /payments_handle_hash/],
      // Migration 0031: a refund only of what was captured, a dispute in the platform's words.
      [{ refundedMinor: 1 }, /payments_refunded_minor/],
      [{ amountMinor: 500, capturedMinor: 400, refundedMinor: 401 }, /payments_refunded_minor/],
      [{ refundedMinor: -1 }, /payments_refunded_minor/],
      [{ dispute: 'needs_response' }, /payments_dispute/],
    ]
    for (const [patch, error] of cases) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) => tx.insert(payments).values(paymentRow(a, patch))),
      )
      expect(message, JSON.stringify(patch)).toMatch(error)
    }
  })

  it('keeps a pay-first payment tied to its sent order, and one handle to one payment', async () => {
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.insert(payments).values(paymentRow(a, { kind: 'pay_first', sentOrderId: a.sentOrderId })),
    )
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(payments).values(paymentRow(a, { handleHash: a.handleHash })),
      ),
    )
    expect(message).toMatch(/payments_handle_hash_unique/)
  })

  it("keeps a step's lines on a move back's attempting row only, in their shape (migration 0034)", async () => {
    const step = (fields: Partial<typeof paymentSteps.$inferInsert>) =>
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(paymentSteps).values({
          tenantId: a.tenantId,
          venueId: a.venueId,
          paymentId: a.paymentId,
          step: 'undoIsolate',
          outcome: 'attempting',
          idempotencyKey: `${a.paymentId}-undo`,
          ...PROVENANCE,
          ...fields,
        }),
      )
    const line = { pos: '9100003', quantity: '0.5', amountMinor: -300 }
    const many = Array.from({ length: 501 }, () => line)
    for (const fields of [
      { outcome: 'done', lines: [line] },
      { step: 'payAndClose', lines: [line] },
      { lines: [] },
      { lines: many },
      { lines: { pos: '9100003' } },
      { lines: [{ pos: '9100003', quantity: '0.5' }] },
      { lines: [{ ...line, pos: '' }] },
      { lines: [{ ...line, pos: 'x'.repeat(201) }] },
      { lines: [{ ...line, quantity: '1.5e3' }] },
      { lines: [{ ...line, quantity: 2 }] },
      { lines: [{ ...line, amountMinor: 1.5 }] },
      { lines: [{ ...line, amountMinor: '300' }] },
      { lines: ['9100003'] },
    ]) {
      expect(await databaseError(step(fields))).toMatch(/payment_steps_lines/)
    }
    await step({ lines: [line, { pos: '9100004', quantity: '2', amountMinor: 2200 }] })
    const [row] = await withTenant(app, a.tenantId, (tx) =>
      tx
        .select({ lines: paymentSteps.lines })
        .from(paymentSteps)
        .where(
          sql`${paymentSteps.paymentId} = ${a.paymentId} and ${paymentSteps.lines} is not null`,
        ),
    )
    expect(row?.lines).toEqual([line, { pos: '9100004', quantity: '2', amountMinor: 2200 }])
  })

  it('keeps a picked quantity above zero and exact', async () => {
    const message = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.insert(paymentLines).values({
          tenantId: a.tenantId,
          venueId: a.venueId,
          paymentId: a.paymentId,
          position: 2,
          quantity: '0',
          posAmountMinor: 0,
          displayName: 'Water',
          ...PROVENANCE,
        }),
      ),
    )
    expect(message).toMatch(/payment_lines_quantity/)
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx.insert(paymentLines).values({
        tenantId: a.tenantId,
        venueId: a.venueId,
        paymentId: a.paymentId,
        position: 2,
        quantity: '0.5',
        posAmountMinor: 450,
        displayName: 'Whisky',
        ...PROVENANCE,
      }),
    )
    const [line] = await withTenant(app, a.tenantId, (tx) =>
      tx
        .select({ quantity: paymentLines.quantity })
        .from(paymentLines)
        .where(sql`${paymentLines.paymentId} = ${a.paymentId} and ${paymentLines.position} = 2`),
    )
    expect(line?.quantity).toBe('0.500000')
  })

  it('gives an account to one venue, and a connected account its reference', async () => {
    const message = await databaseError(
      withTenantWrite(app, b.tenantId, (tx) =>
        tx
          .update(paymentAccounts)
          .set({ accountRef: `acct_${a.venueId.slice(3)}` })
          .where(eq(paymentAccounts.venueId, b.venueId)),
      ),
    )
    expect(message).toMatch(/payment_accounts_account_unique/)
    const noRef = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx
          .update(paymentAccounts)
          .set({ accountRef: null })
          .where(eq(paymentAccounts.venueId, a.venueId)),
      ),
    )
    expect(noRef).toMatch(/payment_accounts_connected_has_account/)
  })

  it('holds the form values only while the payment awaits the guest (migration 0032)', async () => {
    const form = { clientSecret: 'secret_1' }
    for (const state of ['requested', 'priced', 'held', 'cancelling'] as const) {
      const message = await databaseError(
        withTenantWrite(app, a.tenantId, (tx) =>
          tx.insert(payments).values(paymentRow(a, { state, formValues: form })),
        ),
      )
      expect(message, state).toMatch(/payments_form_values/)
    }
    const awaiting = paymentRow(a, { state: 'awaiting_guest', formValues: form })
    await withTenantWrite(app, a.tenantId, (tx) => tx.insert(payments).values(awaiting))
    // Leaving `awaiting_guest` without clearing them is refused by the database itself.
    const kept = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.update(payments).set({ state: 'held' }).where(eq(payments.id, awaiting.id)),
      ),
    )
    expect(kept).toMatch(/payments_form_values/)
    const notObject = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) =>
        tx.execute(
          sql`update restro.payments set form_values = '"secret"'::jsonb where id = ${awaiting.id}`,
        ),
      ),
    )
    expect(notObject).toMatch(/payments_form_values/)
  })

  it('keeps a POS line in one open payment, and frees it when that payment settles (migration 0032)', async () => {
    const line = (paymentId: string) => ({
      tenantId: a.tenantId,
      venueId: a.venueId,
      paymentId,
      position: 1,
      posLineRef: 'line-open',
      quantity: '1',
      posAmountMinor: 500,
      displayName: 'Beer',
      ...PROVENANCE,
    })
    const first = paymentRow(a)
    const second = paymentRow(a)
    await withTenantWrite(app, a.tenantId, async (tx) => {
      await tx.insert(payments).values([first, second])
      await tx.insert(paymentLines).values(line(first.id))
    })
    const twice = await databaseError(
      withTenantWrite(app, a.tenantId, (tx) => tx.insert(paymentLines).values(line(second.id))),
    )
    expect(twice).toMatch(/payment_lines_open_line_unique/)
    // Another tenant's line with the same POS reference is its own.
    await withTenantWrite(app, b.tenantId, async (tx) => {
      const other = paymentRow(b)
      await tx.insert(payments).values(other)
      await tx
        .insert(paymentLines)
        .values({ ...line(other.id), tenantId: b.tenantId, venueId: b.venueId })
    })
    // Settling the first payment closes its lines in the same statement, with its provenance.
    await withTenantWrite(app, a.tenantId, (tx) =>
      tx
        .update(payments)
        .set({
          state: 'released',
          settledAt: sql`now()`,
          retainUntil: sql`now() + interval '18 months'`,
          source: 'guest',
          actor: 'guest',
          jobId: 'req_settle',
        })
        .where(eq(payments.id, first.id)),
    )
    const { rows } = await owner.query(
      'select open, source, actor, job_id from restro.payment_lines where payment_id = $1',
      [first.id],
    )
    expect(rows).toEqual([{ open: false, source: 'guest', actor: 'guest', job_id: 'req_settle' }])
    await withTenantWrite(app, a.tenantId, (tx) => tx.insert(paymentLines).values(line(second.id)))
  })
})
