// The server side of the connector registry (adjustments I1, D81): which systems the web app
// supports, and for each one what the Integrations service asks of its connector
// (`server-types.ts`). Typed against core's list of connector kinds, so a kind core knows without
// a connector here does not compile. The client side of the same registry is `ui.tsx`.
import { INTEGRATION_KINDS, type IntegrationKind, isIntegrationKind } from '@restro/core'

import { barsyServer } from './barsy/server'
import type { ConnectorServer } from './server-types'

/**
 * The kinds core knows that the web app does not offer yet: the simulated POS gets its picker
 * entry, its connector here and the worker's production refusal together in #71.
 */
type NotOfferedKind = 'sim'

const SERVERS: { readonly [K in Exclude<IntegrationKind, NotOfferedKind>]: ConnectorServer } = {
  barsy: barsyServer,
}

function isOffered(kind: IntegrationKind): kind is Exclude<IntegrationKind, NotOfferedKind> {
  return Object.hasOwn(SERVERS, kind)
}

/** Every system the web app supports, in core's order: the list the systems picker offers. */
export const SYSTEM_KINDS: readonly IntegrationKind[] = INTEGRATION_KINDS.filter(isOffered)

/** The connector of a kind, or null for a kind this build does not know. */
export function connectorServer(kind: string): ConnectorServer | null {
  return isIntegrationKind(kind) && isOffered(kind) ? SERVERS[kind] : null
}
