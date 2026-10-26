import { describe, expect, it } from 'vitest'

import { checkStripeKey, StripeConfigError, stripeKeyMode, withoutSecrets } from './config'

// Made-up keys of the right shape: no real key is ever in a test.
const TEST_KEY = `sk_test_${'A1b2C3d4'.repeat(4)}`
const LIVE_KEY = `sk_live_${'Z9y8X7w6'.repeat(4)}`
const RESTRICTED_LIVE = `rk_live_${'Q5r4S3t2'.repeat(4)}`
const PUBLISHABLE = `pk_test_${'M1n2O3p4'.repeat(4)}`

function refusal(env: string, key: string): StripeConfigError {
  try {
    checkStripeKey(env, key)
  } catch (error) {
    if (error instanceof StripeConfigError) return error
    throw error
  }
  throw new Error(`the key was accepted in ${env}`)
}

describe('the key check', () => {
  it('tells live and test keys apart by their prefix', () => {
    expect(stripeKeyMode(TEST_KEY)).toBe('test')
    expect(stripeKeyMode(LIVE_KEY)).toBe('live')
    expect(stripeKeyMode(RESTRICTED_LIVE)).toBe('live')
    expect(stripeKeyMode(PUBLISHABLE)).toBeNull()
    expect(stripeKeyMode('')).toBeNull()
  })

  it('takes a test key outside production and a live key in production', () => {
    for (const env of ['development', 'test', 'staging']) {
      expect(checkStripeKey(env, TEST_KEY)).toEqual({ env, key: TEST_KEY })
    }
    expect(checkStripeKey('production', LIVE_KEY).env).toBe('production')
    expect(checkStripeKey('production', RESTRICTED_LIVE).env).toBe('production')
  })

  it('refuses a live key outside production and a test key in production', () => {
    for (const env of ['development', 'test', 'staging']) {
      expect(refusal(env, LIVE_KEY).message).toContain('live key')
      expect(refusal(env, RESTRICTED_LIVE).message).toContain('live key')
    }
    expect(refusal('production', TEST_KEY).message).toContain('test key')
  })

  it('refuses a publishable key, an unknown environment and an empty key', () => {
    expect(refusal('test', PUBLISHABLE)).toBeInstanceOf(StripeConfigError)
    expect(refusal('prod', LIVE_KEY)).toBeInstanceOf(StripeConfigError)
    expect(refusal('test', '')).toBeInstanceOf(StripeConfigError)
  })

  it('never puts the key, or a part of it, in its message', () => {
    for (const [env, key] of [
      ['staging', LIVE_KEY],
      ['production', TEST_KEY],
      ['test', PUBLISHABLE],
      ['nowhere', RESTRICTED_LIVE],
    ] as const) {
      const message = refusal(env, key).message
      expect(message).not.toContain(key.slice(8, 16))
      expect(message).not.toContain(key.slice(-8))
    }
  })
})

describe('withoutSecrets', () => {
  it('removes keys, client secrets and webhook secrets from a text', () => {
    const text = [
      `key ${LIVE_KEY}`,
      `restricted ${RESTRICTED_LIVE}`,
      `publishable ${PUBLISHABLE}`,
      'secret pi_3AbC123_secret_XyZ987',
      'setup seti_1AbC_secret_Q1w2',
      'webhook whsec_abcDEF123',
      `redacted by Stripe sk_test_${'*'.repeat(8)}1234`,
    ].join(' | ')
    const clean = withoutSecrets(text)
    for (const secret of ['A1b2', 'Z9y8', 'Q5r4', 'M1n2', 'XyZ987', 'Q1w2', 'abcDEF123', '1234']) {
      expect(clean).not.toContain(secret)
    }
    expect(clean).toContain('[key]')
    expect(clean).toContain('[client secret]')
    expect(clean).toContain('[secret]')
  })

  it('leaves ids that are not secret alone', () => {
    expect(withoutSecrets('pi_3AbC123 on acct_1XyZ, charge ch_9')).toBe(
      'pi_3AbC123 on acct_1XyZ, charge ch_9',
    )
  })
})
