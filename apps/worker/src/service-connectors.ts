// The service connector of an integration (#71; spec #64 Implementation Decisions 1 and 2): the one
// place that turns an `integrations` row into a `ServiceReader` the floor reading can call. Only
// `apps/worker` imports a connector package, so this is where the simulated POS is built.
//
// A `sim` instance is refused in production, before anything is built or any host is asked: the
// simulated POS is for tests, demos and staging, and no configuration may point Restro's production
// at one (test-POS design §7 risk 3, CLAUDE.md rule 9's spirit). Outside production its host must be
// a local one or listed in the worker's configuration (`SimPolicy`).
//
// The simulated POS's switches decide what the connector declares (`capabilities`); they come from
// the scenario file the instance names in `integrations.config.sim_scenario` (default
// `quiet-night`), which is the one the simulator server was started with. All the shipped
// scenarios share Demo Bar's switches; a server running different ones makes the connector throw
// loudly on a behaviour the simulator does not define, never guess.

import { SERVICE_TIMINGS, type ServiceReader, type ServiceTimings } from '@restro/core'
import type { Integration } from '@restro/db'
import {
  createSimPosConnector,
  DEFAULT_SCENARIO_NAME,
  fetchTransport,
  loadScenarioFile,
  readingLogin,
  SIM_KIND,
} from '@restro/sim-pos'

import type { SimPolicy } from './config'

/** Why no connector was built. */
export class ServiceConnectorRefused extends Error {
  override name = 'ServiceConnectorRefused'
  constructor(
    readonly code: 'sim_in_production' | 'no_service_connector' | 'host_not_allowed',
    message: string,
  ) {
    super(message)
  }
}

/** The `integrations.config` key that names the simulator's scenario for this instance. */
export const SIM_SCENARIO_KEY = 'sim_scenario'

/** True for a kind whose floor this worker can read. */
export function readsFloor(kind: string): boolean {
  return kind === SIM_KIND
}

/**
 * Refuses a `sim` instance in production. Called before a connector is built, and by the job
 * before it records anything, so a production worker never even opens the host.
 */
export function assertSimAllowed(policy: SimPolicy): void {
  if (policy.env === 'production') {
    throw new ServiceConnectorRefused(
      'sim_in_production',
      'the simulated POS is never used in production',
    )
  }
}

/** The service connector of an integration; throws `ServiceConnectorRefused` when there is none to use. */
export function serviceConnectorFor(
  integration: Pick<Integration, 'kind' | 'host' | 'config'>,
  policy: SimPolicy,
): ServiceReader {
  if (integration.kind !== SIM_KIND) {
    throw new ServiceConnectorRefused(
      'no_service_connector',
      `no service connector is wired for ${integration.kind}`,
    )
  }
  assertSimAllowed(policy)
  const config = integration.config as Readonly<Record<string, unknown>>
  const scenarioName =
    typeof config[SIM_SCENARIO_KEY] === 'string'
      ? (config[SIM_SCENARIO_KEY] as string)
      : DEFAULT_SCENARIO_NAME
  const scenario = loadScenarioFile(scenarioName)
  let transport: ReturnType<typeof fetchTransport>
  try {
    transport = fetchTransport(`http://${integration.host}`, {
      env: policy.env,
      allowHosts: policy.allowHosts,
    })
  } catch (error) {
    throw new ServiceConnectorRefused(
      'host_not_allowed',
      error instanceof Error ? error.message : 'the simulated POS host is not allowed',
    )
  }
  return createSimPosConnector({
    transport,
    login: readingLogin(scenario),
    switches: scenario.switches,
  })
}

/** The seam's context for one call: the platform's clock and timings. */
export function serviceContext(
  now: () => Date,
  timings: ServiceTimings = SERVICE_TIMINGS,
): { now(): Date; readonly timings: ServiceTimings } {
  return { now, timings }
}
