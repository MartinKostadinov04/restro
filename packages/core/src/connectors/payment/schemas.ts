// The shapes that cross the payment provider seam (D127 §Interfaces, design §10). Zod at the
// boundary: a provider's answer is parsed with these before the platform acts on it, and the
// conformance suite parses every answer.
//
// The service connector's two rules hold here too, through its own `WriteOutcome` and `Reading`:
//   - a timeout is always `unknown`: never `refused`; the platform reads the payment back by its
//     id before anything else (D125 3.9);
//   - a reading with any failed part is `complete: false` and concludes nothing.
//
// There is no refund (D125 3.5, D127 4.4): a refund is the venue's, in its own dashboard, and
// Restro only observes it through notices, by reading the payment back (`readNoticeSubject`).

import { z } from 'zod'

import { idSchema } from '../../ids'
import { CurrencySchema } from '../../money'
import {
  EmptyResultSchema,
  InstantSchema,
  MinorSchema,
  readingSchema,
  writeOutcomeSchema,
} from '../service/schemas'
import { ProviderRefSchema } from './provider-ref'

// ---------------------------------------------------------------------------------------------
// Values

/** Our payment's id (`py_`), which the provider keeps on its payment for the read-back. */
export const PaymentIdSchema = idSchema('py')

/**
 * An idempotency key: the same key with the same request makes the provider do the step once and
 * answer the same again (D125 3.9). The platform derives it from the payment and its step. The
 * pattern is the database's (`payment_steps.idempotency_key`, `PROVIDER_REF_PATTERN`: the first
 * character alphanumeric), capped at 200, so every key the seam accepts can be stored.
 */
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/)

/** An amount the provider is asked to hold or capture: whole minor units above zero (rule 8). */
export const PositiveMinorSchema = z.int().positive().max(Number.MAX_SAFE_INTEGER)

// ---------------------------------------------------------------------------------------------
// Refusals and outcomes

/**
 * How far a refusal reaches: this payment, or the venue's whole provider account. The first
 * `account` refusal pauses paying at once (D125 2.4: access removed, or the account can't take
 * payments).
 */
export const PAYMENT_REFUSAL_SCOPES = ['payment', 'account'] as const
export type PaymentRefusalScope = (typeof PAYMENT_REFUSAL_SCOPES)[number]

/**
 * Why the provider said a definite "no". A provider package maps its provider's answer to one of
 * these only where the provider's docs say so; anything else that is not a clear yes (a timeout,
 * a server error) is `unknown`.
 */
export const PAYMENT_REFUSAL_CODES = [
  /** Below the provider's minimum for the currency (`capabilities.minimumMinor`). */
  'amount_too_small',
  /** A capture above the amount held (a partial capture never goes above the hold). */
  'amount_above_hold',
  /** A partial capture where the provider takes none (`capabilities.partialCapture`). */
  'partial_not_supported',
  /** The payment is not held: the guest has not finished, or it failed or was released. */
  'not_held',
  /** The payment is captured already: only one capture (a second key is refused). */
  'already_captured',
  /** The hold ran out (`captureBefore` passed) and the provider dropped it. */
  'hold_expired',
  /** The provider refused the capture of a live hold for a reason it names (D127 3.14). */
  'capture_refused',
  /** The same idempotency key came with a different request. */
  'key_reused',
  /** No such payment or account at the provider. */
  'not_found',
  /** The venue's access was removed, or the credentials are refused (account scope). */
  'access_lost',
  /** The venue's account cannot take payments now (account scope). */
  'account_restricted',
  /** The provider does not offer this step for this account (wallet domains, say). */
  'not_supported',
] as const
export type PaymentRefusalCode = (typeof PAYMENT_REFUSAL_CODES)[number]

/** A definite "no", with its reach. */
export const PaymentRefusalSchema = z.strictObject({
  code: z.enum(PAYMENT_REFUSAL_CODES),
  scope: z.enum(PAYMENT_REFUSAL_SCOPES),
  /** The provider's own words, for the Restro team's Log only: never shown to a guest. */
  detail: z.string().max(500).nullable(),
})
export type PaymentRefusal = z.output<typeof PaymentRefusalSchema>

/** What a provider write answers: the service seam's outcome with the payment refusal. */
export function paymentWriteOutcomeSchema<R extends z.ZodType>(result: R) {
  return writeOutcomeSchema(result, PaymentRefusalSchema)
}

// ---------------------------------------------------------------------------------------------
// The payment as the provider holds it

/**
 * The platform's own statuses of a provider payment (design §10), whatever the provider calls
 * them:
 *   - `awaiting_guest`: created, the guest has not finished the card form (`needsGuestAction`
 *     while the guest's bank asks for a step);
 *   - `held`: the card is authorised for the amount, nothing has moved;
 *   - `captured`: the money moved (once; a partial capture released the rest);
 *   - `released`: the hold was cancelled or ran out, nothing moved;
 *   - `failed`: the card was declined or the bank's check failed, nothing is held.
 */
export const PROVIDER_PAYMENT_STATUSES = [
  'awaiting_guest',
  'held',
  'captured',
  'released',
  'failed',
] as const
export type ProviderPaymentStatus = (typeof PROVIDER_PAYMENT_STATUSES)[number]

/**
 * The result of the bank's check (3-D Secure, D127 6.9), kept as dispute evidence; null while
 * none ran or the provider does not say.
 */
export const THREE_DS_RESULTS = [
  'authenticated',
  'attempted',
  'exempted',
  'not_supported',
  'failed',
  'error',
] as const
export type ThreeDsResult = (typeof THREE_DS_RESULTS)[number]

/**
 * Where a dispute on a payment stands, in the platform's words (#108), whatever the provider
 * calls its states: `open` while the guest's bank asks or reviews (an early warning included),
 * `won` once it closed with the venue keeping the money, `lost` once the money went back. The
 * same words as `payments.dispute` (`PAYMENT_DISPUTE_STATES` in `@restro/db`).
 */
export const PAYMENT_DISPUTE_STATES = ['open', 'won', 'lost'] as const
export type PaymentDisputeState = (typeof PAYMENT_DISPUTE_STATES)[number]

/** A provider payment, read back (`readPayment`, `findByPaymentId`) or answered by a write. */
export const ProviderPaymentSchema = z
  .strictObject({
    ref: ProviderRefSchema,
    /** Our payment, as the provider keeps it. */
    paymentId: PaymentIdSchema,
    status: z.enum(PROVIDER_PAYMENT_STATUSES),
    /** The guest's bank asks for a step (3-D Secure); only while `awaiting_guest`. */
    needsGuestAction: z.boolean(),
    currency: CurrencySchema,
    /** The amount the hold was created for: the most that can ever be captured. */
    amountMinor: PositiveMinorSchema,
    /** What is held now and can still be captured: above zero while `held`, else zero. */
    heldMinor: MinorSchema,
    /** What was captured: above zero once `captured`, else zero; never above `amountMinor`. */
    capturedMinor: MinorSchema,
    /**
     * What the venue refunded in its own dashboard, in total so far (#108): an absolute amount,
     * never a change; zero for none; never above `capturedMinor`.
     */
    refundedMinor: MinorSchema,
    /** The latest dispute on the payment, as it stands now; null for none. Only once captured. */
    dispute: z.enum(PAYMENT_DISPUTE_STATES).nullable(),
    /** When the provider drops the hold uncaptured, once it is held and the provider says. */
    captureBefore: InstantSchema.nullable(),
    threeDs: z.enum(THREE_DS_RESULTS).nullable(),
    /** The bank's authorisation code, dispute evidence; null where none (yet). */
    authorisationCode: z.string().min(1).max(64).nullable(),
  })
  .superRefine((payment, ctx) => {
    const problem = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] })
    if (payment.needsGuestAction && payment.status !== 'awaiting_guest') {
      problem('only a payment awaiting the guest needs the guest', 'needsGuestAction')
    }
    if ((payment.status === 'held') !== payment.heldMinor > 0) {
      problem('an amount is held exactly while the payment is held', 'heldMinor')
    }
    if ((payment.status === 'captured') !== payment.capturedMinor > 0) {
      problem('an amount is captured exactly once the payment is captured', 'capturedMinor')
    }
    if (payment.heldMinor > payment.amountMinor) {
      problem('more is held than the hold was created for', 'heldMinor')
    }
    if (payment.capturedMinor > payment.amountMinor) {
      problem('more is captured than the hold was created for', 'capturedMinor')
    }
    if (payment.refundedMinor > payment.capturedMinor) {
      problem('more is refunded than was captured', 'refundedMinor')
    }
    if (payment.dispute !== null && payment.status !== 'captured') {
      problem('only a captured payment can be disputed', 'dispute')
    }
  })
export type ProviderPayment = z.output<typeof ProviderPaymentSchema>

// ---------------------------------------------------------------------------------------------
// Notices (D127 1.4, design §8; ticket #108)

/**
 * What a provider's notice is about, in the platform's words: the provider's web part maps its own
 * event types to these, so no provider event name picks platform behaviour. `other` has no
 * handler: the worker marks it handled and does nothing. The same words as
 * `provider_notices.kind` (`PROVIDER_NOTICE_KINDS` in `@restro/db`).
 */
export const PROVIDER_NOTICE_KINDS = ['refund', 'dispute', 'other'] as const
export type ProviderNoticeKind = (typeof PROVIDER_NOTICE_KINDS)[number]

/**
 * A provider notice, verified: which event, of what type, about which object of which account.
 * It is a pointer, never the facts: the worker reads the object back from the provider before it
 * records anything, so a forged, stale or out-of-order body changes nothing (D125 3.8).
 */
export const ProviderNoticeSchema = z.strictObject({
  /** The provider's event id: the notice is stored once by it. */
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
  /** The provider's event type, as it names it: stored for the Restro team's Log, never acted on. */
  type: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  kind: z.enum(PROVIDER_NOTICE_KINDS),
  /** The venue's account the event came from; null for a platform-level event. */
  accountRef: ProviderRefSchema.nullable(),
  /** The object the event is about (a payment, a refund, a dispute), read back before acting. */
  objectRef: ProviderRefSchema.nullable(),
})
export type ProviderNotice = z.output<typeof ProviderNoticeSchema>

/**
 * What the page's card form needs to mount (design §10): opaque to the platform, which stores
 * nothing of it and hands it to the paying phone only. A provider package fills it; the
 * platform never reads a key of it.
 */
export const ProviderFormValuesSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.string().min(1).max(2000))
  .refine((values) => Object.keys(values).length <= 16, 'at most 16 form values')
  .brand<'ProviderFormValues'>()
export type ProviderFormValues = z.output<typeof ProviderFormValuesSchema>

// ---------------------------------------------------------------------------------------------
// Connection (D125 2.1–2.4; #61 designs the screens)

/**
 * Start or continue connecting a venue's provider account: a new account (`accountRef` null),
 * or a fresh link to finish one already started. The provider's hosted form returns the owner
 * to `returnUrl`, or to `refreshUrl` when the link ran out.
 */
export const StartConnectionRequestSchema = z.strictObject({
  venueId: idSchema('vn'),
  accountRef: ProviderRefSchema.nullable(),
  returnUrl: z.url({ protocol: /^https?$/ }),
  refreshUrl: z.url({ protocol: /^https?$/ }),
  idempotencyKey: IdempotencyKeySchema,
})
export type StartConnectionRequest = z.output<typeof StartConnectionRequestSchema>

export const StartConnectionResultSchema = z.strictObject({
  /** The provider's hosted form; the owner's browser goes there. Never stored. */
  redirectUrl: z.url({ protocol: /^https$/ }),
  accountRef: ProviderRefSchema,
})
export type StartConnectionResult = z.output<typeof StartConnectionResultSchema>

/** Whether the account can take card payments now, and what the provider still asks for. */
export const ConnectionStatusSchema = z.strictObject({
  canTakePayments: z.boolean(),
  /** The provider's own names of what is missing, for the settings screen; empty when none. */
  missing: z.array(z.string().min(1).max(200)).max(100),
})
export type ConnectionStatus = z.output<typeof ConnectionStatusSchema>

/** Register the guest page's host on the account, for wallets (D125 3.6). */
export const PrepareDomainRequestSchema = z.strictObject({
  accountRef: ProviderRefSchema,
  host: z.hostname(),
  idempotencyKey: IdempotencyKeySchema,
})
export type PrepareDomainRequest = z.output<typeof PrepareDomainRequestSchema>

// ---------------------------------------------------------------------------------------------
// Paying

/**
 * Create a hold for our payment (D127 3.1): nothing moves until `capture`. The amount is the
 * POS's own line amounts plus the tip, priced by the platform. `description` is the venue's
 * name and table label, never a guest's data (D125 3.7).
 */
export const CreateHoldRequestSchema = z.strictObject({
  paymentId: PaymentIdSchema,
  accountRef: ProviderRefSchema,
  amountMinor: PositiveMinorSchema,
  currency: CurrencySchema,
  idempotencyKey: IdempotencyKeySchema,
  description: z.string().min(1).max(200),
})
export type CreateHoldRequest = z.output<typeof CreateHoldRequestSchema>

export const CreateHoldResultSchema = z.strictObject({
  paymentRef: ProviderRefSchema,
  form: ProviderFormValuesSchema,
})
export type CreateHoldResult = z.output<typeof CreateHoldResultSchema>

/** Capture a held payment, once, for at most the hold (a smaller amount releases the rest). */
export const CaptureRequestSchema = z.strictObject({
  accountRef: ProviderRefSchema,
  paymentRef: ProviderRefSchema,
  amountMinor: PositiveMinorSchema,
  idempotencyKey: IdempotencyKeySchema,
})
export type CaptureRequest = z.output<typeof CaptureRequestSchema>

/** Release a payment that is not captured: nothing moves. */
export const ReleaseRequestSchema = z.strictObject({
  accountRef: ProviderRefSchema,
  paymentRef: ProviderRefSchema,
  idempotencyKey: IdempotencyKeySchema,
})
export type ReleaseRequest = z.output<typeof ReleaseRequestSchema>

// ---------------------------------------------------------------------------------------------
// Answer schemas, one per step, for the platform and the conformance suite

export const PAYMENT_ANSWER_SCHEMAS = {
  startConnection: paymentWriteOutcomeSchema(StartConnectionResultSchema),
  readConnection: readingSchema(ConnectionStatusSchema),
  prepareDomain: paymentWriteOutcomeSchema(EmptyResultSchema),
  createHold: paymentWriteOutcomeSchema(CreateHoldResultSchema),
  findByPaymentId: readingSchema(ProviderPaymentSchema.nullable()),
  readPayment: readingSchema(ProviderPaymentSchema),
  readNoticeSubject: readingSchema(ProviderPaymentSchema.nullable()),
  capture: paymentWriteOutcomeSchema(ProviderPaymentSchema),
  release: paymentWriteOutcomeSchema(ProviderPaymentSchema),
} as const
