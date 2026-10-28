// The payment recovery run is isolated per organisation (#166): one organisation whose queries
// fail is logged, without personal data, and the organisations after it are recovered all the
// same. No database: the organisations' queries are answered by hand.
import { newId } from '@restro/core'
import type { DbPool } from '@restro/db'
import { describe, expect, it, vi } from 'vitest'

import type { Logger } from '../src/logger'

const world = vi.hoisted(() => ({
  organisations: [] as string[],
  failing: new Set<string>(),
  /** The first query of an organisation reads its open payments. */
  rows: new Map<string, Record<string, unknown>[]>(),
  calls: new Map<string, number>(),
}))

vi.mock('@restro/db', async (original) => {
  const db = await original<typeof import('@restro/db')>()
  return {
    ...db,
    withSystem: () => Promise.resolve(world.organisations.map((id) => ({ id }))),
    withTenant: (_pool: unknown, tenantId: string) => {
      if (world.failing.has(tenantId))
        return Promise.reject(
          // As Drizzle wraps a Postgres error: the query with its values, and the error that failed it.
          new Error('Failed query: select ... params: Anna P.', {
            cause: Object.assign(new Error('key (name)=(Anna P.) is taken'), { code: '23505' }),
          }),
        )
      const call = world.calls.get(tenantId) ?? 0
      world.calls.set(tenantId, call + 1)
      return Promise.resolve(call === 0 ? (world.rows.get(tenantId) ?? []) : [])
    },
  }
})

const { recoverPayments } = await import('../src/jobs/payment-recovery')

const untouched = (id: string, venueId: string) => ({
  id,
  venueId,
  kind: 'on_bill',
  state: 'priced',
  reason: null,
  paymentTableId: null,
  idleMs: '120000',
  changedMs: '120000',
  captureDue: false,
  releaseRefused: false,
})

describe('the payment recovery across organisations', () => {
  it('logs one organisation’s failure by type and SQLSTATE, never its message and recovers the ones after it', async () => {
    const broken = newId('tn')
    const fine = newId('tn')
    const payment = newId('py')
    world.organisations = [broken, fine]
    world.failing = new Set([broken])
    world.rows = new Map([[fine, [untouched(payment, newId('vn'))]]])
    world.calls = new Map()
    const warn = vi.fn()
    const send = vi.fn(() => Promise.resolve('job'))
    const summary = await recoverPayments(
      {
        pool: {} as DbPool,
        log: { warn, error: vi.fn(), debug: vi.fn() } as unknown as Logger,
        now: () => new Date('2026-10-28T12:00:00Z'),
        queue: { send },
      },
      { providers: new Map() } as never,
    )
    // The fine organisation's stale payment was taken on again.
    expect(summary.prepared).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: fine, paymentId: payment }),
      expect.anything(),
    )
    // The failure is logged with the organisation and the kind of error, never its message.
    expect(warn).toHaveBeenCalledTimes(1)
    const [fields] = warn.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(fields).toEqual({
      tenantId: broken,
      failure: { types: ['Error', 'Error'], codes: ['23505'] },
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Anna')
  })
})
