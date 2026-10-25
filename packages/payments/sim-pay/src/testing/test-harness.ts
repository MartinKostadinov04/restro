// The simulated provider's harness for the payment conformance suite
// (`@restro/core/connectors/payment-testing`). A `test-*` helper: only tests import it.

import type { PaymentHarness } from '@restro/core/connectors/payment-testing'

import { ManualClock } from '../clock'
import { SimPayEngine, type SimPaySwitches } from '../engine'
import { simPayNotice } from '../notices'
import { createSimPayProvider } from '../provider'

export interface SimPayHarnessOptions {
  readonly name: string
  readonly switches?: Partial<SimPaySwitches>
}

/**
 * A fresh engine with two connected accounts (the suite's, and another whose reads must see none
 * of its objects), behind the provider, with every fault and the venue's and bank's actions wired.
 */
export function simPayHarness(options: SimPayHarnessOptions): PaymentHarness & {
  readonly engine: SimPayEngine
  readonly clock: ManualClock
} {
  const clock = new ManualClock()
  const engine = new SimPayEngine({ clock, switches: options.switches })
  const account = engine.addAccount()
  const otherAccount = engine.addAccount()
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
    outside: {
      refundsInDashboard: async (accountRef, paymentRef, amountMinor) =>
        simPayNotice(engine.venue.refundsInDashboard(accountRef, paymentRef, amountMinor)),
      bankOpensDispute: async (accountRef, paymentRef) =>
        simPayNotice(engine.bank.opensDispute(accountRef, paymentRef)),
      disputeCloses: async (accountRef, disputeRef, outcome) =>
        simPayNotice(engine.bank.closesDispute(accountRef, disputeRef, outcome)),
    },
    otherAccount,
  }
}
