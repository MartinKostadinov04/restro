// The guest event kinds (D142; ticket #335, tracker T84): the minimal key set of what a night can
// be measured by, as a closed union. A kind here records the guest's own side of the phone and
// nothing else: the staff side of a night is already in the service rows and the Log, and two
// answers to one question is exactly what this model must not create.
//
// What a kind may carry is fixed below, field by field, and `strictObject` refuses anything else.
// Nothing in this file can hold personal data (D111, rule 3): there is no field for a name, a
// phone number, an email address, an IP address, a device id, a card digit or any text a guest
// typed. A guest is only ever the table's sitting; nothing links one sitting to another.
//
// Pure: no I/O.

import { z } from 'zod'

import { idSchema } from '../ids'
import { LocaleSchema } from '../locales'
import { MoneySchema } from '../money'

/** How long an event is kept, as the Log's classes (D122 §9): 31 days, or 18 months. */
export type GuestEventRetention = 'night' | 'record'

/**
 * The kinds and their retention class. A later question of Martin's adds a kind here, with no
 * migration: the database checks the shape of a kind, not the list. A kind moves from `night` to
 * `record` only, never back (it would erase a record early), as the Log's kinds do.
 */
export const GUEST_EVENT_KINDS = {
  /** A phone opened the menu at a table: scans per night and per table, the top of the funnel. */
  'menu.opened': 'night',
  /** A guest opened one item: what gets looked at and never ordered. */
  'item.opened': 'night',
  /** A line went onto the table's order, and one came off it: intent, and second thoughts. */
  'order.line_added': 'night',
  'order.line_removed': 'night',
  /** A Send was tried: scan-to-send conversion, and the time from the scan to the first Send. */
  'order.send_attempted': 'night',
  /** Paying in the app began, and ended: the abandoned payments no service row shows. */
  'pay.started': 'night',
  'pay.finished': 'night',
  /** A waiter was called: calls per night, against orders per night. */
  'waiter.call_opened': 'night',
  /** A guest chose a menu language: whether the Bulgarian or the English menu is read. */
  'language.chosen': 'night',
} as const satisfies Record<string, GuestEventRetention>

/** One guest event kind. */
export type GuestEventKind = keyof typeof GUEST_EVENT_KINDS

/** Every kind, for a schema or a test that walks them. */
export const GUEST_EVENT_KIND_NAMES = Object.keys(GUEST_EVENT_KINDS) as [
  GuestEventKind,
  ...GuestEventKind[],
]

/** The retention class of a kind. */
export function guestEventRetentionOf(kind: GuestEventKind): GuestEventRetention {
  return GUEST_EVENT_KINDS[kind]
}

/**
 * How something ended: `ok`, or a short failure class (a refusal code, a payment's final state).
 * A code from our own lists, never a message and never a provider's text.
 */
export const GuestEventOutcomeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

/**
 * A refusal code or a final state as an outcome: the code itself when it is one of ours, else
 * `other`. An event is never worth failing the write it measures over, so an outcome this file
 * does not recognise is recorded as `other` instead of throwing.
 */
export function guestEventOutcome(code: string | null | undefined): string {
  return typeof code === 'string' && GuestEventOutcomeSchema.safeParse(code).success
    ? code
    : 'other'
}

/**
 * Fields every event may carry beside its kind.
 * - `at`: when it happened, where that is not the moment of the write (a phone's own tap, placed
 *   back by the age it reported). The writer's clock otherwise.
 * - `sittingId`: the table's open sitting. Left out where the table had none.
 */
const CommonFields = {
  at: z.date().optional(),
  sittingId: idSchema('st').optional(),
}

/**
 * One event as a writer hands it over: a closed union on `kind`, each kind with its own fields and
 * nothing else. An unknown kind, an unknown field or a field of the wrong kind is refused here,
 * before the database is asked.
 */
export const GuestEventInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('menu.opened'), ...CommonFields }),
  // The item, as our own node id: never a POS id and never its name (rule 3).
  z.strictObject({ kind: z.literal('item.opened'), itemId: idSchema('nd'), ...CommonFields }),
  z.strictObject({ kind: z.literal('order.line_added'), ...CommonFields }),
  z.strictObject({ kind: z.literal('order.line_removed'), ...CommonFields }),
  z.strictObject({
    kind: z.literal('order.send_attempted'),
    /** `ok`, or the code the Send was refused with. */
    outcome: GuestEventOutcomeSchema,
    ...CommonFields,
  }),
  z.strictObject({
    kind: z.literal('pay.started'),
    /** What the phone set out to pay, once it is priced; left out before that. */
    amount: MoneySchema.optional(),
    ...CommonFields,
  }),
  z.strictObject({
    kind: z.literal('pay.finished'),
    /** `ok` for a captured payment, else the payment's final state as its failure class. */
    outcome: GuestEventOutcomeSchema,
    /** What was captured, or what was held and then not taken; left out when never priced. */
    amount: MoneySchema.optional(),
    ...CommonFields,
  }),
  z.strictObject({ kind: z.literal('waiter.call_opened'), ...CommonFields }),
  z.strictObject({ kind: z.literal('language.chosen'), locale: LocaleSchema, ...CommonFields }),
])

/** One event as a writer hands it over. */
export type GuestEventInput = z.input<typeof GuestEventInputSchema>

/** One event as the write path reads it. */
export type GuestEvent = z.output<typeof GuestEventInputSchema>

/**
 * The most events one call may write. A phone batches what happened while it was offline; past
 * this the batch is refused whole, so a tampered phone cannot make the write path do unbounded
 * work. The guest API's own body cap (8 KB) bites long before this.
 */
export const GUEST_EVENT_BATCH_MAX = 50

/** A batch as the write path takes it: at least one event, at most `GUEST_EVENT_BATCH_MAX`. */
export const GuestEventBatchSchema = z
  .array(GuestEventInputSchema)
  .min(1)
  .max(GUEST_EVENT_BATCH_MAX)

/**
 * The kinds a phone may report itself: the three things that happen wholly on the phone and leave
 * no service row. Everything else is recorded by the write that decided it (a Send, a payment, a
 * waiter call), so a tampered phone can never invent a conversion, a payment or a call.
 */
export const PHONE_REPORTED_KINDS = ['menu.opened', 'item.opened', 'language.chosen'] as const

/** One kind a phone may report. */
export type PhoneReportedKind = (typeof PHONE_REPORTED_KINDS)[number]

/** True for a kind a phone may report itself. */
export function isPhoneReportedKind(kind: string): kind is PhoneReportedKind {
  return (PHONE_REPORTED_KINDS as readonly string[]).includes(kind)
}

/**
 * A money value for an amount in minor units and a currency as the database holds them (rule 8:
 * integers through the `money` module, never a float). Nothing where there is no amount, or where
 * the currency is not one we accept: an event is never worth failing a payment over.
 */
export function guestEventAmount(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): { readonly amount?: z.output<typeof MoneySchema> } {
  if (amountMinor === null || amountMinor === undefined || amountMinor < 0) return {}
  const money = MoneySchema.safeParse({ amount_minor: amountMinor, currency })
  return money.success ? { amount: money.data } : {}
}
