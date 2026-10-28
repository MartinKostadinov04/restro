// The services contract (D71, D72): what a face and its host say to each other about the guest's
// bag, the table bill, waiter requests, payment and the receipt. Pure types and Zod, no I/O.
//
//   host → face:  `ServiceState`, the host's own record of the bill, the requests, this phone's
//                 payment and the receipt. The face draws it and nothing else.
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
/// Paying (#110, #114, D127): the face sends `pay.start` (lines of `tableBill` and a tip),
// `pay.returned` and `pay.cancel`; the host holds the payment handle and the provider's form
// values, answers `state.payment`, and fills the form slot (`ServiceBinding.payForm`) the face
// places. `paying` says whether paying is on, paused or off here. The screens are worded by
// `strings.pay` and chosen by `payScreen` (paying.ts); the tip and the totals come from
// `choosePay` (paying.ts). The face shows no success of its own: "Paid" is `payment.state`
// `captured`.
//
// The shapes fit the Stage 4 design (docs/reviews/connector-architecture/A5-guest-outbound.md
// 5.1): commands carry our own ids (`nd_` for items and options) and never a price, a barsy id or
// a table token, and the guest's view of an order is "received / sent / problem".

import {
  type Currency,
  DecimalQuantitySchema,
  idSchema,
  type LocalizedText,
  type NodeId,
} from '@restro/core'
import { z } from 'zod'

import { SERVICE_KINDS, type ServiceKind } from './features'
import type { ViewMoney } from './money'
import {
  type BillLineStatus,
  type PayMethod,
  type PaymentState,
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
  PAYMENT_STATES,
  type PayMethod,
  type PaymentState,
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
  /** Bill lines one payment picks. */
  payLines: 200,
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
      /** The on-the-bill lines; empty when the Send has only pay-first lines. */
      readonly lines: readonly OrderLine[]
      /** The sent order a duplicate check named, when the guest chose "Send another" (#78). */
      readonly confirmDuplicateOf?: string
      /**
       * The pay-first lines the guest pays for at this Send (#113, D113), with the tip (at most one
       * of the two; neither is no tip). They become one payment; the host answers its handle.
       */
      readonly payFirst?: {
        readonly lines: readonly OrderLine[]
        readonly tipMinor: number | null
        readonly tipPercent: number | null
      }
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
  /**
   * Pay (#110, #114, D127): picks whole lines of the table's bill or the whole bill, with every
   * picked line as the phone saw it (the knock, D111) and an optional tip: at most one of
   * `tipMinor` and `tipPercent`, neither is no tip (it starts at zero). The host adds Turnstile's
   * token and keeps the payment's handle; the face sees only `payment`.
   */
  | {
      readonly kind: 'pay.start'
      readonly actionId: string
      readonly pick: PayPick
      readonly seen: readonly PaySeenLine[]
      readonly tipMinor: number | null
      readonly tipPercent: number | null
    }
  /** The phone is back from the card form (a nudge: Restro reads the hold from the provider). */
  | { readonly kind: 'pay.returned'; readonly actionId: string }
  /** "Pay later": only before the hold; after it the answer is `too_late`. */
  | { readonly kind: 'pay.cancel'; readonly actionId: string }
  | {
      readonly kind: 'receipt.action'
      readonly actionId: string
      readonly receiptId: string
      readonly action: ReceiptAction
    }

/** What a `pay.start` picks: lines of the bill, each with a quantity, or the whole bill. */
export type PayPick =
  | {
      readonly kind: 'lines'
      readonly lines: readonly { readonly lineId: string; readonly quantity: string }[]
    }
  | { readonly kind: 'whole' }

/** One bill line as the phone saw it when it paid: the line, its quantity and its amount. */
export interface PaySeenLine {
  readonly lineId: string
  readonly quantity: string
  readonly amountMinor: number
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

const BillLineIdSchema = idSchema('bn')

/** `pay.start`: whole lines of the bill (a line's whole quantity) or the whole bill (D127). */
export const PayStartSchema = z
  .strictObject({
    kind: z.literal('pay.start'),
    actionId: ActionIdSchema,
    pick: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('lines'),
        lines: z
          .array(z.strictObject({ lineId: BillLineIdSchema, quantity: DecimalQuantitySchema }))
          .min(1)
          .max(SERVICE_LIMITS.payLines),
      }),
      z.strictObject({ kind: z.literal('whole') }),
    ]),
    seen: z
      .array(
        z.strictObject({
          lineId: BillLineIdSchema,
          quantity: DecimalQuantitySchema,
          amountMinor: z.int(),
        }),
      )
      .min(1)
      .max(SERVICE_LIMITS.payLines),
    tipMinor: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    tipPercent: z.int().min(1).max(SERVICE_LIMITS.tipPercentMax).nullable(),
  })
  .refine((command) => command.tipMinor === null || command.tipPercent === null, {
    message: 'set either tipMinor or tipPercent, not both',
    path: ['tipPercent'],
  })

/** `pay.returned`: the payment is named by the handle in `X-Restro-Payment`. */
export const PayReturnedSchema = z.strictObject({
  kind: z.literal('pay.returned'),
  actionId: ActionIdSchema,
})

/** `pay.cancel`: before the hold only. */
export const PayCancelSchema = z.strictObject({
  kind: z.literal('pay.cancel'),
  actionId: ActionIdSchema,
})

/**
 * The strict schema of a command, for the host to parse what a face sent: unknown keys are
 * refused, and so are a quantity outside 1–50, more than 50 lines or 32 options, a note over 200
 * characters and a tip percent outside 1–30. A `pay.start` names at most one of `tipPercent` and
 * `tipMinor`.
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
  z
    .strictObject({
      kind: z.literal('order.send'),
      actionId: ActionIdSchema,
      lines: z.array(OrderLineSchema).max(SERVICE_LIMITS.lines),
      confirmDuplicateOf: idSchema('so').optional(),
      payFirst: z
        .strictObject({
          lines: z.array(OrderLineSchema).min(1).max(SERVICE_LIMITS.lines),
          tipMinor: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
          tipPercent: z.int().min(1).max(SERVICE_LIMITS.tipPercentMax).nullable(),
        })
        .refine((part) => part.tipMinor === null || part.tipPercent === null, {
          message: 'set either tipMinor or tipPercent, not both',
          path: ['tipPercent'],
        })
        .optional(),
    })
    .refine((command) => command.lines.length > 0 || command.payFirst !== undefined, {
      message: 'a Send names at least one line',
      path: ['lines'],
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
  PayStartSchema,
  PayReturnedSchema,
  PayCancelSchema,
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

/** One line of the table's bill for paying: the POS's own amount, never a price × quantity. */
export interface TableBillLineView {
  /** Our id for the line (`bn_`): what a `pay.start` names. */
  readonly id: string
  /** Our item's name; null is "Other item", worded by the shell. */
  readonly name: LocalizedText | null
  /** The quantity as the POS gives it, decimal text ("2", "0.5"). */
  readonly quantity: string
  /** The line's signed amount in minor units: a discount is negative, a free line 0. */
  readonly amountMinor: number
  /** In a payment that isn't final (D127): greyed, no payer, amount or timer. */
  readonly beingPaid: boolean
}

/** One bill of the table (a table may hold several on the POS). */
export interface TableBillPartView {
  readonly id: string
  /** The whole bill is in a payment that isn't final. */
  readonly beingPaid: boolean
  readonly totalMinor: number
  readonly paidMinor: number
  readonly lines: readonly TableBillLineView[]
}

/** The table's bill as the host read it from the POS (#74). */
export interface TableBillView {
  /** Seconds since the reading: "Updated 12 s ago". */
  readonly readAgoSeconds: number
  /** False when the latest reading failed: the last good bill is drawn marked not up to date. */
  readonly complete: boolean
  readonly currency: Currency
  readonly totalMinor: number
  readonly paidMinor: number
  /** "Left to pay". */
  readonly owedMinor: number
  readonly parts: readonly TableBillPartView[]
}

/** Paying on the bill as the host says it (#114). */
export interface PayingView {
  readonly state: 'on' | 'paused' | 'off'
  /** The smallest card payment, in minor units (D127): Pay is greyed below it. */
  readonly minCardMinor: number
  /** Who processes the payment, as the page names it ("Payment processed by … for …"), or null. */
  readonly processor: string | null
  /** Reserved for #186: true when a receipt email may be offered. The host sets it false. */
  readonly electronicReceipt: boolean
  /**
   * The last payment this phone made, for "Same amount as 4 minutes ago. Pay again?" (D127): its
   * amount and how long ago it was made, or null. Kept by the host in the tab, never stored.
   */
  readonly recent: { readonly amountMinor: number; readonly agoSeconds: number } | null
}

/** One line of this phone's payment. */
export interface PaymentLineView {
  readonly name: string
  readonly quantity: string
  readonly amountMinor: number
}

/**
 * This phone's payment as the host reads it (`GET /api/guest/payment`, #110): where it stands, the
 * priced lines and the amounts once known. The provider's form values never reach the face: the
 * page keeps them and fills the form slot (`ServiceBinding.payForm`).
 */
export interface PaymentView {
  readonly id: string
  /** The short number the guest shows the waiter. */
  readonly number: string
  readonly state: PaymentState
  /** Why it ended or is ending (`busy`, `bill_changed`, `cancelled`, `expired`…), or null. */
  readonly reason: string | null
  readonly currency: Currency
  /** The hold: the lines plus the tip, once priced; null before. */
  readonly amountMinor: number | null
  readonly tipMinor: number
  readonly lines: readonly PaymentLineView[]
  /** The card form is ready for the guest (the state is `awaiting_guest`); the slot is filled. */
  readonly form: { readonly confirmSeconds: number } | null
}

/** One waiter request as the host has it. */
export interface RequestView {
  readonly id: string
  readonly actionId: string
  readonly kind: ServiceKind
  readonly status: RequestStatus
  readonly note: string
}

/** One VAT line of a receipt: the rate as shown ("20%") and the VAT inside the total. */
export interface VatLine {
  readonly rate: string
  readonly amount: ViewMoney
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
  readonly vat: readonly VatLine[]
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
    /**
     * The POS said this item ran out, so the order ended Not sent (`item_unavailable`, #80): the
     * face greys the line on the order ("Mojito is out of stock") and sends the rest.
     */
    readonly outOfStock?: true
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
  readonly receipt: ReceiptView | null
  /**
   * The table's bill as the POS reads it, for paying (#74, #114): its lines with the POS's own
   * amounts and which are in a payment that isn't final; absent where the host has none or the
   * phone has no location pass (`location.state` `needed`).
   */
  readonly tableBill?: TableBillView | null
  /**
   * Paying on the bill here (#114): `state` is on, paused or off (no ids), `minCardMinor` the
   * smallest card payment. `electronicReceipt` is reserved for #186 (an optional email on the pay
   * screen where the POS can issue the venue's electronic receipt): the host leaves it false until
   * a connector declares the capability.
   */
  readonly paying?: PayingView | null
  /**
   * This phone's payment (#110, #114), kept by the host from the handle only this phone holds, or
   * null when this phone has none. A closed or reloaded page comes back to it.
   */
  readonly payment?: PaymentView | null
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
    /**
     * Pay-first at this table (#113): `on`, a pay-first line goes with the Send and is paid there;
     * `paused` (paying paused) or `off` (not offered here), it says "Order this from your waiter"
     * and stays on the order. Absent where the host does not say: treated as `off`.
     */
    readonly payFirst?: 'on' | 'paused' | 'off'
    /**
     * A tip can be given when paying here (D127: the POS records it on the fiscal receipt); false,
     * paying offers no tip. Absent where the host does not say: treated as false.
     */
    readonly tips?: boolean
    /**
     * The venue's night (#82): `last_orders` shows "Last orders at {at}", `closed` "Ordering from
     * phones has closed for tonight" and `opens_later` the opening time; the last two take the
     * send control away. Absent where the host does not say.
     */
    readonly night?: {
      readonly state: 'open' | 'last_orders' | 'opens_later' | 'closed'
      readonly at: string | null
    }
  } | null
  /** True when the host has not reached the server for a while: what is drawn may be old. */
  readonly offline?: boolean
  /** The location check (#76); absent where the host does not check. */
  readonly location?: LocationView | null
  /** The table's sent orders (#77), newest first; absent where the host has none. */
  readonly sentOrders?: readonly SentOrderView[]
}

/** The guest's own controls over this phone's payment screen. */
export interface PayControls {
  /** "Back to the bill": the payment's screen goes away; a reload no longer returns to it. */
  readonly dismiss: () => void
}

/** What a face gives the form slot besides the element. */
export interface PayFormProps {
  /** The form's pay button text, in the guest's language ("Pay 27,50 EUR"). */
  readonly label: string
  /** The class the face wants on that button, so it looks like the face's own. */
  readonly buttonClass: string
}

/** What the host returns for a mounted form. */
export interface PayFormHandle {
  /** The label changed (the tip, the lines). */
  readonly update: (props: PayFormProps) => void
  /** Takes the form away (the payment ended, or the face left the screen). */
  readonly unmount: () => void
}

/**
 * The form slot the page fills (#114): `mount` puts the provider's card form into `target`. The
 * form shows the provider's own text for card errors, reports the return to the host (which sends
 * `pay.returned`) and decides no outcome: the face's screen follows `state.payment`.
 */
export interface PayFormSlot {
  /** The empty element the face provides (an `HTMLElement`; the shell has no DOM types). */
  readonly mount: (target: object, props: PayFormProps) => PayFormHandle
}

/** What a host binds to a face: the state to draw and the way to send a command. */
export interface ServiceBinding {
  readonly state: ServiceState
  readonly dispatch: (command: GuestCommand) => Promise<CommandResult>
  /**
   * The form slot (#114, D127): the face puts an empty element where the card form belongs while
   * `payment.form` is set and gives it to `mount`, and the page fills it with the provider's card
   * form (the face is React; the slot is a plain element, so no framework or provider library is
   * the contract's). The face never loads a provider library (D72). Absent where the host has no
   * form (the admin's preview, a test): the face then shows the paying screen without one.
   */
  readonly payForm?: PayFormSlot
  /** "Back to the bill" from a payment's last screen (#114): forgets the payment on this phone. */
  readonly payControls?: PayControls
  /** The answers to the location screens (#76); absent where the host does not check. */
  readonly location?: LocationControls
}

/** A state with nothing in it: no bill, no request, no payment, no receipt. */
export const EMPTY_SERVICE_STATE: ServiceState = {
  revision: 0,
  preview: false,
  bill: null,
  requests: [],
  receipt: null,
}
