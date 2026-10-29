// The `pay` night of the Tonight fixture (#115): four card payments that wait for a manager, written
// the way the payment route leaves them. Raw SQL on the payments tables, so it lives under `e2e/`
// like the other test harnesses that do (the write-target guard skips such folders); the fixture
// (`../seed-tonight-e2e.ts`) calls it with its own pool, venue, day, tables and sitting maker.
import { createHash } from 'node:crypto'

import { newId } from '@restro/core'
import type pg from 'pg'

/** What the scene needs of the fixture. */
export interface PayNightWorld {
  readonly owner: pg.Pool
  readonly tenantId: string
  readonly venueId: string
  readonly day: string
  readonly tables: Record<string, string>
  /** Opens a sitting at the table of that number and answers its id. */
  readonly sitting: (number: string) => Promise<string>
}

export async function seedPayNight(
  world: PayNightWorld,
  scene: 'pay' | 'pay-stuck' = 'pay',
): Promise<void> {
  const { owner, tenantId, venueId, day, tables, sitting } = world
  if (scene === 'pay-stuck') {
    // Items stuck on a payment table at Table 5: a staff member marks them moved back.
    const sittingId = await sitting('5')
    const id = newId('py')
    await owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, tip_minor, currency, provider_kind, settled_at, source, actor,
          job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'stranded', 'stranded', $7, 3800, 200, 'EUR',
               'sim-pay', now(), 'worker', 'system', 'e2e-seed')`,
      [
        id,
        tenantId,
        venueId,
        tables['5'],
        sittingId,
        day,
        createHash('sha256').update(id).digest('hex'),
      ],
    )
    await owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          raised_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'payment_stranded', 'venue', $5, 'alerts.answer', $6::jsonb,
               now() - interval '2 minutes', 'worker', 'system', 'e2e-seed')`,
      [
        newId('al'),
        tenantId,
        venueId,
        day,
        id,
        JSON.stringify({ paymentId: id, tableId: tables['5'], amountMinor: 3800, currency: 'EUR' }),
      ],
    )
    return
  }
  // Four card payments that wait for a manager (#115): Tables 1 and 2 closed on the till with no
  // answer (a receipt?), Tables 3 and 4 paid first with an order nobody knows is on the till.
  // Each has its alert, as the payment route raises it; the hold ends in five days.
  const holdEnds = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
  const payment = async (
    number: string,
    kind: 'on_bill' | 'pay_first',
    reason: string,
    reference: string | null,
    minutesAgo: number,
  ) => {
    const sittingId = await sitting(number)
    const id = newId('py')
    let sentOrderId: string | null = null
    if (kind === 'pay_first' && reference !== null) {
      sentOrderId = newId('so')
      await owner.query(
        `insert into restro.sent_orders
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state,
            lines, total_minor, action_id, sent_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'pay_first', $7, 'unconfirmed', $8::jsonb, 1800, $9,
                 now() - interval '4 minutes', 'guest', 'guest', 'e2e-seed')`,
        [
          sentOrderId,
          tenantId,
          venueId,
          tables[number],
          sittingId,
          day,
          reference,
          JSON.stringify([
            {
              id: newId('ol'),
              itemId: newId('nd'),
              optionIds: [],
              qty: 2,
              unitMinor: 900,
              name: 'Mojito',
              optionNames: [],
            },
          ]),
          crypto.randomUUID(),
        ],
      )
    }
    await owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, sent_order_id, service_date, kind, state,
          reason, handle_hash, amount_minor, tip_minor, currency, provider_kind, capture_before,
          settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'unconfirmed', $9, $10, 3800, 200, 'EUR', 'sim-pay',
               $11, now(), 'worker', 'system', 'e2e-seed')`,
      [
        id,
        tenantId,
        venueId,
        tables[number],
        sittingId,
        sentOrderId,
        day,
        kind,
        reason,
        createHash('sha256').update(id).digest('hex'),
        holdEnds,
      ],
    )
    if (kind === 'on_bill') {
      // A close was attempted and its outcome unknown: only then is "Receipt printed" asked.
      await owner.query(
        `insert into restro.payment_steps
           (tenant_id, venue_id, payment_id, step, outcome, answer, idempotency_key, source, actor, job_id)
         values ($1, $2, $3, 'payAndClose', 'unknown', null, $4, 'worker', 'system', 'e2e-seed')`,
        [tenantId, venueId, id, `e2e-close-${number}`],
      )
    }
    await owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          raised_at, source, actor, job_id)
       values ($1, $2, $3, $4, 'payment_unconfirmed', 'venue', $5, 'money.follow_up', $6::jsonb,
               now() - ($7 || ' minutes')::interval, 'worker', 'system', 'e2e-seed')`,
      [
        newId('al'),
        tenantId,
        venueId,
        day,
        id,
        JSON.stringify({
          paymentId: id,
          tableId: tables[number],
          amountMinor: 3800,
          tipMinor: 200,
          currency: 'EUR',
          captureBefore: holdEnds,
          ...(kind === 'pay_first' ? { question: 'till', reference } : {}),
        }),
        String(minutesAgo),
      ],
    )
  }
  await payment('1', 'on_bill', 'close_unknown', null, 6)
  await payment('2', 'on_bill', 'close_unknown', null, 5)
  await payment('3', 'pay_first', 'enter_unknown', 'P3X1', 4)
  await payment('4', 'pay_first', 'enter_unknown', 'P4X2', 3)
}
