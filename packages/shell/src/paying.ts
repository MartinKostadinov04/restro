// Paying from the bill (#114, D127 "The guest's bill screen"): what a face needs to draw choosing,
// the tip, the pay button and the screens a payment passes through, as pure functions with no
// React, so every face has the same rules.
//
// - `choosePay` adds up the lines the guest ticked and the tip (5, 10, 15 % or an amount, rounded
//   half-up through core's money module, rule 8). It is the screen's preview: the hold is priced by
//   the server from the POS's own amounts, and the face shows no success of its own (D72).
// - `payBlock` says why Pay is greyed.
// - `payStartCommand` builds the `pay.start` the face sends, each ticked line as the phone saw it.
// - `reconcilePicks` keeps the ticks across a fresh bill and clears only those of lines that changed
//   or went (a friend's new round never clears one, D127).
// - `payScreen` turns the paying phone's payment into the one screen to draw.

import {
  addMinor,
  type Currency,
  type Locale,
  localeToBcp47,
  percentOfMinor,
  sumSignedMinor,
} from '@restro/core'

import { viewMinor } from './money'
import { PAY_ENDS, type PayEnd } from './service-vocabulary'
import type { ServiceStrings } from './strings'

export { PAY_ENDS, type PayEnd }

import type {
  GuestCommand,
  PayingView,
  PaymentView,
  PaySeenLine,
  ServiceState,
  TableBillLineView,
  TableBillView,
} from './services'

/** The tip presets in whole percent of the chosen lines (D127). */
export const TIP_PERCENTS = [5, 10, 15] as const

/** One tip preset. */
export type TipPercent = (typeof TIP_PERCENTS)[number]

/** What the guest chose for the tip: nothing to start with; presets are never preselected. */
export type TipChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'percent'; readonly percent: TipPercent }
  | { readonly kind: 'other'; readonly minor: number }

/** No tip. */
export const NO_TIP: TipChoice = { kind: 'none' }

/** What was ticked: each line as the phone saw it when ticking, by line id. */
export type Picks = ReadonlyMap<string, PaySeenLine>

/** Every line of the bill a guest may tick: not in a payment that isn't final. */
export function freeLines(bill: TableBillView): readonly TableBillLineView[] {
  return bill.parts.flatMap((part) =>
    part.beingPaid ? [] : part.lines.filter((line) => !line.beingPaid),
  )
}

/** The line as the phone saw it. */
function seenOf(line: TableBillLineView): PaySeenLine {
  return { lineId: line.id, quantity: line.quantity, amountMinor: line.amountMinor }
}

/** Ticks `lineId`, or clears it when it is ticked. A line being paid is never ticked. */
export function togglePick(picks: Picks, bill: TableBillView, lineId: string): Picks {
  const next = new Map(picks)
  if (next.delete(lineId)) return next
  const line = freeLines(bill).find((candidate) => candidate.id === lineId)
  if (line !== undefined) next.set(lineId, seenOf(line))
  return next
}

/** "The whole bill": ticks every line free to pay, or clears all when they are all ticked. */
export function pickWhole(picks: Picks, bill: TableBillView): Picks {
  const free = freeLines(bill)
  if (free.length > 0 && free.every((line) => picks.has(line.id))) return new Map()
  return new Map(free.map((line) => [line.id, seenOf(line)]))
}

/**
 * Keeps the ticks across a fresh bill (a face does not call it while this phone has a payment: the
 * server marks that payment's own lines `beingPaid`, which would empty the ticks "Pay again" keeps) and clears those of lines that changed (another quantity or
 * amount than the guest ticked), went, or are now in a payment. A friend's new round changes none.
 */
export function reconcilePicks(picks: Picks, bill: TableBillView): Picks {
  const free = new Map(freeLines(bill).map((line) => [line.id, line]))
  const kept = new Map<string, PaySeenLine>()
  for (const [id, seen] of picks) {
    const line = free.get(id)
    if (
      line !== undefined &&
      line.quantity === seen.quantity &&
      line.amountMinor === seen.amountMinor
    ) {
      kept.set(id, seen)
    }
  }
  return kept.size === picks.size ? picks : kept
}

/** What the screen adds up for the ticked lines and the tip. */
export interface PayTotals {
  /** The ticked lines' amounts. */
  readonly itemsMinor: number
  /** The tip, 0 for none. */
  readonly tipMinor: number
  readonly totalMinor: number
  /** Each preset's amount on the ticked lines, for the buttons. */
  readonly presets: readonly { readonly percent: TipPercent; readonly tipMinor: number }[]
  /** False when the tip is more than the lines (the server refuses it). */
  readonly tipValid: boolean
}

/**
 * Adds up the ticked lines and the tip. The tip is of the ticked lines only (D127). Where no tip is
 * offered (`tipsOffered` false: the POS cannot record one), the tip is none, whatever was chosen
 * before the flag changed.
 */
export function choosePay(picks: Picks, chosen: TipChoice, tipsOffered: boolean): PayTotals {
  const tip = tipsOffered ? chosen : NO_TIP
  const itemsMinor = sumSignedMinor([...picks.values()].map((line) => line.amountMinor))
  const base = Math.max(itemsMinor, 0)
  const presets = TIP_PERCENTS.map((percent) => ({
    percent,
    tipMinor: percentOfMinor(base, percent),
  }))
  const tipMinor =
    tip.kind === 'none'
      ? 0
      : tip.kind === 'other'
        ? tip.minor
        : (presets.find((preset) => preset.percent === tip.percent)?.tipMinor ?? 0)
  return {
    itemsMinor,
    tipMinor,
    totalMinor: addMinor(base, tipMinor),
    presets,
    tipValid: tipMinor <= base,
  }
}

/** Why Pay is greyed; the guest's words are in `strings.pay`. */
export type PayBlock =
  | 'cards_paused'
  | 'not_up_to_date'
  | 'nothing_picked'
  | 'below_minimum'
  | 'tip_too_big'

/**
 * Why Pay is greyed now, or null. Paying off at the venue shows no Pay button at all
 * (`paying.state` `off`: "Ask your waiter to pay."), so it is not a block.
 */
export function payBlock(
  paying: PayingView,
  bill: TableBillView,
  picks: Picks,
  tip: TipChoice,
  tipsOffered: boolean,
): PayBlock | null {
  if (paying.state === 'paused') return 'cards_paused'
  if (!bill.complete) return 'not_up_to_date'
  if (picks.size === 0) return 'nothing_picked'
  const totals = choosePay(picks, tip, tipsOffered)
  if (!totals.tipValid) return 'tip_too_big'
  // The smallest card payment is measured on what is held: the lines plus the tip (D127).
  if (totals.totalMinor < paying.minCardMinor) return 'below_minimum'
  return null
}

/** The `pay.start` for the ticked lines and the tip, each line as the phone saw it. */
export function payStartCommand(
  actionId: string,
  picks: Picks,
  chosen: TipChoice,
  tipsOffered: boolean,
): Extract<GuestCommand, { kind: 'pay.start' }> {
  const tip = tipsOffered ? chosen : NO_TIP
  const totals = choosePay(picks, tip, tipsOffered)
  const seen = [...picks.values()]
  return {
    kind: 'pay.start',
    actionId,
    pick: {
      kind: 'lines',
      lines: seen.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
    },
    seen,
    // A preset goes as its percent (the server prices it), an amount as the amount.
    tipPercent: tip.kind === 'percent' ? tip.percent : null,
    tipMinor: tip.kind === 'other' && totals.tipMinor > 0 ? totals.tipMinor : null,
  }
}

/** Whether the bill screen offers Pay: a bill, paying on or paused, and no payment of this phone's. */
export function offersPay(state: ServiceState): boolean {
  const paying = state.paying
  return (
    paying != null && paying.state !== 'off' && state.tableBill != null && state.payment == null
  )
}

/* ---------------------------------------------------------------------------------------------
 * The payment's screens
 * ------------------------------------------------------------------------------------------- */

/** The one screen a payment shows. */
export type PayScreen =
  /** "Preparing your bill…" with Pay later. */
  | { readonly kind: 'preparing' }
  /** The lines, tip, total, the card form and "Pay X" with Pay later. */
  | { readonly kind: 'card' }
  /** "Processing your payment…": everything between the hold and the capture. */
  | { readonly kind: 'waiting' }
  /** "Paid", the payment number, the lines. */
  | { readonly kind: 'paid' }
  /** "The venue is checking the payment": unconfirmed, stranded, capture failed. */
  | { readonly kind: 'checking' }
  /** Ended with nothing charged; `again` offers "Pay again". `cancelled` is the guest's own. */
  | { readonly kind: 'ended'; readonly end: PayEnd; readonly again: boolean }

/** The release reasons the guide words, and the ones that offer "Pay again". */
const ENDS: Readonly<Record<string, { end: PayEnd; again: boolean }>> = {
  busy: { end: 'busy', again: true },
  paying_paused: { end: 'paying_paused', again: false },
  paying_not_offered: { end: 'paying_off', again: false },
  enter_refused: { end: 'enter_refused', again: false },
  item_unavailable: { end: 'item_unavailable', again: false },
  bill_changed: { end: 'check_failed', again: true },
  check_failed: { end: 'check_failed', again: true },
  isolate_refused: { end: 'isolate_refused', again: false },
  not_on_till: { end: 'no_receipt', again: false },
  no_receipt: { end: 'no_receipt', again: false },
  expired: { end: 'expired', again: true },
  cancelled: { end: 'cancelled', again: false },
}

/**
 * The screen for this phone's payment. Everything between the hold and the capture is one waiting
 * state with no step of the till named; only `captured` is ever drawn as paid. A release reason the
 * guide has no words for is `other` (worded calmly with "Nothing was charged").
 */
export function payScreen(payment: PaymentView): PayScreen {
  switch (payment.state) {
    case 'requested':
    case 'priced':
      return { kind: 'preparing' }
    case 'awaiting_guest':
      return payment.form === null ? { kind: 'preparing' } : { kind: 'card' }
    case 'held':
    case 'queued':
    case 'isolated':
    case 'entered':
    case 'checked':
    case 'closed':
    case 'cancelling':
      return { kind: 'waiting' }
    case 'captured':
      return { kind: 'paid' }
    case 'unconfirmed':
    case 'stranded':
    case 'capture_failed':
      return { kind: 'checking' }
    case 'released': {
      const known = payment.reason === null ? undefined : ENDS[payment.reason]
      return { kind: 'ended', end: known?.end ?? 'other', again: known?.again ?? false }
    }
  }
}

/**
 * True once the payment cannot change: the page stops polling it. `unconfirmed` is not final: a
 * manager's answer moves it to captured or released (D127 3.5), so the page keeps reading it.
 */
export function paymentIsFinal(payment: PaymentView): boolean {
  return (
    payment.state === 'captured' ||
    payment.state === 'released' ||
    payment.state === 'stranded' ||
    payment.state === 'capture_failed'
  )
}

/** The same amount within this many minutes asks "Pay again?" first (D127). */
export const SAME_AMOUNT_MINUTES = 15

/** The minutes ago to name in the check, or null when the amounts differ or it was long ago. */
export function sameAmountAgo(
  recent: { readonly amountMinor: number; readonly agoSeconds: number } | null | undefined,
  totalMinor: number,
): number | null {
  if (recent == null || recent.amountMinor !== totalMinor) return null
  if (recent.agoSeconds >= SAME_AMOUNT_MINUTES * 60) return null
  return Math.max(1, Math.round(recent.agoSeconds / 60))
}

/** An amount of the paying screens as text for the guest's language ("27,50 EUR" / "27.50 EUR"). */
export function payMoney(minor: number, currency: Currency, locale: Locale): string {
  return viewMinor(minor, currency, locale).text
}

/** The language code a card form is shown in ("bg", "en"): the shell's locale without its region. */
export function payFormLocale(locale: Locale): string {
  return localeToBcp47(locale).split('-')[0] ?? 'en'
}

/**
 * The words for a refusal. The one place a face turns a code into words: `below_minimum` carries
 * the venue's own smallest card payment (`minCard`, the amount as text), and `rate_limited` on a
 * pay command is the guide's "Too many tries" rather than the order's "Too many changes". A code
 * the guide has no words for is `refusedOther`.
 */
export function refusalText(
  words: ServiceStrings,
  code: string | null | undefined,
  context: { readonly command?: string; readonly minCard?: string | null } = {},
): string {
  if (code === null || code === undefined) return words.refusedOther
  if (code === 'below_minimum') {
    return context.minCard == null ? words.refusedOther : words.paying.belowMinimum(context.minCard)
  }
  if (code === 'rate_limited' && context.command?.startsWith('pay.'))
    return words.paying.rateLimited
  return Object.hasOwn(words.refusals, code)
    ? words.refusals[code as keyof typeof words.refusals]
    : words.refusedOther
}
