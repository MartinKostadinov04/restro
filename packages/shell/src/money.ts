// R4 Money: amounts arrive as integer minor units and leave as text for the locale and the
// snapshot currency. The shell may format; it never computes a price (no sums, no products), and
// it never turns minor units into a float (`formatMoney` hands Intl an exact decimal string).

import { type Currency, formatMoney, type Locale, type Money } from '@restro/core'

import type { Strings } from './strings'

/** An amount as shown: the minor units it came from and its text. */
export interface ViewMoney {
  readonly minor: number
  readonly currency: Currency
  readonly text: string
}

/** A price as shown: `from` marks "from 12,50 €" (the cheapest way to order the item). */
export interface ViewPrice {
  readonly minor: number
  readonly currency: Currency
  /** The amount alone: "12,50 €". */
  readonly amount: string
  readonly from: boolean
  /** What a face prints: the amount, or "from …". */
  readonly text: string
}

/** One amount in the snapshot currency. */
export function viewMoney(money: Money, currency: Currency, locale: Locale): ViewMoney {
  return {
    minor: money.amount_minor,
    currency,
    text: formatMoney(money.amount_minor, currency, locale),
  }
}

/** An option's price delta, "+3,00 €". A delta of zero shows nothing (R8), and so does none. */
export function viewDelta(
  money: Money | null,
  currency: Currency,
  locale: Locale,
): ViewMoney | null {
  if (money === null || money.amount_minor === 0) return null
  const amount = viewMoney(money, currency, locale)
  return { ...amount, text: `+${amount.text}` }
}

/**
 * The item's price: `price_from` (the cheapest total, shown as "from …") when the snapshot has
 * one, otherwise the price, otherwise nothing (unpriced items have no price slot).
 */
export function viewPrice(
  price: Money | null,
  priceFrom: Money | null,
  currency: Currency,
  locale: Locale,
  strings: Strings,
): ViewPrice | null {
  const shown = priceFrom ?? price
  if (shown === null) return null
  const amount = formatMoney(shown.amount_minor, currency, locale)
  const from = priceFrom !== null
  return {
    minor: shown.amount_minor,
    currency,
    amount,
    from,
    text: from ? strings.fromPrice(amount) : amount,
  }
}
