import { StripeConfigError } from '@restro/stripe'
import { describe, expect, it } from 'vitest'

import { paymentProviders, simulatedForms } from './connectors'

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

describe('finishing the simulated provider’s form (#398)', () => {
  const sim = { PAYMENTS_ENV: 'test', WORKER_PAYMENTS_SIM: 'on' }
  const request = {
    venueId: 'vn_0000000000000000000000',
    accountRef: null,
    returnUrl: 'https://restro.test/venues/vn_1?tab=settings&section=paying&connection=return',
    refreshUrl: 'https://restro.test/venues/vn_1?tab=settings&section=paying&connection=refresh',
    idempotencyKey: 'connect:test:1',
  } as const

  it('offers nothing without the simulator switched on, and refuses production on its own', () => {
    expect(simulatedForms({ PAYMENTS_ENV: 'test' }).size).toBe(0)
    expect(() =>
      simulatedForms({ PAYMENTS_ENV: 'production', WORKER_PAYMENTS_SIM: 'on' }),
    ).toThrow()
    expect([...simulatedForms(sim).keys()]).toEqual(['sim-pay'])
  })

  it('finishes the account that the provider handed out, on the engine every caller shares', async () => {
    // The connection endpoint and the payment jobs each ask `paymentProviders()` for their
    // provider: both must reach the one engine, or a connected account would be unknown to the
    // payment that follows it.
    const forConnection = paymentProviders(sim).get('sim-pay')
    const forPayments = paymentProviders(sim).get('sim-pay')
    if (forConnection === undefined || forPayments === undefined) throw new Error('no provider')

    const started = await forConnection.startConnection(request)
    if (started.kind !== 'done') throw new Error('the connection did not start')
    const { accountRef } = started.result
    expect(await forPayments.readConnection(accountRef)).toMatchObject({
      value: { canTakePayments: false },
    })

    simulatedForms(sim).get('sim-pay')?.(accountRef)

    expect(await forPayments.readConnection(accountRef)).toMatchObject({
      value: { canTakePayments: true, missing: [] },
    })
  })
})
