// The Log's sentences (Log plan §8): one per kind of `LOG_KINDS`, made from the semantic parts of
// a line (`LogLineView`) and the plan's strings. Pure: the translator, the table's name and the
// money are passed in. `lease.taken_over` and `payment.hold_unread` have no sentence and never show
// (D120); every other kind has one, and the compiler and a test both fail when a kind has none, so "Something
// happened (kind)" can never be drawn.
import type { LogLineView } from '@/server/tonight/night-view'

import { callKindsText } from './call-kinds'

/** One kind of Log entry (core's `LogKind`, as the view carries it). */
type LogKind = LogLineView['kind']

/** The translator of the `tonight` messages. */
export type Say = (key: string, values?: Record<string, string | number>) => string

/** What a sentence needs besides the line. */
export interface SentenceContext {
  readonly say: Say
  /** The line's table as the screen words it ("Table 7"), or "the table". */
  readonly table: (line: LogLineView) => string
  /** A person's name, Restro or a guest's phone, with " · via Telegram" where it applies. */
  readonly who: (by: LogLineView['by']) => string
  readonly money: (minor: number) => string
  readonly source: string
  /**
   * Part 2's words for a payment's state (#115), by state code. Empty until it fills them: a
   * payment step with no word is worded without a state, never with a raw code.
   */
  readonly paymentStates: Readonly<Record<string, string>>
}

type Sentence = (line: LogLineView, c: SentenceContext) => string

const ref = (line: LogLineView) => line.reference ?? ''

function scopeText(line: LogLineView, c: SentenceContext): string {
  const scope = line.scope
  if (scope === null || scope.kind === 'venue') return c.say('p_all')
  if (scope.kind === 'bar') return scope.name ?? c.say('p_all')
  if (scope.kind === 'table') return c.table(line)
  return c.say('lg_sc_conn', { source: c.source })
}

function causeText(line: LogLineView, c: SentenceContext): string | null {
  switch (line.cause) {
    case 'staff':
      return c.say('lg_cz_staff', { who: c.who(line.by) })
    case 'unconfirmed':
      return c.say('lg_cz_unconfirmed')
    case 'guard':
      return c.say('lg_cz_guard')
    case 'vanished':
      return c.say('lg_cz_vanished', { source: c.source })
    case 'unreachable':
      return c.say('rs_unreachable', { source: c.source })
    default:
      return null
  }
}

function stateText(line: LogLineView, c: SentenceContext): string {
  const word = line.state === null ? '' : stateWordText(line.state, c)
  return line.reason === null
    ? word
    : `${word} (${c.say(`rs_${line.reason}`, { source: c.source })})`
}

function stateWordText(state: NonNullable<LogLineView['state']>, c: SentenceContext): string {
  return state === 'approval' ? c.say('st_approval', { source: c.source }) : c.say(`st_${state}`)
}

/** The Log's word for each answer a manager gives: the receipt's or the till's own, never swapped. */
const PAYMENT_ANSWER_LOG_WORDS = {
  receipt_printed: 'lg_pay_ok',
  no_receipt: 'lg_pay_no',
  on_till: 'lg_pay_till',
  not_on_till: 'lg_pay_notill',
} as const

/**
 * The word for what a reservation became (#323): the party's status, or "changed" for a code the
 * screen has no word for, so a raw code is never drawn. "Not seated" is its own word and is never
 * worded as a no-show (D140).
 */
const RESERVATION_STATE_WORDS: Readonly<Record<string, string>> = {
  reserved: 'lg_rv_s_reserved',
  waiting: 'lg_rv_s_waiting',
  seated: 'lg_rv_s_seated',
  finished: 'lg_rv_s_finished',
  no_show: 'lg_rv_s_no_show',
  cancelled: 'lg_rv_s_cancelled',
  not_seated: 'lg_rv_s_not_seated',
  requested: 'lg_rv_s_requested',
  deleted: 'lg_rv_s_deleted',
}

function reservationStateText(line: LogLineView, c: SentenceContext): string {
  const key =
    line.reservationStatus === null ? undefined : RESERVATION_STATE_WORDS[line.reservationStatus]
  return c.say(key ?? 'lg_rv_s_other')
}

/** What a change to the floor plan's spots was: a spot of the plan, or a kind of spot (#323). */
const SPOT_SENTENCES: Readonly<Record<string, string>> = {
  created: 'lg_spot_added',
  removed: 'lg_spot_removed',
  kind_saved: 'lg_spot_kind',
  kind_removed: 'lg_spot_kind_removed',
  seats: 'lg_spot_seats',
}

/** Which reservation rule a settings change moved, when it was one (#325). */
const SETTINGS_SENTENCES: Readonly<Record<string, string>> = {
  turn_time: 'lg_rv_set_turn_time',
  phone_required: 'lg_rv_set_phone',
  edit_past: 'lg_rv_set_past',
  private_list: 'lg_rv_set_private',
  closed_date_added: 'lg_rv_set_closed_added',
  closed_date_removed: 'lg_rv_set_closed_removed',
}

/** The word for each pay rule a reservation can carry (#334); no rule reads as the club's own. */
const PAY_RULE_SENTENCES: Readonly<Record<string, string>> = {
  venue: 'lg_rv_pr_venue',
  on_bill: 'lg_rv_pr_on_bill',
  pay_first: 'lg_rv_pr_pay_first',
}

/** What a change to a guest's record was; its details are never in the sentence (D140). */
const GUEST_SENTENCES: Readonly<Record<string, string>> = {
  archived: 'lg_guest_archived',
  note_kept: 'lg_guest_note',
  note_cleared: 'lg_guest_note_cleared',
}

/** The sentence of each shown kind; `null` is a kind that never shows. */
export const SENTENCES = {
  'sitting.opened': (l, c) => c.say('lg_opened', { table: c.table(l) }),
  'sitting.ended': (l, c) => c.say('lg_ended', { table: c.table(l) }),
  'sent_order.state': (l, c) =>
    l.answer !== null
      ? c.say('lg_so_answer', {
          ref: ref(l),
          answer: c.say(l.answer === 'found' ? 's_ok' : 's_no'),
        })
      : c.say('lg_so_state', { ref: ref(l), state: stateText(l, c) }),
  'sent_order.landed_late': (l, c) => c.say('lg_so_late', { ref: ref(l) }),
  'pause.started': (l, c) => {
    const cause = causeText(l, c)
    const base = c.say('lg_paused', { scope: scopeText(l, c) })
    return cause === null ? base : `${base} · ${cause}`
  },
  'pause.lifted': (l, c) => c.say('lg_lifted', { scope: scopeText(l, c) }),
  'alert.raised': (l, c) => c.say('lg_alert', { alert: l.alertTitle ?? '' }),
  'alert.done': (l, c) => c.say('lg_alert_done', { alert: l.alertTitle ?? '' }),
  'alert.cleared': (l, c) => c.say('lg_alert_cleared', { alert: l.alertTitle ?? '' }),
  // A call's requests are named: the one this entry added, or every kind the call held (#180).
  'waiter_call.called': (l, c) =>
    c.say('lg_call', { table: c.table(l), kinds: callKindsText(c.say, l.callKinds) }),
  'waiter_call.done': (l, c) =>
    l.callUndone
      ? c.say('lg_call_undone', { who: c.who(l.by), table: c.table(l) })
      : c.say('lg_call_done', { table: c.table(l), kinds: callKindsText(c.say, l.callKinds) }),
  'waiter_call.lapsed': (l, c) =>
    c.say('lg_call_lapsed', { table: c.table(l), kinds: callKindsText(c.say, l.callKinds) }),
  // Screen 1's `r_toast` for the mark, as Martin confirmed for the Log (#200); its Undo has its
  // own words, chosen by the state the line carries (the lead's words, awaiting Martin).
  'receipt.brought': (l, c) =>
    l.receipt?.undone === true
      ? c.say('lg_receipt_unbrought', { who: c.who(l.by), n: l.receipt.paymentNumber ?? '' })
      : c.say('lg_receipt_brought', { table: c.table(l) }),
  'service_day.closed': (l, c) => c.say('lg_day_closed', { n: l.sentOrdersOfDay ?? 0 }),
  'guard.tripped': (l, c) => c.say('lg_guard', { what: c.say(`lg_g_${l.guard ?? 'other'}`) }),
  'settings.changed': (l, c) =>
    c.say('lg_settings', {
      what: c.say(l.setting === 'pay_table' ? 'lg_w_pay_table' : 'lg_w_setting'),
    }),
  // A role change names the role and how many abilities it holds now (#366): a default role the
  // venue ticked is read in the Log like any other, and the keys themselves are in the entry.
  'role.changed': (l, c) => {
    const role = l.subject ?? c.say('lg_someone')
    return l.heldCount === null
      ? c.say('lg_role', { role })
      : c.say('lg_role_holds', { role, n: l.heldCount })
  },
  // A person getting or losing a role is a change of staff (no sentence of its own in the plan).
  'assignment.changed': (l, c) => c.say('lg_staff', { who: l.subject ?? c.say('lg_someone') }),
  'staff.changed': (l, c) => c.say('lg_staff', { who: l.subject ?? c.say('lg_someone') }),
  'pin.changed': (l, c) => c.say('lg_pin', { who: l.subject ?? c.say('lg_someone') }),
  'pin.revealed': (l, c) => c.say('lg_pin_seen', { who: l.subject ?? c.say('lg_someone') }),
  'device.changed': (l, c) => c.say('lg_device', { device: l.subject ?? c.say('lg_someone') }),
  'table_code.reissued': (l, c) => c.say('lg_code_new', { table: c.table(l) }),
  'table_code.revealed': (l, c) => c.say('lg_code_seen', { table: c.table(l) }),
  'payment.state': (l, c) => {
    const word = l.paymentState === null ? undefined : c.paymentStates[l.paymentState]
    return word === undefined || l.amountMinor === null
      ? c.say('lg_pay_plain', { table: c.table(l) })
      : c.say('lg_pay_state', { table: c.table(l), amount: c.money(l.amountMinor), state: word })
  },
  'payment.answered': (l, c) =>
    c.say('lg_pay_answer', {
      table: c.table(l),
      answer: c.say(PAYMENT_ANSWER_LOG_WORDS[l.paymentAnswer ?? 'no_receipt']),
    }),
  // A refund the venue made at its provider (#222). A refund that did not go through says so, in
  // the sheet's words; the storno taken back by Undo has the lead's words, awaiting Martin.
  'payment.refund_seen': (l, c) => {
    const provider = l.provider ?? c.say('pb_provider_none')
    return l.refundFailed
      ? c.say('py_refund_failed', { provider })
      : c.say('lg_pay_refund', { amt: c.money(l.amountMinor ?? 0), provider })
  },
  // "Got it" on a refund that did not go through, and its Undo (#234; the Undo's words: Martin 10-30).
  'payment.refund_failed_seen': (l, c) =>
    c.say(l.refundSeenUndone ? 'lg_pay_refund_seen_undone' : 'lg_pay_refund_seen'),
  'payment.storno': (l, c) => c.say(l.stornoUndone ? 'lg_pay_storno_undone' : 'lg_pay_storno'),
  'payment.dispute': (l, c) =>
    c.say('lg_pay_dispute', {
      state: c.say(
        l.disputeState === 'open' || l.disputeState === null
          ? 'py_disputed'
          : l.disputeState === 'lost'
            ? 'd_lost'
            : 'd_won',
      ),
    }),
  // Reservations (#323; D141: they write to the same Log as ordering). A line says what happened
  // to the booking, never who the guest is: his name and number stay in his record (D140).
  'reservation.created': (l, c) => c.say('lg_rv_created', { state: reservationStateText(l, c) }),
  'reservation.changed': (l, c) => c.say('lg_rv_changed', { state: reservationStateText(l, c) }),
  'reservation.status': (l, c) => c.say('lg_rv_status', { state: reservationStateText(l, c) }),
  'reservation.restored': (l, c) => c.say('lg_rv_restored', { state: reservationStateText(l, c) }),
  'reservation.spots': (l, c) =>
    c.say(l.reservationStatus === 'released' ? 'lg_rv_freed' : 'lg_rv_held'),
  // The pay rule a party carries (#334, D135): the rule it became, never an amount (D136).
  'reservation.pay_rule': (l, c) =>
    c.say('lg_rv_pay_rule', {
      rule: c.say(
        (l.reservationStatus === null ? undefined : PAY_RULE_SENTENCES[l.reservationStatus]) ??
          'lg_rv_pr_venue',
      ),
    }),
  // The night's end (#332; D138): at the closing hour, or an admin's early end, with the bills it
  // found still open — the closing hour's warning, counted and named here.
  'night.closed': (l, c) =>
    l.endedEarly
      ? c.say('lg_night_ended_early', { who: c.who(l.by), n: l.openBills ?? 0 })
      : c.say('lg_night_ended', { n: l.openBills ?? 0 }),
  'plan.changed': (l, c) =>
    c.say(l.reservationStatus === 'removed' ? 'lg_plan_removed' : 'lg_plan_changed'),
  'spot.changed': (l, c) =>
    c.say(
      (l.reservationStatus === null ? undefined : SPOT_SENTENCES[l.reservationStatus]) ??
        'lg_spot_changed',
    ),
  'reservation_settings.changed': (l, c) =>
    c.say(
      (l.reservationStatus === null ? undefined : SETTINGS_SENTENCES[l.reservationStatus]) ??
        'lg_rv_settings',
    ),
  'guest.changed': (l, c) =>
    c.say(
      (l.reservationStatus === null ? undefined : GUEST_SENTENCES[l.reservationStatus]) ??
        'lg_guest_changed',
    ),
  'guest.erased': (_l, c) => c.say('lg_guest_erased'),
  // The sweep of the parties nobody seated, which the worker does when a night ends unclosed.
  'night.swept': (_l, c) => c.say('lg_rv_night_swept'),
  'lease.taken_over': null,
  'payment.hold_unread': null,
} as const satisfies Record<LogKind, Sentence | null>

/** The sentence of a line; null for the kind that never shows. */
export function logSentence(line: LogLineView, c: SentenceContext): string | null {
  const make: Sentence | null = SENTENCES[line.kind]
  return make === null ? null : make(line, c)
}
