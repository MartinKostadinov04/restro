// The parts of Stripe's objects this package reads, parsed with Zod before anything maps them
// (Zod at every boundary). Each schema keeps only the fields the mapping uses and lets the rest
// through untouched; a field Stripe documents as nullable is nullable here.
//
// Sources (API version 2026-09-30.endive, the version stripe-node 23.0.1 pins):
//   https://docs.stripe.com/api/payment_intents/object.md
//   https://docs.stripe.com/api/charges/object.md
//   https://docs.stripe.com/api/disputes/object.md
//   https://docs.stripe.com/api/refunds/object.md
//   https://docs.stripe.com/api/v2/core/accounts/object.md
//   https://docs.stripe.com/api/v2/core/account-links/object.md
//   https://docs.stripe.com/api/payment_method_domains/object.md

import { z } from 'zod'

/** A Stripe id: opaque text, kept as the provider ref (`ProviderRefSchema` checks its characters). */
const StripeIdSchema = z.string().min(1).max(255)

/** A charge's card details: the hold's deadline, the bank's 3-D Secure result and the code. */
export const CardDetailsSchema = z.looseObject({
  /** "a future timestamp at which the charge will be automatically refunded if uncaptured" (unix seconds). */
  capture_before: z.int().positive().nullish(),
  authorization_code: z.string().nullish(),
  three_d_secure: z.looseObject({ result: z.string().nullish() }).nullish(),
})

export const ChargeSchema = z.looseObject({
  id: StripeIdSchema,
  object: z.literal('charge'),
  payment_intent: z.string().nullish(),
  amount_refunded: z.int().nonnegative(),
  payment_method_details: z.looseObject({ card: CardDetailsSchema.nullish() }).nullish(),
})
export type StripeCharge = z.output<typeof ChargeSchema>

export const PaymentIntentSchema = z.looseObject({
  id: StripeIdSchema,
  object: z.literal('payment_intent'),
  status: z.string(),
  amount: z.int().positive(),
  amount_capturable: z.int().nonnegative(),
  amount_received: z.int().nonnegative(),
  currency: z.string(),
  metadata: z.record(z.string(), z.string()).nullish(),
  /** Set while the guest has a step to finish (3-D Secure). */
  next_action: z.looseObject({ type: z.string() }).nullish(),
  /** The last payment error: a decline leaves the intent in `requires_payment_method` with it. */
  last_payment_error: z.looseObject({ code: z.string().nullish() }).nullish(),
  cancellation_reason: z.string().nullish(),
  client_secret: z.string().nullish(),
  /** An id, or the charge when the request expanded `latest_charge`. */
  latest_charge: z.union([z.string(), ChargeSchema]).nullish(),
})
export type StripePaymentIntent = z.output<typeof PaymentIntentSchema>

export const DisputeSchema = z.looseObject({
  id: StripeIdSchema,
  object: z.literal('dispute'),
  status: z.string(),
  payment_intent: z.string().nullish(),
  created: z.int(),
})
export type StripeDispute = z.output<typeof DisputeSchema>

export const RefundSchema = z.looseObject({
  id: StripeIdSchema,
  object: z.literal('refund'),
  payment_intent: z.string().nullish(),
})

export function listSchema<T extends z.ZodType>(item: T) {
  return z.looseObject({ data: z.array(item), has_more: z.boolean() })
}

export const SearchResultSchema = z.looseObject({
  data: z.array(PaymentIntentSchema),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
})

export const BalanceTransactionSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  amount: z.int(),
})

/** A v2 account with `configuration.merchant` and `requirements` included. */
export const AccountSchema = z.looseObject({
  id: StripeIdSchema,
  configuration: z
    .looseObject({
      merchant: z
        .looseObject({
          capabilities: z
            .looseObject({ card_payments: z.looseObject({ status: z.string() }).nullish() })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
  requirements: z
    .looseObject({
      entries: z
        .array(
          z.looseObject({ description: z.string(), awaiting_action_from: z.string().nullish() }),
        )
        .nullish(),
    })
    .nullish(),
})
export type StripeAccount = z.output<typeof AccountSchema>

export const AccountLinkSchema = z.looseObject({
  account: StripeIdSchema,
  url: z.url({ protocol: /^https$/ }),
})

export const PaymentMethodDomainSchema = z.looseObject({
  id: StripeIdSchema,
  domain_name: z.string(),
  enabled: z.boolean(),
})
