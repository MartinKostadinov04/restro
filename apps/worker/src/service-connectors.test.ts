// The worker's service connector factory (#71): the simulated POS is built for a local or listed
// host outside production and refused in production before anything else is looked at; a kind with
// no service connector is refused by name.
import { describe, expect, it } from 'vitest'

import {
  assertSimAllowed,
  readsFloor,
  ServiceConnectorRefused,
  serviceConnectorFor,
} from './service-connectors'

const sim = (host: string, config: Record<string, unknown> = {}) => ({
  kind: 'sim',
  host,
  config,
})

describe('serviceConnectorFor', () => {
  it('builds the simulated POS connector for a local host', () => {
    const connector = serviceConnectorFor(sim('127.0.0.1:4010'), {
      env: 'development',
      allowHosts: [],
    })
    expect(connector.kind).toBe('sim')
    // Demo Bar's switches: the bars are read.
    expect(connector.capabilities.tableBar).toBe(true)
  })

  it('builds it for the host a staging demo lists, and for a name under .test', () => {
    expect(
      serviceConnectorFor(sim('sim.staging.example'), {
        env: 'staging',
        allowHosts: ['sim.staging.example'],
      }).kind,
    ).toBe('sim')
    expect(serviceConnectorFor(sim('demo.test'), { env: 'test', allowHosts: [] }).kind).toBe('sim')
  })

  it('refuses a host that is neither local nor listed', () => {
    const attempt = () =>
      serviceConnectorFor(sim('sim.elsewhere.example'), { env: 'development', allowHosts: [] })
    expect(attempt).toThrow(ServiceConnectorRefused)
    expect(attempt).toThrow(/not allowed/)
  })

  it('refuses a sim instance in production, whatever its host', () => {
    for (const host of ['127.0.0.1:4010', 'demo.test', 'sim.staging.example']) {
      try {
        serviceConnectorFor(sim(host), { env: 'production', allowHosts: ['sim.staging.example'] })
        expect.unreachable('a production worker built a simulated POS connector')
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceConnectorRefused)
        expect((error as ServiceConnectorRefused).code).toBe('sim_in_production')
      }
    }
    expect(() => assertSimAllowed({ env: 'production', allowHosts: [] })).toThrow(
      /never used in production/,
    )
    expect(() => assertSimAllowed({ env: 'staging', allowHosts: [] })).not.toThrow()
  })

  it('names a kind that has no service connector wired', () => {
    expect(() =>
      serviceConnectorFor(
        { kind: 'barsy', host: 'x.barsyonline.com', config: {} },
        {
          env: 'development',
          allowHosts: [],
        },
      ),
    ).toThrow(/no service connector is wired for barsy/)
    expect(readsFloor('sim')).toBe(true)
    expect(readsFloor('barsy')).toBe(false)
  })

  it('reads the scenario the instance names for its switches, and refuses one that is not there', () => {
    expect(
      serviceConnectorFor(sim('demo.test', { sim_scenario: 'payment-trouble' }), {
        env: 'test',
        allowHosts: [],
      }).kind,
    ).toBe('sim')
    expect(() =>
      serviceConnectorFor(sim('demo.test', { sim_scenario: 'no-such-night' }), {
        env: 'test',
        allowHosts: [],
      }),
    ).toThrow(/no scenario called/)
  })
})
