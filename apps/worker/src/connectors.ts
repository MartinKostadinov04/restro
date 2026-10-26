// The worker's names for the first connector's tables (D82, D67): a venue of ours serves one till
// venue (`tillVenueLinks`). Platform code in the worker (the purge job) reads and erases the links
// under this name, so no vendor word reaches it; the columns are the connector's own. The same
// pair apps/web keeps in src/connectors/till-venues.ts and core in
// packages/core/src/connectors/till-venues.ts.

import type { PaymentProvider } from '@restro/core'
import { createStripeProvider, STRIPE_KIND } from '@restro/stripe'

export { barsyVenues as tillVenueLinks } from '@restro/db'

/** The payment providers the worker pays through, by kind (`payments.provider_kind`). */
export type PaymentProviders = ReadonlyMap<string, PaymentProvider>

/**
 * The payment providers the worker pays through (#110) and reads notices back from (#108), by kind, built from the
 * worker's configuration (#107). Stripe is built when `STRIPE_SECRET_KEY` is set (the platform's
 * secret or restricted key), checked against `PAYMENTS_ENV`: a live key only in production, a test
 * key never there, and a key without a valid `PAYMENTS_ENV` stops the worker at start
 * (`StripeConfigError`, which never carries the key). A stored notice of a provider not listed
 * waits (`provider-notices`), and the job logs it once it is a day old.
 */
export function paymentProviders(env: NodeJS.ProcessEnv = process.env): PaymentProviders {
  const providers = new Map<string, ReturnType<typeof createStripeProvider>>()
  const stripeKey = env.STRIPE_SECRET_KEY
  if (stripeKey !== undefined && stripeKey !== '') {
    providers.set(
      STRIPE_KIND,
      createStripeProvider({ env: env.PAYMENTS_ENV ?? '', key: stripeKey }),
    )
  }
  return providers
}
