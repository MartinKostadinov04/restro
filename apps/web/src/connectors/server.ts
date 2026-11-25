// The server side of the connector registry (adjustments I1, D81): which systems the web app
// supports, and for each one what the Integrations service asks of its connector
// (`server-types.ts`). Typed against core's list of connector kinds, so a kind core knows without
// a connector here does not compile. The client side of the same registry is `ui.tsx`.
//
// The simulated POS (`sim`, #71) is for tests, demos and staging: it is offered only where the
// deployment says it is not production (`simOffered`), so the systems picker hides it there and an
// existing `sim` instance has no tab. The worker refuses the kind in production on its own side;
// a test pins both.
import { INTEGRATION_KINDS, type IntegrationKind, isIntegrationKind } from '@restro/core'

import { barsyServer } from './barsy/server'
import type { ConnectorServer } from './server-types'
import { simServer } from './sim/server'

/** The deployment environments the simulated POS may be offered in. */
const SIM_ENVIRONMENTS: readonly string[] = ['development', 'test', 'staging']

/**
 * True when the simulated POS may be offered here: the deployment's environment label (`BARSY_ENV`,
 * the one the worker reads too) is development, test or staging. A missing or unknown label, and
 * `production`, hide it: the safe answer when nothing says otherwise.
 */
export function simOffered(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return SIM_ENVIRONMENTS.includes((env.BARSY_ENV ?? '').trim().toLowerCase())
}

const SERVERS: { readonly [K in IntegrationKind]: ConnectorServer } = {
  barsy: barsyServer,
  sim: simServer,
}

function isOffered(
  kind: IntegrationKind,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return kind !== 'sim' || simOffered(env)
}

/** Every system the web app offers here, in core's order: the list the systems picker shows. */
export function systemKinds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly IntegrationKind[] {
  return INTEGRATION_KINDS.filter((kind) => isOffered(kind, env))
}

/** The connector of a kind, or null for a kind this deployment does not offer. */
export function connectorServer(
  kind: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConnectorServer | null {
  return isIntegrationKind(kind) && isOffered(kind, env) ? SERVERS[kind] : null
}
