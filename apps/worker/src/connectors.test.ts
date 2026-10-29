import { StripeConfigError } from '@restro/stripe'
import { describe, expect, it } from 'vitest'

import { paymentProviders } from './connectors'

// Made-up keys of the right shape: no real key is ever in a test.
const TEST_KEY = `sk_test_${'A1b2C3d4'.repeat(4)}`
const LIVE_KEY = `rk_live_${'Z9y8X7w6'.repeat(4)}`

function refusal(env: NodeJS.ProcessEnv): StripeConfigError {
  try {
    paymentProviders(env)
  } catch (error) {
    if (error instanceof StripeConfigError) return error
    throw error
  }
  throw new Error('the configuration was accepted')
}

describe('paymentProviders (#107)', () => {
  it('builds no provider without a key', () => {
    expect(paymentProviders({}).size).toBe(0)
    expect(paymentProviders({ PAYMENTS_ENV: 'staging', STRIPE_SECRET_KEY: '' }).size).toBe(0)
  })

  it('builds the Stripe provider from a key that fits the environment', () => {
    const providers = paymentProviders({ PAYMENTS_ENV: 'development', STRIPE_SECRET_KEY: TEST_KEY })
    expect([...providers.keys()]).toEqual(['stripe'])
    expect(typeof providers.get('stripe')?.readNoticeSubject).toBe('function')
    expect(paymentProviders({ PAYMENTS_ENV: 'production', STRIPE_SECRET_KEY: LIVE_KEY }).size).toBe(
      1,
    )
  })

  it('stops on a live key outside production, a test key in production, or no environment', () => {
    for (const env of [
      { PAYMENTS_ENV: 'staging', STRIPE_SECRET_KEY: LIVE_KEY },
      { PAYMENTS_ENV: 'production', STRIPE_SECRET_KEY: TEST_KEY },
      { STRIPE_SECRET_KEY: TEST_KEY },
    ]) {
      const message = refusal(env).message
      expect(message).not.toContain(env.STRIPE_SECRET_KEY.slice(8))
    }
  })
})

describe('the simulated provider (#116)', () => {
  it('is built only with WORKER_PAYMENTS_SIM=on, and never in production', () => {
    expect(paymentProviders({ PAYMENTS_ENV: 'test' }).size).toBe(0)
    expect([
      ...paymentProviders({ PAYMENTS_ENV: 'test', WORKER_PAYMENTS_SIM: 'on' }).keys(),
    ]).toEqual(['sim-pay'])
    expect(() =>
      paymentProviders({ PAYMENTS_ENV: 'production', WORKER_PAYMENTS_SIM: 'on' }),
    ).toThrow()
  })
})
