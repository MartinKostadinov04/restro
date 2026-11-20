// What the three other Tonight screens draw (#86; plans
// `docs/deliverables/2026-10-27-tonight-{sent-orders,log,end-of-night}-plan.md`), made from core's
// reads by pure functions so the words, the order and the permissions can be tested without a
// database. Plain data, safe to send to the browser: our ids and public fields only (rule 3),
// times as text in the venue's zone, money as minor units (the screen formats it through the
// `money` module).
import { REFUSAL_CODES } from '@restro/core'
import {
  type AlertLocale,
  alertMessage,
  type LogKind,
  type LogLine,
  type LogPage,
  type NightAccess,
  type NightFixRow,
  type NightRead,
  paymentNumberOf,
  type SentOrderDetail,
  type SentOrderPage,
  type SentOrderRow,
  tableLabel,
  type Who,
} from '@restro/core/service'

import { providerDisplayName } from '@/connectors/notices'

import type { ActionRow, Can } from './view'

/** The venue's own time, `HH:mm`, whatever the server's zone is (the CLAUDE.md time rule). */
export function clockIn(timezone: string): (value: Date | string | null) => string | null {
  const hours = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
  return (value) => (value === null ? null : hours.format(new Date(value)))
}

// ───────────────────────────── the words of a sent order ─────────────────────────────

/** The state words of a sent order (plan §8, `st_*`). */
export type StateWord =
  | 'waiting'
  | 'sending'
  | 'checking'
  | 'added'
  | 'approval'
  | 'notsent'
  | 'check'

const STATE_WORDS: Readonly<Record<string, StateWord>> = {
  waiting: 'waiting',
  sending: 'sending',
  checking: 'checking',
  added: 'added',
  awaiting_approval: 'approval',
  not_sent: 'notsent',
  unconfirmed: 'check',
}

/** The word of a state code; an unknown state reads as "Check the bill", the cautious one. */
export function stateWord(state: string | null): StateWord | null {
  if (state === null) return null
  return STATE_WORDS[state] ?? 'check'
}

/** The reason words (plan §8, `rs_*`). */
export type ReasonWord = 'soldout' | 'refused' | 'paused' | 'closed' | 'hours' | 'unreachable'

const REASON_WORDS: Readonly<Record<string, ReasonWord>> = {
  // The POS says an item ran out, or the item isn't on the POS: the guest sees "sold out".
  item_unavailable: 'soldout',
  item_not_on_pos: 'soldout',
  ordering_paused: 'paused',
  table_closed: 'closed',
  staff_closed: 'closed',
  closing_hour: 'hours',
  pos_unreachable: 'unreachable',
  pos_unavailable: 'unreachable',
  // The POS can't place it: no POS table for it.
  pos_table_missing: 'refused',
  // Every other refusal the POS can give (`REFUSAL_CODES`).
  ...Object.fromEntries(
    REFUSAL_CODES.filter((code) => code !== 'item_unavailable').map((code) => [code, 'refused']),
  ),
}

/**
 * Codes that sit on a sent order and are rightly worded elsewhere or not at all: the staff
 * answers (shown as the answer), and why an order ended Unconfirmed (the row says "Check the
 * bill" and nothing more).
 */
const SILENT_REASONS: ReadonlySet<string> = new Set([
  'staff_found',
  'staff_not_found',
  'check_timed_out',
  'check_ambiguous',
])

/** The reason's word and whether the code has no word at all (reported, never shown raw). */
export function reasonWordOf(reason: string | null): {
  readonly word: ReasonWord | null
  readonly unknown: boolean
} {
  if (reason === null || SILENT_REASONS.has(reason)) return { word: null, unknown: false }
  const word = REASON_WORDS[reason]
  return word === undefined ? { word: null, unknown: true } : { word, unknown: false }
}

/** Every reason code with a word, for the test that lists what core writes. */
export const REASON_WORD_CODES: readonly string[] = [
  ...Object.keys(REASON_WORDS),
  ...SILENT_REASONS,
]

// ──────────────────────────────── who did it ────────────────────────────────

/** Who did a step: a name, Restro, or a guest's phone; `telegram` when it came from Telegram. */
export interface WhoView {
  readonly who: Who
  readonly telegram: boolean
}

/** A manager's answers to a payment, as the Log keeps them (`payment.answer`). */
export const PAYMENT_ANSWER_CODES = [
  'receipt_printed',
  'no_receipt',
  'on_till',
  'not_on_till',
] as const

/** One answer a manager gave about a payment. */
export type PaymentAnswerCode = (typeof PAYMENT_ANSWER_CODES)[number]

const answerCodeOf = (value: string | null): PaymentAnswerCode | null =>
  (PAYMENT_ANSWER_CODES as readonly (string | null)[]).includes(value)
    ? (value as PaymentAnswerCode)
    : null

export const whoView = (who: Who, via: string | null): WhoView => ({
  who,
  telegram: via === 'telegram',
})

// ───────────────────────────────── sent orders ─────────────────────────────────

/** What the screens know about the actor: the controls the server would refuse are not drawn. */
export interface Frame {
  readonly venueId: string
  /** The POS' name for `{source}`. */
  readonly source: string
  readonly currency: string
  readonly device: boolean
  /**
   * Whether a write must name a person before it runs: true on a shared device nobody is on, false
   * on a person's own session and on a shared device whose person is still on it (their PIN started
   * their own short session, D141 12.11, #324). `device` stays true there: the controls a shared
   * device shows and the tips it hides do not change because somebody typed a PIN.
   */
  readonly asks: boolean
  readonly can: Can
  /** `settings.connect_payments`: the end of night's "paying is still paused" row offers Reconnect. */
  readonly canConnect: boolean
  /** `log.view` and `night.view_full`: the Log's "Export" is drawn only then (#87). */
  readonly canExport: boolean
  readonly timezone: string
  /** The venue's current service day (`YYYY-MM-DD`). */
  readonly today: string
  /** The hour the service day ends (`HH:mm`). */
  readonly dayEndsAt: string
  readonly now: string
}

export function frameOf(
  access: NightAccess,
  input: {
    readonly venueId: string
    readonly source: string
    readonly now: Date
    /** A person's own short session is on this shared device: no write asks for a PIN (#324). */
    readonly remembered?: boolean
  },
): Frame {
  const held = new Set<string>(access.permissions)
  return {
    venueId: input.venueId,
    source: input.source,
    currency: access.venue.currency,
    device: access.device,
    asks: access.device && input.remembered !== true,
    can: {
      openClose: held.has('tables.open_close'),
      resume: held.has('tables.resume'),
      pause: held.has('ordering.pause'),
      lift: held.has('ordering.lift'),
      answer: held.has('alerts.answer'),
      followUp: held.has('money.follow_up'),
      endNight: held.has('reservations.end_night'),
    },
    canConnect: held.has('settings.connect_payments'),
    canExport: held.has('log.view') && held.has('night.view_full'),
    timezone: access.venue.timezone,
    today: access.today,
    dayEndsAt: access.venue.dayEndsAt,
    now: input.now.toISOString(),
  }
}

/** One sent order on a row. */
export interface SentRowView {
  readonly id: string
  readonly reference: string
  readonly tableId: string
  readonly table: string
  readonly numbered: boolean
  readonly itemCount: number
  readonly totalMinor: number
  readonly state: StateWord
  readonly reason: ReasonWord | null
  readonly time: string
  /** When Restro found it on the bill by itself, `HH:mm`. */
  readonly landedAt: string | null
  readonly answer: {
    readonly answer: 'found' | 'not_found'
    readonly by: WhoView
  } | null
}

/** The day's sent orders as the list draws them. */
export interface SentListView {
  readonly day: string
  readonly rows: readonly SentRowView[]
  readonly hasMore: boolean
  readonly counts: SentOrderPage['counts']
}

export function sentRowView(row: SentOrderRow, clock: ReturnType<typeof clockIn>): SentRowView {
  return {
    id: row.id,
    reference: row.reference,
    tableId: row.tableId,
    table: row.table,
    numbered: row.numbered,
    itemCount: row.itemCount,
    totalMinor: row.totalMinor,
    state: stateWord(row.state) ?? 'check',
    reason: reasonWordOf(row.reason).word,
    time: clock(row.createdAt) ?? '',
    landedAt: clock(row.landedAt),
    answer:
      row.answer === null
        ? null
        : { answer: row.answer.answer, by: whoView(row.answer.who, row.answer.via) },
  }
}

export function sentListView(page: SentOrderPage, timezone: string): SentListView {
  const clock = clockIn(timezone)
  return {
    day: page.day,
    rows: page.rows.map((row) => sentRowView(row, clock)),
    hasMore: page.hasMore,
    counts: page.counts,
  }
}

/** Reason codes on a page that have no word: reported by the loader, never drawn raw. */
export function unknownReasons(rows: readonly { readonly reason: string | null }[]): string[] {
  return [
    ...new Set(rows.flatMap((row) => (reasonWordOf(row.reason).unknown ? [row.reason ?? ''] : []))),
  ]
}

/** One step of a sent order in its sheet. */
export interface StepView {
  readonly time: string
  readonly landedLate: boolean
  readonly state: StateWord | null
  readonly reason: ReasonWord | null
  /** A staff answer to an Unconfirmed one, by its words. */
  readonly answer: 'found' | 'not_found' | null
  readonly by: WhoView
}

/** Everything about one sent order (plan O4). */
export interface SentDetailView {
  readonly row: SentRowView
  readonly lines: readonly {
    readonly qty: number
    readonly name: string
    readonly options: readonly string[]
    readonly note: string | null
  }[]
  /** The POS bill it joined, as staff know it there; null until it has joined one. */
  readonly billRef: string | null
  readonly steps: readonly StepView[]
}

export function sentDetailView(detail: SentOrderDetail, timezone: string): SentDetailView {
  const clock = clockIn(timezone)
  return {
    row: sentRowView(detail.order, clock),
    lines: detail.lines.map((line) => ({
      qty: line.qty,
      name: line.name,
      options: line.optionNames,
      note: line.note,
    })),
    billRef: detail.posBillRef,
    steps: detail.steps.map((step) => ({
      time: clock(step.at) ?? '',
      landedLate: step.kind === 'sent_order.landed_late',
      state: step.kind === 'sent_order.landed_late' ? null : stateWord(step.toState),
      reason: reasonWordOf(step.reason).word,
      answer:
        step.reason === 'staff_found'
          ? 'found'
          : step.reason === 'staff_not_found'
            ? 'not_found'
            : null,
      by: whoView(step.who, step.via),
    })),
  }
}

// ──────────────────────────────────── the Log ────────────────────────────────────

/** The words of a pause's cause (`lg_cz_*`); null for a cause with none, so no code shows. */
export type CauseWord = 'staff' | 'unconfirmed' | 'guard' | 'vanished' | 'unreachable'

const CAUSE_WORDS: Readonly<Record<string, CauseWord>> = {
  staff: 'staff',
  order_unconfirmed: 'unconfirmed',
  unconfirmed_orders: 'unconfirmed',
  guard_tripped: 'guard',
  table_vanished: 'vanished',
  pos_unreachable: 'unreachable',
}

/** The words of a changed setting (`lg_w_*`, S15): which part of the settings it was. */
export type SettingWord =
  | 'pay_table'
  | 'hours'
  | 'limits'
  | 'location'
  | 'calls'
  | 'alerts'
  | 'telegram'
  | 'pay_rule'
  | 'paying'
  | 'payments'
  | 'setting'

/** The part of the ordering settings each key belongs to, as Settings groups them. */
const ORDERING_KEY_WORDS: Readonly<Record<string, SettingWord>> = {
  serviceHours: 'hours',
  closedDayHours: 'hours',
  preOpeningCheck: 'hours',
  capMinor: 'limits',
  pacePer15Minutes: 'limits',
  locationCheck: 'location',
  spot: 'location',
  radiusMetres: 'location',
  passMinutes: 'location',
  callLapseMinutes: 'calls',
  alertRecipientUserIds: 'alerts',
  telegramChatId: 'telegram',
}

/** The word of each `settings.changed` reason that names one part whatever its keys. */
const SETTING_REASON_WORDS: Readonly<Record<string, SettingWord>> = {
  payment_table: 'pay_table',
  telegram_linked: 'telegram',
  telegram_left: 'telegram',
  pay_first: 'pay_rule',
  paying: 'paying',
  payments_connect: 'payments',
  payments_connected: 'payments',
  payments_disconnect: 'payments',
  payments_check: 'payments',
  payments_lost: 'payments',
}

/**
 * The word of a reason whose entry keeps its keys, for an entry that kept none (written before
 * keys were kept): the alerts form saves recipients and the Telegram chat, so its keys say which.
 */
const KEYED_REASON_WORDS: Readonly<Record<string, SettingWord>> = {
  alerts: 'alerts',
  telegram_unlinked: 'telegram',
}

/**
 * Which settings a `settings.changed` line changed, by the part of Settings they sit in (S15): the
 * reason where it names one part, else the keys the entry kept, each by its part. A key with no
 * part of its own adds "a setting" after the named ones, so nothing changed goes unsaid. An entry
 * with no keys says its reason's part, or "a setting".
 */
export function settingWordsOf(reason: string | null, keys: readonly string[]): SettingWord[] {
  const named = SETTING_REASON_WORDS[reason ?? '']
  if (named !== undefined) return [named]
  if (keys.length === 0) return [KEYED_REASON_WORDS[reason ?? ''] ?? 'setting']
  const words = [...new Set(keys.flatMap((key) => ORDERING_KEY_WORDS[key] ?? []))]
  const unnamed = keys.some((key) => ORDERING_KEY_WORDS[key] === undefined)
  return unnamed ? [...words, 'setting'] : words
}

/** The words of a guard (`lg_g_*`). */
export type GuardWord = 'cap' | 'pace' | 'rate' | 'pin' | 'other'

const GUARD_WORDS: Readonly<Record<string, GuardWord>> = {
  order_cap: 'cap',
  order_pace: 'pace',
  order_rate: 'rate',
  pin_wrong: 'pin',
}

/** One Log line, with the semantic parts its sentence is made of. */
export interface LogLineView {
  readonly seq: number
  readonly time: string
  readonly kind: LogKind
  readonly table: string | null
  readonly numbered: boolean
  readonly sentOrderId: string | null
  readonly reference: string | null
  /** The state a sent order moved to, as its word. */
  readonly state: StateWord | null
  readonly reason: ReasonWord | null
  readonly answer: 'found' | 'not_found' | null
  readonly by: WhoView
  readonly scope: LogLine['scope']
  readonly cause: CauseWord | null
  /** The alert's own title, in the admin's language. */
  readonly alertTitle: string | null
  readonly guard: GuardWord | null
  /** Which settings a `settings.changed` line changed, as words (S15); empty for other lines. */
  readonly setting: readonly SettingWord[]
  readonly subject: string | null
  /** What a role holds now, as a count (#366): the Log line says it in words. */
  readonly heldCount: number | null
  /** How many codes one `table_code.revealed` entry showed (several tables at once). */
  readonly codeCount: number | null
  readonly amountMinor: number | null
  /** Part 2's payment state word key (empty until #115 fills `PAYMENT_STATE_WORDS`). */
  readonly paymentState: string | null
  /**
   * Why a payment step was logged where it is not a new state of the money (S20): the payment
   * table freed after the charge, or the hold's release refused. Null for every other line.
   */
  readonly paymentReason: 'table_freed' | 'release_refused' | null
  /** The answer a manager gave, by its own words: never a receipt word for a till answer. */
  readonly paymentAnswer: PaymentAnswerCode | null
  /** The payment a line is about, for its sheet. */
  readonly paymentId: string | null
  /** The payment provider's name for a refund or dispute line (#222); null where it is not known. */
  readonly provider: string | null
  /** A dispute line's state (`payment.dispute`), a refund line's `failed` (#222). */
  readonly disputeState: 'open' | 'won' | 'lost' | 'none' | null
  readonly refundFailed: boolean
  /** A storno line taken back by Undo (#222). */
  readonly stornoUndone: boolean
  /** A "Got it" line taken back by Undo (#234). */
  readonly refundSeenUndone: boolean
  readonly sentOrdersOfDay: number | null
  /** The bills still open when the night ended (#332); null for any other entry. */
  readonly openBills: number | null
  /** A `night.closed` an admin wrote before the closing hour (#332). */
  readonly endedEarly: boolean
  /**
   * A reservation entry's own code (#323): what the thing became — the party's status, the spots
   * held or freed, a plan or a guest record kept, removed or erased. Null for every other kind.
   */
  readonly reservationStatus: string | null
  /** A waiter call entry's kinds (#180): the one asked for, or all of a call that ended. */
  readonly callKinds: readonly string[]
  /** The Undo of "Handled" (RR-58): a `waiter_call.done` line that opens the call again. */
  readonly callUndone: boolean
  /**
   * A paper receipt's mark (#200), for `receipt.brought` lines only: `undone` is Undo of the mark
   * (the receipt is to be brought again), `paymentNumber` the number the guest shows.
   */
  readonly receipt?: { readonly undone: boolean; readonly paymentNumber: string | null }
}

/** The Log's day as the screen draws it. */
export interface LogView {
  readonly day: string
  readonly today: boolean
  readonly rows: readonly LogLineView[]
  readonly hasMore: boolean
  readonly days: readonly string[]
}

/**
 * The reservations' kinds (#323). Each of their entries says in its `to_state` what the thing
 * became — the party's status, the spots held or freed, a plan kept or removed, a guest's record
 * listed, archived or erased — and the Log's sentence picks the word for it. Nothing else of the
 * entry reaches the screen: a guest's name and number are never in the Log (D140).
 */
const RESERVATION_KINDS = new Set<string>([
  'reservation.created',
  'reservation.changed',
  'reservation.status',
  'reservation.spots',
  'reservation.restored',
  'reservation.pay_rule',
  'night.closed',
  'plan.changed',
  'spot.changed',
  'reservation_settings.changed',
  'guest.changed',
  'guest.erased',
])

export function logLineView(
  line: LogLine,
  input: {
    readonly clock: ReturnType<typeof clockIn>
    readonly locale: AlertLocale
    readonly source: string
    readonly venueName: string
  },
): LogLineView {
  const alerting =
    line.kind === 'alert.raised' || line.kind === 'alert.done' || line.kind === 'alert.cleared'
  const answered =
    line.kind === 'sent_order.state' && line.reason !== null
      ? line.reason === 'staff_found'
        ? 'found'
        : line.reason === 'staff_not_found'
          ? 'not_found'
          : null
      : null
  return {
    seq: line.seq,
    time: input.clock(line.at) ?? '',
    kind: line.kind,
    table: line.table,
    numbered: line.numbered,
    sentOrderId: line.sentOrderId,
    reference: line.reference,
    state: line.kind === 'sent_order.state' ? stateWord(line.toState) : null,
    reason: line.kind === 'sent_order.state' ? reasonWordOf(line.reason).word : null,
    answer: answered,
    by: whoView(line.who, line.via),
    scope: line.scope,
    cause: line.cause === null ? null : (CAUSE_WORDS[line.cause] ?? null),
    alertTitle: alerting
      ? alertMessage(
          {
            kind: line.reason ?? '',
            details: line.scope?.kind === 'bar' ? { scope: 'bar', barName: line.scope.name } : {},
          },
          {
            locale: input.locale,
            venueName: input.venueName,
            tableLabel:
              line.table === null
                ? null
                : tableLabel(
                    input.locale,
                    line.numbered
                      ? { name: null, number: line.table }
                      : { name: line.table, number: null },
                  ),
            source: input.source,
            provider: providerDisplayName(line.providerKind),
          },
          'new',
        ).title
      : null,
    guard: line.kind === 'guard.tripped' ? (GUARD_WORDS[line.reason ?? ''] ?? 'other') : null,
    setting: line.kind === 'settings.changed' ? settingWordsOf(line.reason, line.settingKeys) : [],
    subject: line.subject,
    heldCount: line.heldCount,
    codeCount: line.codeCount,
    amountMinor: line.amountMinor,
    paymentState: line.kind === 'payment.state' ? line.toState : null,
    paymentReason:
      line.kind === 'payment.state' &&
      (line.reason === 'table_freed' || line.reason === 'release_refused')
        ? line.reason
        : null,
    paymentAnswer: line.kind === 'payment.answered' ? answerCodeOf(line.toState) : null,
    paymentId: line.paymentId,
    provider: providerDisplayName(line.providerKind),
    disputeState:
      line.kind === 'payment.dispute'
        ? line.toState === 'open' || line.toState === 'won' || line.toState === 'lost'
          ? line.toState
          : 'none'
        : null,
    refundFailed: line.kind === 'payment.refund_seen' && line.toState === 'failed',
    stornoUndone: line.kind === 'payment.storno' && line.toState === 'open',
    refundSeenUndone: line.kind === 'payment.refund_failed_seen' && line.toState === 'open',
    sentOrdersOfDay: line.sentOrdersOfDay,
    openBills: line.openBills,
    endedEarly: line.kind === 'night.closed' && line.reason === 'ended_early',
    reservationStatus: RESERVATION_KINDS.has(line.kind) ? line.toState : null,
    callKinds: line.callKinds,
    callUndone: line.kind === 'waiter_call.done' && line.toState === 'open',
    ...(line.kind === 'receipt.brought'
      ? {
          receipt: {
            undone: line.toState === 'to_bring',
            paymentNumber: line.paymentId === null ? null : paymentNumberOf(line.paymentId),
          },
        }
      : {}),
  }
}

export function logView(
  page: LogPage,
  input: {
    readonly timezone: string
    readonly locale: AlertLocale
    readonly source: string
    readonly venueName: string
  },
): LogView {
  const clock = clockIn(input.timezone)
  return {
    day: page.day,
    today: page.today,
    rows: page.rows.map((line) =>
      logLineView(line, {
        clock,
        locale: input.locale,
        source: input.source,
        venueName: input.venueName,
      }),
    ),
    hasMore: page.hasMore,
    days: page.days,
  }
}

// ──────────────────────────────── the end of the night ────────────────────────────────

/** An answered problem on an earlier night (section 1): the answer and who gave it. */
export interface AnsweredFixView {
  readonly sentOrderId: string
  readonly reference: string
  readonly table: string
  readonly numbered: boolean
  readonly answer: 'found' | 'not_found'
  readonly by: WhoView
}

/** The end of one night as the page draws it. */
export interface NightView {
  readonly day: string
  readonly today: boolean
  readonly hasService: boolean
  readonly dayEndsAt: string
  /** Staff ended this night: the page offers no "End the night" (S13). */
  readonly ended: boolean
  readonly full: boolean
  readonly days: readonly string[]
  /** Section 1: problems that still wait for an answer, as screen 1's rows. */
  readonly fix: readonly ActionRow[]
  readonly answered: readonly AnsweredFixView[]
  readonly sent: SentListView
  readonly totals: NightRead['totals']
  /** The door's counts: null where the venue works no reservations (#408). */
  readonly reservations: NightRead['reservations']
  /** Payments, captured, tips and the unconfirmed: `money.follow_up` only, else null. */
  readonly money: NightRead['money']
}

function fixRow(row: NightFixRow, clock: ReturnType<typeof clockIn>): ActionRow {
  return {
    id: row.alertId ?? row.sentOrderId,
    kind: 'check',
    tableId: row.tableId,
    table: row.table,
    numbered: row.numbered,
    at: row.at.toISOString(),
    check: {
      alertId: row.alertId ?? '',
      sentOrderId: row.sentOrderId,
      reference: row.reference,
      items: row.items,
      sentAt: clock(row.sentAt),
      billBeforeMinor: row.billBeforeMinor,
      landedAt: clock(row.landedAt),
    },
  }
}

export function nightView(night: NightRead, timezone: string): NightView {
  const clock = clockIn(timezone)
  return {
    day: night.day,
    today: night.today,
    hasService: night.hasService,
    dayEndsAt: night.dayEndsAt,
    ended: night.ended,
    full: night.full,
    days: night.days,
    fix: night.fix.filter((row) => row.answer === null).map((row) => fixRow(row, clock)),
    answered: night.fix.flatMap((row) =>
      row.answer === null
        ? []
        : [
            {
              sentOrderId: row.sentOrderId,
              reference: row.reference,
              table: row.table,
              numbered: row.numbered,
              answer: row.answer.answer,
              by: whoView(row.answer.who, row.answer.via),
            },
          ],
    ),
    sent: sentListView(night.sent.notAdded, timezone),
    totals: night.totals,
    reservations: night.reservations,
    money: night.money,
  }
}
