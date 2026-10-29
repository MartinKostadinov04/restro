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
