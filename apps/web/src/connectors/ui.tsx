// The client side of the connector registry (adjustments I1, I2, D81, D82): for each system the two
// pieces of admin screen that are its own. The platform's screens (the instance panel, the venue's
// Menu source card) draw everything common and ask this registry for the rest, by the instance's
// kind; they name no system. The server side of the registry is `server.ts`.
//
//   - the system settings card of an instance (barsy: the allergen characteristic and the
//     language of untagged text, B6);
//   - the part of a venue's Menu source that is the connector's (barsy: the price shown, B2).
//
// A connector's components may name their system and use the `connectors.<kind>` messages (the
// vendor-word test allows both here, D67).
import { type IntegrationKind, isIntegrationKind } from '@restro/core'
import type { ComponentType } from 'react'

import { BarsySettingsCard } from './barsy/settings-card'
import { BarsyVenuePart } from './barsy/venue-part'
import type { InstanceSettingsData, VenueSourceData } from './data'

export interface InstanceSettingsCardProps {
  readonly integrationId: string
  readonly canManage: boolean
  readonly data: InstanceSettingsData
}

export interface VenueSourcePartProps {
  readonly venueId: string
  readonly canManage: boolean
  readonly data: VenueSourceData
}

export interface ConnectorUi {
  /** The instance's system settings card, or null when the system has none. */
  readonly InstanceSettingsCard: ComponentType<InstanceSettingsCardProps> | null
  /** The connector's part of a venue's Menu source card, or null when it has none. */
  readonly VenueSourcePart: ComponentType<VenueSourcePartProps> | null
}

const UI: { readonly [K in IntegrationKind]: ConnectorUi } = {
  barsy: {
    InstanceSettingsCard: ({ data, ...rest }) =>
      data.kind === 'barsy' ? <BarsySettingsCard {...rest} data={data} /> : null,
    VenueSourcePart: ({ data, ...rest }) =>
      data.kind === 'barsy' ? <BarsyVenuePart {...rest} data={data} /> : null,
  },
  // The simulated POS (#71) has no screen of its own: the platform's cards say everything.
  sim: { InstanceSettingsCard: null, VenueSourcePart: null },
}

/** The screens a connector supplies, or null for a kind this build does not know. */
export function connectorUi(kind: string): ConnectorUi | null {
  return isIntegrationKind(kind) ? UI[kind] : null
}
