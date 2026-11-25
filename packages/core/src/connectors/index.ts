// What core knows about each connector kind (brief CF-03; D64, D65; review A1-P2, readiness
// decision 4). The rest of core speaks only of the till role: the layer `till`, sources
// `till:<in_…>`, the owner `till`. A vendor's name lives here and on the connection row
// (`integrations.kind`), nowhere else in core (D67, the vendor-word test). A later brief moves
// these maps into one data manifest per connector kind.
//
// Pure data and pure functions: no I/O, safe in the browser.

import type { NodeType } from '../node-types'

/**
 * The connector kinds a tenant can configure (`integrations.kind`). `sim` is the simulated POS
 * (`packages/connectors/sim-pos`, D124): for tests, demos and staging, never a real venue's till
 * (the worker refuses it in production, #71).
 */
export const INTEGRATION_KINDS = ['barsy', 'sim'] as const

/** One of the connector kinds. */
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

/** True if `value` names a connector kind core knows. */
export function isIntegrationKind(value: unknown): value is IntegrationKind {
  return typeof value === 'string' && (INTEGRATION_KINDS as readonly string[]).includes(value)
}

/** For each node type, the external types a till link to that node may have. */
export type TillLinkTypesOfKind = { readonly [T in NodeType]: readonly string[] }

/** Link types per connector kind (the shape of `TILL_LINK_TYPES`; tests pass their own). */
export type TillLinkTypes = Readonly<Record<string, TillLinkTypesOfKind>>

/**
 * The external types a till link may have, per connector kind and node type (doc "Barsy to
 * canonical mapping" for barsy): an item mirrors an article, a section a category, a modifier
 * group a supplement group of one combo article (`<articleId>:<groupId>`), an option a
 * modificator or a supplement article (`<articleId>:<groupId>:<optionArticleId>`). A menu mirrors
 * one of the roots the till designates for the venue (`menu_root`, `<catId>@<vn_ id>`: the
 * public menu or the till tree, D88); specials take no till link. `apply()` checks every link
 * against this map.
 */
export const TILL_LINK_TYPES: { readonly [K in IntegrationKind]: TillLinkTypesOfKind } = {
  barsy: {
    menu: ['menu_root'],
    section: ['category'],
    item: ['article'],
    modifier_group: ['supplement_group'],
    option: ['modificator', 'supplement'],
    special: [],
  },
  // The simulated POS's catalogue (test-POS design §2.2, §7): its menu is seeded through
  // `apply()` with till provenance until the generic sync reads it.
  sim: {
    menu: ['menu_root'],
    section: ['category'],
    item: ['article'],
    modifier_group: ['option_group'],
    option: ['option'],
    special: [],
  },
}

/**
 * Why a till link of connector kind `kind` from a `nodeType` node to an object of `externalType`
 * is refused, or null when it is allowed. A kind the map does not know is refused: a connector
 * declares its link types before it can link anything.
 */
export function tillLinkTypeProblem(
  kind: string,
  nodeType: NodeType,
  externalType: string,
  linkTypes: TillLinkTypes = TILL_LINK_TYPES,
): string | null {
  const ofKind = Object.hasOwn(linkTypes, kind) ? linkTypes[kind] : undefined
  if (ofKind === undefined) return `the connector kind ${kind} declares no link types`
  const allowed = ofKind[nodeType] ?? []
  if (allowed.includes(externalType)) return null
  return allowed.length === 0
    ? `a ${nodeType} takes no till link`
    : `a ${nodeType} links to a ${allowed.join(' or ')}, not a ${externalType}`
}

/** The name the admin shows for each connector kind (fills `{source}` in messages). */
export const CONNECTOR_LABELS: { readonly [K in IntegrationKind]: string } = {
  barsy: 'barsy',
  sim: 'test POS',
}

/** The label of a connector kind, for the admin's "Hidden by {source}" and similar messages. */
export function connectorLabel(kind: IntegrationKind): string {
  return CONNECTOR_LABELS[kind]
}
