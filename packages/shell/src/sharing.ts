// Sharing the bill by amount (D160 §3, #544): a group payment, where the guests of a table settle
// one bill together and each phone's card takes a part of it. "Split the amount" is the button's
// wording only — the thing is a group payment (GLOSSARY).
//
// Everything here is pure, so every face has the same rules and the same words:
//
// - `offersShare` says whether the bill screen shows "Split the amount" at all;
// - `sharePart` checks what the guest typed, or "The rest", against core's own limits (rule 8);
// - `shareBlock` says why Pay on "Your part" is greyed, and `shareScreen` which one screen this
//   phone draws for the share the host sent;
// - `shareStartCommand` and `shareHoldCommand` build the two commands a face sends.
//
// The face shows no success of its own (D72): "Paid" is this phone's hold `captured`, and the
// table's bill is paid only once the share itself says so.

import { type Currency, type Locale, type SharePartProblem, sharePartProblem } from '@restro/core'

import { parseMinor } from './money'
import { NO_TIP, type PayTotals, payMoney, payTotalsOf, type TipChoice } from './paying'
import {
  type GuestCommand,
  type PayingView,
  type ServiceState,
  SHARE_ENDS,
  SHARE_HOLD_STATES,
  type ShareEnd,
  type ShareHoldState,
  type ShareView,
} from './services'
import type { PayingStrings } from './strings'

export { SHARE_ENDS, SHARE_HOLD_STATES, type ShareEnd, type ShareHoldState }

/**
 * Whether the bill screen offers "Split the amount" beside Pay: paying is on here, the venue's POS
 * closes one bill with several card payments and guests here do not pay before they order
 * (`ordering.sharing`, D160 2.8), and neither this phone nor its table is in one already. Where it
 * is false the face draws Pay alone — never a button the server would refuse (`share_not_offered`).
 */
export function offersShare(state: ServiceState): boolean {
  return (
    state.ordering?.sharing === true &&
    state.paying != null &&
    state.paying.state === 'on' &&
    state.tableBill != null &&
    state.payment == null &&
    state.share == null
  )
}

/**
 * Whether a group payment is still taking parts: a phone may take one, or give its own back. Before
 * `awaiting_guest` the share is still being priced from the POS's own amounts, and nothing of it
 * can be claimed yet.
 */
export function shareGathering(share: ShareView): boolean {
  return share.state === 'awaiting_guest'
}

/**
 * The minutes a group payment still has (D160 2.4: it runs out 10 minutes after the first part),
 * rounded up and never below 1 while any time is left; null once it has run out or has no deadline.
 * `now` is the phone's own clock in milliseconds.
 */
export function shareMinutesLeft(endsAt: string | null, now: number): number | null {
  if (endsAt === null) return null
  const left = Date.parse(endsAt) - now
  if (Number.isNaN(left) || left <= 0) return null
  return Math.max(1, Math.ceil(left / 60_000))
}

/** What the guest chose as their part: an amount they typed, or "The rest" as one tap. */
export type SharePartChoice =
  | { readonly kind: 'rest' }
  | { readonly kind: 'amount'; readonly typed: string }

/** "The rest": what is left of the shared amount. */
export const SHARE_REST: SharePartChoice = { kind: 'rest' }

/** The part the guest chose, or why it cannot be taken. */
export type SharePart =
  /** `minor` is the part without the tip, ready for `share.hold`. */
  | { readonly kind: 'ok'; readonly minor: number }
  /** Nothing is typed yet: Pay is greyed with no words. */
  | { readonly kind: 'empty' }
  /** What is typed is not an amount: Pay is greyed with no words. */
  | { readonly kind: 'bad' }
  /** The amount is an amount, but the limits refuse it; the words are `strings.pay.share`. */
  | { readonly kind: 'problem'; readonly problem: SharePartProblem }

/**
 * Checks the part the guest chose against core's own limits (rule 8, D160 2.11 and 2.12): never
 * above what is left of the shared amount, never below the smallest card payment, and never
 * leaving the others a rest nobody could pay. "The rest" is what is left, which is refused only
 * where it is below the smallest card payment — nobody can pay it, so the waiter finishes the bill.
 */
export function sharePart(choice: SharePartChoice, share: ShareView): SharePart {
  if (choice.kind === 'amount' && choice.typed.trim() === '') return { kind: 'empty' }
  const minor =
    choice.kind === 'rest' ? share.leftMinor : parseMinor(choice.typed.replace(/\s/g, ''))
  if (minor === null || minor <= 0) return { kind: 'bad' }
  const problem = sharePartProblem({
    sharedMinor: share.sharedMinor,
    claimedMinor: share.claimedMinor,
    partMinor: minor,
    minimumMinor: share.minimumMinor,
  })
  return problem === null ? { kind: 'ok', minor } : { kind: 'problem', problem }
}

/** The words under the amount field for a part the limits refuse (D160 2.12). */
export function sharePartText(
  words: PayingStrings,
  problem: SharePartProblem,
  share: ShareView,
  locale: Locale,
): string {
  const amount = (minor: number) => payMoney(minor, share.currency, locale)
  switch (problem) {
    case 'above_share':
      return words.share.aboveShare(amount(share.leftMinor))
    case 'below_minimum':
      return words.share.smallestCard(amount(share.minimumMinor))
    case 'rest_below_minimum':
      return words.share.restBelowMinimum(amount(share.minimumMinor))
  }
}

/** Why Pay on "Your part" is greyed; the words are in `strings.pay` and `strings.pay.share`. */
export type ShareBlock =
  /** The phone has not reached Restro for about 10 s (D121): Pay is blocked, never queued. */
  | 'offline'
  | 'cards_paused'
  /** The share is no longer taking parts: covered, or let go. */
  | 'share_over'
  /** Nothing usable is typed yet (no words: the field says). */
  | 'no_amount'
  /** The amount is above what is left, below the smallest card payment, or leaves a bad rest. */
  | SharePartProblem
  | 'tip_too_big'

/**
 * Why Pay on "Your part" is greyed now, or null. The part is checked against the share as the host
 * last sent it: the server checks it again against the holds of the moment, and a part the others
 * overtook meanwhile is refused `above_share` with the fresh amount.
 */
export function shareBlock(
  share: ShareView,
  choice: SharePartChoice,
  paying: PayingView,
  tip: TipChoice,
  tipsOffered: boolean,
  /** `state.offline`: the phone is offline, so Pay is greyed whatever else holds (D121). */
  offline = false,
): ShareBlock | null {
  if (offline) return 'offline'
  if (paying.state === 'paused') return 'cards_paused'
  if (!shareGathering(share)) return 'share_over'
  const part = sharePart(choice, share)
  if (part.kind === 'empty' || part.kind === 'bad') return 'no_amount'
  if (part.kind === 'problem') return part.problem
  if (!payTotalsOf(part.minor, tip, tipsOffered).tipValid) return 'tip_too_big'
  return null
}

/** What this phone's part comes to with its tip: the hold the provider is asked for (D160 2.6). */
export function shareTotals(
  choice: SharePartChoice,
  share: ShareView,
  tip: TipChoice,
  tipsOffered: boolean,
): PayTotals {
  const part = sharePart(choice, share)
  return payTotalsOf(part.kind === 'ok' ? part.minor : 0, tip, tipsOffered)
}

/**
 * The `share.start` for the ticked lines, each line as the phone saw it (D111). It is the same pick
 * a Pay sends: the server prices the shared amount from the POS's own amounts, and this phone's own
 * part is a `share.hold` afterwards, with its own tip.
 */
export function shareStartCommand(
  actionId: string,
  start: Extract<GuestCommand, { kind: 'pay.start' }>,
): Extract<GuestCommand, { kind: 'share.start' }> {
  return { kind: 'share.start', actionId, pick: start.pick, seen: start.seen }
}

/** The `share.hold` for this phone's own part and its tip, or null while the part is refused. */
export function shareHoldCommand(
  actionId: string,
  share: ShareView,
  choice: SharePartChoice,
  chosen: TipChoice,
  tipsOffered: boolean,
): Extract<GuestCommand, { kind: 'share.hold' }> | null {
  const part = sharePart(choice, share)
  if (part.kind !== 'ok') return null
  const tip = tipsOffered ? chosen : NO_TIP
  const totals = payTotalsOf(part.minor, tip, tipsOffered)
  return {
    kind: 'share.hold',
    actionId,
    paymentId: share.id,
    // "The rest" goes as "the rest", so the server takes what is left at the moment it reads the
    // holds and a part claimed in between never makes this one refused (D160 2.11).
    part: choice.kind === 'rest' ? { kind: 'rest' } : { kind: 'amount', minor: part.minor },
    tipPercent: tip.kind === 'percent' ? tip.percent : null,
    tipMinor: tip.kind === 'other' && totals.tipMinor > 0 ? totals.tipMinor : null,
  }
}

/* ---------------------------------------------------------------------------------------------
 * The share's screens
 * ------------------------------------------------------------------------------------------- */

/** The one screen a group payment shows on this phone. */
export type ShareScreen =
  /** The share is taking parts and this phone has none: what is held, what is left, and Pay. */
  | { readonly kind: 'open' }
  /** This phone's part is being prepared. */
  | { readonly kind: 'preparing' }
  /** This phone's card form, with its part, its tip and "Pay X". */
  | { readonly kind: 'card' }
  /** This phone's part is held and the others' are still to come. */
  | { readonly kind: 'waiting' }
  /** This phone is giving its own part back. */
  | { readonly kind: 'releasing' }
  /** The shared amount is covered and the bill is being paid. */
  | { readonly kind: 'closing' }
  /** This phone's part was taken: paid. */
  | { readonly kind: 'paid' }
  /** The table paid, on a phone that took no part of its own. */
  | { readonly kind: 'settled' }
  /** "The venue is checking the payment": a capture that did not go through. */
  | { readonly kind: 'checking' }
  /** Ended with nothing charged; `again` offers "Start again". */
  | { readonly kind: 'ended'; readonly end: ShareEnd; readonly again: boolean }

/** The end reasons the ticket words, and the one that offers "Start again". */
const ENDS: Readonly<Record<string, { end: ShareEnd; again: boolean }>> = {
  expired: { end: 'expired', again: false },
  cancelled: { end: 'cancelled', again: false },
  withdrawn: { end: 'withdrawn', again: false },
  // The bill moved under the share, so nothing was charged and the picking starts over (2.13).
  bill_changed: { end: 'bill_changed', again: true },
}

function endedScreen(reason: string | null): ShareScreen {
  const known = reason === null ? undefined : ENDS[reason]
  return { kind: 'ended', end: known?.end ?? 'other', again: known?.again ?? false }
}

/** What the share itself shows on a phone that has no part of its own. */
function shareOnly(share: ShareView): ShareScreen {
  switch (share.state) {
    // The shared amount is still being priced: nothing to claim and nothing to show of it yet.
    case 'requested':
    case 'priced':
      return { kind: 'preparing' }
    case 'awaiting_guest':
      return { kind: 'open' }
    case 'held':
    case 'queued':
    case 'isolated':
    case 'entered':
    case 'checked':
    case 'closed':
    case 'cancelling':
      return { kind: 'closing' }
    case 'captured':
      return { kind: 'settled' }
    case 'unconfirmed':
    case 'stranded':
    case 'capture_failed':
      return { kind: 'checking' }
    case 'released':
      return endedScreen(share.reason)
  }
}

/**
 * The one screen this phone draws for a group payment. A phone with no part of its own follows the
 * share; a phone with one follows its own hold, because that is what its card did. Only `captured`
 * is ever drawn as paid (D72), and a guest who took their part back while the share still gathers
 * comes back to the share rather than to an ending.
 */
export function shareScreen(share: ShareView): ShareScreen {
  const mine = share.mine
  if (mine === null) return shareOnly(share)
  switch (mine.state) {
    case 'requested':
      return { kind: 'preparing' }
    case 'awaiting_guest':
      return mine.form === null ? { kind: 'preparing' } : { kind: 'card' }
    case 'held':
      // The part is safe; what shows is whether the table is still gathering or already paying.
      return shareGathering(share) ? { kind: 'waiting' } : { kind: 'closing' }
    case 'releasing':
      return { kind: 'releasing' }
    case 'captured':
      return { kind: 'paid' }
    case 'capture_failed':
      return { kind: 'checking' }
    case 'released':
      // The guest gave this part back and the others are still taking theirs: back to the share.
      return shareGathering(share) ? { kind: 'open' } : endedScreen(mine.reason ?? share.reason)
  }
}

/** Whether this phone may still give its own part back (D160 2.5: until the amount is covered). */
export function offersTakeBack(share: ShareView): boolean {
  const mine = share.mine
  return (
    mine !== null &&
    shareGathering(share) &&
    (mine.state === 'awaiting_guest' || mine.state === 'held')
  )
}

/** The words of a group payment that ended with nothing charged. */
export function shareEndText(words: PayingStrings, end: ShareEnd): string {
  return end === 'bill_changed' ? words.share.billChanged : words.share.nothingCharged
}

/** "27,50 EUR of 109,00 EUR paid · 81,50 EUR left": what the table has covered so far. */
export function shareProgressText(
  words: PayingStrings,
  share: ShareView,
  locale: Locale,
  currency: Currency = share.currency,
): string {
  const amount = (minor: number) => payMoney(minor, currency, locale)
  return words.share.progress(
    amount(share.heldMinor),
    amount(share.sharedMinor),
    amount(share.leftMinor),
  )
}
