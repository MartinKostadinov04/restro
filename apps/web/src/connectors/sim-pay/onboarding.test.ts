// The simulated provider's stand-in for its hosted form (#398): the address it turns the
// simulator's dead one into, who is offered it, and that no other provider's address is touched.
import { describe, expect, it } from 'vitest'

import { onboardingAddress, onboardingByKind } from '../onboarding'
import { onboarding, simPayOnboardingOffered } from './onboarding'

const context = {
  venueId: 'vn_01',
  returnUrl: 'https://restro.test/venues/vn_01?tab=settings&section=paying&connection=return',
  refreshUrl: 'https://restro.test/venues/vn_01?tab=settings&section=paying&connection=refresh',
}
const simulatorsAddress = 'https://connect.sim-pay.test/onboard/simacct_abc123_1'

describe('the simulated provider’s onboarding page', () => {
  it('stands for the simulator’s hosted address, and carries the venue and both return addresses', () => {
    const address = onboarding.address(simulatorsAddress, context)
    expect(address).not.toBeNull()
    const parsed = new URL(address as string, 'https://restro.test')
    expect(parsed.pathname).toBe('/sim-pay/onboard/simacct_abc123_1')
    expect(parsed.searchParams.get('venue')).toBe('vn_01')
    expect(parsed.searchParams.get('return')).toBe(context.returnUrl)
    expect(parsed.searchParams.get('refresh')).toBe(context.refreshUrl)
  })

  it('leaves every other address alone', () => {
    for (const other of [
      'https://connect.stripe.com/setup/e/acct_1/abc',
      'https://connect.sim-pay.test.evil.example/onboard/simacct_1',
      'http://connect.sim-pay.test/onboard/simacct_1',
      'https://connect.sim-pay.test/other/simacct_1',
      'https://connect.sim-pay.test/onboard/not-an-account',
      'https://connect.sim-pay.test/onboard/simacct_1/extra',
      'not an address',
    ]) {
      expect(onboarding.address(other, context)).toBeNull()
    }
  })

  it('exists in development, test and staging, never in production or for an unknown environment', () => {
    for (const env of ['development', 'test', 'staging'] as const) {
      expect(onboarding.offered(env)).toBe(true)
      expect(simPayOnboardingOffered(env)).toBe(true)
    }
    expect(onboarding.offered('production')).toBe(false)
    expect(simPayOnboardingOffered('production')).toBe(false)
    expect(simPayOnboardingOffered(null)).toBe(false)
  })
})

describe('where the owner’s browser goes (onboardingAddress)', () => {
  it('goes to the app’s page for the simulator’s address', () => {
    expect(onboardingAddress(simulatorsAddress, context, 'development')).toMatch(
      /^\/sim-pay\/onboard\/simacct_abc123_1\?/,
    )
  })

  it('goes to the provider’s own address in production, with no known environment, or for a real provider', () => {
    expect(onboardingAddress(simulatorsAddress, context, 'production')).toBe(simulatorsAddress)
    expect(onboardingAddress(simulatorsAddress, context, null)).toBe(simulatorsAddress)
    const stripes = 'https://connect.stripe.com/setup/e/acct_1/abc'
    expect(onboardingAddress(stripes, context, 'development')).toBe(stripes)
  })

  it('refuses a module with no onboarding, or one under another provider’s folder', () => {
    expect(() => onboardingByKind({ './x/onboarding.ts': {} })).toThrow(/x\/onboarding\.ts/)
    expect(() => onboardingByKind({ './other/onboarding.ts': { onboarding } })).toThrow(
      /another kind/,
    )
  })
})
