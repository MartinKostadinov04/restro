// RR-8, attacked (the repair-review's A7): the per-phone Pay limits are keyed on `X-Restro-Phone`,
// which the caller chooses. With D122's real limits, on Postgres as restro_app: what does a caller
// holding one table code get by rotating that value? The per-phone limit resets, as RR-8 says. What
// stops it is the engine: a line is on one open payment at a time, so the open payments of a table
// are at most its lines. What's left is that one caller can hold every line of the bill, each Pay
// costing a Turnstile token (so it stands on RR-6).
import { randomUUID } from 'node:crypto'

import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import { forgetGuestCodes, type GuestTableState, guestAct, guestState } from './guest'
import { GuestLimiter } from './guest-limits'

const KEY = 'pay-test-key-'.padEnd(48, 'x')

const LINES = [
  { pos: 'L1', quantity: '1', amountMinor: 1_000 },
  { pos: 'L2', quantity: '1', amountMinor: 450 },
  { pos: 'L3', quantity: '1', amountMinor: 300 },
]

type BillLine = NonNullable<GuestTableState['bill']>['parts'][number]['lines'][number]

describe.skipIf(!hasDatabase)('rotating the phone value at Pay (RR-8, real limits)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  const integrationId = newId('in')
  let limiter: GuestLimiter

  async function record() {
    const { result } = await applyService(
      world.app,
      {
        type: 'reading.record',
        tableId,
        reading: {
          complete: true,
          currency: 'EUR',
          bills: [
            {
              pos: 'B1',
              totalMinor: 1_750,
              paidMinor: 0,
              openedAt: '2026-10-26T20:00:00.000Z',
              openedByRestro: false,
              paymentInFlight: false,
              lines: LINES.map((line) => ({
                pos: line.pos,
                itemPos: null,
                posName: `till name ${line.pos}`,
                quantity: line.quantity,
                amountMinor: line.amountMinor,
                enteredBy: 'staff',
                enteredAt: null,
                restroRef: null,
              })),
            },
          ],
        },
      } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'integration', integrationId },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
  }

  async function bill(): Promise<BillLine[]> {
    const read = await guestState(world.app, { code, view: 'bill', limiter })
    if (!read.ok || read.answer.unchanged || read.answer.bill === null) throw new Error('no bill')
    return read.answer.bill.parts.flatMap((part) => part.lines)
  }

  const pay = async (
    phone: string,
    lines: readonly BillLine[],
    command: { readonly actionId?: string } = {},
  ) =>
    guestAct(world.app, {
      code,
      command: {
        actionId: command.actionId ?? randomUUID(),
        type: 'pay.start',
        pick: {
          kind: 'lines',
          lines: lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
        },
        seen: lines.map((line) => ({
          lineId: line.id,
          quantity: line.quantity,
          amountMinor: line.amountMinor,
        })),
        tipMinor: null,
        tipPercent: null,
      } as never,
      ageMs: 50,
      view: 'bill',
      phone,
      limiter,
      check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      humanCheck: async () => 'passed',
      queuePayment: async () => {},
    })

  const resultOf = (answer: Awaited<ReturnType<typeof pay>>) => {
    if (!answer.ok) throw new Error(`the code was refused: ${answer.code}`)
    return answer.result
  }

  beforeAll(async () => {
    world = await openServiceWorld('pay-phones')
    tableId = world.tables[0] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
    )
    await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integrationId}, ${world.tenantId}, 'sim', '127.0.0.1:9')`),
    )
    await world.owner.query(
      `update restro.venues set settings = settings || '{"legalDetails":{"name":"Club EOOD","eik":"123456789","address":"Sofia, 1 Vitosha Blvd","privacyUrl":"https://club.example/privacy"}}'::jsonb where id = $1`,
      [world.venueId],
    )
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_paytest1', 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId],
    )
    await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
      world.tables[3],
    ])
    await world.declareCapabilities({ recordTipOnClose: true })
  }, 120_000)

  afterAll(async () => {
    await world?.close()
  }, 60_000)

  beforeEach(async () => {
    forgetGuestCodes()
    limiter = new GuestLimiter()
    await world.owner.query(
      `update restro.payments set state = 'released', reason = 'test', form_values = null,
         settled_at = now() where table_id = $1 and settled_at is null`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    await world.openSitting(tableId)
    code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, await hashTableCode(code)],
    )
    await record()
  }, 30_000)

  it('the same phone is held by the 15-second gap (control)', async () => {
    const [first, second] = await bill()
    const phone = 'attack-phone-aaaaaaaaa'
    expect(resultOf(await pay(phone, [first as BillLine]))).toMatchObject({ status: 'accepted' })
    const again = await pay(phone, [second as BillLine])
    expect(again).toMatchObject({ ok: false, code: 'rate_limited' })
  }, 30_000)

  it('a rotated phone escapes the gap, but no line goes on two open payments', async () => {
    const lines = await bill()
    const first = lines[0] as BillLine
    expect(resultOf(await pay(randomUUID(), [first]))).toMatchObject({ status: 'accepted' })
    // The same line, from any number of fresh phone values: the engine refuses each.
    for (let attempt = 0; attempt < 5; attempt++) {
      const answer = resultOf(await pay(randomUUID(), [first]))
      expect(answer.status, JSON.stringify(answer)).not.toBe('accepted')
    }
    const open = await world.owner.query<{ n: number }>(
      `select count(*)::int as n from restro.payments where table_id = $1 and settled_at is null`,
      [tableId],
    )
    expect(open.rows[0]?.n).toBe(1)
  }, 60_000)

  it('rotating gets at most one open payment per line of the bill', async () => {
    const lines = await bill()
    const answers = []
    for (const line of lines) answers.push(resultOf(await pay(randomUUID(), [line])))
    expect(answers.every((answer) => answer.status === 'accepted')).toBe(true)
    // Past the lines nothing is left to pick.
    const extra = resultOf(await pay(randomUUID(), [lines[0] as BillLine]))
    expect(extra.status).not.toBe('accepted')
    const open = await world.owner.query<{ n: number }>(
      `select count(*)::int as n from restro.payments where table_id = $1 and settled_at is null`,
      [tableId],
    )
    expect(open.rows[0]?.n).toBe(LINES.length)
  }, 60_000)
})
