// The notice connectors' registry (#108): it finds every provider folder's verifier by glob, and
// hides the simulator in production. A module without a connector, or under another folder than
// its kind, stops the registry with its path named.
import { describe, expect, it } from 'vitest'
import { connectorsByKind, noticeConnectorFor, noticeKinds, paymentsEnv } from './notices'
import { noticeConnector } from './sim-pay/notices'

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

  it('takes each whole module, and names the path of one without a connector or under another kind', () => {
    expect([...connectorsByKind({ './sim-pay/notices.ts': { noticeConnector } }).keys()]).toEqual([
      'sim-pay',
    ])
    for (const module of [{}, { noticeConnector: undefined }, { noticeConnector: { kind: 'x' } }]) {
      expect(() => connectorsByKind({ './broken/notices.ts': module })).toThrow(
        './broken/notices.ts exports no noticeConnector',
      )
    }
    expect(() => connectorsByKind({ './other/notices.ts': { noticeConnector } })).toThrow(
      'the notice connector in ./other/notices.ts names another kind (sim-pay)',
    )
  })

  it('reads the environment label, and nothing for a missing or unknown one', () => {
    expect(paymentsEnv({ PAYMENTS_ENV: ' Production ' })).toBe('production')
    expect(paymentsEnv({ PAYMENTS_ENV: 'staging' })).toBe('staging')
    expect(paymentsEnv({})).toBeNull()
    expect(paymentsEnv({ PAYMENTS_ENV: 'prod' })).toBeNull()
  })
})
