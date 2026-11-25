import { describe, expect, it } from 'vitest'

import { buildEnvProblems } from './check-build-env'

/** Made-up values in the right shapes; none is a real key. */
const STAGING = {
  NEXT_PUBLIC_CDN_BASE_URL: 'https://restro.example.test/cdn',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_madeUpForTheTestOnly',
  PAYMENTS_ENV: 'staging',
}

describe('buildEnvProblems', () => {
  it('lets a complete staging build through', () => {
    expect(buildEnvProblems(STAGING)).toEqual([])
  })

  it('names every missing or blank public value', () => {
    expect(buildEnvProblems({ NEXT_PUBLIC_CDN_BASE_URL: ' ', PAYMENTS_ENV: 'staging' })).toEqual([
      'NEXT_PUBLIC_CDN_BASE_URL is not set.',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.',
    ])
  })

  it('needs an absolute https address for the CDN', () => {
    for (const cdn of ['/cdn', 'http://restro.example.test/cdn', 'restro.example.test/cdn']) {
      expect(buildEnvProblems({ ...STAGING, NEXT_PUBLIC_CDN_BASE_URL: cdn })).toEqual([
        'NEXT_PUBLIC_CDN_BASE_URL must be an absolute https:// address (the table links redirect to it).',
      ])
    }
  })

  it('refuses a site key with anything but letters, digits, - and _', () => {
    expect(
      buildEnvProblems({ ...STAGING, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'key with spaces' }),
    ).toHaveLength(1)
  })

  it('takes only a test publishable key unless the build is for production', () => {
    const live = { ...STAGING, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_madeUpForTheTestOnly' }
    const testOnly =
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a test publishable key (pk_test_) unless the build is for production (PAYMENTS_ENV=production).'
    expect(buildEnvProblems(live)).toEqual([testOnly])
    // Unset means not production: the safe side.
    const { PAYMENTS_ENV: _unset, ...noEnvironment } = live
    expect(buildEnvProblems(noEnvironment)).toEqual([testOnly])
    expect(
      buildEnvProblems({ ...STAGING, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_test_x' }),
    ).toEqual([testOnly])
  })

  it('takes only a live publishable key in a production build', () => {
    expect(buildEnvProblems({ ...STAGING, PAYMENTS_ENV: ' Production ' })).toEqual([
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a live publishable key (pk_live_) in a production build.',
    ])
    expect(
      buildEnvProblems({
        ...STAGING,
        PAYMENTS_ENV: 'production',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_madeUpForTheTestOnly',
      }),
    ).toEqual([])
  })

  it('never repeats a value in its messages', () => {
    const text = buildEnvProblems({
      NEXT_PUBLIC_CDN_BASE_URL: 'ftp://secret-host.example',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'secret value',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_live_x',
    }).join('\n')
    expect(text).not.toMatch(/secret|sk_live_x/)
  })
})
