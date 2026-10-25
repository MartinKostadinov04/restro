// The notice connectors' registry (#108): it finds every provider folder's verifier by glob, and
// hides the simulator in production.
import { describe, expect, it } from 'vitest'

import { noticeConnectorFor, noticeKinds, paymentsEnv } from './notices'

describe('the notice connectors', () => {
  it("finds each provider folder's notice connector, under its own kind", () => {
    expect(noticeKinds()).toEqual(['sim-pay', 'stripe'])
    expect(noticeConnectorFor('stripe', 'production')?.kind).toBe('stripe')
    expect(noticeConnectorFor('sim-pay', 'staging')?.kind).toBe('sim-pay')
  })

  it('has none for an unknown kind, nor for the simulator in production', () => {
    expect(noticeConnectorFor('barsy', 'staging')).toBeNull()
    expect(noticeConnectorFor('../stripe', 'staging')).toBeNull()
    expect(noticeConnectorFor('sim-pay', 'production')).toBeNull()
  })

  it('reads the environment label, and nothing for a missing or unknown one', () => {
    expect(paymentsEnv({ PAYMENTS_ENV: ' Production ' })).toBe('production')
    expect(paymentsEnv({ PAYMENTS_ENV: 'staging' })).toBe('staging')
    expect(paymentsEnv({})).toBeNull()
    expect(paymentsEnv({ PAYMENTS_ENV: 'prod' })).toBeNull()
  })
})
