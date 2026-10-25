// The payment conformance suite on the simulated provider (#103 acceptance): every fault the
// suite knows is wired, so each runs in turn, on the cautious switches and with the choices a
// real provider may make the other way (no partial capture, wallets, refund notices).

import { paymentProviderSuite } from '@restro/core/connectors/payment-testing'

import { simPayHarness } from './testing'

paymentProviderSuite(simPayHarness({ name: 'sim-pay cautious' }))
paymentProviderSuite(
  simPayHarness({
    name: 'sim-pay, no partial capture, wallets, refund notices',
    switches: { partialCapture: false, wallets: ['apple_pay', 'google_pay'], refundNotices: true },
  }),
)
