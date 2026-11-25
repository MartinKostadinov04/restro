// The payment conformance suite on the simulated provider (#103 acceptance): every fault the
// suite knows is wired, so each runs in turn, on the cautious switches and with the choices a
// real provider may make the other way (no partial capture, wallets, refund notices).
//
// The one refund Restro makes (`refundLine`, the 11-18 refund decision, 148) is handed to the suite
// here, in a test file, so the conformance kit itself never calls a refund (`scripts/no-refunds.test.ts`).

import { paymentProviderSuite } from '@restro/core/connectors/payment-testing'

import { simPayHarness } from './testing'

type Harness = ReturnType<typeof simPayHarness>

/** The harness with the provider's refund step, for the refund check. */
function withLineRefund(harness: Harness): Harness {
  return { ...harness, lineRefund: (request) => harness.provider.refundLine(request) }
}

paymentProviderSuite(withLineRefund(simPayHarness({ name: 'sim-pay cautious' })))
paymentProviderSuite(
  withLineRefund(
    simPayHarness({
      name: 'sim-pay, no partial capture, wallets, refund notices',
      switches: {
        partialCapture: false,
        wallets: ['apple_pay', 'google_pay'],
        refundNotices: true,
      },
    }),
  ),
)
