// The Stripe payment provider (#107; D126, D127 §Interfaces, design §10): direct charges on the
// venue's own Stripe account (`Stripe-Account`), a manual-capture PaymentIntent per payment, Accounts
// v2 with Stripe's hosted onboarding for connecting. Only apps/worker builds it (D127 1.2).
//
// Every request is parsed with the seam's schemas first: a malformed request is a bug in the
// platform and throws. Every Stripe answer is parsed with this package's schemas (`api.ts`)
// before it is mapped. A timeout, a 5xx, a 409 or a rate limit is `unknown` (`errors.ts`), and
// stripe-node never retries on its own (`maxNetworkRetries: 0`): the platform decides. Restro
// never refunds (D125 3.5): nothing here makes one; a refund or a dispute is only read back.
// No key, client secret or Stripe message reaches a log or an error unredacted (`withoutSecrets`).

import {
  CaptureRequestSchema,
  type ConnectionStatus,
  CreateHoldRequestSchema,
  type CreateHoldResult,
  type Currency,
  type PaymentCapabilities,
  type PaymentDisputeState,
  type PaymentId,
  PaymentIdSchema,
  type PaymentProvider,
  type PaymentWriteOutcome,
  PrepareDomainRequestSchema,
  type ProviderFormValues,
  ProviderFormValuesSchema,
  type ProviderNotice,
  ProviderNoticeSchema,
  type ProviderPayment,
  type ProviderRef,
  ProviderRefSchema,
  providerRef,
  type Reading,
  ReleaseRequestSchema,
  StartConnectionRequestSchema,
  type StartConnectionResult,
} from '@restro/core'
import Stripe from 'stripe'
import type { z } from 'zod'

import {
  AccountLinkSchema,
  AccountSchema,
  ChargeSchema,
  DisputeSchema,
  listSchema,
  PaymentIntentSchema,
  PaymentMethodDomainSchema,
  RefundSchema,
  SearchResultSchema,
  type StripeCharge,
  type StripePaymentIntent,
} from './api'
import { checkStripeKey, withoutSecrets } from './config'
import { classify, detailOf, failedWrite, isMissing, type WriteStep } from './errors'
import {
  connectionStatus,
  disputeState,
  type Mapped,
  PAYMENT_METADATA_KEY,
  providerPayment,
} from './mapping'

/** The provider kind (`payments.provider_kind`, `apps/web/src/connectors/stripe/`). */
export const STRIPE_KIND = 'stripe'

/**
 * The API version every request names. stripe-node 23.0.1 pins it; the API reference of v2
 * accounts and account links sends it too (https://docs.stripe.com/api/versioning.md,
 * https://docs.stripe.com/api/v2/core/account-links/create.md).
 */
export const STRIPE_API_VERSION = '2026-09-30.endive'

/**
 * The smallest charge per currency (https://docs.stripe.com/currencies.md#minimum-and-maximum-charge-amounts:
 * EUR 0.50). Stripe accepts a smaller PaymentIntent at creation (the sandbox, 10-26), so the
 * provider refuses it itself.
 */
const MINIMUM_MINOR: { readonly [C in Currency]: number } = { EUR: 50 }

/**
 * What Stripe offers a venue's account (D126; design §10):
 *   - a hold on a card the guest pays online (customer-initiated) lasts 7 days on every brand
 *     (https://docs.stripe.com/payments/place-a-hold-on-a-payment-method.md); each payment's own
 *     `captureBefore` is the exact moment;
 *   - a capture may take less than the hold, and the rest is released (same page);
 *   - Apple Pay and Google Pay are cards in the card form, once the domain is registered;
 *   - a refund in the Dashboard sends an event (#108).
 */
export const STRIPE_CAPABILITIES: PaymentCapabilities = {
  holdDays: 7,
  partialCapture: true,
  wallets: ['apple_pay', 'google_pay'],
  refundNotices: true,
  minimumMinor: (currency) => MINIMUM_MINOR[currency],
}

/**
 * The country of a venue's new account: Restro's pilot venues are Bulgarian clubs. Stripe
 * needs it before it takes a merchant configuration (`identity_country_required`,
 * https://docs.stripe.com/api/v2/core/accounts/create.md; the sandbox, 10-26), and the hosted
 * form then asks for Bulgaria's details.
 */
const ACCOUNT_COUNTRY = 'bg'

/** Payments made in this window are found by listing; older ones by search (see `findByPaymentId`). */
const RECENT_WINDOW_S = 2 * 60 * 60

/** At most this many pages of 100 are listed; past that the read-back is incomplete. */
const RECENT_PAGES = 10

/** A request with no answer by then is `unknown`. */
const DEFAULT_TIMEOUT_MS = 20_000

export interface StripeProviderOptions {
  /** The deployment's environment (`PAYMENTS_ENV`): checked against the key (`checkStripeKey`). */
  readonly env: string
  /** The platform's secret or restricted key. Never logged. */
  readonly key: string
  /** The fetch every request goes through (tests: recordings and faults). Default: global fetch. */
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  /** The clock of the read-back's window. Default: the system's. */
  readonly now?: () => Date
}

/** A read that worked, or why not: `missing` when Stripe said there is no such object here. */
type Got<T> = { ok: true; value: T } | { ok: false; missing: boolean; reason: string }

/** The Stripe provider. Throws `StripeConfigError` when the key does not fit the environment. */
export function createStripeProvider(options: StripeProviderOptions): PaymentProvider {
  const { key } = checkStripeKey(options.env, options.key)
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = options.now ?? (() => new Date())
  const stripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    telemetry: false,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    httpClient: Stripe.createFetchHttpClient(fetchFn),
  })

  const on = (accountRef: ProviderRef) => ({ stripeAccount: accountRef.provider })
  const keyed = (accountRef: ProviderRef, idempotencyKey: string) => ({
    stripeAccount: accountRef.provider,
    idempotencyKey,
  })

  /** Runs a read and parses its answer; a failure is a reason, never a throw. */
  async function get<S extends z.ZodType>(
    schema: S,
    call: () => Promise<unknown>,
  ): Promise<Got<z.output<S>>> {
    let answer: unknown
    try {
      answer = await call()
    } catch (error) {
      return { ok: false, missing: isMissing(error), reason: detailOf(error) }
    }
    const parsed = schema.safeParse(answer)
    if (!parsed.success) {
      return {
        ok: false,
        missing: false,
        reason: 'Stripe answered an object this package cannot read',
      }
    }
    return { ok: true, value: parsed.data }
  }

  function incomplete(reason: string): { complete: false; reason: string } {
    return { complete: false, reason: withoutSecrets(reason).slice(0, 500) }
  }

  /** The latest dispute on a captured payment, as it stands now. */
  async function latestDispute(
    accountRef: ProviderRef,
    intentId: string,
  ): Promise<Mapped<PaymentDisputeState | null>> {
    // GET /v1/disputes?payment_intent=…: newest first (https://docs.stripe.com/api/disputes/list.md).
    const disputes = await get(listSchema(DisputeSchema), () =>
      stripe.disputes.list({ payment_intent: intentId, limit: 10 }, on(accountRef)),
    )
    if (!disputes.ok) return { ok: false, reason: `the disputes were not read: ${disputes.reason}` }
    const latest = [...disputes.value.data].sort((a, b) => b.created - a.created)[0]
    if (latest === undefined) return { ok: true, value: null }
    const state = disputeState(latest.status)
    if (state === 'unknown') return { ok: false, reason: `unknown dispute status ${latest.status}` }
    return { ok: true, value: state }
  }

  /** The payment from an intent: its latest charge read too where it was not expanded. */
  async function paymentOf(
    accountRef: ProviderRef,
    intent: StripePaymentIntent,
  ): Promise<Mapped<ProviderPayment>> {
    let charge: StripeCharge | null = null
    if (typeof intent.latest_charge === 'string') {
      // GET /v1/charges/:id (https://docs.stripe.com/api/charges/retrieve.md)
      const read = await get(ChargeSchema, () =>
        stripe.charges.retrieve(intent.latest_charge as string, {}, on(accountRef)),
      )
      if (!read.ok) return { ok: false, reason: `the charge was not read: ${read.reason}` }
      charge = read.value
    } else {
      charge = intent.latest_charge ?? null
    }
    let dispute: PaymentDisputeState | null = null
    if (intent.status === 'succeeded') {
      const latest = await latestDispute(accountRef, intent.id)
      if (!latest.ok) return latest
      dispute = latest.value
    }
    return providerPayment(intent, charge, dispute)
  }

  /** Reads an intent by id with its latest charge. */
  async function readIntent(
    accountRef: ProviderRef,
    intentId: string,
  ): Promise<Got<ProviderPayment>> {
    // GET /v1/payment_intents/:id?expand[]=latest_charge
    // (https://docs.stripe.com/api/payment_intents/retrieve.md, https://docs.stripe.com/api/expanding_objects.md)
    const read = await get(PaymentIntentSchema, () =>
      stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }, on(accountRef)),
    )
    if (!read.ok) return read
    const payment = await paymentOf(accountRef, read.value)
    return payment.ok ? payment : { ok: false, missing: false, reason: payment.reason }
  }

  /** A write's answer: the payment it left, mapped (a write that landed but cannot be read is unknown). */
  async function written(
    accountRef: ProviderRef,
    answer: unknown,
  ): Promise<PaymentWriteOutcome<ProviderPayment>> {
    const intent = PaymentIntentSchema.safeParse(answer)
    if (!intent.success) return { kind: 'unknown', reason: 'Stripe answered an unreadable payment' }
    const payment = await paymentOf(accountRef, intent.data)
    if (!payment.ok) {
      return {
        kind: 'unknown',
        reason: withoutSecrets(`done, but ${payment.reason}`).slice(0, 500),
      }
    }
    return { kind: 'done', result: payment.value }
  }

  /** A failed write of a payment step, as an outcome. */
  async function failed(
    step: WriteStep,
    accountRef: ProviderRef,
    error: unknown,
  ): Promise<PaymentWriteOutcome<ProviderPayment>> {
    const classified = classify(step, error)
    if (classified.kind !== 'already_released') return failedWrite(classified)
    // Releasing an intent that is already cancelled reaches the goal: answer it as it is now.
    const read = await readIntent(accountRef, classified.intent.id)
    if (!read.ok) return { kind: 'unknown', reason: `released, but ${read.reason}`.slice(0, 500) }
    return { kind: 'done', result: read.value }
  }

  /** The intents this account has for our payment id: recent ones listed, older ones searched. */
  async function intentsFor(
    accountRef: ProviderRef,
    paymentId: PaymentId,
  ): Promise<Got<Set<string>>> {
    const found = new Set<string>()
    // Search is not for read-after-write: data is searchable "in less than a minute", and "can be
    // up to an hour behind during outages" (https://docs.stripe.com/api/payment_intents/search.md,
    // https://docs.stripe.com/search.md#data-freshness). So a payment made in the last two hours
    // is found by listing (https://docs.stripe.com/api/payment_intents/list.md), an older one by
    // search, and the two together miss none.
    const since = Math.floor(now().getTime() / 1000) - RECENT_WINDOW_S
    let startingAfter: string | undefined
    for (let page = 0; ; page++) {
      if (page === RECENT_PAGES) {
        return { ok: false, missing: false, reason: 'too many recent payments to list' }
      }
      const listed = await get(listSchema(PaymentIntentSchema), () =>
        stripe.paymentIntents.list(
          {
            created: { gte: since },
            limit: 100,
            ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
          },
          on(accountRef),
        ),
      )
      if (!listed.ok) return listed
      for (const intent of listed.value.data) {
        if (intent.metadata?.[PAYMENT_METADATA_KEY] === paymentId) found.add(intent.id)
      }
      const last = listed.value.data.at(-1)
      if (!listed.value.has_more || last === undefined) break
      startingAfter = last.id
    }
    // GET /v1/payment_intents/search (https://docs.stripe.com/api/payment_intents/search.md;
    // query language: https://docs.stripe.com/search.md). Our id is base62, safe in the quotes.
    const searched = await get(SearchResultSchema, () =>
      stripe.paymentIntents.search(
        { query: `metadata['${PAYMENT_METADATA_KEY}']:'${paymentId}'`, limit: 10 },
        on(accountRef),
      ),
    )
    if (!searched.ok) return searched
    if (searched.value.has_more) {
      return { ok: false, missing: false, reason: 'more than ten payments carry this payment id' }
    }
    for (const intent of searched.value.data) found.add(intent.id)
    return { ok: true, value: found }
  }

  /** The object a notice names, read back on the account, as the id of its PaymentIntent. */
  async function intentOfNotice(
    accountRef: ProviderRef,
    notice: ProviderNotice,
  ): Promise<Got<string | null>> {
    const objectId = notice.objectRef?.provider
    if (objectId === undefined) return { ok: true, value: null }
    // The object of each event type (https://docs.stripe.com/api/events/types.md): a charge for
    // `charge.refunded`, a refund for `charge.refund.updated` and `refund.*`, a dispute for
    // `charge.dispute.*` (the same table as apps/web/src/connectors/stripe/notices.ts).
    let read: Got<{ payment_intent?: string | null | undefined }>
    if (notice.type.startsWith('charge.dispute.')) {
      // GET /v1/disputes/:id (https://docs.stripe.com/api/disputes/retrieve.md)
      read = await get(DisputeSchema, () => stripe.disputes.retrieve(objectId, {}, on(accountRef)))
    } else if (notice.type === 'charge.refund.updated' || notice.type.startsWith('refund.')) {
      // GET /v1/refunds/:id (https://docs.stripe.com/api/refunds/retrieve.md): a read only.
      read = await get(RefundSchema, () => stripe.refunds.retrieve(objectId, {}, on(accountRef)))
    } else if (notice.type.startsWith('charge.')) {
      read = await get(ChargeSchema, () => stripe.charges.retrieve(objectId, {}, on(accountRef)))
    } else {
      return { ok: true, value: null }
    }
    // An object of another account, or none at all, is not found on this one.
    if (!read.ok) return read.missing ? { ok: true, value: null } : read
    return { ok: true, value: read.value.payment_intent ?? null }
  }

  return {
    kind: STRIPE_KIND,
    capabilities: STRIPE_CAPABILITIES,

    async startConnection(request): Promise<PaymentWriteOutcome<StartConnectionResult>> {
      const req = StartConnectionRequestSchema.parse(request)
      let accountId = req.accountRef?.provider
      if (accountId === undefined) {
        // POST /v2/core/accounts: a full-Dashboard merchant that pays Stripe's fees and carries
        // its own losses (D126; https://docs.stripe.com/api/v2/core/accounts/create.md,
        // https://docs.stripe.com/connect/accounts-v2.md). The country is the venue's
        // (`ACCOUNT_COUNTRY`): Stripe refuses a merchant configuration without it
        // (`identity_country_required`).
        try {
          const created = AccountSchema.safeParse(
            await stripe.v2.core.accounts.create(
              {
                dashboard: 'full',
                identity: { country: ACCOUNT_COUNTRY },
                configuration: {
                  merchant: { capabilities: { card_payments: { requested: true } } },
                },
                defaults: {
                  responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
                },
                metadata: { restro_venue: req.venueId },
              },
              { idempotencyKey: `${req.idempotencyKey}:account` },
            ),
          )
          if (!created.success)
            return { kind: 'unknown', reason: 'Stripe answered an unreadable account' }
          accountId = created.data.id
        } catch (error) {
          return failedWrite(withoutReleased(classify('startConnection', error)))
        }
      }
      // POST /v2/core/account_links: Stripe's hosted onboarding, everything the account will need
      // asked at once (https://docs.stripe.com/api/v2/core/account-links/create.md,
      // https://docs.stripe.com/connect/hosted-onboarding.md).
      try {
        const link = AccountLinkSchema.safeParse(
          await stripe.v2.core.accountLinks.create(
            {
              account: accountId,
              use_case: {
                type: 'account_onboarding',
                account_onboarding: {
                  collection_options: { fields: 'eventually_due' },
                  return_url: req.returnUrl,
                  refresh_url: req.refreshUrl,
                },
              },
            },
            { idempotencyKey: `${req.idempotencyKey}:link` },
          ),
        )
        if (!link.success) return { kind: 'unknown', reason: 'Stripe answered an unreadable link' }
        return {
          kind: 'done',
          result: { redirectUrl: link.data.url, accountRef: providerRef(link.data.account) },
        }
      } catch (error) {
        return failedWrite(withoutReleased(classify('startConnection', error)))
      }
    },

    async readConnection(accountRef): Promise<Reading<ConnectionStatus>> {
      const ref = ProviderRefSchema.parse(accountRef)
      // GET /v2/core/accounts/:id?include=configuration.merchant,requirements
      // (https://docs.stripe.com/api/v2/core/accounts/retrieve.md)
      const read = await get(AccountSchema, () =>
        stripe.v2.core.accounts.retrieve(ref.provider, {
          include: ['configuration.merchant', 'requirements'],
        }),
      )
      if (!read.ok) return incomplete(`the account was not read: ${read.reason}`)
      const status = connectionStatus(read.value)
      return status.ok ? { complete: true, value: status.value } : incomplete(status.reason)
    },

    async prepareDomain(request) {
      const req = PrepareDomainRequestSchema.parse(request)
      // POST /v1/payment_method_domains on the venue's account: wallets show only on a registered
      // domain (https://docs.stripe.com/api/payment_method_domains/create.md,
      // https://docs.stripe.com/payments/payment-methods/pmd-registration.md?dashboard-or-api=api:
      // with direct charges, on the connected account).
      try {
        const domain = PaymentMethodDomainSchema.safeParse(
          await stripe.paymentMethodDomains.create(
            { domain_name: req.host },
            keyed(req.accountRef, req.idempotencyKey),
          ),
        )
        if (!domain.success)
          return { kind: 'unknown', reason: 'Stripe answered an unreadable domain' }
        return { kind: 'done', result: {} }
      } catch (error) {
        return failedWrite(withoutReleased(classify('prepareDomain', error)))
      }
    },

    async createHold(request): Promise<PaymentWriteOutcome<CreateHoldResult>> {
      const req = CreateHoldRequestSchema.parse(request)
      if (req.amountMinor < STRIPE_CAPABILITIES.minimumMinor(req.currency)) {
        return {
          kind: 'refused',
          refusal: {
            code: 'amount_too_small',
            scope: 'payment',
            detail: `below Stripe's minimum charge for ${req.currency}`,
          },
        }
      }
      // POST /v1/payment_intents on the venue's account (direct charge): a manual-capture card
      // hold, 3-D Secure asked for whenever the card supports it, our id in the metadata for the
      // read-back, no customer and no receipt email (D125 3.7)
      // (https://docs.stripe.com/api/payment_intents/create.md,
      // https://docs.stripe.com/payments/place-a-hold-on-a-payment-method.md,
      // https://docs.stripe.com/payments/3d-secure/authentication-flow.md). Since 2026-09-30.endive
      // the card-only list is `allowed_payment_method_types`; `payment_method_types` is refused
      // (https://docs.stripe.com/changelog/endive/2026-09-30/removes-the-payment-method-types-parameter-from-payment-intents-and-setup-intents.md).
      let answer: unknown
      try {
        answer = await stripe.paymentIntents.create(
          {
            amount: req.amountMinor,
            currency: req.currency.toLowerCase(),
            capture_method: 'manual',
            allowed_payment_method_types: ['card'],
            payment_method_options: { card: { request_three_d_secure: 'any' } },
            metadata: { [PAYMENT_METADATA_KEY]: req.paymentId },
            description: req.description,
          },
          keyed(req.accountRef, req.idempotencyKey),
        )
      } catch (error) {
        return failedWrite(withoutReleased(classify('createHold', error)))
      }
      const intent = PaymentIntentSchema.safeParse(answer)
      if (!intent.success || !intent.data.client_secret) {
        return { kind: 'unknown', reason: 'Stripe answered an unreadable payment' }
      }
      // What Stripe.js needs to mount the card form for a direct charge: the client secret and
      // the account it is initialised with (`stripeAccount`)
      // (https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=elements).
      const form: ProviderFormValues = ProviderFormValuesSchema.parse({
        clientSecret: intent.data.client_secret,
        account: req.accountRef.provider,
      })
      return { kind: 'done', result: { paymentRef: providerRef(intent.data.id), form } }
    },

    async findByPaymentId(accountRef, paymentId): Promise<Reading<ProviderPayment | null>> {
      const ref = ProviderRefSchema.parse(accountRef)
      const id = PaymentIdSchema.parse(paymentId)
      const intents = await intentsFor(ref, id)
      if (!intents.ok) return incomplete(`the payments were not read: ${intents.reason}`)
      const [only, ...more] = [...intents.value]
      if (only === undefined) return { complete: true, value: null }
      if (more.length > 0) return incomplete('more than one payment carries this payment id')
      const read = await readIntent(ref, only)
      if (!read.ok) return incomplete(`the payment was not read: ${read.reason}`)
      return { complete: true, value: read.value }
    },

    async readPayment(accountRef, paymentRef): Promise<Reading<ProviderPayment>> {
      const account = ProviderRefSchema.parse(accountRef)
      const ref = ProviderRefSchema.parse(paymentRef)
      const read = await readIntent(account, ref.provider)
      return read.ok ? { complete: true, value: read.value } : incomplete(read.reason)
    },

    async readNoticeSubject(accountRef, notice): Promise<Reading<ProviderPayment | null>> {
      const account = ProviderRefSchema.parse(accountRef)
      const parsed = ProviderNoticeSchema.parse(notice)
      if (parsed.kind === 'other') return { complete: true, value: null }
      const intentId = await intentOfNotice(account, parsed)
      if (!intentId.ok) return incomplete(`the notice's object was not read: ${intentId.reason}`)
      if (intentId.value === null) return { complete: true, value: null }
      const read = await get(PaymentIntentSchema, () =>
        stripe.paymentIntents.retrieve(
          intentId.value as string,
          { expand: ['latest_charge'] },
          on(account),
        ),
      )
      if (!read.ok) {
        return read.missing ? { complete: true, value: null } : incomplete(read.reason)
      }
      // A payment Restro did not make (no payment id of ours) leads nowhere.
      if (
        PaymentIdSchema.safeParse(read.value.metadata?.[PAYMENT_METADATA_KEY]).success === false
      ) {
        return { complete: true, value: null }
      }
      const payment = await paymentOf(account, read.value)
      return payment.ok ? { complete: true, value: payment.value } : incomplete(payment.reason)
    },

    async capture(request) {
      const req = CaptureRequestSchema.parse(request)
      // POST /v1/payment_intents/:id/capture with `amount_to_capture`: the rest of the hold is
      // released (https://docs.stripe.com/api/payment_intents/capture.md).
      try {
        const answer = await stripe.paymentIntents.capture(
          req.paymentRef.provider,
          { amount_to_capture: req.amountMinor, expand: ['latest_charge'] },
          keyed(req.accountRef, req.idempotencyKey),
        )
        return written(req.accountRef, answer)
      } catch (error) {
        return failed('capture', req.accountRef, error)
      }
    },

    async release(request) {
      const req = ReleaseRequestSchema.parse(request)
      // POST /v1/payment_intents/:id/cancel: the hold is released, nothing moves
      // (https://docs.stripe.com/api/payment_intents/cancel.md).
      try {
        const answer = await stripe.paymentIntents.cancel(
          req.paymentRef.provider,
          { expand: ['latest_charge'] },
          keyed(req.accountRef, req.idempotencyKey),
        )
        return written(req.accountRef, answer)
      } catch (error) {
        return failed('release', req.accountRef, error)
      }
    },
  }
}

/** A step that is not a release never classifies as already released. */
function withoutReleased(
  classified: ReturnType<typeof classify>,
): Exclude<ReturnType<typeof classify>, { kind: 'already_released' }> {
  return classified.kind === 'already_released'
    ? { kind: 'unknown', reason: 'Stripe answered an unexpected state' }
    : classified
}
