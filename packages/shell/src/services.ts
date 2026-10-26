// The services contract (D71, D72): what a face and its host say to each other about the guest's
// bag, the table bill, waiter requests, payment and the receipt. Pure types and Zod, no I/O.
//
//   host → face:  `ServiceState`, the host's own record of the bill, the requests, the payment
//                 quote and the receipt. The face draws it and nothing else.
//   face → host:  `GuestCommand`, one guest action with an `actionId` (a uuid made once per
//                 action and reused on a retry, so the host can answer a repeat with the first
//                 answer: idempotency). The host answers `CommandResult`.
//
// A face never succeeds on its own (D72). After a command it shows "pending", and only a result
// of `accepted` or `rejected` from the host, or the host's state, changes what the guest sees:
// it adds no bill round, confirms no waiter and reports no payment by itself. Every amount a
// face shows comes from the host as `ViewMoney`, except the bag estimate (bag.ts).
//
// The table's shared order (D117, D121; #75): every phone at a table edits one order. The face
// sends `order.add`, `order.change`, `order.remove`, `order.undo` and `order.restore`; the host
// may draw an edit at once (optimistic) and takes it back when the server refuses it, and the
// server's next state is always the truth. A Send is never drawn before the server answers.
//
// The location check (D118, D121, D122 §4; #76): where the venue checks, only phones at the table
// may add or change on-the-bill lines, send them, or see the order and the bill. The face never
// sees a position, a pass or a Turnstile token: the host answers an edit `location_needed`, the
// face draws the consent screen (`state.location.prompt`), and the guest's "Allow" goes through
// `binding.location`, which locates the phone and carries the waiting edit on. A failed check
// offers "Call a waiter" and "Cancel".
//
// The shapes fit the Stage 4 design (docs/reviews/connector-architecture/A5-guest-outbound.md
// 5.1): commands carry our own ids (`nd_` for items and options) and never a price, a barsy id or
// a table token, and the guest's view of an order is "received / sent / problem".

import { idSchema, type NodeId } from '@restro/core'
import { z } from 'zod'

import { SERVICE_KINDS, type ServiceKind } from './features'
import type { ViewMoney } from './money'
import {
  type BillLineStatus,
  PAY_METHODS,
  PAY_SCOPES,
  type PayMethod,
  type PayScope,
  RECEIPT_ACTIONS,
  type ReceiptAction,
  type RequestStatus,
} from './service-vocabulary'
import type { ViewText } from './text'

export {
  BILL_LINE_STATUSES,
  type BillLineStatus,
  GUEST_REFUSAL_CODES,
  type GuestRefusalCode,
  PAY_METHODS,
  PAY_SCOPES,
  type PayMethod,
  type PayScope,
  RECEIPT_ACTIONS,
  REQUEST_STATUSES,
  type ReceiptAction,
  type RequestStatus,
} from './service-vocabulary'

/** The limits of a command: the schema, the bag reducer and the screens all read these. */
export const SERVICE_LIMITS = {
  /** Lines in one order. */
  lines: 50,
  /** Quantity of one line. */
  quantity: 50,
  /** Chosen options on one line. */
  options: 32,
  /** A note, in characters. */
  note: 200,
  /** A promo code, in characters. */
  promo: 32,
  /** People in an equal split. */
  peopleMin: 2,
  peopleMax: 20,
  /** A tip in whole percent. */
  tipPercentMax: 30,
} as const

/* ---------------------------------------------------------------------------------------------
 * Commands (face → host)
 * ------------------------------------------------------------------------------------------- */

/** One order line of an `order.send` command: our ids, a quantity and a note, never a price. */
export interface OrderLine {
  readonly itemId: NodeId
  readonly optionIds: readonly NodeId[]
  readonly qty: number
  readonly note: string
}

/**
 * One guest action. `actionId` is a uuid made once per user action and reused on a retry
 * (idempotency): the host answers a repeated `actionId` with the answer it gave the first time.
 */
export type GuestCommand =
  | {
      /** Puts an item on the table's order (merged into an identical line). */
      readonly kind: 'order.add'
      readonly actionId: string
      readonly itemId: NodeId
      readonly optionIds: readonly NodeId[]
      readonly qty: number
      readonly note: string
    }
  | {
      /** Changes a line's quantity by `delta`; down to nothing removes it. */
      readonly kind: 'order.change'
      readonly actionId: string
      readonly lineId: string
      readonly delta: number
    }
  | { readonly kind: 'order.remove'; readonly actionId: string; readonly lineId: string }
  /** Brings back a removed line while its Undo lasts. */
  | { readonly kind: 'order.undo'; readonly actionId: string; readonly lineId: string }
  /** Brings back the earlier order set aside at `setAsideAt` (milliseconds since the epoch). */
  | { readonly kind: 'order.restore'; readonly actionId: string; readonly setAsideAt: number }
  /** The guest's own "Allow location": locates the phone to see the order and the bill (#76). */
  | { readonly kind: 'location.check'; readonly actionId: string }
  | {
      readonly kind: 'order.send'
      readonly actionId: string
      readonly lines: readonly OrderLine[]
      /** The sent order a duplicate check named, when the guest chose "Send another" (#78). */
      readonly confirmDuplicateOf?: string
    }
  | {
      readonly kind: 'service.request'
      readonly actionId: string
      readonly request: ServiceKind
      readonly note: string
    }
  | {
      readonly kind: 'service.cancel'
      readonly actionId: string
      readonly requestId: string
    }
  | {
      readonly kind: 'pay.quote'
      readonly actionId: string
      readonly scope: PayScope
      readonly people: number | null
      readonly tipPercent: number | null
      readonly tipMinor: number | null
      readonly promo: string | null
    }
  | {
      readonly kind: 'pay.start'
      readonly actionId: string
      readonly quoteId: string
      readonly method: PayMethod
    }
  | {
      readonly kind: 'receipt.action'
      readonly actionId: string
      readonly receiptId: string
      readonly action: ReceiptAction
    }

const ActionIdSchema = z.uuid()
const HostIdSchema = z.string().min(1).max(64)
const OrderLineIdSchema = idSchema('ol')

const OrderLineSchema = z.strictObject({
  itemId: idSchema('nd'),
  optionIds: z.array(idSchema('nd')).max(SERVICE_LIMITS.options),
  qty: z.int().min(1).max(SERVICE_LIMITS.quantity),
  note: z.string().max(SERVICE_LIMITS.note),
})

/**
 * The strict schema of a command, for the host to parse what a face sent: unknown keys are
 * refused, and so are a quantity outside 1–50, more than 50 lines or 32 options, a note over 200
 * characters, a promo over 32, people outside 2–20 and a tip percent outside 0–30.
 *
 * Two rules beyond those limits keep a `pay.quote` unambiguous: `people` is set exactly when the
 * scope is `split`, and at most one of `tipPercent` and `tipMinor` is set.
 */
export const GuestCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('order.add'),
    actionId: ActionIdSchema,
    itemId: idSchema('nd'),
    optionIds: z.array(idSchema('nd')).max(SERVICE_LIMITS.options),
    qty: z.int().min(1).max(SERVICE_LIMITS.quantity),
    note: z.string().max(SERVICE_LIMITS.note),
  }),
  z.strictObject({
    kind: z.literal('order.change'),
    actionId: ActionIdSchema,
    lineId: OrderLineIdSchema,
    delta: z
      .int()
      .min(-SERVICE_LIMITS.quantity)
      .max(SERVICE_LIMITS.quantity)
      .refine((delta) => delta !== 0, 'a change of nothing'),
  }),
  z.strictObject({
    kind: z.literal('order.remove'),
    actionId: ActionIdSchema,
    lineId: OrderLineIdSchema,
  }),
  z.strictObject({
    kind: z.literal('order.undo'),
    actionId: ActionIdSchema,
    lineId: OrderLineIdSchema,
  }),
  z.strictObject({
    kind: z.literal('order.restore'),
    actionId: ActionIdSchema,
    setAsideAt: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('location.check'),
    actionId: ActionIdSchema,
  }),
  z.strictObject({
    kind: z.literal('order.send'),
    actionId: ActionIdSchema,
    lines: z.array(OrderLineSchema).min(1).max(SERVICE_LIMITS.lines),
    confirmDuplicateOf: idSchema('so').optional(),
  }),
  z.strictObject({
    kind: z.literal('service.request'),
    actionId: ActionIdSchema,
    request: z.enum(SERVICE_KINDS),
    note: z.string().max(SERVICE_LIMITS.note),
  }),
  z.strictObject({
    kind: z.literal('service.cancel'),
    actionId: ActionIdSchema,
    requestId: HostIdSchema,
  }),
  z
    .strictObject({
      kind: z.literal('pay.quote'),
      actionId: ActionIdSchema,
      scope: z.enum(PAY_SCOPES),
      people: z.int().min(SERVICE_LIMITS.peopleMin).max(SERVICE_LIMITS.peopleMax).nullable(),
      tipPercent: z.int().min(0).max(SERVICE_LIMITS.tipPercentMax).nullable(),
      tipMinor: z.int().nonnegative().nullable(),
      promo: z.string().min(1).max(SERVICE_LIMITS.promo).nullable(),
    })
    .refine((command) => (command.scope === 'split') === (command.people !== null), {
      message: 'people is set exactly when the scope is split',
      path: ['people'],
    })
    .refine((command) => command.tipPercent === null || command.tipMinor === null, {
      message: 'set either tipPercent or tipMinor, not both',
      path: ['tipMinor'],
    }),
  z.strictObject({
    kind: z.literal('pay.start'),
    actionId: ActionIdSchema,
    quoteId: HostIdSchema,
    method: z.enum(PAY_METHODS),
  }),
  z.strictObject({
    kind: z.literal('receipt.action'),
    actionId: ActionIdSchema,
    receiptId: HostIdSchema,
    action: z.enum(RECEIPT_ACTIONS),
  }),
])

/** What the host answers to a command. */
export interface CommandResult {
  /** The `actionId` of the command this answers. */
  readonly actionId: string
  /** `pending`: received, the outcome is not known yet. Only the host's state or a repeat of the command settles it. */
  readonly status: 'pending' | 'accepted' | 'rejected'
  /** What to tell the guest (a rejection reason, "ask your waiter"), in a language. */
  readonly message: ViewText | null
  /** A short reference to show the guest (for example to quote to staff), or null. */
  readonly ref: string | null
  /** Why the host said no (`GUEST_REFUSAL_CODES`), for the face to word; null or absent otherwise. */
  readonly code?: string | null
  /**
   * What the command made or acted on (the order line an `order.add` made, the sent order a Send
   * made, the item an `item_unavailable` names), or null.
   */
  readonly subjectId?: string | null
}

/* ---------------------------------------------------------------------------------------------
 * State (host → face)
 * ------------------------------------------------------------------------------------------- */

/** One line of a bill round or a receipt. */
export interface BillLineView {
  readonly id: string
  readonly name: ViewText
  readonly qty: number
  readonly total: ViewMoney
  readonly status: BillLineStatus
  readonly options: readonly ViewText[]
}

/** One round of the table bill: what the guests sent together, or what staff entered. */
export interface BillRoundView {
  readonly id: string
  readonly origin: 'guest' | 'staff'
  /** The time of the round as the host wants it shown ("19:42"). */
  readonly time: string
  /** The `actionId` of the `order.send` this round answers, or null for a staff round. */
  readonly actionId: string | null
  readonly lines: readonly BillLineView[]
}

/** The table bill as the host has it. The face draws it and never adds to it. */
export interface BillView {
  readonly revision: number
  readonly rounds: readonly BillRoundView[]
  readonly total: ViewMoney
  readonly updatedAt: string
}

/** One waiter request as the host has it. */
export interface RequestView {
  readonly id: string
  readonly actionId: string
  readonly kind: ServiceKind
  readonly status: RequestStatus
  readonly note: string
}

/** One VAT line of a quote or a receipt: the rate as shown ("20%") and the VAT inside the total. */
export interface VatLine {
  readonly rate: string
  readonly amount: ViewMoney
}

/** The host's payment quote: what the guest would pay, how, and with which tip. */
export interface PayQuote {
  readonly id: string
  readonly scope: PayScope
  readonly people: number | null
  readonly subtotal: ViewMoney
  readonly tipOptions: readonly { readonly percent: number; readonly amount: ViewMoney }[]
  readonly tip: ViewMoney
  readonly vat: readonly VatLine[]
  readonly total: ViewMoney
  /** The only methods the guest may choose. */
  readonly methods: readonly PayMethod[]
  /** Present when the host takes promo codes: the code last tried and what became of it. */
  readonly promo: {
    readonly code: string
    readonly accepted: boolean
    readonly message: ViewText | null
  } | null
}

/** A paid receipt as the host issued it. */
export interface ReceiptView {
  readonly id: string
  readonly reference: string
  readonly fiscalReference: string | null
  readonly venueName: string
  readonly tableLabel: string | null
  /** When it was issued, as the host wants it shown. */
  readonly issuedAt: string
  readonly lines: readonly BillLineView[]
  readonly vat: PayQuote['vat']
  readonly tip: ViewMoney
  readonly total: ViewMoney
  readonly method: PayMethod
  /** Which receipt buttons the host can serve. */
  readonly actions: { readonly pdf: boolean; readonly email: boolean; readonly print: boolean }
}

/** One line of the table's shared order: our ids, never a price or a name (the face looks them up). */
export interface OrderLineView {
  readonly id: string
  readonly itemId: NodeId
  readonly optionIds: readonly NodeId[]
  readonly qty: number
  readonly note: string
  /** `pay_first`: the item is ordered from the waiter ("Order this from your waiter"). */
  readonly mode: 'on_bill' | 'pay_first'
  /** Held by a payment: no change, no removal. */
  readonly held: boolean
  /** Drawn before the server answered (an optimistic edit), taken back if it is refused. */
  readonly pending: boolean
}

/** The table's shared order as the host has it. */
export interface TableOrderView {
  readonly lines: readonly OrderLineView[]
  /** Lines removed in the last seconds, each with its Undo. */
  readonly removed: readonly (Omit<OrderLineView, 'held' | 'pending'> & {
    /** Seconds the Undo still lasts. */
    readonly undoSeconds: number
  })[]
  /** The order set aside when it went idle ("Earlier order · Restore"), or null. */
  readonly earlier: {
    readonly setAsideAt: number
    readonly lines: readonly Omit<OrderLineView, 'held' | 'pending'>[]
  } | null
}

/**
 * One sent order of the table (#77, D116, D122 §5): what a Send made, shown on every phone while it
 * is in flight and for 15 minutes after it ends. Its lines are no longer on the order.
 */
export interface SentOrderView {
  readonly id: string
  /**
   * `sending` until the POS has it or certainly not; `awaiting_approval` only where the POS
   * approves orders at the bar; `unconfirmed` when Restro could not tell (the table pauses).
   */
  readonly state: 'sending' | 'awaiting_approval' | 'added' | 'not_sent' | 'unconfirmed'
  /** Why it ended Not sent or Unconfirmed (`ordering_paused`, `check_timed_out`…), or null. */
  readonly reason: string | null
  /** The short reference a waiter reads (K7Q). */
  readonly ref: string
  readonly lines: readonly {
    readonly itemId: NodeId
    readonly optionIds: readonly NodeId[]
    readonly qty: number
  }[]
  /** When it was sent, in milliseconds since the epoch by the phone's clock. */
  readonly sentAt: number
  /** Sent from this phone: only this phone shows "Sending…" (D122 §5). */
  readonly mine: boolean
}

/** Where the phone stands with the location check (#76), and what the face shows for it. */
export interface LocationView {
  /**
   * `off`: the venue doesn't check. `held`: this phone was located for the table's sitting.
   * `needed`: not yet, so the host has no order and no bill to draw.
   */
  readonly state: 'off' | 'needed' | 'held'
  /**
   * What the face shows now: nothing; the consent screen (`locationConsent`, Allow / Not now);
   * "Checking your location…"; or the failed check (`locationFailed`, Call a waiter / Cancel).
   */
  readonly prompt: 'none' | 'consent' | 'checking' | 'failed'
  /** The guest's answer to the consent screen this service day. */
  readonly consent: 'unknown' | 'allowed' | 'declined'
  /** The venue's name, for the consent text. */
  readonly venueName: string
}

/** The guest's answers to the location screens; the host does the rest. */
export interface LocationControls {
  /**
   * "Allow" on the consent screen: the host records the consent for the service day, locates the
   * phone and carries on with the edit that was waiting (or only gets the pass). The answer is
   * that edit's, or null when nothing was waiting.
   */
  readonly allow: () => Promise<CommandResult | null>
  /** "Not now": remembered for the service day; the waiting edit is dropped. */
  readonly decline: () => void
  /** The guest's own "Allow location" tap after "Not now": shows the consent screen again. */
  readonly reopen: () => void
  /** "Cancel" on the failed check: back to the order. */
  readonly dismiss: () => void
}

/** Everything the host knows that a face may draw. */
export interface ServiceState {
  readonly revision: number
  /** True in the admin's preview with demo data: the face shows a small "Preview" marker. */
  readonly preview: boolean
  readonly bill: BillView | null
  readonly requests: readonly RequestView[]
  readonly quote: PayQuote | null
  readonly receipt: ReceiptView | null
  /** The table's shared order (#75); absent where the host has none. */
  readonly order?: TableOrderView | null
  /**
   * Whether the table takes orders from phones now: `paused` by staff, `closed` when the table
   * is not open. Absent where the host does not say. `notesAndOptions` (#78): true where notes
   * and options reach the POS's ticket; false or absent, the template draws no note field (it
   * shows `notesAtStaff` instead) and an item that must have options says "Order this from your
   * waiter" instead of an add control.
   */
  readonly ordering?: {
    readonly state: 'on' | 'paused' | 'closed'
    readonly notesAndOptions?: boolean
  } | null
  /** True when the host has not reached the server for a while: what is drawn may be old. */
  readonly offline?: boolean
  /** The location check (#76); absent where the host does not check. */
  readonly location?: LocationView | null
  /** The table's sent orders (#77), newest first; absent where the host has none. */
  readonly sentOrders?: readonly SentOrderView[]
}

/** What a host binds to a face: the state to draw and the way to send a command. */
export interface ServiceBinding {
  readonly state: ServiceState
  readonly dispatch: (command: GuestCommand) => Promise<CommandResult>
  /** The answers to the location screens (#76); absent where the host does not check. */
  readonly location?: LocationControls
}

/** A state with nothing in it: no bill, no request, no quote, no receipt. */
export const EMPTY_SERVICE_STATE: ServiceState = {
  revision: 0,
  preview: false,
  bill: null,
  requests: [],
  quote: null,
  receipt: null,
}
