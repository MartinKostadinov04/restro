// The words of an alert on a phone or in Telegram (D120 "Alerts reach everyone"; ticket #83).
// Plain text, no notes and no guest data: an alert's details already hold none, and only the
// fields named here are ever read from them. English; the interface strings of Tonight go through
// next-intl, and these follow once the Bulgarian words are settled (D122, Tonight's open points).
//
// Pure: the worker gives it the venue's name, the table's label and the POS's name (`{source}`,
// D82).

import { wallClock } from '../service-day'
import type { Step } from './alert-delivery'

/** A message: a short title, and the details under it (possibly empty). */
export interface AlertMessage {
  readonly title: string
  readonly body: string
}

/** What the words need to know beyond the alert itself. */
export interface MessageContext {
  readonly venueName: string
  /** The alert's table as the venue labels it, or null. */
  readonly tableLabel: string | null
  /** The POS's name for staff (D82). */
  readonly source: string
}

/** The alert as the words read it. */
export interface AlertWords {
  readonly kind: string
  readonly details: Readonly<Record<string, unknown>>
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** `2 × Gin tonic (no mint)` for each line of an Unconfirmed order. */
function itemsOf(details: Readonly<Record<string, unknown>>): string {
  const items = Array.isArray(details.items) ? details.items : []
  return items
    .flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { name, qty, options } = item as Record<string, unknown>
      const label = asText(name)
      if (label === null || typeof qty !== 'number') return []
      const extras = Array.isArray(options) ? options.filter((o) => typeof o === 'string') : []
      return [`${qty} × ${label}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`]
    })
    .join(', ')
}

/** The words of one alert at one step of its delivery. */
export function alertMessage(alert: AlertWords, context: MessageContext, step: Step): AlertMessage {
  const { venueName, source } = context
  const table = context.tableLabel ?? 'A table'
  switch (alert.kind) {
    case 'order_unconfirmed': {
      const reference = asText(alert.details.reference)
      const parts = [itemsOf(alert.details), reference === null ? '' : `ref ${reference}`].filter(
        (part) => part !== '',
      )
      return {
        title: `${table}: an order couldn’t be confirmed`,
        body: `${parts.join(', ')}. Check the bill in ${source}.`,
      }
    }
    case 'ordering_paused': {
      const barName = asText(alert.details.barName)
      const where =
        alert.details.scope === 'bar' && barName !== null ? `${barName}, ${venueName}` : venueName
      const still = step === 'reminder' || step === 'still_paused'
      if (step === 'back') return { title: `Ordering is back at ${where}`, body: '' }
      return {
        title: still ? `Ordering is still paused at ${where}` : `Ordering is paused at ${where}`,
        body: '',
      }
    }
    case 'pre_opening_check':
      return { title: `${venueName} can’t open: Restro can’t work with ${source}`, body: '' }
    case 'order_pace':
      return { title: `${venueName}: ${table} hit the order pace limit`, body: '' }
    case 'order_rate':
      return { title: `${venueName}: ${table} changed its order too fast`, body: '' }
    case 'connection_unstable':
      return { title: `${venueName}: the connection to ${source} is unstable`, body: '' }
    case 'table_code_block':
      return {
        title: `${venueName}: a network was blocked after too many wrong table codes`,
        body: '',
      }
    default:
      return { title: `${venueName}: ${alert.kind}`, body: '' }
  }
}

/** One message for several: one as it is, more as a list of their titles. */
export function digestMessage(messages: readonly AlertMessage[], venueName: string): AlertMessage {
  const [only] = messages
  if (messages.length === 1 && only !== undefined) return only
  return {
    title: `${messages.length} alerts at ${venueName}`,
    body: messages.map((message) => message.title).join('\n'),
  }
}

/** A message as Telegram shows it: title, then body. */
export function linkedMessage(message: AlertMessage): string {
  return message.body === '' ? message.title : `${message.title}\n${message.body}`
}

/** `Done by Maria, 02:14`: who answered, at the time on the venue's clocks. */
export function doneLine(by: string, at: Date, timeZone: string): string {
  const { hour, minute } = wallClock(at, timeZone)
  return `Done by ${by}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
