// The name the admin gives a till (brief CF-03): the `{source}` in "From {source}" and the like.
// The till is a role in the menu document (sources `till:<integration>`); the connector behind an
// integration names itself through core's `connectorLabel`. Reads only, as the signed-in tenant.
import {
  connectorLabel,
  isIntegrationKind,
  type MenuDocument,
  tillIntegrationOf,
} from '@restro/core'
import { type DbPool, integrations, withTenant } from '@restro/db'

/** The name of every integration of the tenant, by its `in_` id. */
export async function loadTillLabels(
  pool: DbPool,
  tenantId: string,
): Promise<Readonly<Record<string, string>>> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx.select({ id: integrations.id, kind: integrations.kind }).from(integrations),
  )
  return Object.fromEntries(rows.map((row) => [row.id, tillLabelOfKind(row.kind)]))
}

/** The admin's name of a connector kind; a kind core does not know shows as itself. */
export function tillLabelOfKind(kind: string): string {
  return isIntegrationKind(kind) ? connectorLabel(kind) : kind
}

/**
 * The name of the till that the links of `nodeId` (or, without one, of the whole document) come
 * from: the first till link in id order. '' when there is none (then no value comes from a till).
 */
export function tillLabelOf(
  links: MenuDocument['links'],
  labels: Readonly<Record<string, string>>,
  nodeId?: string,
): string {
  const integrationsOfLinks = links
    .filter((link) => nodeId === undefined || link.nodeId === nodeId)
    .map((link) => tillIntegrationOf(link.source))
    .filter((id): id is string => id !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const first = integrationsOfLinks[0]
  return first === undefined ? '' : (labels[first] ?? '')
}
