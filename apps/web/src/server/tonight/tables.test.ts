// Tonight's table commands, server side (#73): what this file adds over the service write path,
// whose commands core's sittings tests cover on Postgres. The service path is a fake here: the
// context it gets (staff, via Tonight, the actor and the sign-in), the answer's shape, and the
// payment-table mark's queueing of the retired code's files, which never reach the screen.
import { JOB_NAMES } from '@restro/core'
import type { ServiceResult } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

const applyService = vi.hoisted(() => vi.fn())
vi.mock('@restro/core/service', () => ({ applyService }))
vi.mock('../log', () => ({ logError: vi.fn() }))

import { markPaymentTable, runTableCommand, type TonightScope } from './tables'

const TENANT = 'tn_0123456789ABCDEFGHIJKL'
const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const TABLE = 'tb_0123456789ABCDEFGHIJKL'
const signedInAt = new Date('2026-10-24T20:00:00Z')
const scope: TonightScope = {
  pool: {} as DbPool,
  tenantId: TENANT,
  venueId: VENUE,
  actor: { kind: 'staff', staffMemberId: 'sm_0123456789ABCDEFGHIJKL', sessionId: 's1' },
  signedInAt,
}
const answers = (
  result:
    | { readonly status: 'accepted'; readonly details: Record<string, string | boolean> }
    | { readonly status: 'refused'; readonly code: string },
) => {
  const full: ServiceResult =
    result.status === 'accepted'
      ? { actionId: null, ref: null, ...result }
      : { actionId: null, details: {}, ...result }
  applyService.mockResolvedValueOnce({ result: full })
}

afterEach(() => {
  applyService.mockReset()
})

describe("Tonight's table commands", () => {
  it('runs a command as staff via Tonight, with the actor and the sign-in', async () => {
    answers({ status: 'accepted', details: { opened: true, sittingId: 'st_x' } })
    const result = await runTableCommand(scope, { type: 'table.open', tableId: TABLE })
    expect(result).toEqual({ ok: true, details: { opened: true, sittingId: 'st_x' } })
    const [, command, context] = applyService.mock.calls[0] ?? []
    expect(command).toEqual({ type: 'table.open', tableId: TABLE })
    expect(context).toMatchObject({
      tenantId: TENANT,
      venueId: VENUE,
      origin: 'staff',
      via: 'tonight',
      actor: scope.actor,
      signedInAt,
    })
    expect(context.jobId).toMatch(/^jb_/)
  })

  it("passes a refusal's code on", async () => {
    answers({ status: 'refused', code: 'payment_table' })
    expect(await runTableCommand(scope, { type: 'tables.open_all' })).toEqual({
      ok: false,
      error: 'payment_table',
    })
  })
})

describe('the payment-table mark', () => {
  const sent: unknown[] = []
  const services = {
    enqueue: vi.fn(async (name: string, data: unknown) => {
      sent.push({ name, data })
      return 'job-1'
    }),
  }
  afterEach(() => {
    sent.length = 0
  })

  it('queues the retired code files and keeps their names off the answer', async () => {
    answers({ status: 'accepted', details: { changed: true, retired: 'a1.json,b2.json' } })
    const result = await markPaymentTable(scope, services, { tableId: TABLE, isPaymentTable: true })
    expect(result).toEqual({ ok: true, details: { changed: true }, queued: true })
    expect(applyService.mock.calls[0]?.[1]).toEqual({
      type: 'table.mark_payment',
      tableId: TABLE,
      isPaymentTable: true,
    })
    expect(sent).toEqual([
      {
        name: JOB_NAMES.publishTableTokens,
        data: { tenantId: TENANT, venueId: VENUE, retired: ['a1.json', 'b2.json'] },
      },
    ])
  })

  it('queues nothing when no code was retired', async () => {
    answers({ status: 'accepted', details: { changed: false, retired: '' } })
    const result = await markPaymentTable(scope, services, { tableId: TABLE, isPaymentTable: true })
    expect(result).toEqual({ ok: true, details: { changed: false } })
    expect(sent).toEqual([])
  })

  it('keeps the mark when the queue is down, and says so', async () => {
    answers({ status: 'accepted', details: { changed: true, retired: 'a1.json' } })
    const down = { enqueue: vi.fn(async () => Promise.reject(new Error('queue is down'))) }
    const result = await markPaymentTable(scope, down, { tableId: TABLE, isPaymentTable: true })
    expect(result).toEqual({ ok: true, details: { changed: true }, queued: false })
  })

  it('passes a refusal on and queues nothing', async () => {
    answers({ status: 'refused', code: 'table_open' })
    const result = await markPaymentTable(scope, services, { tableId: TABLE, isPaymentTable: true })
    expect(result).toEqual({ ok: false, error: 'table_open' })
    expect(sent).toEqual([])
  })
})
