// The words of a payment (#115; paying plan `docs/deliverables/2026-10-29-tonight-paying-plan.md`):
// its state for the Log (`lg_pay_state`) and the reasons a payment was released for the end of the
// night, as message keys of the `tonight` namespace (`ps_*`, `pr_*`). A state or reason code with no
// word is never drawn raw: the Log words the step without a state (`lg_pay_plain`), and a test fails
// on a code core writes that has no word.
import type { Say } from './log-sentence'

/** Each payment state's word (`ps_*`), by the state code the Log keeps. */
export const PAYMENT_STATE_WORDS: Readonly<Record<string, string>> = {
  requested: 'ps_requested',
  priced: 'ps_priced',
  awaiting_guest: 'ps_awaiting_guest',
  held: 'ps_held',
  queued: 'ps_queued',
  isolated: 'ps_isolated',
  entered: 'ps_entered',
  checked: 'ps_checked',
  closed: 'ps_closed',
  cancelling: 'ps_cancelling',
  captured: 'ps_captured',
  released: 'ps_released',
  unconfirmed: 'ps_unconfirmed',
  stranded: 'ps_stranded',
  capture_failed: 'ps_capture_failed',
}

/** Why a payment was released (end of night, section 3), by the reason code: `pr_*`. */
export const PAYMENT_RELEASE_REASONS: Readonly<Record<string, string>> = {
  cancelled: 'pr_cancelled',
  busy: 'pr_busy',
  paying_paused: 'pr_paying_paused',
  paying_not_offered: 'pr_paying_not_offered',
  check_failed: 'pr_check_failed',
  no_receipt: 'pr_no_receipt',
  not_on_till: 'pr_not_on_till',
  expired: 'pr_expired',
  hold_refused: 'pr_hold_refused',
  below_minimum: 'pr_below_minimum',
  // The lead's words, awaiting Martin 10-30 (paying plan, "Release reasons").
  bill_changed: 'pr_bill_changed',
  ask_waiter_to_split: 'pr_ask_waiter_to_split',
  item_unavailable: 'pr_item_unavailable',
  enter_refused: 'pr_enter_refused',
  isolate_refused: 'pr_isolate_refused',
}

/** The state words of one language, for the Log's sentence context. */
export function paymentStateWords(say: Say): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(PAYMENT_STATE_WORDS).map(([code, key]) => [code, say(key)]),
  )
}

/** The reason's word, or null for a code with none (reported by the loader, never shown raw). */
export function releaseReasonWord(say: Say, reason: string | null): string | null {
  if (reason === null) return null
  const key = PAYMENT_RELEASE_REASONS[reason]
  return key === undefined ? null : say(key)
}

/** The answers a manager gives, by code: their words (`m_ok`, `m_no`, `m_till_*`). */
export const PAYMENT_ANSWER_WORDS: Readonly<Record<string, string>> = {
  receipt_printed: 'm_ok',
  no_receipt: 'm_no',
  on_till: 'm_till_ok',
  not_on_till: 'm_till_no',
  expired: 'pr_expired',
}
