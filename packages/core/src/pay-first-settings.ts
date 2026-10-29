// A venue's pay-first settings (D113, D122 §5; ticket #113): `venues.settings.payFirst`, Zod-checked,
// written only by `patchPayFirstSettingsIn` (core/apply). Two layers:
// - the payment mode an item takes when it sets none (the item's own `payment_mode` field wins);
// - whether pay-first applies at a table: set for the venue, a group of tables (a bar or a hall)
//   and a table, the most specific setting winning.
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

import { type AreaId, type BarId, idSchema, type TableId } from './ids'
import { PAYMENT_MODES, type PaymentMode } from './templates/venue-menu'

/** The id of a group of tables a pay-first setting may sit on: a bar or a hall (area). */
export const PayFirstGroupIdSchema = z.union([idSchema('br'), idSchema('ar')])

/** `venues.settings.payFirst` as stored. Every key is present after a save. */
export const PayFirstSettingsSchema = z.strictObject({
  /** The payment mode of an item that sets none. */
  itemMode: z.enum(PAYMENT_MODES),
  /** Whether pay-first applies at the venue's tables unless a group or a table says otherwise. */
  applies: z.boolean(),
  /** Per bar or hall: whether pay-first applies at its tables, over the venue's setting. */
  groups: z.record(PayFirstGroupIdSchema, z.boolean()),
  /** Per table: whether pay-first applies there, over its bar's, hall's and the venue's. */
  tables: z.record(idSchema('tb'), z.boolean()),
})

/** A venue's pay-first settings. */
export type PayFirstSettings = z.infer<typeof PayFirstSettingsSchema>

/** What applies until a venue saves its own: every item on the bill, pay-first allowed anywhere. */
export const DEFAULT_PAY_FIRST_SETTINGS: PayFirstSettings = {
  itemMode: 'on_bill',
  applies: true,
  groups: {},
  tables: {},
}

/** The venue's pay-first settings from `venues.settings`, the defaults where none are saved. */
export function readPayFirstSettings(
  settings: Readonly<Record<string, unknown>>,
): PayFirstSettings {
  const parsed = PayFirstSettingsSchema.safeParse(settings.payFirst)
  return parsed.success ? parsed.data : DEFAULT_PAY_FIRST_SETTINGS
}

/** Where a table sits: its bar (null where the POS has none) and its hall. */
export interface PayFirstPlace {
  readonly tableId: TableId
  readonly barId: BarId | null
  readonly areaId: AreaId
}

/**
 * Whether pay-first rules apply at a table (D122 §5): the table's own setting, else its bar's,
 * else its hall's, else the venue's. A bar is the narrower group: it is the service that makes
 * the drinks, a hall only where the table stands.
 */
export function payFirstApplies(settings: PayFirstSettings, place: PayFirstPlace): boolean {
  return (
    settings.tables[place.tableId] ??
    (place.barId === null ? undefined : settings.groups[place.barId]) ??
    settings.groups[place.areaId] ??
    settings.applies
  )
}

/** An item's payment mode: its own, else the venue's default. */
export function itemPaymentMode(
  own: PaymentMode | null | undefined,
  settings: PayFirstSettings,
): PaymentMode {
  return own ?? settings.itemMode
}
