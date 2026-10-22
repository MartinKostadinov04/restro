// What a connector supplies to the Integrations screen and to a venue's Menu source card, as plain
// data (adjustments I1, I2, D81, D82). The platform's view types (`server/integration/view.ts`)
// carry these as opaque, kind-tagged values; only the connector's own components read them. Pure
// types, no imports: the view, the server registry and the client registry all depend on this file
// and it depends on none of them.

/** A characteristic of the till that can hold allergens, as the connection check listed it. */
export interface AllergenOption {
  /** The characteristic's key in the till. Sent back by the picker, never shown. */
  readonly key: string
  readonly name: string
}

/** The system settings card of a barsy instance (B6, D82): how its data is read, for the whole installation. */
export interface BarsyInstanceSettings {
  readonly kind: 'barsy'
  /** The characteristic the manager chose, or null for automatic detection. */
  readonly allergenKey: string | null
  /** What automatic detection finds in the cached details tree, if anything. */
  readonly allergenDetected: AllergenOption | null
  readonly allergenOptions: readonly AllergenOption[]
  /** The language of text that carries no language tag (`bg_BG`): an instance setting (D77, D82). */
  readonly defaultLocale: string
}

/** The price a barsy venue's menu shows (B2, D91 point 10). */
export type BarsyPriceSource = 'actual_price' | 'current_price'

/** The barsy part of a venue's Menu source card (B2): which price the venue shows. */
export interface BarsyVenueSource {
  readonly kind: 'barsy'
  readonly priceSource: BarsyPriceSource
}

/** The simulated POS (#71) has no settings of its own: the tag is all there is. */
export interface SimInstanceSettings {
  readonly kind: 'sim'
}

/** The simulated POS has no part of its own in a venue's Menu source card either. */
export interface SimVenueSource {
  readonly kind: 'sim'
}

/** The system settings every connector supplies for its instances, tagged with the connector's kind. */
export type InstanceSettingsData = BarsyInstanceSettings | SimInstanceSettings

/** The connector-supplied part of a venue's Menu source card, tagged with the connector's kind. */
export type VenueSourceData = BarsyVenueSource | SimVenueSource
