// The simulated provider's harness for the payment conformance suite
// (`@restro/core/connectors/payment-testing`). A `test-*` helper: only tests import it.

import type { PaymentHarness } from '@restro/core/connectors/payment-testing'

import { ManualClock } from '../clock'
import { SimPayEngine, type SimPaySwitches } from '../engine'
import { createSimPayProvider } from '../provider'

export interface SimPayHarnessOptions {
  readonly name: string
  readonly switches?: Partial<SimPaySwitches>
}

/** A fresh engine with one connected account, behind the provider, with every fault wired. */
export function simPayHarness(options: SimPayHarnessOptions): PaymentHarness & {
  readonly engine: SimPayEngine
  readonly clock: ManualClock
} {
  const clock = new ManualClock()
  const engine = new SimPayEngine({ clock, switches: options.switches })
  const account = engine.addAccount()
  const provider = createSimPayProvider({ env: 'test', engine })
  return {
    name: options.name,
    engine,
    clock,
    provider,
    account,
    currency: 'EUR',
    guestHost: 'pay.restro.test',
    reset: () => engine.clearFaults(),
    movedMinor: async () => engine.movedMinor(account),
    guest: {
      pay: async ({ paymentRef }) => engine.guest.pay(paymentRef),
      completeStep: async ({ paymentRef }) => engine.guest.completeStep(paymentRef),
      decline: async ({ paymentRef }) => engine.guest.decline(paymentRef),
    },
    faults: {
      landThenTimeOut: (step) => engine.fault(step, { kind: 'land_then_timeout' }),
      timeOutBeforeLanding: (step) => engine.fault(step, { kind: 'timeout_before' }),
      refuseNext: (step) => engine.fault(step, { kind: 'refuse' }),
      storeServerError: (step) => engine.fault(step, { kind: 'server_error' }),
      nextHoldNeedsStep: () => engine.nextHoldNeedsStep(),
      passCaptureBefore: async (accountRef, paymentRef) => {
        const reading = await provider.readPayment(accountRef, paymentRef)
        if (!reading.complete || reading.value.captureBefore === null) {
          throw new Error('the payment has no captureBefore to pass')
        }
        clock.set(reading.value.captureBefore)
      },
      failReads: () => engine.failReads(),
    },
  }
}
