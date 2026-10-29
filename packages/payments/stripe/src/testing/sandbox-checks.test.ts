// The pilot's sandbox checks 1-3 (#117, D127 design §13) against "Restro Sandbox", on a connected
// test account, with the real restricted key. Skipped unless asked for, and never run in CI:
//
//   STRIPE_SANDBOX_CHECKS=run STRIPE_SANDBOX_ENV_FILE=<path of a .env file with the keys> \
//     pnpm vitest run --project packages/payments/stripe src/testing/sandbox-checks.test.ts
//
// `STRIPE_SECRET_KEY` is the platform's restricted key (what the app runs on); `STRIPE_HARNESS_KEY`
// is the harness's own key, used only to read the balance (the platform's key may not). Both must
// be sandbox keys, or the run stops before any request. The run prints request ids and object ids
// as `EVIDENCE` lines, never a key. `STRIPE_HARNESS_ACCOUNT` names the connected account.

import { appendFileSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

import { newId, providerRef } from '@restro/core'
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { stripeKeyMode } from '../config'
import { createStripeProvider, STRIPE_API_VERSION } from '../provider'

const RUN = process.env.STRIPE_SANDBOX_CHECKS === 'run'
const ACCOUNT = process.env.STRIPE_HARNESS_ACCOUNT ?? 'acct_1UUjd8H6CXJeKV2v'

if (RUN && process.env.STRIPE_SANDBOX_ENV_FILE) loadEnvFile(process.env.STRIPE_SANDBOX_ENV_FILE)

function sandboxKey(name: string): string {
  // `.env.local` has had `NAME =` (a space) before; take either spelling.
  const key = process.env[name] ?? process.env[`${name} `] ?? ''
  if (stripeKeyMode(key) !== 'test') throw new Error(`${name} is not a sandbox key: stopping`)
  return key
}

function client(key: string): Stripe {
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 0, telemetry: false })
}

const on = { stripeAccount: ACCOUNT }

interface Refusal {
  readonly statusCode?: number
  readonly code?: string
  readonly requestId?: string
}

/** What Stripe refused a call with, or null when the call went through. */
async function refusalOf(call: () => Promise<unknown>): Promise<Refusal | null> {
  try {
    await call()
    return null
  } catch (error) {
    return error as Refusal
  }
}

/** One evidence line: printed, and appended to `STRIPE_SANDBOX_EVIDENCE_FILE` where set. */
function note(line: string): void {
  console.log(line)
  if (process.env.STRIPE_SANDBOX_EVIDENCE_FILE) {
    appendFileSync(
      process.env.STRIPE_SANDBOX_EVIDENCE_FILE,
      `${line}
`,
    )
  }
}

function evidence(check: string, what: string, request: unknown, ...ids: string[]): void {
  const requestId =
    (request as { lastResponse?: { requestId?: string } }).lastResponse?.requestId ??
    (request as { requestId?: string }).requestId
  note(`EVIDENCE ${check} | ${what} | request ${requestId ?? '?'} | ${ids.join(' ')}`)
}

describe.skipIf(!RUN)('sandbox checks 1-3 (#117)', () => {
  const platform = RUN ? client(sandboxKey('STRIPE_SECRET_KEY')) : (null as never)
  const harness = RUN ? client(sandboxKey('STRIPE_HARNESS_KEY')) : (null as never)

  /** A manual-capture card hold, as the provider makes it, confirmed with a test card. */
  async function hold(check: string, amount: number) {
    const created = await platform.paymentIntents.create(
      {
        amount,
        currency: 'eur',
        capture_method: 'manual',
        allowed_payment_method_types: ['card'],
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        metadata: { restro_payment_id: newId('py') },
        description: `sandbox check ${check}`,
      },
      on,
    )
    expect(created.livemode).toBe(false)
    evidence(check, `create ${amount}`, created, created.id)
    const confirmed = await platform.paymentIntents.confirm(
      created.id,
      { payment_method: 'pm_card_amex_threeDSecureNotSupported' },
      on,
    )
    evidence(check, 'confirm with the test card', confirmed, confirmed.id)
    expect(confirmed.status).toBe('requires_capture')
    return confirmed
  }

  async function chargeTransactions(chargeId: string) {
    const list = await harness.balanceTransactions.list({ source: chargeId, limit: 10 }, on)
    evidence('balance', 'transactions of the charge', list, chargeId, `count=${list.data.length}`)
    return list.data
  }

  it('check 1+2: the key creates, reads with latest_charge, captures in full and in part, and cannot refund', async () => {
    const full = await hold('2', 1000)
    expect(full.amount_capturable).toBe(1000)

    const read = await platform.paymentIntents.retrieve(full.id, { expand: ['latest_charge'] }, on)
    evidence('1', 'read with expand[]=latest_charge', read, read.id)
    const heldCharge = read.latest_charge as Stripe.Charge
    expect(typeof heldCharge).toBe('object')
    expect(heldCharge.captured).toBe(false)
    const captureBefore = (heldCharge.payment_method_details?.card as { capture_before?: number })
      ?.capture_before
    note(`EVIDENCE 2 | capture_before present on the held charge: ${captureBefore != null}`)

    const captured = await platform.paymentIntents.capture(
      full.id,
      { amount_to_capture: 1000, expand: ['latest_charge'] },
      on,
    )
    evidence('1', 'capture', captured, captured.id)
    expect(captured.status).toBe('succeeded')
    expect(captured.amount_received).toBe(1000)
    const fullCharge = captured.latest_charge as Stripe.Charge
    expect(fullCharge.amount_captured).toBe(1000)
    const moved = await chargeTransactions(fullCharge.id)
    expect(moved.map((t) => [t.type, t.amount])).toContainEqual(['charge', 1000])

    // The refund the key must not be able to make (D122 §8), by payment and by charge.
    for (const params of [{ payment_intent: full.id }, { charge: fullCharge.id }]) {
      const refused = await refusalOf(() => platform.refunds.create({ ...params, amount: 100 }, on))
      expect(refused, 'the refund must be refused').not.toBeNull()
      evidence(
        '1',
        `POST /v1/refunds by ${Object.keys(params)[0]} refused ${refused?.statusCode} ${refused?.code}`,
        refused,
        full.id,
      )
      expect(refused?.statusCode).toBe(403)
    }
    const after = await platform.charges.retrieve(fullCharge.id, {}, on)
    expect(after.amount_refunded).toBe(0)
    expect(after.refunded).toBe(false)

    // A partial capture: 600 of a 1000 hold; the rest is released.
    const partial = await hold('2', 1000)
    const part = await platform.paymentIntents.capture(
      partial.id,
      { amount_to_capture: 600, expand: ['latest_charge'] },
      on,
    )
    evidence('2', 'capture 600 of 1000', part, part.id)
    expect(part.status).toBe('succeeded')
    expect(part.amount_received).toBe(600)
    expect(part.amount_capturable).toBe(0)
    const partCharge = part.latest_charge as Stripe.Charge
    expect(partCharge.amount_captured).toBe(600)
    const partMoved = await chargeTransactions(partCharge.id)
    expect(partMoved.map((t) => [t.type, t.amount])).toEqual([['charge', 600]])
  }, 120_000)

  it('check 1+3: the key cancels a hold and the balance does not move', async () => {
    const held = await hold('3', 1000)
    const chargeId = held.latest_charge as string
    const cancelled = await platform.paymentIntents.cancel(
      held.id,
      { expand: ['latest_charge'] },
      on,
    )
    evidence('1', 'cancel', cancelled, cancelled.id)
    expect(cancelled.status).toBe('canceled')
    expect(cancelled.amount_received).toBe(0)
    const charge = cancelled.latest_charge as Stripe.Charge
    expect(charge.id).toBe(chargeId)
    expect(charge.captured).toBe(false)
    note(
      `EVIDENCE 3 | cancelled hold's charge: captured=${charge.captured} refunded=${charge.refunded} amount_captured=${charge.amount_captured} balance_transaction=${String(charge.balance_transaction)}`,
    )
    expect(await chargeTransactions(chargeId)).toEqual([])

    // Nothing more can be captured on it.
    const refused = await refusalOf(() => platform.paymentIntents.capture(held.id, {}, on))
    evidence('3', `capture after cancel refused ${refused?.code}`, refused, held.id)
    expect(refused?.code).toBe('payment_intent_unexpected_state')
  }, 120_000)

  it('check 1: the provider code path with the real key', async () => {
    const provider = createStripeProvider({ env: 'test', key: sandboxKey('STRIPE_SECRET_KEY') })
    const account = providerRef(ACCOUNT)
    const paymentId = newId('py')
    const created = await provider.createHold({
      paymentId,
      accountRef: account,
      amountMinor: 1000,
      currency: 'EUR',
      idempotencyKey: `sandbox-check-${paymentId}-create`,
      description: 'sandbox check provider',
    })
    expect(created.kind).toBe('done')
    if (created.kind !== 'done') return
    const paymentRef = created.result.paymentRef
    await platform.paymentIntents.confirm(
      paymentRef.provider,
      { payment_method: 'pm_card_amex_threeDSecureNotSupported' },
      on,
    )
    const read = await provider.readPayment(account, paymentRef)
    expect(read.complete && read.value.status).toBe('held')
    const captured = await provider.capture({
      accountRef: account,
      paymentRef,
      amountMinor: 600,
      idempotencyKey: `sandbox-check-${paymentId}-capture`,
    })
    expect(captured.kind).toBe('done')
    if (captured.kind === 'done') {
      expect(captured.result.capturedMinor).toBe(600)
      note(`EVIDENCE 1 | provider create/read/capture(600 of 1000) done | ${paymentRef.provider}`)
    }

    const second = newId('py')
    const hold2 = await provider.createHold({
      paymentId: second,
      accountRef: account,
      amountMinor: 1000,
      currency: 'EUR',
      idempotencyKey: `sandbox-check-${second}-create`,
      description: 'sandbox check provider',
    })
    expect(hold2.kind).toBe('done')
    if (hold2.kind !== 'done') return
    await platform.paymentIntents.confirm(
      hold2.result.paymentRef.provider,
      { payment_method: 'pm_card_amex_threeDSecureNotSupported' },
      on,
    )
    const released = await provider.release({
      accountRef: account,
      paymentRef: hold2.result.paymentRef,
      idempotencyKey: `sandbox-check-${second}-release`,
    })
    expect(released.kind).toBe('done')
    note(`EVIDENCE 1 | provider release done | ${hold2.result.paymentRef.provider}`)
  }, 120_000)
})
