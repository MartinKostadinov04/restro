// The key check (CLAUDE.md rules 7 and 9; #107 acceptance): a live key runs only in production,
// a test key never does. Stripe tells the two apart by the key's prefix: `sk_live_` / `rk_live_`
// for live mode, `sk_test_` / `rk_test_` for test mode and sandboxes
// (https://docs.stripe.com/keys.md). No error here ever carries the key, nor any part of it.

/** The deployment environments a payment provider may run in (`PAYMENTS_ENV`). */
export const STRIPE_ENVS = ['development', 'test', 'staging', 'production'] as const
export type StripeEnv = (typeof STRIPE_ENVS)[number]

export class StripeConfigError extends Error {
  override name = 'StripeConfigError'
}

/** Which mode a key is for, from its prefix; null for anything that is not a secret or restricted key. */
export function stripeKeyMode(key: string): 'live' | 'test' | null {
  const match = /^(?:sk|rk)_(live|test)_[A-Za-z0-9]+$/.exec(key)
  return match === null ? null : (match[1] as 'live' | 'test')
}

/**
 * The key, checked against the environment. Throws `StripeConfigError` for an unknown
 * environment, a value that is not a secret or restricted key (a publishable key included), a
 * live key outside production, or a test key in production.
 */
export function checkStripeKey(env: string, key: string): { env: StripeEnv; key: string } {
  if (!(STRIPE_ENVS as readonly string[]).includes(env)) {
    throw new StripeConfigError(
      `the payments environment must be one of: ${STRIPE_ENVS.join(', ')}`,
    )
  }
  const mode = stripeKeyMode(key)
  if (mode === null) {
    throw new StripeConfigError('the provider key is not a secret or restricted key')
  }
  if (mode === 'live' && env !== 'production') {
    throw new StripeConfigError(`a live key is refused in ${env}: only production takes one`)
  }
  if (mode === 'test' && env === 'production') {
    throw new StripeConfigError('a test key is refused in production')
  }
  return { env: env as StripeEnv, key }
}

/** Removes anything key-like or secret-like from a text the provider will log or store. */
export function withoutSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9*]+/g, '[key]')
    .replace(/\b(pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[client secret]')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, '[secret]')
}
