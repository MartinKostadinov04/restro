// What the owner's Paying settings need to know about Stripe (#116): its name for `{provider}` in the
// interface (D82, D127) and its smallest charge. The web app never imports the provider's package
// (only the worker does), so the minimum is written here from the same page the package cites:
// https://docs.stripe.com/currencies.md#minimum-and-maximum-charge-amounts (EUR 0.50).
import type { Currency } from '@restro/core'

import type { ProviderInfo } from '../provider-types'

const MINIMUM_MINOR: { readonly [C in Currency]: number } = { EUR: 50 }

export const providerInfo: ProviderInfo = {
  kind: 'stripe',
  label: 'Stripe',
  simulated: false,
  minimumMinor: (currency) => MINIMUM_MINOR[currency],
}
