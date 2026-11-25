// What the owner's Paying settings need to know about the simulated card provider (#103, #116): the
// name `{provider}` shows and its smallest charge (its switches' default, EUR 0.50). Development,
// test and staging only: the worker refuses it in production.
import type { Currency } from '@restro/core'

import type { ProviderInfo } from '../provider-types'

const MINIMUM_MINOR: { readonly [C in Currency]: number } = { EUR: 50 }

export const providerInfo: ProviderInfo = {
  kind: 'sim-pay',
  label: 'Test card payments',
  simulated: true,
  minimumMinor: (currency) => MINIMUM_MINOR[currency],
}
