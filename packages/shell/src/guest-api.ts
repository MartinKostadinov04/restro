// The guest API's wire shapes (D121; design `2026-10-20-guest-api-design.md` §3–§5; ticket #75):
// what `GET /api/guest/state` and `POST /api/guest/actions` answer and what the POST takes. Strict
// both ways: the route parses the request with these and checks its own answer with them before
// it sends it, and the host's client parses every answer with them. Pure: no I/O.
//
// The table's code travels in the `Authorization: Table <code>` header, never in a body or an
// address. Every id is ours (`ol_`, `nd_`, `tb_`…); nothing here can carry a POS id, an internal
// name or a price of an order line (rule 3); a bill line's amount is the bill's own.
//
// Paying (#110, D127): `pay.start`, `pay.returned` and `pay.cancel` go through the same POST. The
// paying phone gets a payment handle in the answer to its `pay.start` and sends it back in
// `X-Restro-Payment`, never in an address or a body; `GET /api/guest/payment` answers that phone
// alone, with its payment and, while the card is being collected, the provider's form values.

import {
  DecimalQuantitySchema,
  GuestPositionSchema,
  idSchema,
  LocalizedTextSchema,
} from '@restro/core'
import { z } from 'zod'

import { GUEST_REFUSAL_CODES } from './service-vocabulary'
import { GuestCommandSchema, SERVICE_LIMITS } from './services'

/** The largest request body the API reads, in bytes. */
export const GUEST_API_MAX_BYTES = 8 * 1024

/** The screen a phone polls from: the menu polls slower than the order and the bill. */
export const GUEST_API_VIEWS = ['menu', 'order', 'bill'] as const

/** One screen. */
export type GuestApiView = (typeof GUEST_API_VIEWS)[number]

/** The header scheme of the table's code: `Authorization: Table <code>`. */
export const TABLE_AUTH_SCHEME = 'Table'

/**
 * The header of the random value a page makes at load (#76, D122 §4): the key of the per-phone
 * limits, kept in the server's memory for minutes and never stored. Required on a command.
 */
export const GUEST_PHONE_HEADER = 'X-Restro-Phone'

/** A phone value: 16 random bytes, base64url. */
export const GUEST_PHONE_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** The header of the location pass the phone holds (#76): never in an address or a body. */
export const GUEST_PASS_HEADER = 'X-Restro-Pass'

/** The Turnstile action a Send's widget names, and siteverify's answer must name (#76). */
export const TURNSTILE_SEND_ACTION = 'order_send'

/** The Turnstile action a `pay.start`'s widget names (#110, D127 §Limits). */
export const TURNSTILE_PAY_ACTION = 'pay_start'

/**
 * The header of the payment handle (D127 2.2): the secret only the paying phone holds, kept in
 * `sessionStorage`. Never in an address or a body, never logged; only its hash is stored.
 */
export const GUEST_PAYMENT_HEADER = 'X-Restro-Payment'

/** A payment handle: 16 random bytes (128 bits), base64url. */
export const PAYMENT_HANDLE_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** Where the phone stands with the location check: none at the venue, a pass, or none yet. */
export const GUEST_LOCATION_STATES = ['off', 'needed', 'held'] as const

/** The oldest tap the API takes, in milliseconds (a day; an order edit is refused past 30 s). */
const MAX_AGE_MS = 24 * 60 * 60_000

const seconds = z.int().nonnegative()
const minor = z.int()
const NodeIdSchema = idSchema('nd')
const LineIdSchema = idSchema('ol')
const ModeSchema = z.enum(['on_bill', 'pay_first'])

const OrderLineFields = {
  id: LineIdSchema,
  itemId: NodeIdSchema,
  optionIds: z.array(NodeIdSchema).max(SERVICE_LIMITS.options),
  qty: z.int().min(1).max(SERVICE_LIMITS.quantity),
  note: z.string().max(SERVICE_LIMITS.note),
}

/** The table's state as a phone may see it. */
export const GuestTableStateSchema = z.strictObject({
  unchanged: z.literal(false),
  /** The table's version: only rises; the phone sends it back as `since`. */
  version: z.int().nonnegative(),
  /** Milliseconds to the next poll. */
  next: z.int().positive(),
  table: z.strictObject({ label: z.string().max(64) }),
  ordering: z.strictObject({ state: z.enum(['on', 'paused', 'closed']) }),
  /**
   * The location check (#76): `needed` leaves out the order, the sent orders and the bill until
   * the phone holds a pass of the table's current sitting.
   */
  location: z.strictObject({
    state: z.enum(GUEST_LOCATION_STATES),
    passSeconds: seconds.nullable(),
    /** How long the phone remembers the guest's consent or refusal: to the service day's end. */
    dayEndsInSeconds: seconds,
    /** The venue's name, which the consent text names. */
    venueName: z.string().max(200),
  }),
  /** The table's order; null while the location check is `needed`. */
  order: z
    .strictObject({
      lines: z
        .array(
          z.strictObject({
            ...OrderLineFields,
            rev: z.int().nonnegative(),
            mode: ModeSchema,
            held: idSchema('py').nullable(),
          }),
        )
        .max(SERVICE_LIMITS.lines),
      removed: z
        .array(z.strictObject({ ...OrderLineFields, undoSeconds: seconds }))
        .max(SERVICE_LIMITS.lines),
      earlier: z
        .strictObject({
          setAsideAt: z.int().nonnegative(),
          setAsideAgoSeconds: seconds,
          lines: z
            .array(z.strictObject({ ...OrderLineFields, mode: ModeSchema }))
            .max(SERVICE_LIMITS.lines),
        })
        .nullable(),
    })
    .nullable(),
  sentOrders: z
    .array(
      z.strictObject({
        id: idSchema('so'),
        state: z.enum(['sending', 'awaiting_approval', 'added', 'not_sent', 'unconfirmed']),
        reason: z.string().max(64).nullable(),
        ref: z.string().max(32),
      }),
    )
    .max(50),
  bill: z
    .strictObject({
      readAgoSeconds: seconds,
      complete: z.boolean(),
      currency: z.string().length(3).nullable(),
      totalMinor: minor,
      paidMinor: minor,
      owedMinor: minor,
      parts: z
        .array(
          z.strictObject({
            id: z.string().min(1).max(64),
            beingPaid: z.boolean(),
            totalMinor: minor,
            paidMinor: minor,
            lines: z
              .array(
                z.strictObject({
                  id: z.string().min(1).max(64),
                  /** Our item's name; null is "Other item", worded by the shell. */
                  name: LocalizedTextSchema.nullable(),
                  quantity: z.string().max(32),
                  amountMinor: minor,
                  /** In a payment that isn't final (D127 2.4): no payer, amount or timer. */
                  beingPaid: z.boolean(),
                }),
              )
              .max(500),
          }),
        )
        .max(50),
    })
    .nullable(),
})

/** The table's state as a phone may see it. */
export type GuestTableState = z.output<typeof GuestTableStateSchema>

/** "Nothing changed since your version." */
export const GuestUnchangedSchema = z.strictObject({
  unchanged: z.literal(true),
  version: z.int().nonnegative(),
  next: z.int().positive(),
  /** When it differs from the state the phone holds, the phone asks for the whole state again. */
  location: z.enum(GUEST_LOCATION_STATES),
})

/** What `GET /api/guest/state` answers with 200. */
export const GuestStateAnswerSchema = z.discriminatedUnion('unchanged', [
  GuestTableStateSchema,
  GuestUnchangedSchema,
])

/** What `GET /api/guest/state` answers with 200. */
export type GuestStateAnswer = z.output<typeof GuestStateAnswerSchema>

/** The query of `GET /api/guest/state`. */
export const GuestStateQuerySchema = z.strictObject({
  since: z.coerce.number().int().nonnegative().optional(),
  view: z.enum(GUEST_API_VIEWS).default('menu'),
})

/** The longest Turnstile token (Cloudflare's siteverify: 2048 characters). */
const HUMAN_TOKEN_MAX = 2_048

/**
 * What the page (never the face) adds to a command (#76, design §5): the phone's position with
 * the consent version the guest allowed, and Turnstile's token at Send. The server checks the
 * position in memory and drops it; nothing logs it, and a parse error names paths only.
 */
export const GuestCheckSchema = z.strictObject({
  location: GuestPositionSchema.optional(),
  consentVersion: z.string().min(1).max(16).optional(),
  humanToken: z.string().min(1).max(HUMAN_TOKEN_MAX).optional(),
})

/** What the page adds to a command. */
export type GuestCheck = z.output<typeof GuestCheckSchema>

/** A bill line's id (`bn_`), as the table's state shows it. */
const BillLineIdSchema = idSchema('bn')

/** The most bill lines one payment picks. */
const PAY_LINES_MAX = 200

/**
 * The guest's pay commands (#110, D127; design §3). `pay.start` picks whole lines of the bill (a
 * line's whole quantity, as the bill shows it) or the whole bill, and sends every picked line as the
 * phone saw it (the knock, D111). At most one of `tipMinor` and `tipPercent` is set; neither is no
 * tip (it starts at zero, D127). `pay.returned` and `pay.cancel` name the payment by the handle in
 * `X-Restro-Payment`.
 */
export const GuestPayCommandSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('pay.start'),
      actionId: z.uuid(),
      pick: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('lines'),
          lines: z
            .array(z.strictObject({ lineId: BillLineIdSchema, quantity: DecimalQuantitySchema }))
            .min(1)
            .max(PAY_LINES_MAX),
        }),
        z.strictObject({ kind: z.literal('whole') }),
      ]),
      seen: z
        .array(
          z.strictObject({
            lineId: BillLineIdSchema,
            quantity: DecimalQuantitySchema,
            amountMinor: minor,
          }),
        )
        .min(1)
        .max(PAY_LINES_MAX),
      tipMinor: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
      tipPercent: z.int().min(1).max(SERVICE_LIMITS.tipPercentMax).nullable(),
    })
    .refine((command) => command.tipMinor === null || command.tipPercent === null, {
      message: 'set either tipMinor or tipPercent, not both',
      path: ['tipPercent'],
    }),
  z.strictObject({ kind: z.literal('pay.returned'), actionId: z.uuid() }),
  z.strictObject({ kind: z.literal('pay.cancel'), actionId: z.uuid() }),
])

/** A guest pay command. */
export type GuestPayCommand = z.input<typeof GuestPayCommandSchema>

/** The body of `POST /api/guest/actions`. */
export const GuestActionRequestSchema = z.strictObject({
  /**
   * A face's command, or a pay command. The pay commands come first: the face contract's own
   * `pay.start` (a quote and a method, D71) still parses as the face's and is answered `not_built`.
   */
  command: z.union([GuestPayCommandSchema, GuestCommandSchema]),
  /** Milliseconds since the guest's tap (a retry sends the same tap's age, grown). */
  ageMs: z.int().nonnegative().max(MAX_AGE_MS),
  view: z.enum(GUEST_API_VIEWS).default('order'),
  check: GuestCheckSchema.optional(),
})

/** The body of `POST /api/guest/actions`. */
export type GuestActionRequest = z.input<typeof GuestActionRequestSchema>

/** A command's answer. */
export const GuestCommandResultSchema = z.strictObject({
  actionId: z.uuid().nullable(),
  status: z.enum(['accepted', 'rejected']),
  code: z.string().max(64).nullable(),
  subjectId: z.string().max(64).nullable(),
  ref: z.string().max(32).nullable(),
})

/** What `POST /api/guest/actions` answers with 200: the result and the table's fresh state. */
export const GuestActionAnswerSchema = z.strictObject({
  result: GuestCommandResultSchema,
  state: GuestTableStateSchema.nullable(),
  /** A fresh location pass for the phone to send back in `X-Restro-Pass`, or null. */
  pass: z.string().min(1).max(1_024).nullable(),
  /**
   * The payment handle, only in the answer to the `pay.start` that made (or repeats) the payment:
   * the page keeps it in `sessionStorage` and sends it in `X-Restro-Payment`. Null otherwise.
   */
  handle: z.string().regex(PAYMENT_HANDLE_PATTERN).nullable(),
})

/** What `POST /api/guest/actions` answers with 200. */
export type GuestActionAnswer = z.output<typeof GuestActionAnswerSchema>

/** The states of a payment a paying phone sees (the database's, D127; design §4). */
export const GUEST_PAYMENT_STATES = [
  'requested',
  'priced',
  'awaiting_guest',
  'held',
  'queued',
  'isolated',
  'entered',
  'checked',
  'closed',
  'cancelling',
  'captured',
  'released',
  'unconfirmed',
  'stranded',
  'capture_failed',
] as const

/**
 * What `GET /api/guest/payment` answers the paying phone with 200 (#110): where its payment stands,
 * the lines and the amounts once priced, and the provider's form values while the card is being
 * collected (`awaiting_guest`). The form's values are the one provider value a guest answer
 * carries, and only this one (rule 3, D127).
 */
export const GuestPaymentAnswerSchema = z.strictObject({
  id: idSchema('py'),
  state: z.enum(GUEST_PAYMENT_STATES),
  /** Why the payment ended or is ending (`bill_changed`, `cancelled`, `expired`...), or null. */
  reason: z.string().max(64).nullable(),
  currency: z.string().length(3),
  /** The hold: the lines plus the tip, once priced; null before. */
  amountMinor: minor.nullable(),
  tipMinor: minor,
  lines: z
    .array(
      z.strictObject({
        name: z.string().max(200),
        quantity: z.string().max(32),
        amountMinor: minor,
      }),
    )
    .max(PAY_LINES_MAX),
  /** The card form: which provider's, and the values it needs. Only while `awaiting_guest`. */
  form: z
    .strictObject({
      provider: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
      values: z.record(z.string().max(64), z.string().max(2_000)),
      /** Seconds the guest has to confirm. */
      confirmSeconds: seconds,
    })
    .nullable(),
  /** Milliseconds to the next poll. */
  next: z.int().positive(),
})

/** What `GET /api/guest/payment` answers with 200. */
export type GuestPaymentAnswer = z.output<typeof GuestPaymentAnswerSchema>

/** The answer of a request the API refused before any command ran (401, 400, 404, 413, 429). */
export const GuestApiErrorSchema = z.strictObject({
  code: z.enum(['code_retired', 'invalid_request', 'too_large', 'rate_limited', 'unknown_payment']),
})

/** The answer of a request the API refused before any command ran. */
export type GuestApiError = z.output<typeof GuestApiErrorSchema>

/** True if `code` is one the shell words. */
export function isGuestRefusalCode(code: string): code is (typeof GUEST_REFUSAL_CODES)[number] {
  return (GUEST_REFUSAL_CODES as readonly string[]).includes(code)
}
