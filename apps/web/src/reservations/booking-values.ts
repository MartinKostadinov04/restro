// The booking form's values and the plain rules about them (#328). Pure and import-free of anything
// with I/O, so the form's behaviour can be tested without a screen: what a blank form starts as,
// what an existing booking fills it with, whether it has been changed, and which field is wrong.
//
// The checks here are the ones a person is helped with while typing (a name is needed, a number
// has digits). The write path decides again, in its own words: a venue that requires a phone, a
// night that cannot be written, a spot somebody holds — none of those is judged here.
import type { RvDetailView } from '@/server/reservations/view'

import { type BookingReason, isBookingReason } from './booking-reasons'

/** Everything the form holds, as the person typed it. */
export interface BookingValues {
  readonly name: string
  readonly phone: string
  /** Text, so a half-typed number is not a number the form took away from the person. */
  readonly partySize: string
  /** The night (`YYYY-MM-DD`). */
  readonly day: string
  /** `HH:mm` on the venue's clock. */
  readonly time: string
  /** `HH:mm`, or empty for no end hour of its own. */
  readonly until: string
  readonly note: string
  readonly reason: BookingReason | null
  readonly spotIds: readonly string[]
}

/** A blank form for a night, optionally with a spot already chosen (the plan's "Book this spot"). */
export function blankValues(input: {
  readonly day: string
  readonly time: string
  readonly spotIds?: readonly string[]
}): BookingValues {
  return {
    name: '',
    phone: '',
    partySize: '',
    day: input.day,
    time: input.time,
    until: '',
    note: '',
    reason: null,
    spotIds: input.spotIds ?? [],
  }
}

/** The form of an existing booking, as its sheet read it. */
export function valuesOf(detail: RvDetailView): BookingValues {
  const { row } = detail
  return {
    name: row.name ?? '',
    phone: detail.phone ?? '',
    partySize: row.partySize === null ? '' : String(row.partySize),
    day: detail.day,
    time: row.time,
    until: row.until ?? '',
    note: row.note ?? '',
    reason: isBookingReason(row.reason) ? row.reason : null,
    spotIds: detail.spotIds,
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((one) => b.includes(one))

/** Whether the form differs from what it started with: what "Save" and "Unsaved" follow. */
export function isDirty(now: BookingValues, start: BookingValues): boolean {
  return (
    now.name !== start.name ||
    now.phone !== start.phone ||
    now.partySize !== start.partySize ||
    now.day !== start.day ||
    now.time !== start.time ||
    now.until !== start.until ||
    now.note !== start.note ||
    now.reason !== start.reason ||
    !sameSet(now.spotIds, start.spotIds)
  )
}

/** The digits of a phone number as typed. */
export function phoneDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, '')
}

/** A phone number the guest record can be keyed by: 6 to 20 digits (`phoneKeyOf`'s own bounds). */
export function phoneLooksRight(phone: string): boolean {
  const digits = phoneDigits(phone)
  const key = digits.startsWith('00') ? digits.slice(2) : digits
  return key.length >= 6 && key.length <= 20
}

/** The fields that can be wrong while typing, each with the word the form says. */
export type FieldError = 'name' | 'phone_needed' | 'phone_digits' | 'guests' | 'end_hour'
export type FieldErrors = Partial<Record<'name' | 'phone' | 'partySize' | 'until', FieldError>>

/** Which fields the form cannot be saved with, and why. Empty when it can be saved. */
export function fieldErrors(
  values: BookingValues,
  rules: { readonly phoneRequired: boolean },
): FieldErrors {
  const errors: { -readonly [K in keyof FieldErrors]: FieldErrors[K] } = {}
  if (values.name.trim() === '') errors.name = 'name'
  const phone = values.phone.trim()
  if (phone === '') {
    if (rules.phoneRequired) errors.phone = 'phone_needed'
  } else if (!phoneLooksRight(phone)) {
    errors.phone = 'phone_digits'
  }
  const guests = Number(values.partySize)
  if (!Number.isInteger(guests) || guests < 1 || guests > 500) errors.partySize = 'guests'
  if (values.until !== '' && values.until === values.time) errors.until = 'end_hour'
  return errors
}

/**
 * The next quarter hour on the venue's clock, as `HH:mm`: where a booking taken now would start
 * unless the person says otherwise.
 */
export function nextQuarter(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  const total = at('hour') * 60 + at('minute')
  const next = (Math.floor(total / 15) + 1) * 15
  const hour = Math.floor(next / 60) % 24
  const minute = next % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The hour a booking for a night that is not tonight starts at, until the person says. */
export const EVENING_HOUR = '22:00'

/** The next night after a service day, for the copy dialog's first guess. */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
