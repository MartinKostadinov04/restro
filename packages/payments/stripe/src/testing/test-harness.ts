// The Stripe provider's harness for the payment conformance suite (#107;
// `@restro/core/connectors/payment-testing`). A `test-*` helper: only tests import it.
//
// It runs the provider against Stripe's sandbox ("Restro Sandbox"), never a venue's live account
// (rule 7), while recording, and against the recording otherwise (`test-cassette.ts`). Beside the
// provider it keeps its own Stripe clients for what is not the provider's: the guest at the card
// form, on the platform's key; and the account's ledger and the venue and the bank (`outside`,
// given by the test file, so that what Restro never does stays in a test file), on the harness's
// own key. The platform's restricted key cannot read balances, refund or answer a dispute
// (D125 3.5), and is not widened for a test.
//
// The guest pays with Stripe's test payment methods, server-side
// (https://docs.stripe.com/testing.md, https://docs.stripe.com/api/payment_intents/confirm.md):
//   - `pm_card_amex_threeDSecureNotSupported` holds under the provider's
//     `request_three_d_secure: any`, where the other test cards ask the guest for a step the
//     sandbox only completes in a browser (the sandbox, 10-26);
//   - `pm_card_createDisputeProductNotReceived` for a check about disputes: the charge succeeds,
//     then is disputed; `pm_card_visa_chargeDeclined` for a decline. These two are confirmed with
//     `request_three_d_secure: automatic`, so the bank decides without asking the guest.
// Not here, so the suite shows them as todos: a guest step completed by the guest (a browser
// only), and time passing a hold's `captureBefore` (seven days; the sandbox has no clock to move).

import { type ProviderRef, providerRef } from '@restro/core'
import type {
  GuestPayment,
  OutsideActions,
  PaymentHarness,
} from '@restro/core/connectors/payment-testing'
import Stripe from 'stripe'

import { createStripeProvider, STRIPE_API_VERSION } from '../provider'
import type { Tape } from './test-cassette'
import { StripeFaults } from './test-faults'

/**
 * What `outside` gets: the client on the harness's own key, and a poll that waits while
 * recording only.
 */
export interface OutsideTools {
  readonly stripe: Stripe
  until<T>(label: string, read: () => Promise<T | null>): Promise<T>
}

export interface StripeHarnessOptions {
  readonly name: string
  /**
   * The platform's key, for the provider and the guest: a sandbox key (`sk_test_`/`rk_test_`)
   * while recording; any test-shaped key in playback.
   */
  readonly key: string
  /** The harness's own key, for the ledger (`movedMinor`) and `outside`: the same rules. */
  readonly harnessKey: string
  /** Stripe's API as this run reaches it: the recording fetch, or the fetch MSW answers. */
  readonly fetch: typeof fetch
  /** The current check's tape: its accounts. */
  readonly tape: () => Tape
  /** The current check's title: a check about disputes pays with the disputing card. */
  readonly title: () => string
  /** Waits between polls while recording; nothing in playback. */
  readonly sleep: (ms: number) => Promise<void>
  readonly outside?: (tools: OutsideTools) => OutsideActions
  /** How long one check may take (`PaymentHarness.checkTimeoutMs`). */
  readonly checkTimeoutMs?: number
}

/** How many times a poll asks, a second apart, before it gives up. */
const POLLS = 25

/**
 * Balance transactions of money taken from a guest (`type` in
 * https://docs.stripe.com/api/balance_transactions/list.md; a capture's is `charge`: the sandbox,
 * 10-26).
 */
const MONEY_IN = new Set(['charge', 'payment'])

export function stripeHarness(options: StripeHarnessOptions): PaymentHarness & {
  readonly stripe: Stripe
  readonly stripeFaults: StripeFaults
} {
  const stripeFaults = new StripeFaults()
  const provider = createStripeProvider({
    env: 'test',
    key: options.key,
    fetch: stripeFaults.wrap(options.fetch),
  })
  const client = (key: string) =>
    new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 0,
      telemetry: false,
      httpClient: Stripe.createFetchHttpClient(options.fetch),
    })
  const stripe = client(options.key)
  const harnessStripe = client(options.harnessKey)
  const on = (accountRef: ProviderRef) => ({ stripeAccount: accountRef.provider })
  const since = Math.floor(Date.now() / 1000) - 60

  async function until<T>(label: string, read: () => Promise<T | null>): Promise<T> {
    for (let attempt = 0; attempt < POLLS; attempt++) {
      const value = await read()
      if (value !== null) return value
      await options.sleep(1_000)
    }
    throw new Error(`the sandbox did not get there: ${label}`)
  }

  async function confirm(
    payment: GuestPayment,
    paymentMethod: string,
    bankDecides: boolean,
  ): Promise<void> {
    await stripe.paymentIntents.confirm(
      payment.paymentRef.provider,
      {
        payment_method: paymentMethod,
        ...(bankDecides
          ? { payment_method_options: { card: { request_three_d_secure: 'automatic' } } }
          : {}),
      },
      on(payment.accountRef),
    )
  }

  return {
    name: options.name,
    provider,
    stripe,
    stripeFaults,
    get account() {
      return providerRef(options.tape().cassette.account)
    },
    get otherAccount() {
      return providerRef(options.tape().cassette.otherAccount)
    },
    currency: 'EUR',
    guestHost: 'pay.restro.test',
    reset: () => stripeFaults.clear(),
    // The account's balance transactions since the run started: money in from cards
    // (https://docs.stripe.com/api/balance_transactions/list.md; Balance Read).
    async movedMinor() {
      let moved = 0
      let startingAfter: string | undefined
      for (;;) {
        const page = await harnessStripe.balanceTransactions.list(
          {
            created: { gte: since },
            limit: 100,
            ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
          },
          on(providerRef(options.tape().cassette.account)),
        )
        for (const transaction of page.data) {
          if (MONEY_IN.has(transaction.type)) moved += transaction.amount
        }
        const last = page.data.at(-1)
        if (!page.has_more || last === undefined) return moved
        startingAfter = last.id
      }
    },
    guest: {
      pay: async (payment) =>
        options.title().includes('dispute')
          ? confirm(payment, 'pm_card_createDisputeProductNotReceived', true)
          : confirm(payment, 'pm_card_amex_threeDSecureNotSupported', false),
      decline: async (payment) => {
        try {
          await confirm(payment, 'pm_card_visa_chargeDeclined', true)
        } catch (error) {
          // The bank's decline is the confirmation's 402 `card_declined`
          // (https://docs.stripe.com/error-codes.md, https://docs.stripe.com/testing.md);
          // anything else is a broken run.
          if ((error as { code?: string }).code !== 'card_declined') throw error
        }
      },
    },
    faults: {
      landThenTimeOut: (step) => stripeFaults.arm(step, 'land_then_timeout'),
      timeOutBeforeLanding: (step) => stripeFaults.arm(step, 'timeout_before'),
      refuseNext: (step) => stripeFaults.arm(step, 'refuse'),
      storeServerError: (step) => stripeFaults.arm(step, 'server_error'),
      failReads: () => stripeFaults.failReads(),
    },
    ...(options.outside === undefined
      ? {}
      : { outside: options.outside({ stripe: harnessStripe, until }) }),
    ...(options.checkTimeoutMs === undefined ? {} : { checkTimeoutMs: options.checkTimeoutMs }),
  }
}
