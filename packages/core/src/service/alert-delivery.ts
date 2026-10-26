// What to send, to whom, and when (D120 "How often"; ticket #83): the delivery planner. Pure: the
// worker gives it a venue's alerts with the state of what each receiver was already told, the
// venue's service hours and who can be reached, and gets back the messages to send. The worker
// sends them and records each with `alert.delivered`, which applies `recordStep` below.
//
// Per receiver (the ticked accounts' push, the venue's Telegram group, the Restro team's chat):
// - a new alert goes after the kind's first delay, grouped, with at most one message per minute
//   (push) or per 10 minutes (team) for the kind at the venue;
// - nothing goes outside service hours (the pre-opening check excepted): an alert raised while the
//   venue is closed is dropped, never sent late;
// - reminders follow the kind's rules while nobody has acted;
// - a pause that ends is announced ("Ordering is back") to those told it began, once it has been
//   over for 10 minutes; one still on when the venue opens is announced once ("still paused");
// - an alert answered in Restro gets its Telegram message edited to "Done by …".

import { z } from 'zod'

import { type KindRule, ruleOf, type ServiceHoursWindow } from './alert-rules'

/** A new alert older than this was raised for another night: it is not announced now. */
export const STALE_NEW_MS = 6 * 3_600_000

/** Who is told. */
export const RECEIVERS = ['push', 'venueTelegram', 'team'] as const

/** One receiver. */
export type Receiver = (typeof RECEIVERS)[number]

/** The kind of message a step sends. */
export const STEPS = ['new', 'reminder', 'back', 'still_paused', 'done_edit'] as const

/** One step. */
export type Step = (typeof STEPS)[number]

const Instant = z.iso.datetime()

/** What one receiver was told about one alert. */
const ReceiverStateSchema = z.strictObject({
  firstAt: Instant,
  lastAt: Instant,
  /** Messages sent: the first and each reminder (and "still paused"). */
  count: z.int().min(1),
  backAt: Instant.optional(),
  editedDoneAt: Instant.optional(),
  /** The service day it was last told "still paused". */
  stillPausedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

/** What each receiver was told about an alert; kept in the alert's details under `delivery`. */
export const DeliveryStateSchema = z.strictObject({
  push: ReceiverStateSchema.optional(),
  venueTelegram: ReceiverStateSchema.optional(),
  team: ReceiverStateSchema.optional(),
  /** Raised while the venue was closed: never sent (D120). */
  suppressed: z.literal(true).optional(),
})

/** What each receiver was told about an alert. */
export type DeliveryState = z.infer<typeof DeliveryStateSchema>

/** One receiver's state. */
export type ReceiverState = z.infer<typeof ReceiverStateSchema>

/** The delivery state in an alert's details; empty when none is kept or it does not parse. */
export function readDelivery(details: Readonly<Record<string, unknown>>): DeliveryState {
  const parsed = DeliveryStateSchema.safeParse(details.delivery)
  return parsed.success ? parsed.data : {}
}

/** The alert's details with this delivery state. */
export function withDelivery(
  details: Readonly<Record<string, unknown>>,
  state: DeliveryState,
): Record<string, unknown> {
  return { ...details, delivery: state }
}

/** The state after a step was sent to a receiver at `at`. */
export function recordStep(
  state: DeliveryState,
  receiver: Receiver,
  step: Step,
  at: Date,
  options: { readonly day?: string } = {},
): DeliveryState {
  const when = at.toISOString()
  const before = state[receiver]
  const next: ReceiverState =
    before === undefined
      ? { firstAt: when, lastAt: when, count: 1 }
      : step === 'back' || step === 'done_edit'
        ? { ...before }
        : { ...before, lastAt: when, count: before.count + 1 }
  if (step === 'back') next.backAt = when
  if (step === 'done_edit') next.editedDoneAt = when
  if (step === 'still_paused' && options.day !== undefined) next.stillPausedOn = options.day
  return { ...state, [receiver]: next }
}

/** An alert as the planner sees it. */
export interface PlannedAlert {
  readonly id: string
  readonly kind: string
  readonly audience: 'venue' | 'restro'
  readonly raisedAt: Date
  readonly doneAt: Date | null
  readonly delivery: DeliveryState
  /** The venue group's message to edit, once sent. */
  readonly telegramRef: string | null
}

/** What the planner is given. */
export interface PlanInput {
  readonly now: Date
  readonly window: ServiceHoursWindow
  readonly alerts: readonly PlannedAlert[]
  /** Who can be reached: ticked accounts with a device, the venue's group, the team's chat. */
  readonly reachable: Readonly<Record<Receiver, boolean>>
}

/** One message to send. A venue group's message names one alert; the others group several. */
export interface DeliveryStep {
  readonly receiver: Receiver
  readonly step: Step
  readonly alertIds: readonly string[]
  /** Push only: just the venue's owners get it. */
  readonly ownersOnly: boolean
}

/** What to do now. */
export interface DeliveryPlan {
  readonly steps: readonly DeliveryStep[]
  /** Alerts raised while the venue was closed: record that they are never sent. */
  readonly suppress: readonly string[]
}

/** The rule of a kind for a receiver. */
function receiverRule(rule: KindRule, receiver: Receiver) {
  return rule[receiver]
}

/** Plans the messages due now (see the header). */
export function planDelivery(input: PlanInput): DeliveryPlan {
  const { now, window, alerts, reachable } = input
  const nowMs = now.getTime()
  const steps: DeliveryStep[] = []
  const suppress = new Set<string>()

  const kinds = [...new Set(alerts.map((alert) => alert.kind))]
  for (const receiver of RECEIVERS) {
    if (!reachable[receiver]) continue
    for (const kind of kinds) {
      const ofKind = alerts.filter((alert) => alert.kind === kind)
      const audience = ofKind[0]?.audience ?? 'venue'
      const rule = ruleOf(kind, audience)
      const forReceiver = receiverRule(rule, receiver)
      if (forReceiver === null) continue
      const stateOf = (alert: PlannedAlert) => alert.delivery[receiver]
      const open = ofKind.filter((alert) => alert.doneAt === null)
      const speaking = rule.outsideServiceHours || window.inService
      const add = (step: Step, group: readonly PlannedAlert[], ownersOnly = false) => {
        if (group.length === 0) return
        if (receiver === 'venueTelegram') {
          for (const alert of group) {
            steps.push({ receiver, step, alertIds: [alert.id], ownersOnly: false })
          }
        } else {
          steps.push({ receiver, step, alertIds: group.map((alert) => alert.id), ownersOnly })
        }
      }

      // Still paused when the venue opens: once a service day, to those who can be told.
      const stillPaused =
        rule.closesItself && window.inService && window.opensAt !== null
          ? open.filter(
              (alert) =>
                alert.raisedAt.getTime() < (window.opensAt as Date).getTime() &&
                stateOf(alert)?.stillPausedOn !== window.date,
            )
          : []
      add('still_paused', stillPaused)
      const announced = new Set(stillPaused.map((alert) => alert.id))

      // A new alert, after its first delay.
      const fresh = open.filter(
        (alert) =>
          stateOf(alert) === undefined &&
          !alert.delivery.suppressed &&
          !announced.has(alert.id) &&
          (rule.closesItself || nowMs - alert.raisedAt.getTime() <= STALE_NEW_MS) &&
          alert.raisedAt.getTime() + forReceiver.firstDelayMs <= nowMs,
      )
      if (fresh.length > 0) {
        if (!speaking) {
          for (const alert of fresh) suppress.add(alert.id)
        } else {
          const lastSent = Math.max(
            0,
            ...ofKind.map((alert) => Date.parse(stateOf(alert)?.lastAt ?? '1970-01-01T00:00:00Z')),
          )
          if (forReceiver.minGapMs === 0 || lastSent + forReceiver.minGapMs <= nowMs) {
            add('new', fresh)
          }
        }
      }

      // Reminders while nobody has acted.
      const reminder = forReceiver.reminder
      if (reminder !== null && speaking) {
        const due = open.filter((alert) => {
          const state = stateOf(alert)
          return (
            state !== undefined &&
            !announced.has(alert.id) &&
            state.count - 1 < reminder.max &&
            Date.parse(state.lastAt) + reminder.afterMs <= nowMs
          )
        })
        add('reminder', due, reminder.ownersOnly)
      }

      // Told it ended, once it has stayed over.
      if (rule.back) {
        add(
          'back',
          ofKind.filter((alert) => {
            const state = stateOf(alert)
            return (
              alert.doneAt !== null &&
              state !== undefined &&
              state.backAt === undefined &&
              alert.doneAt.getTime() + rule.backAfterMs <= nowMs
            )
          }),
        )
      } else if (receiver === 'venueTelegram') {
        // Answered in Restro: the group's message says who, and when.
        add(
          'done_edit',
          ofKind.filter((alert) => {
            const state = stateOf(alert)
            return (
              alert.doneAt !== null &&
              alert.telegramRef !== null &&
              state !== undefined &&
              state.editedDoneAt === undefined
            )
          }),
        )
      }
    }
  }
  return { steps, suppress: [...suppress] }
}
