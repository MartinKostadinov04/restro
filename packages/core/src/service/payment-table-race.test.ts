// A payment table's first claim and an unmark at the same moment (#215) on a real Postgres, as the
// restro_app role. The lease row of a payment table may not exist yet, and `FOR UPDATE` on a row
// that is not there locks nothing; `lockLeases` therefore makes the free row first, so whoever
// inserts it makes the other wait. Either order ends in one answer: the unmark is refused
// `payment_table_busy` (the claim won), or the claim finds the table no longer marked (the unmark
// won). Skipped without a database.
import { randomUUID } from 'node:crypto'

import { venueTables } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setPaymentTableIn } from '../apply/tables'
import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { Provenance } from './context'
import { applyService } from './index'
import { type LeaseTx, lockLeases, takePaymentTable } from './leases'
import { RowLocks } from './rows'

const PROVENANCE: Provenance = { source: 'worker', actor: 'system', jobId: 'race-test' }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A promise the test settles by hand, to hold a transaction open at a chosen point. */
function gate() {
  let open!: () => void
  const passed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { passed, open }
}

describe.skipIf(!hasDatabase)('a payment table: claim and unmark at once (restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string

  beforeAll(async () => {
    world = await openServiceWorld('lease-race')
    ownerId = await world.addUser('owner')
  })

  afterAll(async () => {
    await world?.close()
  })

  const inTx = <T>(fn: (stx: LeaseTx) => Promise<T>): Promise<T> =>
    withTenantWrite(world.app, world.tenantId, (tx: WriteTx) =>
      fn({
        tx,
        tenantId: world.tenantId,
        venueId: world.venueId,
        provenance: PROVENANCE,
        rows: new RowLocks(tx, world.tenantId, world.venueId, PROVENANCE),
      }),
    )

  const mark = (tableId: string, isPaymentTable: boolean) =>
    applyService(
      world.app,
      { type: 'table.mark_payment', tableId, isPaymentTable },
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
        jobId: `req-${randomUUID()}`,
        signedInAt: new Date(),
      },
    ).then(({ result }) => result)

  const holderOf = async (tableId: string) =>
    (
      await world.owner.query<{ holder: string | null }>(
        `select holder from restro.locks where tenant_id = $1 and scope = 'payment_table' and key = $2`,
        [world.tenantId, tableId],
      )
    ).rows[0]?.holder

  const isMarked = async (tableId: string) =>
    (
      await world.owner.query<{ is_payment_table: boolean }>(
        'select is_payment_table from restro.tables where id = $1',
        [tableId],
      )
    ).rows[0]?.is_payment_table

  /** What `payment.claim_table` does: the lease row first, then the candidate read afresh, then the take. */
  const claim = async (stx: LeaseTx, tableId: string, holder: string, hold?: Promise<void>) => {
    await lockLeases(stx, [{ scope: 'payment_table', key: tableId }])
    if (hold !== undefined) await hold
    const [candidate] = await stx.tx
      .select({ isPaymentTable: venueTables.isPaymentTable })
      .from(venueTables)
      .where(eq(venueTables.id, tableId))
    if (candidate?.isPaymentTable !== true) return false
    return (await takePaymentTable(stx, { key: tableId, holder })).taken
  }

  it('the claim goes first: the unmark waits for it, then is refused payment_table_busy', async () => {
    const tableId = world.tables[0] as string
    expect(await mark(tableId, true)).toMatchObject({ status: 'accepted' })
    const holder = newId('py')
    const midway = gate()
    const claiming = inTx((stx) => claim(stx, tableId, holder, midway.passed))
    await sleep(300)
    const unmarking = mark(tableId, false)
    // The unmark cannot get past the lease row while the claim is open.
    expect(
      await Promise.race([unmarking.then(() => 'done'), sleep(500).then(() => 'waiting')]),
    ).toBe('waiting')
    midway.open()
    expect(await claiming).toBe(true)
    expect(await unmarking).toMatchObject({ status: 'refused', code: 'payment_table_busy' })
    expect(await holderOf(tableId)).toBe(holder)
    expect(await isMarked(tableId)).toBe(true)
  })

  it('the unmark goes first: the claim waits for it, then finds the table no longer marked', async () => {
    const tableId = world.tables[1] as string
    expect(await mark(tableId, true)).toMatchObject({ status: 'accepted' })
    const midway = gate()
    // The unmark of `markPaymentTable`, held open before it commits.
    const unmarking = inTx(async (stx) => {
      await stx.tx
        .select({ id: venueTables.id })
        .from(venueTables)
        .where(eq(venueTables.id, tableId))
        .for('update')
      await lockLeases(stx, [{ scope: 'payment_table', key: tableId }])
      const change = await setPaymentTableIn(stx.tx, tableId, false)
      await midway.passed
      return change.ok
    })
    await sleep(300)
    const claiming = inTx((stx) => claim(stx, tableId, newId('py')))
    expect(
      await Promise.race([claiming.then(() => 'done'), sleep(500).then(() => 'waiting')]),
    ).toBe('waiting')
    midway.open()
    expect(await unmarking).toBe(true)
    expect(await claiming).toBe(false)
    expect(await holderOf(tableId)).toBeNull()
    expect(await isMarked(tableId)).toBe(false)
  })
})

// The real command under the race (RR-39): the tests above run their own copy of the claim.
describe.skipIf(!hasDatabase)('payment.claim_table itself, at once (restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let sittingId: string

  const tenant = () => ({ tenantId: world.tenantId, venueId: world.venueId })
  const paymentTables = () => [...world.tables.slice(0, 3)].sort() as string[]
  const guestTable = () => world.tables[3] as string

  beforeAll(async () => {
    world = await openServiceWorld('claim-race')
    ownerId = await world.addUser('owner')
    sittingId = await world.openSitting(guestTable())
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, source, actor, job_id)
       values ($1, $2, 'sim-pay', $3, 'connected', 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, `acct_${randomUUID().replaceAll('-', '')}`],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  /** Each night starts with every payment over, every table free and the given tables marked. */
  const night = async (marked: readonly string[]) => {
    await world.owner.query(
      `update restro.payments
          set state = 'released', reason = 'test', settled_at = now(), payment_table_id = null
        where tenant_id = $1 and settled_at is null`,
      [world.tenantId],
    )
    await world.owner.query(
      `update restro.locks set holder = null where tenant_id = $1 and scope = 'payment_table'`,
      [world.tenantId],
    )
    await world.owner.query(
      `update restro.tables set is_payment_table = (id = any($2::text[]))
        where tenant_id = $1 and id <> $3`,
      [world.tenantId, marked, guestTable()],
    )
  }

  /** A held payment whose wait ends `endsInMs` from now. */
  const held = async (endsInMs: number) => {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          action_id, amount_minor, tip_minor, currency, provider_kind, queue_ends_at,
          source, actor, job_id)
       values ($1, $2, $3, $4, $5, current_date, 'on_bill', 'held',
          encode(sha256(convert_to($1, 'UTF8')), 'hex'), $6, 1000, 0, 'EUR', 'sim-pay',
          now() + ($7 || ' milliseconds')::interval, 'restro', 'system', 'test-seed')`,
      [id, world.tenantId, world.venueId, guestTable(), sittingId, randomUUID(), String(endsInMs)],
    )
    return id
  }

  const claim = (paymentId: string, freeTables: readonly string[]) =>
    applyService(
      world.app,
      { type: 'payment.claim_table', paymentId, freeTables: [...freeTables] },
      { ...tenant(), origin: 'worker', actor: { kind: 'system' }, jobId: `job-${randomUUID()}` },
    ).then(({ result }) => result)

  const mark = (tableId: string, isPaymentTable: boolean) =>
    applyService(
      world.app,
      { type: 'table.mark_payment', tableId, isPaymentTable },
      {
        ...tenant(),
        origin: 'staff',
        actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
        jobId: `req-${randomUUID()}`,
        signedInAt: new Date(),
      },
    ).then(({ result }) => result)

  const holders = async () =>
    new Map(
      (
        await world.owner.query<{ key: string; holder: string }>(
          `select key, holder from restro.locks
            where tenant_id = $1 and scope = 'payment_table' and holder is not null`,
          [world.tenantId],
        )
      ).rows.map((row) => [row.key, row.holder]),
    )

  const stored = async (id: string) =>
    (
      await world.owner.query<{ state: string; payment_table_id: string | null }>(
        'select state, payment_table_id from restro.payments where id = $1',
        [id],
      )
    ).rows[0]

  it('skips a table another payment holds and takes the next free one', async () => {
    const tables = paymentTables()
    await night(tables)
    const first = await held(60_000)
    const second = await held(61_000)
    await claim(first, tables)
    await claim(second, tables)
    // The order the database itself sorts ids in: its collation is not JavaScript's `sort`.
    const inOrder = (
      await world.owner.query<{ id: string }>(
        'select id from restro.tables where id = any($1::text[]) order by id',
        [tables],
      )
    ).rows.map((row) => row.id)
    expect((await stored(first))?.payment_table_id).toBe(inOrder[0])
    expect((await stored(second))?.payment_table_id).toBe(inOrder[1])
  })

  it('gives N payments at once the M tables first come, first served, one holder each', async () => {
    const tables = paymentTables()
    for (let round = 0; round < 8; round += 1) {
      await night(tables)
      const queue: string[] = []
      for (let place = 0; place < 7; place += 1) queue.push(await held(60_000 + place * 1000))
      // Every order the runs may arrive in: the last in the queue often first.
      const arrival = round % 2 === 0 ? [...queue].reverse() : queue
      await Promise.all(arrival.map((id) => claim(id, tables)))
      const taken = await holders()
      expect([...taken.values()].sort()).toEqual(queue.slice(0, 3).sort())
      for (const [table, holder] of taken) {
        expect((await stored(holder))?.payment_table_id).toBe(table)
      }
      for (const late of queue.slice(3)) {
        expect(await stored(late)).toEqual({ state: 'queued', payment_table_id: null })
      }
    }
  }, 60_000)

  /** A claim and an unmark let go at once; what each came to, and what is stored after. */
  const claimAndUnmark = async (tableId: string) => {
    await night([tableId])
    const id = await held(60_000)
    const [claimed, unmarked] = await Promise.allSettled([
      claim(id, [tableId]),
      mark(tableId, false),
    ])
    const marked = (
      await world.owner.query<{ is_payment_table: boolean }>(
        'select is_payment_table from restro.tables where id = $1',
        [tableId],
      )
    ).rows[0]?.is_payment_table
    return {
      id,
      claimed,
      unmarked,
      marked,
      holder: (await holders()).get(tableId) ?? null,
      onTable: (await stored(id))?.payment_table_id ?? null,
    }
  }

  it('never leaves a holder on a table the owner unmarked at the same moment', async () => {
    const tableId = paymentTables()[0] as string
    for (let round = 0; round < 40; round += 1) {
      const { id, marked, holder, onTable } = await claimAndUnmark(tableId)
      expect(onTable).toBe(holder === null ? null : tableId)
      if (holder !== null) {
        expect(holder).toBe(id)
        expect(marked).toBe(true)
      }
    }
  }, 120_000)

  it('lets a payment whose wait ran out go, and it holds up nobody behind it', async () => {
    const tables = paymentTables()
    await night([tables[0] as string])
    const expired = await held(-1000)
    const waiting = await held(60_000)
    // The one in time takes the only table although the other waited longer...
    await claim(waiting, tables)
    expect((await stored(waiting))?.payment_table_id).toBe(tables[0])
    // ...and the other, at its own turn, is cancelled: never left on no table, waiting.
    await claim(expired, tables)
    expect(await stored(expired)).toEqual({ state: 'cancelling', payment_table_id: null })
  })
})
