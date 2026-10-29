// Paying on the bill up to a held card (#110) on a real Postgres, as the restro_app role: a guest's
// `pay.start` greys its lines on every phone and hands the paying phone a handle whose hash alone is
// stored; the worker's steps price it from the POS's own amounts plus the tip, keep the card form's
// values only while the guest is at the form, and hold it; every refusal of design §3; the races
// (a notice and `pay.returned` together, a cancel and the hold together, two friends on one line);
// and no POS or provider value in any guest answer but the paying phone's own form. Skipped
// without a database.
import { createHash, randomUUID } from 'node:crypto'

import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import {
  forgetGuestCodes,
  type GuestTableState,
  guestAct,
  guestPayment,
  guestState,
  type HumanCheck,
  hashPaymentHandle,
  type PaymentTarget,
} from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'

const KEY = 'pay-test-key-'.padEnd(48, 'x')
const ACCOUNT = 'acct_paytest1'
/** The provider's id of a payment's hold: one per payment. */
const holdRef = (paymentId: string) => `simpay_${paymentId}`
/** A value the card form needs and nothing else may show (Stripe's is a client secret). */
const SECRET = 'pi_test_secret_do_not_leak'

/** D122's limits, loosened so a test's quick taps meet the engine's limits, not the phone's. */
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

type BillLine = NonNullable<GuestTableState['bill']>['parts'][number]['lines'][number]

describe.skipIf(!hasDatabase)('paying on the bill (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let code: string
  const integrationId = newId('in')
  const limiter = new GuestLimiter(LOOSE)
  const queued: { target: PaymentTarget; job: string }[] = []
  let human: HumanCheck = async () => 'passed'

  /** The table's POS bill, as the worker reads it: three lines, 17.50 in all. */
  const LINES = [
    { pos: 'L1', quantity: '2', amountMinor: 1_000 },
    { pos: 'L2', quantity: '1', amountMinor: 450 },
    { pos: 'L3', quantity: '1', amountMinor: 300 },
  ]
  /** `totalMinor` other than the lines' sum is a bill-level discount (D122 §8). */
  const reading = (
    lines = LINES,
    totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0),
  ) => ({
    complete: true as const,
    currency: 'EUR',
    bills: [
      {
        pos: 'B1',
        totalMinor,
        paidMinor: 0,
        openedAt: '2026-10-26T20:00:00.000Z',
        openedByRestro: false,
        paymentInFlight: false,
        lines: lines.map((line) => ({
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
  })

  const workerContext = () => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker' as const,
    actor: { kind: 'system' as const },
    jobId: `payment-${randomUUID()}`,
  })
  const worker = async (command: Record<string, unknown>) =>
    (await applyService(world.app, command, workerContext())).result

  async function record(lines = LINES, totalMinor?: number) {
    const { result } = await applyService(
      world.app,
      { type: 'reading.record', tableId, reading: reading(lines, totalMinor) },
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

  /** One phone at the table. */
  function phone() {
    const id = randomUUID()
    let handle: string | null = null
    const act = async (command: Record<string, unknown>, view: 'bill' | 'order' = 'bill') => {
      const answer = await guestAct(world.app, {
        code,
        command: { actionId: randomUUID(), ...command } as never,
        ageMs: 50,
        view,
        phone: id,
        limiter,
        check: { humanToken: 'XXXX.DUMMY.TOKEN.XXXX' },
        humanCheck: (...args) => human(...args),
        ...(handle === null ? {} : { handle }),
        queuePayment: async (target, job) => {
          queued.push({ target, job })
        },
      })
      if (!answer.ok) throw new Error(`the code was refused: ${answer.code}`)
      if (answer.handle !== null) handle = answer.handle
      return answer
    }
    return {
      act,
      get handle() {
        return handle
      },
      set handle(value: string | null) {
        handle = value
      },
      payment: async () => {
        if (handle === null) throw new Error('this phone holds no handle')
        return guestPayment(world.app, { code, handle, limiter })
      },
    }
  }

  /** The table's state as a friend's phone reads it. */
  async function friendState(): Promise<GuestTableState> {
    const read = await guestState(world.app, { code, view: 'bill', limiter })
    if (!read.ok || read.answer.unchanged) throw new Error('no table state')
    return read.answer
  }

  async function bill(): Promise<BillLine[]> {
    const state = await friendState()
    if (state.bill === null) throw new Error('no bill')
    return state.bill.parts.flatMap((part) => part.lines)
  }

  /** The `pay.start` of `lines` (by their POS refs), as the phone saw them. */
  async function start(
    who: ReturnType<typeof phone>,
    refs: readonly string[] | 'whole',
    tip: { tipMinor?: number; tipPercent?: number } = {},
  ) {
    const shown = await bill()
    const byPos = new Map(LINES.map((line, index) => [line.pos, shown[index] as BillLine]))
    const picked = refs === 'whole' ? shown : refs.map((ref) => byPos.get(ref) as BillLine)
    return who.act({
      type: 'pay.start',
      pick:
        refs === 'whole'
          ? { kind: 'whole' }
          : {
              kind: 'lines',
              lines: picked.map((line) => ({ lineId: line.id, quantity: line.quantity })),
            },
      seen: picked.map((line) => ({
        lineId: line.id,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
      })),
      tipMinor: tip.tipMinor ?? null,
      tipPercent: tip.tipPercent ?? null,
    })
  }

  const stored = async (id: string) =>
    (
      await world.owner.query<{
        state: string
        reason: string | null
        amount_minor: string | null
        tip_minor: string
        handle_hash: string
        form_values: Record<string, string> | null
        provider_payment_ref: string | null
      }>(
        `select state, reason, amount_minor, tip_minor, handle_hash, form_values, provider_payment_ref
           from restro.payments where id = $1`,
        [id],
      )
    ).rows[0]

  const paymentIdOf = (answer: Awaited<ReturnType<ReturnType<typeof phone>['act']>>) => {
    expect(answer.result).toMatchObject({ status: 'accepted' })
    const id = answer.result.subjectId
    if (id === null) throw new Error('no payment id')
    return id
  }

  const price = (paymentId: string, overrides: Record<string, unknown> = {}) =>
    worker({
      type: 'payment.price',
      paymentId,
      lines: LINES,
      providerMinimumMinor: 50,
      tipAllowed: true,
      ...overrides,
    })
  const holdMade = (paymentId: string) =>
    worker({
      type: 'payment.hold_created',
      paymentId,
      providerPaymentRef: holdRef(paymentId),
      formValues: { clientSecret: SECRET },
    })
  const check = (paymentId: string, amountMinor: number, overrides: Record<string, unknown> = {}) =>
    worker({
      type: 'payment.check',
      paymentId,
      reading: {
        ref: holdRef(paymentId),
        status: 'held',
        needsGuestAction: false,
        currency: 'EUR',
        amountMinor,
        heldMinor: amountMinor,
        captureBefore: '2026-11-02T20:00:00.000Z',
        threeDs: 'authenticated',
        authorisationCode: '123456',
        ...overrides,
      },
    })

  /** A payment of L1 taken to `awaiting_guest`. */
  async function awaiting(who = phone()) {
    const id = paymentIdOf(await start(who, ['L1']))
    expect(await price(id)).toMatchObject({ status: 'accepted', details: { state: 'priced' } })
    expect(await holdMade(id)).toMatchObject({ details: { state: 'awaiting_guest' } })
    return { id, who }
  }

  const setAccount = (state: string | null) =>
    state === null
      ? world.owner.query('update restro.payment_accounts set state = $2 where venue_id = $1', [
          world.venueId,
          'disconnected',
        ])
      : world.owner.query('update restro.payment_accounts set state = $2 where venue_id = $1', [
          world.venueId,
          state,
        ])

  beforeAll(async () => {
    world = await openServiceWorld('pay')
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
    // The venue's legal details are part of what turns paying on (#198).
    await world.owner.query(
      `update restro.venues set settings = settings || '{"legalDetails":{"name":"Club EOOD","eik":"123456789","address":"Sofia, 1 Vitosha Blvd","privacyUrl":"https://club.example/privacy"}}'::jsonb where id = $1`,
      [world.venueId],
    )
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', $3, 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, ACCOUNT],
    )
    // Paying is on only with a payment table marked in the queue (D125 2.3).
    await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
      world.tables[3],
    ])
    // The table's POS records a tip on the close (D127): a tip can be given.
    await world.declareCapabilities({ recordTipOnClose: true })
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    forgetGuestCodes()
    limiter.clear()
    queued.length = 0
    human = async () => 'passed'
    await setAccount('connected')
    await world.owner.query(
      `update restro.venues set settings = settings - 'paying' where id = $1`,
      [world.venueId],
    )
    // Each test starts on a table of its own state: no open payment, a fresh sitting and code.
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
    const fresh = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, fresh, await hashTableCode(fresh)],
    )
    code = fresh
    await record()
  })

  it('greys the picked lines on every phone and gives the payer a handle stored only as its hash', async () => {
    const payer = phone()
    const answer = await start(payer, ['L1', 'L3'])
    const id = paymentIdOf(answer)
    expect(payer.handle).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const row = await stored(id)
    expect(row).toMatchObject({ state: 'requested', amount_minor: null, form_values: null })
    expect(row?.handle_hash).toBe(
      createHash('sha256')
        .update(payer.handle ?? '')
        .digest('hex'),
    )
    expect(row?.handle_hash).toBe(hashPaymentHandle(payer.handle ?? ''))
    expect(queued).toEqual([
      {
        target: { tenantId: world.tenantId, venueId: world.venueId, paymentId: id },
        job: 'prepare',
      },
    ])

    // A friend's phone sees L1 and L3 being paid, L2 not; nothing says who or how much.
    const lines = await bill()
    expect(lines.map((line) => line.beingPaid)).toEqual([true, false, true])
    expect(JSON.stringify(await friendState())).not.toContain(payer.handle)

    // The payer reads its own payment by the handle; another handle finds nothing.
    const mine = await payer.payment()
    expect(mine).toMatchObject({ ok: true, answer: { id, state: 'requested', form: null } })
    const stranger = phone()
    stranger.handle = 'A'.repeat(22)
    expect(await stranger.payment()).toEqual({ ok: false, code: 'unknown_payment' })
  })

  it('prices the hold as the POS amounts plus the tip, and keeps the form values only at the form', async () => {
    const payer = phone()
    // 10 % of 13.00 is 1.30 (rounded half-up, rule 8).
    const id = paymentIdOf(await start(payer, ['L1', 'L3'], { tipPercent: 10 }))
    expect(await price(id)).toMatchObject({ details: { state: 'priced', amountMinor: 1_430 } })
    expect(await stored(id)).toMatchObject({ amount_minor: '1430', tip_minor: '130' })
    // A repeat of the step changes nothing (compare-and-set on the state).
    expect(await price(id)).toMatchObject({ details: { state: 'priced', changed: false } })

    expect(await holdMade(id)).toMatchObject({
      details: { state: 'awaiting_guest', changed: true },
    })
    expect((await stored(id))?.form_values).toEqual({ clientSecret: SECRET })
    const atForm = await payer.payment()
    expect(atForm).toMatchObject({
      ok: true,
      answer: {
        state: 'awaiting_guest',
        amountMinor: 1_430,
        tipMinor: 130,
        form: { provider: 'sim-pay', values: { clientSecret: SECRET }, confirmSeconds: 120 },
      },
    })
    // The form's values reach no other answer: not the payer's own state, not a friend's.
    const returned = await payer.act({ type: 'pay.returned' })
    expect(returned.result).toMatchObject({ status: 'accepted' })
    expect(queued.at(-1)?.job).toBe('check')
    for (const answer of [returned, await friendState()]) {
      const text = JSON.stringify(answer)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain(holdRef(id))
      expect(text).not.toContain(ACCOUNT)
      for (const ref of ['B1', 'L1', 'L2', 'L3', 'till name']) expect(text).not.toContain(`"${ref}`)
    }

    expect(await check(id, 1_430)).toMatchObject({ details: { state: 'held', changed: true } })
    expect(await stored(id)).toMatchObject({ state: 'held', form_values: null })
    expect(await payer.payment()).toMatchObject({ ok: true, answer: { state: 'held', form: null } })
    // Held lines stay grey until the payment is final.
    expect((await bill()).map((line) => line.beingPaid)).toEqual([true, false, true])
  })

  it('releases a tip where the connector records none, and a hold below the provider minimum', async () => {
    const tipped = paymentIdOf(await start(phone(), ['L2'], { tipMinor: 100 }))
    expect(await price(tipped, { tipAllowed: false })).toMatchObject({
      details: { state: 'released' },
    })
    expect(await stored(tipped)).toMatchObject({ state: 'released', reason: 'paying_not_offered' })

    const small = paymentIdOf(await start(phone(), ['L3']))
    expect(await price(small, { providerMinimumMinor: 500 })).toMatchObject({
      details: { state: 'released' },
    })
    expect(await stored(small)).toMatchObject({ state: 'released', reason: 'below_minimum' })

    // The bill changed between the tap and the fresh read: released, and the lines ungrey.
    const moved = paymentIdOf(await start(phone(), ['L1']))
    expect(
      await price(moved, {
        lines: [{ pos: 'L1', quantity: '1', amountMinor: 500 }, ...LINES.slice(1)],
      }),
    ).toMatchObject({ details: { state: 'released' } })
    expect(await stored(moved)).toMatchObject({ reason: 'bill_changed' })
    expect((await bill()).every((line) => !line.beingPaid)).toBe(true)
  })

  it('clears the form values on every way out of the card form', async () => {
    // The guest cancels.
    const cancelled = await awaiting()
    const cancel = await cancelled.who.act({ type: 'pay.cancel' })
    expect(cancel.result).toMatchObject({ status: 'accepted' })
    expect(await stored(cancelled.id)).toMatchObject({ state: 'cancelling', form_values: null })
    expect(queued.at(-1)).toMatchObject({ job: 'prepare' })
    expect(
      await worker({
        type: 'payment.settle',
        paymentId: cancelled.id,
        from: 'cancelling',
        reason: 'cancelled',
      }),
    ).toMatchObject({ details: { state: 'released' } })
    // Cancel ungreys.
    expect((await bill()).every((line) => !line.beingPaid)).toBe(true)

    // The provider dropped it.
    const dropped = await awaiting()
    expect(await check(dropped.id, 1_000, { status: 'released', heldMinor: 0 })).toMatchObject({
      details: { state: 'released' },
    })
    expect(await stored(dropped.id)).toMatchObject({ form_values: null, reason: 'expired' })

    // The deadline passed.
    const late = await awaiting()
    await world.owner.query(
      `update restro.payments set confirm_by = now() - interval '1 second' where id = $1`,
      [late.id],
    )
    expect(await check(late.id, 1_000, { status: 'awaiting_guest', heldMinor: 0 })).toMatchObject({
      details: { state: 'cancelling' },
    })
    expect(await stored(late.id)).toMatchObject({ form_values: null, reason: 'expired' })
    await worker({
      type: 'payment.settle',
      paymentId: late.id,
      from: 'cancelling',
      reason: 'cancelled',
    })

    // Held.
    const held = await awaiting()
    await check(held.id, 1_000)
    expect(await stored(held.id)).toMatchObject({ state: 'held', form_values: null })
  })

  it('stretches the confirm deadline while the bank asks the guest for a step', async () => {
    const { id } = await awaiting()
    await world.owner.query(
      `update restro.payments set confirm_by = now() - interval '1 second' where id = $1`,
      [id],
    )
    expect(
      await check(id, 1_000, { status: 'awaiting_guest', heldMinor: 0, needsGuestAction: true }),
    ).toMatchObject({ details: { state: 'awaiting_guest' } })
    const { rows } = await world.owner.query<{ stretched: boolean }>(
      'select confirm_by = session_ends_at as stretched from restro.payments where id = $1',
      [id],
    )
    expect(rows[0]?.stretched).toBe(true)
    // At the session's limit it is cancelled, the bank's step or not (#112).
    await world.owner.query(
      `update restro.payments set session_ends_at = now() - interval '1 second' where id = $1`,
      [id],
    )
    expect(
      await check(id, 1_000, { status: 'awaiting_guest', heldMinor: 0, needsGuestAction: true }),
    ).toMatchObject({ details: { state: 'cancelling' } })
    expect(await stored(id)).toMatchObject({ reason: 'expired', form_values: null })
    await worker({ type: 'payment.settle', paymentId: id, from: 'cancelling', reason: 'cancelled' })
  })

  describe('refusals', () => {
    const refusal = async (answer: Awaited<ReturnType<ReturnType<typeof phone>['act']>>) => {
      expect(answer.result.status).toBe('rejected')
      expect(answer.handle).toBeNull()
      return answer.result.code
    }

    it('paying_not_offered, paying_paused: the venue takes no card payments now', async () => {
      await setAccount(null)
      expect(await refusal(await start(phone(), ['L1']))).toBe('paying_not_offered')
      await setAccount('connecting')
      expect(await refusal(await start(phone(), ['L1']))).toBe('paying_not_offered')
      await setAccount('lost_access')
      expect(await refusal(await start(phone(), ['L1']))).toBe('paying_paused')
      // The provider's breaker (#112): paying pauses at the venue, connected or not.
      await setAccount('connected')
      await world.owner.query(
        'update restro.payment_accounts set paying_paused_at = now() where venue_id = $1',
        [world.venueId],
      )
      try {
        expect(await refusal(await start(phone(), ['L1']))).toBe('paying_paused')
      } finally {
        await world.owner.query(
          'update restro.payment_accounts set paying_paused_at = null where venue_id = $1',
          [world.venueId],
        )
      }
    })

    it('paying_not_offered while any check of D125 2.3 is missing, even with the account connected (#109)', async () => {
      const tick = { at: '2026-10-27T00:00:00Z', by: 'system' }
      const ready = {
        cardPayments: true,
        ticks: { cardTypeInTill: tick, receiptEmailsOff: tick },
      }
      const setChecks = (checks: unknown) =>
        world.owner.query(
          'update restro.payment_accounts set checks = $2::jsonb where venue_id = $1',
          [world.venueId, JSON.stringify(checks)],
        )
      // The legal details as seeded: put back in the `finally`, so one failed assertion here can not
      // leave every later test with paying off.
      const kept = (
        await world.owner.query<{ legal: unknown }>(
          `select settings -> 'legalDetails' as legal from restro.venues where id = $1`,
          [world.venueId],
        )
      ).rows[0]?.legal
      const restoreLegal = () =>
        world.owner.query(
          `update restro.venues set settings = jsonb_set(settings, '{legalDetails}', $2::jsonb) where id = $1`,
          [world.venueId, JSON.stringify(kept)],
        )
      try {
        for (const checks of [
          {},
          { ...ready, cardPayments: false },
          { ...ready, ticks: { cardTypeInTill: null, receiptEmailsOff: tick } },
          { ...ready, ticks: { cardTypeInTill: tick, receiptEmailsOff: null } },
        ]) {
          await setChecks(checks)
          expect(await refusal(await start(phone(), ['L1']))).toBe('paying_not_offered')
        }
        // Every check but the legal details: with one detail missing paying is not offered (#198).
        await setChecks(ready)
        for (const field of ['name', 'eik', 'address', 'privacyUrl']) {
          await world.owner.query(
            `update restro.venues set settings = jsonb_set(settings, '{legalDetails}', (settings -> 'legalDetails') - $2::text) where id = $1`,
            [world.venueId, field],
          )
          expect(await refusal(await start(phone(), ['L1'])), field).toBe('paying_not_offered')
          await restoreLegal()
        }
        await world.owner.query(
          `update restro.venues set settings = settings - 'legalDetails' where id = $1`,
          [world.venueId],
        )
        expect(await refusal(await start(phone(), ['L1']))).toBe('paying_not_offered')
        await restoreLegal()
        // Every check but the payment tables: the till's table is no longer marked.
        await setChecks(ready)
        await world.owner.query('update restro.tables set is_payment_table = false where id = $1', [
          world.tables[3],
        ])
        expect(await refusal(await start(phone(), ['L1']))).toBe('paying_not_offered')
      } finally {
        await restoreLegal()
        await setChecks(ready)
        await world.owner.query('update restro.tables set is_payment_table = true where id = $1', [
          world.tables[3],
        ])
      }
      // All four pass: a payment starts.
      paymentIdOf(await start(phone(), ['L1']))
    })

    it('payment_in_flight: the owner can not disconnect while a payment is not final (#109)', async () => {
      const ownerId = await world.addUser('owner')
      const disconnect = async () =>
        (
          await applyService(
            world.app,
            { type: 'payment_account.disconnect' },
            {
              tenantId: world.tenantId,
              venueId: world.venueId,
              origin: 'staff',
              actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
              jobId: `req-${randomUUID()}`,
              signedInAt: new Date(),
            },
          )
        ).result
      const id = paymentIdOf(await start(phone(), ['L1']))
      expect(await disconnect()).toMatchObject({ status: 'refused', code: 'payment_in_flight' })
      await world.owner.query(
        `update restro.payments set state = 'released', reason = 'test', form_values = null, settled_at = now() where id = $1`,
        [id],
      )
      expect(await disconnect()).toMatchObject({
        status: 'accepted',
        details: { state: 'disconnected' },
      })
    })

    it('being_paid: a line in another payment that is not final', async () => {
      paymentIdOf(await start(phone(), ['L1']))
      expect(await refusal(await start(phone(), ['L1', 'L2']))).toBe('being_paid')
      expect(await refusal(await start(phone(), 'whole'))).toBe('being_paid')
      // Another line is free.
      paymentIdOf(await start(phone(), ['L2']))
    })

    it('bill_changed: a line that went or changed since the phone saw it', async () => {
      const shown = await bill()
      const first = shown[0] as BillLine
      const knock = (amountMinor: number, lineId = first.id) =>
        phone().act({
          type: 'pay.start',
          pick: { kind: 'lines', lines: [{ lineId, quantity: first.quantity }] },
          seen: [{ lineId, quantity: first.quantity, amountMinor }],
          tipMinor: null,
          tipPercent: null,
        })
      expect(await refusal(await knock(999))).toBe('bill_changed')
      expect(await refusal(await knock(first.amountMinor, newId('bn')))).toBe('bill_changed')
      // The whole bill, seen with one line fewer.
      const whole = await phone().act({
        type: 'pay.start',
        pick: { kind: 'whole' },
        seen: [{ lineId: first.id, quantity: first.quantity, amountMinor: first.amountMinor }],
        tipMinor: null,
        tipPercent: null,
      })
      expect(await refusal(whole)).toBe('bill_changed')
    })

    it('below_minimum: below the venue floor', async () => {
      await world.owner.query(
        `update restro.venues set settings = jsonb_set(settings, '{paying}', '{"minCardMinor": 500}') where id = $1`,
        [world.venueId],
      )
      expect(await refusal(await start(phone(), ['L3']))).toBe('below_minimum')
      paymentIdOf(await start(phone(), ['L1']))
    })

    it('invalid_command: a tip given as an amount above the picked lines', async () => {
      expect(await refusal(await start(phone(), ['L3'], { tipMinor: 301 }))).toBe('invalid_command')
      const id = paymentIdOf(await start(phone(), ['L3'], { tipMinor: 300 }))
      expect((await stored(id))?.tip_minor).toBe('300')
    })

    it('tells the phone who the payment is processed for: the four public legal fields and nothing else (#198, rule 3)', async () => {
      expect((await friendState()).ordering.payingLegal).toStrictEqual({
        name: 'Club EOOD',
        eik: '123456789',
        address: 'Sofia, 1 Vitosha Blvd',
        privacyUrl: 'https://club.example/privacy',
      })
    })

    it('tip_not_offered: a tip where the POS records none on the close (D127)', async () => {
      await world.declareCapabilities({ recordTipOnClose: false })
      try {
        expect((await friendState()).ordering).toMatchObject({ tips: false })
        expect(await refusal(await start(phone(), ['L3'], { tipPercent: 10 }))).toBe(
          'tip_not_offered',
        )
        // No tip is still a payment.
        paymentIdOf(await start(phone(), ['L3']))
      } finally {
        await world.declareCapabilities({ recordTipOnClose: true })
      }
      expect((await friendState()).ordering).toMatchObject({ tips: true })
    })

    it('ask_waiter_to_split: part of a line', async () => {
      const first = (await bill())[0] as BillLine
      const part = await phone().act({
        type: 'pay.start',
        pick: { kind: 'lines', lines: [{ lineId: first.id, quantity: '1' }] },
        seen: [{ lineId: first.id, quantity: first.quantity, amountMinor: first.amountMinor }],
        tipMinor: null,
        tipPercent: null,
      })
      expect(await refusal(part)).toBe('ask_waiter_to_split')
    })

    it('ask_waiter_to_split: any pick on a bill with a whole-bill discount (D122 §8)', async () => {
      // Two 20.00 lines, 36.00 on the bill: the lines alone would hold the full prices.
      await record(
        [
          { pos: 'L1', quantity: '1', amountMinor: 2_000 },
          { pos: 'L2', quantity: '1', amountMinor: 2_000 },
        ],
        3_600,
      )
      expect(await refusal(await start(phone(), ['L1']))).toBe('ask_waiter_to_split')
      expect(await refusal(await start(phone(), ['L1', 'L2']))).toBe('ask_waiter_to_split')
      expect(await refusal(await start(phone(), 'whole'))).toBe('ask_waiter_to_split')
      const open = await world.owner.query(
        'select 1 from restro.payments where table_id = $1 and settled_at is null',
        [tableId],
      )
      expect(open.rowCount).toBe(0)
    })

    it('turnstile: the check said no, fail closed', async () => {
      human = async () => 'failed'
      expect(await refusal(await start(phone(), ['L1']))).toBe('turnstile')
      human = async () => 'unavailable'
      paymentIdOf(await start(phone(), ['L1']))
    })

    it("rate_limited: the phone's open payment, and the table's three", async () => {
      const payer = phone()
      paymentIdOf(await start(payer, ['L1']))
      expect(await refusal(await start(payer, ['L2']))).toBe('rate_limited')
      paymentIdOf(await start(phone(), ['L2']))
      paymentIdOf(await start(phone(), ['L3']))
      await record([...LINES, { pos: 'L4', quantity: '1', amountMinor: 200 }])
      const shown = await bill()
      const fourth = shown[3] as BillLine
      const answer = await phone().act({
        type: 'pay.start',
        pick: { kind: 'lines', lines: [{ lineId: fourth.id, quantity: fourth.quantity }] },
        seen: [{ lineId: fourth.id, quantity: fourth.quantity, amountMinor: fourth.amountMinor }],
        tipMinor: null,
        tipPercent: null,
      })
      expect(await refusal(answer)).toBe('rate_limited')
    })

    it('sitting_ended: the table has no open sitting', async () => {
      const lines = await bill()
      await world.owner.query(
        'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
        [tableId, 'staff_closed'],
      )
      const first = lines[0] as BillLine
      const answer = await phone().act({
        type: 'pay.start',
        pick: { kind: 'lines', lines: [{ lineId: first.id, quantity: first.quantity }] },
        seen: [{ lineId: first.id, quantity: first.quantity, amountMinor: first.amountMinor }],
        tipMinor: null,
        tipPercent: null,
      })
      expect(await refusal(answer)).toBe('sitting_ended')
    })

    it('too_late, unknown_payment: a cancel after the hold, and one without the handle', async () => {
      const { id, who } = await awaiting()
      await check(id, 1_000)
      expect(await refusal(await who.act({ type: 'pay.cancel' }))).toBe('too_late')

      const stranger = phone()
      expect(await refusal(await stranger.act({ type: 'pay.cancel' }))).toBe('unknown_payment')
      stranger.handle = 'B'.repeat(22)
      expect(await refusal(await stranger.act({ type: 'pay.returned' }))).toBe('unknown_payment')
    })
  })

  describe('races', () => {
    it('two friends picking the same line: one pays it, the other is told it is being paid', async () => {
      await bill()
      const [a, b] = await Promise.all([start(phone(), ['L1']), start(phone(), ['L1', 'L2'])])
      const outcomes = [a.result, b.result].map((result) => result.code ?? result.status).sort()
      expect(outcomes).toEqual(['accepted', 'being_paid'])
      const { rows } = await world.owner.query<{ n: string }>(
        `select count(*) as n from restro.payment_lines pl join restro.payments p on p.id = pl.payment_id
          where p.table_id = $1 and pl.open`,
        [tableId],
      )
      expect(Number(rows[0]?.n)).toBe(a.result.status === 'accepted' ? 1 : 2)
    })

    it('a notice and pay.returned together: one moves it to held, the other changes nothing', async () => {
      const { id } = await awaiting()
      const results = await Promise.all([check(id, 1_000), check(id, 1_000)])
      expect(results.map((result) => result.details.changed).sort()).toEqual([false, true])
      expect(await stored(id)).toMatchObject({ state: 'held', form_values: null })
    })

    it('a cancel and the hold together: exactly one wins', async () => {
      const { id, who } = await awaiting()
      const [cancel, held] = await Promise.all([who.act({ type: 'pay.cancel' }), check(id, 1_000)])
      const row = await stored(id)
      if (row?.state === 'held') {
        expect(cancel.result).toMatchObject({ status: 'rejected', code: 'too_late' })
        expect(held.details).toMatchObject({ state: 'held', changed: true })
      } else {
        expect(row?.state).toBe('cancelling')
        expect(cancel.result.status).toBe('accepted')
        expect(held.details).toMatchObject({ state: 'cancelling', changed: false })
      }
      expect(row?.form_values).toBeNull()
    })
  })
})
