// The Stripe payment provider (#107; D126, D127 §Interfaces): the `PaymentProvider` of
// `@restro/core` over Stripe's API, on the venue's own account (direct charges, Accounts v2).
// Only apps/worker and tests import it (dependency-cruiser, `payments-only-from-worker`); the key
// check refuses a live key outside production and a test key in production.

export {
  checkStripeKey,
  STRIPE_ENVS,
  StripeConfigError,
  type StripeEnv,
  stripeKeyMode,
} from './config'
export {
  createStripeProvider,
  STRIPE_API_VERSION,
  STRIPE_CAPABILITIES,
  STRIPE_KIND,
  type StripeProviderOptions,
} from './provider'
