// A venue's pay-first settings (D113, D122 §5; ticket #113): `venues.settings.payFirst`, Zod-checked,
// written only by `patchPayFirstSettingsIn` (core/apply). Two layers:
// - the payment mode an item takes when it sets none (the item's own `payment_mode` field wins);
// - whether pay-first applies at a table: set for the venue, a group of tables (a bar or a hall)
//   and a table, the most specific setting winning.
//
// **A reservation is a level of its own** (D135, ticket #334), so the whole order, widest last, is
// `venue → area → bar → reservation → table`: a table's own setting still wins over the party's,
// and the party's wins over its bar's, its hall's and the house's. `payFirstRuleAt` is the one
// function that decides it; `payFirstAppliesAt` is the same resolution without a party, for the
// screens that set the venue's own four levels. Whether the party's rule is in force at all — it
// lasts for one sitting — is the reservation side's own question (`service/reservations/pay-rule.ts`),
// never this module's: here a rule is either handed in or it is not.
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
 * A pay rule one level can carry: everything on the bill, or pay first. The same two words as an
 * item's payment mode (`PAYMENT_MODES`), because they say the same thing about the same money
 * (GLOSSARY: "Payment mode"); `null` is no rule at this level, so the level below it decides.
 */
export type PayRule = PaymentMode

/** The levels of the venue's own settings: a table, its bar, its hall, the house. */
export type PayFirstVenueLevel = 'table' | 'bar' | 'area' | 'venue'

/** Every level a pay rule can come from, the reservation's own among them (D135). */
export type PayFirstLevel = PayFirstVenueLevel | 'reservation'

/** Whether pay-first applies at a table, and which setting said so (as `MenuShown.level` does). */
export interface PayFirstVenueReading {
  readonly applies: boolean
  readonly level: PayFirstVenueLevel
}

/** The same, with the reservation's level among the answers. */
export interface PayFirstReading {
  readonly applies: boolean
  readonly level: PayFirstLevel
}

/**
 * Whether pay-first rules apply at a table (D122 §5), and which level decided it: the table's own
 * setting, else its bar's, else its hall's, else the venue's. A bar is the narrower group: it is
 * the service that makes the drinks, a hall only where the table stands. No screen sets a bar's
 * choice, but a stored one is still honoured.
 */
export function payFirstAppliesAt(
  settings: PayFirstSettings,
  place: PayFirstPlace,
): PayFirstVenueReading {
  const own = settings.tables[place.tableId]
  if (own !== undefined) return { applies: own, level: 'table' }
  const bar = place.barId === null ? undefined : settings.groups[place.barId]
  if (bar !== undefined) return { applies: bar, level: 'bar' }
  const area = settings.groups[place.areaId]
  if (area !== undefined) return { applies: area, level: 'area' }
  return { applies: settings.applies, level: 'venue' }
}

/**
 * **The one resolution** of whose pay rule holds at a table, over all five levels (D122 §5, D135):
 * the table's own setting, else the rule the party sitting there carries, else its bar's setting,
 * else its hall's, else the venue's. The level that decided comes back with the answer, because a
 * screen that shows the party's rule has to say when a table's own setting beat it (ticket #334).
 *
 * `rule` is the party's rule **already found to be in force** — a rule lasts one sitting, and that
 * is the reservation side's question, not this one's. `null` is no party rule, and then this is
 * exactly the venue's own four levels.
 */
export function payFirstRuleAt(
  settings: PayFirstSettings,
  place: PayFirstPlace,
  rule: PayRule | null,
): PayFirstReading {
  const own = settings.tables[place.tableId]
  if (own !== undefined) return { applies: own, level: 'table' }
  if (rule !== null) return { applies: rule === 'pay_first', level: 'reservation' }
  // The table has no setting of its own here, so what is left is its bar, its hall and the house.
  return payFirstAppliesAt(settings, place)
}

/** Whether pay-first rules apply at a table (D122 §5): `payFirstAppliesAt` without the level. */
export function payFirstApplies(settings: PayFirstSettings, place: PayFirstPlace): boolean {
  return payFirstAppliesAt(settings, place).applies
}

/** Whether pay-first rules apply at a table, the party's rule included: `payFirstRuleAt` alone. */
export function payFirstRuleApplies(
  settings: PayFirstSettings,
  place: PayFirstPlace,
  rule: PayRule | null,
): boolean {
  return payFirstRuleAt(settings, place, rule).applies
}

/** An item's payment mode: its own, else the venue's default. */
export function itemPaymentMode(
  own: PaymentMode | null | undefined,
  settings: PayFirstSettings,
): PaymentMode {
  return own ?? settings.itemMode
}
