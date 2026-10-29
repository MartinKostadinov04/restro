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
  scene: 'pay' | 'pay-stuck' | 'receipts' | 'refunds' = 'pay',
): Promise<void> {
  const { owner, tenantId, venueId, day, tables, sitting } = world
  if (scene === 'refunds') {
    await seedRefundsNight(world)
    return
  }
  if (scene === 'receipts') {
    // Paper receipts to bring (#200), as a capture leaves them: Table 1's has the POS's receipt
    // number, Table 2's has none (a manager answered "Receipt printed"), Table 3's was brought
    // already. Table 1 was captured first.
    const captured = async (
      number: string,
      receiptNumber: string | null,
      minutesAgo: number,
      broughtBy: string | null,
    ) => {
      const sittingId = await sitting(number)
      const id = newId('py')
      await owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            amount_minor, tip_minor, captured_minor, currency, provider_kind, receipt_number,
            settled_at, receipt_to_bring_at, receipt_brought_at, receipt_brought_by, source, actor,
            job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', $7, 3800, 200, 3800, 'EUR',
                 'sim-pay', $8, now(), now() - make_interval(mins => $9),
                 case when $10::text is not null then now() end, $10, 'worker', 'system',
                 'e2e-seed')`,
        [
          id,
          tenantId,
          venueId,
          tables[number],
          sittingId,
          day,
          createHash('sha256').update(id).digest('hex'),
          receiptNumber,
          minutesAgo,
          broughtBy,
        ],
      )
    }
    await captured('1', 'R-000123', 6, null)
    await captured('2', null, 3, null)
    await captured('3', 'R-000125', 9, 'system')
    return
  }
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

/**
 * Refunds and disputes read back from the provider (#222), as `payment.observe` leaves them:
 * Table 1 was partly refunded (€5.00, seen a few minutes ago, its storno not made), Table 2 was
 * refunded and its storno made long ago (no row), Table 3's payment is disputed and open with the
 * provider's answer-by date in five days (with an item, its steps and its bank check for the
 * evidence), Table 4's dispute was lost (no row).
 */
async function seedRefundsNight(world: PayNightWorld): Promise<void> {
  const { owner, tenantId, venueId, day, tables, sitting } = world
  const payment = async (
    number: string,
    fields: {
      readonly refundedMinor?: number
      readonly dispute?: 'open' | 'lost'
      readonly receiptNumber?: string
    },
  ) => {
    const sittingId = await sitting(number)
    const id = newId('py')
    await owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, tip_minor, captured_minor, refunded_minor, dispute, dispute_opened_at,
          dispute_due_at, currency, provider_kind, provider_payment_ref, receipt_number,
          fiscal_memory_number, three_ds_result, authorisation_code, settled_at, source, actor,
          job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', $7, 3800, 200, 3800, $8, $9,
               case when $9::text is not null then now() - interval '2 hours' end,
               case when $9::text = 'open' then now() + interval '5 days' end,
               'EUR', 'sim-pay', $10, $11, 'FM-77881', 'authenticated', 'A1B2C3', now(), 'worker',
               'system', 'e2e-seed')`,
      [
        id,
        tenantId,
        venueId,
        tables[number],
        sittingId,
        day,
        createHash('sha256').update(id).digest('hex'),
        fields.refundedMinor ?? 0,
        fields.dispute ?? null,
        `pi_e2e_${id.slice(3)}`,
        fields.receiptNumber ?? 'R-000123',
      ],
    )
    return { id, tableId: tables[number] as string, sittingId }
  }
  const refund = (paymentId: string, amountMinor: number, minutesAgo: number, storno: boolean) =>
    owner.query(
      `insert into restro.payment_refunds
         (id, tenant_id, venue_id, payment_id, amount_minor, seen_at, service_date, storno_at,
          storno_by, source, actor, job_id)
       values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6), $7,
               case when $8::boolean then now() - make_interval(mins => $6) end,
               case when $8::boolean then 'system' end, 'worker', 'system', 'e2e-seed')`,
      [newId('rf'), tenantId, venueId, paymentId, amountMinor, minutesAgo, day, storno],
    )

  const refunded = await payment('1', { refundedMinor: 500 })
  await refund(refunded.id, 500, 8, false)
  const answered = await payment('2', { refundedMinor: 300, receiptNumber: 'R-000124' })
  await refund(answered.id, 300, 90, true)

  const disputed = await payment('3', { dispute: 'open', receiptNumber: 'R-000125' })
  await owner.query(
    `insert into restro.payment_lines
       (tenant_id, venue_id, payment_id, position, pos_line_ref, quantity, pos_amount_minor,
        display_name, source, actor, job_id)
     values ($1, $2, $3, 1, 'e2e-line-1', 2, 3600, 'Gin tonic', 'worker', 'system', 'e2e-seed')`,
    [tenantId, venueId, disputed.id],
  )
  for (const [state, minutes] of [
    ['held', 40],
    ['closed', 30],
    ['captured', 29],
  ] as const) {
    await owner.query(
      `insert into restro.log_entries
         (tenant_id, venue_id, service_date, at, kind, payment_id, table_id, to_state, details,
          retention, source, actor, job_id)
       values ($1, $2, $3, now() - make_interval(mins => $7), 'payment.state', $4, $5, $6,
               '{}'::jsonb, 'record', 'worker', 'system', 'e2e-seed')`,
      [tenantId, venueId, day, disputed.id, disputed.tableId, state, minutes],
    )
  }
  await payment('4', { dispute: 'lost', receiptNumber: 'R-000126' })
}
