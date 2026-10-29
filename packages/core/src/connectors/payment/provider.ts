// The provider-neutral payment provider (D98, D127 §Interfaces, design §10). The integration
// layer owns it, beside the service connector; each provider package under `packages/payments/`
// implements it, and only the worker calls one (D127 1.2). The platform says "hold this amount
// for this payment", "capture it", "release it"; the route, its compare-and-sets, the recovery
// job and the Log stay in the platform.
//
// Every provider id crosses inside a `ProviderRef` (rule 3); money is whole minor units (rule 8);
// a timeout is `unknown` and is read back by our payment id (D125 3.9); a partial reading
// concludes nothing. Only `capture` moves money. There is no refund (D125 3.5, D127 4.4): a
// refund or a dispute is only read back, after a notice (`readNoticeSubject`, #108).

import type { PaymentId } from '../../ids'
import type { EmptyResult, Reading, WriteOutcome } from '../service/schemas'
import type { PaymentCapabilities } from './capabilities'
import type { ProviderRef } from './provider-ref'
import type {
  CaptureRequest,
  ConnectionStatus,
  CreateHoldRequest,
  CreateHoldResult,
  PaymentRefusal,
  PrepareDomainRequest,
  ProviderNotice,
  ProviderPayment,
  ReleaseRequest,
  StartConnectionRequest,
  StartConnectionResult,
} from './schemas'

/** What a provider write answers: done, a definite "no", or `unknown` (read back). */
export type PaymentWriteOutcome<R> = WriteOutcome<R, PaymentRefusal>

/** The steps of the interface, in the order the guard reports them. */
export const PAYMENT_PROVIDER_STEPS = [
  'startConnection',
  'readConnection',
  'prepareDomain',
  'createHold',
  'findByPaymentId',
  'readPayment',
  'readNoticeSubject',
  'capture',
  'release',
] as const
export type PaymentProviderStep = (typeof PAYMENT_PROVIDER_STEPS)[number]

/** The steps that change something at the provider; only `capture` moves money. */
export const PAYMENT_WRITE_STEPS: readonly PaymentProviderStep[] = [
  'startConnection',
  'prepareDomain',
  'createHold',
  'capture',
  'release',
]

export interface PaymentProvider {
  /** The provider kind, as its package names itself (`payments.provider_kind`). */
  readonly kind: string
  readonly capabilities: PaymentCapabilities

  // Connection (D125 2.1–2.4)
  /** A new venue account, or a fresh link to finish one; the owner is sent to `redirectUrl`. */
  startConnection(
    request: StartConnectionRequest,
  ): Promise<PaymentWriteOutcome<StartConnectionResult>>
  /** Whether the account can take card payments, and what is missing (D125 2.3). */
  readConnection(accountRef: ProviderRef): Promise<Reading<ConnectionStatus>>
  /** Register the guest page's host on the account, for wallets (D125 3.6). */
  prepareDomain(request: PrepareDomainRequest): Promise<PaymentWriteOutcome<EmptyResult>>

  // Paying (D127 3.1)
  /** Create a hold, idempotent by key; nothing moves. */
  createHold(request: CreateHoldRequest): Promise<PaymentWriteOutcome<CreateHoldResult>>
  /** Our payment's provider payment, or null where none was made: the read-back after a timeout. */
  findByPaymentId(
    accountRef: ProviderRef,
    paymentId: PaymentId,
  ): Promise<Reading<ProviderPayment | null>>
  /** The payment's status, amounts, `captureBefore`, the bank's check and its code. */
  readPayment(accountRef: ProviderRef, paymentRef: ProviderRef): Promise<Reading<ProviderPayment>>
  /**
   * The payment a notice is about, read back from the provider as it stands now (#108): the
   * object the notice names (a payment, a refund, a dispute) leads to its payment. Null when the
   * object is not this account's, or leads to no payment Restro made. The notice's own body is
   * never trusted: the amounts and the dispute come from this reading.
   */
  readNoticeSubject(
    accountRef: ProviderRef,
    notice: ProviderNotice,
  ): Promise<Reading<ProviderPayment | null>>
  /** Capture once, at most the hold, idempotent by key: the only step that moves money. */
  capture(request: CaptureRequest): Promise<PaymentWriteOutcome<ProviderPayment>>
  /** Release a payment that is not captured, idempotent by key; nothing moves. */
  release(request: ReleaseRequest): Promise<PaymentWriteOutcome<ProviderPayment>>
}

/**
 * Why the notice route refused a notice, the only thing its log line says (#108):
 *   - `unsigned`: no signature header, or none of the provider's scheme;
 *   - `bad_signature`: no signature matches the body;
 *   - `stale`: signed outside the tolerance (a replay);
 *   - `malformed`: the body is not the provider's event;
 *   - `wrong_mode`: a live event in a test environment, or a test event in production.
 */
export const NOTICE_REFUSAL_REASONS = [
  'unsigned',
  'bad_signature',
  'stale',
  'malformed',
  'wrong_mode',
] as const
export type NoticeRefusalReason = (typeof NOTICE_REFUSAL_REASONS)[number]

/**
 * The web's part of a provider (D127 1.4, design §8): checks a notice's signature by hand, with
 * no provider SDK, that its live/test flag matches this environment, and maps the provider's
 * event type to a `ProviderNoticeKind`. Implemented per provider in
 * `apps/web/src/connectors/<kind>/` (#108); the notice route records what it returns and nothing
 * else, and a worker job reads the object back from the provider.
 */
export interface ProviderNoticeVerifier {
  readonly kind: string
  verify(
    rawBody: string,
    headers: Headers,
    secret: string,
    now: Date,
    live: boolean,
  ): { ok: true; notice: ProviderNotice } | { ok: false; reason: NoticeRefusalReason }
}
