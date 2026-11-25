// The property test of #103's acceptance (fast-check): across random sequences of create, read,
// capture and release, with faults switched on in between, the captured amount never exceeds the
// held amount, money moves only by capture, and a repeated key never creates a second payment.

import {
  addMinor,
  newId,
  type PaymentId,
  ProviderPaymentSchema,
  type ProviderRef,
  sameProviderRef,
} from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ManualClock } from './clock'
import { SimPayEngine, type SimPayFault, type SimPayStep } from './engine'
import { createSimPayProvider } from './provider'

const STEPS: readonly SimPayStep[] = ['createHold', 'capture', 'release']
const FAULTS: readonly SimPayFault[] = [
  { kind: 'land_then_timeout' },
  { kind: 'timeout_before' },
  { kind: 'refuse' },
  { kind: 'server_error' },
]

type Op =
  | { readonly op: 'create'; readonly p: number; readonly k: number; readonly amount: number }
  | { readonly op: 'pay'; readonly p: number }
  | { readonly op: 'capture'; readonly p: number; readonly k: number; readonly amount: number }
  | { readonly op: 'release'; readonly p: number; readonly k: number }
  | { readonly op: 'read'; readonly p: number }
  | { readonly op: 'fault'; readonly step: number; readonly fault: number }
  | { readonly op: 'time'; readonly hours: number }

const payment = fc.integer({ min: 0, max: 2 })
const key = fc.integer({ min: 0, max: 1 })
const amount = fc.integer({ min: 1, max: 6_000 })

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('create' as const), p: payment, k: key, amount }),
  fc.record({ op: fc.constant('pay' as const), p: payment }),
  fc.record({ op: fc.constant('capture' as const), p: payment, k: key, amount }),
  fc.record({ op: fc.constant('release' as const), p: payment, k: key }),
  fc.record({ op: fc.constant('read' as const), p: payment }),
  fc.record({
    op: fc.constant('fault' as const),
    step: fc.integer({ min: 0, max: STEPS.length - 1 }),
    fault: fc.integer({ min: 0, max: FAULTS.length - 1 }),
  }),
  fc.record({ op: fc.constant('time' as const), hours: fc.integer({ min: 1, max: 100 }) }),
)

describe('the simulated provider under random sequences with faults', () => {
  it('never captures above the hold, moves money only by capture, and makes one payment per key', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 20, maxLength: 60, size: 'max' }),
        fc.boolean(),
        async (ops, partial) => {
          const clock = new ManualClock()
          const engine = new SimPayEngine({ clock, switches: { partialCapture: partial } })
          const provider = createSimPayProvider({ env: 'test', engine })
          const accountRef = engine.addAccount()
          const ids: PaymentId[] = [newId('py'), newId('py'), newId('py')]
          /** The payment each create key answered: never two. */
          const byKey = new Map<string, ProviderRef>()
          /** The create keys tried per payment: at most that many payments exist for it. */
          const keysTried = new Map<PaymentId, Set<string>>()
          const refs = new Map<number, ProviderRef>()

          for (const op of ops) {
            if (op.op === 'create') {
              const paymentId = ids[op.p] as PaymentId
              const idempotencyKey = `${paymentId}:hold:${op.k}`
              keysTried.set(paymentId, (keysTried.get(paymentId) ?? new Set()).add(idempotencyKey))
              const outcome = await provider.createHold({
                paymentId,
                accountRef,
                amountMinor: op.amount,
                currency: 'EUR',
                idempotencyKey,
                description: 'Property Bar, table 1',
              })
              if (outcome.kind === 'done') {
                const before = byKey.get(idempotencyKey)
                if (before !== undefined) {
                  expect(sameProviderRef(before, outcome.result.paymentRef)).toBe(true)
                }
                byKey.set(idempotencyKey, outcome.result.paymentRef)
                refs.set(op.p, outcome.result.paymentRef)
              }
            } else if (op.op === 'pay') {
              const ref = refs.get(op.p)
              if (ref === undefined) continue
              const read = await provider.readPayment(accountRef, ref)
              if (read.complete && read.value.status === 'awaiting_guest') engine.guest.pay(ref)
            } else if (op.op === 'capture') {
              const ref = refs.get(op.p)
              if (ref === undefined) continue
              await provider.capture({
                accountRef,
                paymentRef: ref,
                amountMinor: op.amount,
                idempotencyKey: `${ref.provider}:capture:${op.k}`,
              })
            } else if (op.op === 'release') {
              const ref = refs.get(op.p)
              if (ref === undefined) continue
              await provider.release({
                accountRef,
                paymentRef: ref,
                idempotencyKey: `${ref.provider}:release:${op.k}`,
              })
            } else if (op.op === 'read') {
              const found = await provider.findByPaymentId(accountRef, ids[op.p] as PaymentId)
              if (found.complete && found.value !== null) refs.set(op.p, found.value.ref)
            } else if (op.op === 'fault') {
              engine.fault(STEPS[op.step] as SimPayStep, FAULTS[op.fault] as SimPayFault)
            } else {
              clock.advance(op.hours * 3_600_000)
            }

            let captured = 0
            for (const paymentId of ids) {
              const payments = engine.paymentsOf(accountRef, paymentId)
              expect(payments.length).toBeLessThanOrEqual(keysTried.get(paymentId)?.size ?? 0)
              for (const p of payments) {
                expect(ProviderPaymentSchema.safeParse(p).success).toBe(true)
                expect(p.capturedMinor).toBeLessThanOrEqual(p.amountMinor)
                expect(p.heldMinor).toBeLessThanOrEqual(p.amountMinor)
                if (!partial && p.capturedMinor > 0) expect(p.capturedMinor).toBe(p.amountMinor)
                captured = addMinor(captured, p.capturedMinor)
              }
            }
            expect(engine.movedMinor(accountRef)).toBe(captured)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
