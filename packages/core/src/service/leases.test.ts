// Integration tests of leases ("turns", D117; design §2.3) on a real Postgres, as the restro_app
// role: a take is one conditional statement, so of two takers at once exactly one wins; an expired
// lease is taken over and the fence rises; a holder whose fence is stale can neither release nor
// renew. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { Provenance } from './context'
import {
  type LeaseKey,
  type LeaseTx,
  readLease,
  releaseLease,
  renewLease,
  takeLease,
} from './leases'
import { RowLocks } from './rows'

const PROVENANCE: Provenance = { source: 'worker', actor: 'system', jobId: 'lease-test' }

describe.skipIf(!hasDatabase)('leases (as the restro_app role)', () => {
  let world: ServiceWorld

  beforeAll(async () => {
    world = await openServiceWorld('leases')
  })

  afterAll(async () => {
    await world?.close()
  })

  /** Runs `fn` in its own tenant transaction with a fresh set of row locks. */
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

  /** A lease of its own per test: a slot on a table id nobody else uses. */
  const freshKey = (): LeaseKey => ({ scope: 'order_slot', key: newId('tb') })

  /** Moves the lease's deadline into the past, as if its holder had stalled. */
  const expire = (lease: LeaseKey) =>
    world.owner.query(
      `update restro.locks set deadline = now() - interval '1 second'
       where tenant_id = $1 and scope = $2 and key = $3`,
      [world.tenantId, lease.scope, lease.key],
    )

  it('lets exactly one of several takers at once win, and tells the others who holds it', async () => {
    const lease = freshKey()
    const holders = Array.from({ length: 6 }, () => newId('so'))
    const results = await Promise.all(
      holders.map((holder) => inTx((stx) => takeLease(stx, { ...lease, holder, seconds: 60 }))),
    )
    const winners = results.filter((result) => result.taken)
    expect(winners).toHaveLength(1)
    const winner = holders[results.findIndex((result) => result.taken)]
    for (const result of results) {
      if (result.taken) {
        expect(result).toEqual({ taken: true, fence: 1, tookOverFrom: null })
      } else {
        expect(result.holder).toBe(winner)
        expect(result.secondsLeft).toBeGreaterThan(50)
      }
    }
  })

  it('refuses a take while the lease is held, and changes nothing', async () => {
    const lease = freshKey()
    const first = newId('so')
    await inTx((stx) => takeLease(stx, { ...lease, holder: first, seconds: 60 }))
    const second = await inTx((stx) =>
      takeLease(stx, { ...lease, holder: newId('so'), seconds: 60 }),
    )
    expect(second).toMatchObject({ taken: false, holder: first })
    expect(await inTx((stx) => readLease(stx.tx, lease))).toMatchObject({ holder: first, fence: 1 })
  })

  it('takes over an expired lease, raises the fence and names the holder it replaced', async () => {
    const lease = freshKey()
    const stalled = newId('so')
    await inTx((stx) => takeLease(stx, { ...lease, holder: stalled, seconds: 60 }))
    await expire(lease)
    const next = newId('so')
    const taken = await inTx((stx) => takeLease(stx, { ...lease, holder: next, seconds: 60 }))
    expect(taken).toEqual({ taken: true, fence: 2, tookOverFrom: stalled })

    // The stalled holder's fence is stale: it can neither release nor renew.
    const stale = { ...lease, holder: stalled, fence: 1 }
    expect(await inTx((stx) => releaseLease(stx, stale))).toEqual({
      released: false,
      reason: 'not_held',
    })
    expect(await inTx((stx) => renewLease(stx, { ...stale, seconds: 30 }))).toEqual({
      renewed: false,
      reason: 'not_held',
    })
  })

  it('lets several takers race for an expired lease: one wins, the fence rises once', async () => {
    const lease = freshKey()
    await inTx((stx) => takeLease(stx, { ...lease, holder: newId('so'), seconds: 60 }))
    await expire(lease)
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        inTx((stx) => takeLease(stx, { ...lease, holder: newId('so'), seconds: 60 })),
      ),
    )
    expect(results.filter((result) => result.taken)).toHaveLength(1)
    expect(await inTx((stx) => readLease(stx.tx, lease))).toMatchObject({ fence: 2 })
  })

  it('raises the fence on every take, so an old claim is refused as fenced', async () => {
    const lease = freshKey()
    const holder = newId('so')
    const first = await inTx((stx) => takeLease(stx, { ...lease, holder, seconds: 60 }))
    if (!first.taken) throw new Error('first take lost')
    expect(
      await inTx((stx) => releaseLease(stx, { ...lease, holder, fence: first.fence })),
    ).toEqual({ released: true })
    // A released row is free: the same holder takes it again with a higher fence.
    const again = await inTx((stx) => takeLease(stx, { ...lease, holder, seconds: 60 }))
    expect(again).toEqual({ taken: true, fence: 2, tookOverFrom: null })
    expect(await inTx((stx) => releaseLease(stx, { ...lease, holder, fence: 1 }))).toEqual({
      released: false,
      reason: 'fenced',
    })
  })

  it('renews a live lease but refuses to extend an expired one', async () => {
    const lease = freshKey()
    const holder = newId('so')
    await inTx((stx) => takeLease(stx, { ...lease, holder, seconds: 5 }))
    const claim = { ...lease, holder, fence: 1, seconds: 120 }
    expect(await inTx((stx) => renewLease(stx, claim))).toEqual({ renewed: true })
    expect((await inTx((stx) => readLease(stx.tx, lease)))?.secondsLeft).toBeGreaterThan(100)
    await expire(lease)
    expect(await inTx((stx) => renewLease(stx, claim))).toEqual({
      renewed: false,
      reason: 'expired',
    })
  })

  it('stamps the provenance of the last take on the row (rule 2)', async () => {
    const lease = freshKey()
    const jobId = `lease-${randomUUID()}`
    await withTenantWrite(world.app, world.tenantId, (tx) => {
      const provenance: Provenance = { source: 'guest', actor: 'guest', jobId }
      return takeLease(
        {
          tx,
          tenantId: world.tenantId,
          venueId: world.venueId,
          provenance,
          rows: new RowLocks(tx, world.tenantId, world.venueId, provenance),
        },
        { ...lease, holder: newId('so'), seconds: 60 },
      )
    })
    const { rows } = await world.owner.query(
      'select source, actor, job_id from restro.locks where tenant_id = $1 and key = $2',
      [world.tenantId, lease.key],
    )
    expect(rows).toEqual([{ source: 'guest', actor: 'guest', job_id: jobId }])
  })

  it('refuses a take of a second lease out of key order in one transaction', async () => {
    const [low, high] = [newId('tb'), newId('tb')].sort()
    await expect(
      inTx(async (stx) => {
        await takeLease(stx, {
          scope: 'order_slot',
          key: high as string,
          holder: newId('so'),
          seconds: 5,
        })
        await takeLease(stx, {
          scope: 'order_slot',
          key: low as string,
          holder: newId('so'),
          seconds: 5,
        })
      }),
    ).rejects.toThrow(/order/)
  })
})
