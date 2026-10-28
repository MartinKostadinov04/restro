// A venue's paying settings (D127; ticket #104): `venues.settings.paying`, Zod-checked, written only
// by `setPayingSettings` (core/apply). The venue's provider account and its connection state live
// in `payment_accounts` (the worker writes them, D125 2.3); this holds what the owner chooses.
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

/**
 * What a phone is told as the smallest card payment when the venue set none: €0.50, the lowest
 * charge the pilot's provider takes (D127). The provider's own check at pricing stays the truth.
 */
export const CARD_FLOOR_MINOR = 50

/** The largest smallest-card-payment a venue may set: €1,000 in minor units. */
export const MIN_CARD_MAX_MINOR = 100_000

/** `venues.settings.paying` as stored. Every key is present after a save. */
export const PayingSettingsSchema = z.strictObject({
  /**
   * The smallest amount a guest may pay by card, in minor units, or null for the provider's own
   * minimum (D127). Never below the provider's minimum: the provider sets that, so code checks it
   * when the owner saves (`setPayingSettings`) and again when a payment is priced.
   */
  minCardMinor: z.number().int().positive().max(MIN_CARD_MAX_MINOR).nullable(),
})

/** A venue's paying settings. */
export type PayingSettings = z.infer<typeof PayingSettingsSchema>

/** What applies until a venue saves its own: the provider's minimum. */
export const DEFAULT_PAYING_SETTINGS: PayingSettings = { minCardMinor: null }

/** The venue's paying settings from `venues.settings`, the defaults where none are saved. */
export function readPayingSettings(settings: Readonly<Record<string, unknown>>): PayingSettings {
  const parsed = PayingSettingsSchema.safeParse(settings.paying)
  return parsed.success ? parsed.data : DEFAULT_PAYING_SETTINGS
}

/**
 * The smallest card payment that applies: the venue's own, never below the provider's minimum
 * (`providerMinMinor`, in the same currency's minor units).
 */
export function smallestCardMinor(settings: PayingSettings, providerMinMinor: number): number {
  return Math.max(settings.minCardMinor ?? 0, providerMinMinor)
}
