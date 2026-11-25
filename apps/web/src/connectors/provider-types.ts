// What the Paying settings ask of a payment provider's web folder (#116): the name that fills
// `{provider}` in the interface and its smallest charge. Each `./<kind>/provider.ts` exports one as
// `providerInfo`; `./providers.ts` finds them.
import type { Currency } from '@restro/core'

/** A payment provider as the owner's settings word it. */
export interface ProviderInfo {
  readonly kind: string
  /** The name for `{provider}`. */
  readonly label: string
  /** True for the simulator: never chosen by default. */
  readonly simulated: boolean
  /** The provider's smallest charge in the currency's minor units. */
  minimumMinor(currency: Currency): number
}
