// The payment conformance suite on the Stripe provider (#107 acceptance). By default it plays the
// recordings in `fixtures/recordings/` back through MSW (CI). To record them again against the
// sandbox ("Restro Sandbox", never a live account), with the sandbox key in the environment:
//
//   STRIPE_CONFORMANCE=record STRIPE_SECRET_KEY=sk_test_… \
//     pnpm vitest run --project packages/payments/stripe src/conformance.test.ts
//
// `STRIPE_HARNESS_ACCOUNT` and `STRIPE_HARNESS_OTHER_ACCOUNT` name the sandbox's connected
// accounts to record on; a recording keeps the ones it ran on.
//
// The venue's refund and the bank's dispute are done here, in a test file, as the venue and the
// bank would at Stripe (D125 3.5: Restro never refunds; the no-refund guard skips test files).

import { fileURLToPath } from 'node:url'

import { type ProviderNotice, type ProviderRef, providerRef } from '@restro/core'
import { paymentProviderSuite } from '@restro/core/connectors/payment-testing'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'

import { stripeKeyMode } from './config'
import {
  type Cassette,
  cassettePath,
  newCassette,
  playbackServer,
  readCassette,
  recording,
  recordingFetch,
  seedRandom,
  Tape,
  writeCassette,
} from './testing/test-cassette'
import { type OutsideTools, stripeHarness } from './testing/test-harness'

const RECORD = recording()
const DIR = fileURLToPath(new URL('../fixtures/recordings', import.meta.url))

/** The sandbox's connected accounts the recordings were made on (10-26). */
const ACCOUNT = process.env.STRIPE_HARNESS_ACCOUNT ?? 'acct_1UUjd8H6CXJeKV2v'
const OTHER_ACCOUNT = process.env.STRIPE_HARNESS_OTHER_ACCOUNT ?? 'acct_1UUjixH6CXaVmuUR'

/**
 * Checks not recorded yet, each with why. The connection check needs an account that can take
 * payments, which only the venue's owner gets to, through Stripe's hosted onboarding in a
 * browser (a Stripe login of their own): the harness account has not been through it.
 */
const PENDING: Readonly<Record<string, string>> = {
  'connecting and reading the connection move no money':
    'the harness account has not finished hosted onboarding, so it cannot take payments (#107)',
}

function sandboxKey(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (stripeKeyMode(key) !== 'test') {
    throw new Error('recording needs a sandbox key (sk_test_ or rk_test_) in STRIPE_SECRET_KEY')
  }
  return key
}

const EMPTY: Cassette = { nonce: '', account: ACCOUNT, otherAccount: OTHER_ACCOUNT, entries: [] }

let tape = new Tape(EMPTY)
let title = ''
let active = false
let undoSeed = (): void => {}
const server = RECORD ? null : playbackServer(() => tape)

beforeAll(() => server?.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server?.close())

beforeEach((context) => {
  title = context.task.name
  const pending = PENDING[title]
  if (pending !== undefined) context.skip(pending)
  const cassette = RECORD
    ? newCassette(ACCOUNT, OTHER_ACCOUNT)
    : (readCassette(cassettePath(DIR, title)) ?? EMPTY)
  tape = new Tape(cassette)
  undoSeed = seedRandom(`${cassette.nonce}:${title}`)
  active = true
})

afterEach(() => {
  if (!active) return
  active = false
  undoSeed()
  if (RECORD) {
    if (tape.cassette.entries.length > 0) {
      writeCassette(DIR, cassettePath(DIR, title), tape.cassette)
    }
    return
  }
  expect(tape.problems, 'requests the recording does not have').toEqual([])
  expect(tape.leftOver(), 'recorded answers the run did not ask for').toEqual([])
})

function notice(
  type: string,
  kind: ProviderNotice['kind'],
  accountRef: ProviderRef,
  objectId: string,
): ProviderNotice {
  // The notice as the web's verifier passes an event on (apps/web/src/connectors/stripe/notices.ts);
  // its id only has to be unique.
  return {
    id: `evt_conformance_${objectId}_${type}`,
    type,
    kind,
    accountRef,
    objectRef: providerRef(objectId),
  }
}

function outside({ stripe, until }: OutsideTools) {
  const on = (accountRef: ProviderRef) => ({ stripeAccount: accountRef.provider })
  return {
    // The venue refunds part of a payment in its Dashboard: POST /v1/refunds on its account
    // (https://docs.stripe.com/api/refunds/create.md), event `refund.created`
    // (https://docs.stripe.com/api/events/types.md).
    async refundsInDashboard(
      accountRef: ProviderRef,
      paymentRef: ProviderRef,
      amountMinor: number,
    ) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentRef.provider, amount: amountMinor },
        on(accountRef),
      )
      return notice('refund.created', 'refund', accountRef, refund.id)
    },
    // The disputing test card's charge is disputed by the bank shortly after its capture
    // (https://docs.stripe.com/testing.md, "Simulate a dispute"): event `charge.dispute.created`.
    async bankOpensDispute(accountRef: ProviderRef, paymentRef: ProviderRef) {
      const dispute = await until('the bank opens a dispute', async () => {
        const disputes = await stripe.disputes.list(
          { payment_intent: paymentRef.provider, limit: 1 },
          on(accountRef),
        )
        return disputes.data[0] ?? null
      })
      return notice('charge.dispute.created', 'dispute', accountRef, dispute.id)
    },
    // The venue answers with the sandbox's winning or losing evidence, and the dispute closes
    // (https://docs.stripe.com/testing.md, "Evidence"; https://docs.stripe.com/api/disputes/update.md):
    // event `charge.dispute.closed`.
    async disputeCloses(accountRef: ProviderRef, disputeRef: ProviderRef, outcome: 'won' | 'lost') {
      await stripe.disputes.update(
        disputeRef.provider,
        {
          evidence: {
            uncategorized_text: outcome === 'won' ? 'winning_evidence' : 'losing_evidence',
          },
          submit: true,
        },
        on(accountRef),
      )
      await until(`the dispute is ${outcome}`, async () => {
        const dispute = await stripe.disputes.retrieve(disputeRef.provider, {}, on(accountRef))
        return dispute.status === outcome ? dispute : null
      })
      return notice('charge.dispute.closed', 'dispute', accountRef, disputeRef.provider)
    },
  }
}

paymentProviderSuite(
  stripeHarness({
    name: 'stripe (sandbox recordings)',
    key: RECORD ? sandboxKey() : 'sk_test_playback0',
    fetch: RECORD ? recordingFetch(() => tape) : (input, init) => globalThis.fetch(input, init),
    tape: () => tape,
    title: () => title,
    sleep: RECORD ? (ms) => new Promise((resolve) => setTimeout(resolve, ms)) : async () => {},
    outside,
    // Recording waits on the sandbox: the dispute check closes two disputes, ~7 s each (10-26).
    ...(RECORD ? { checkTimeoutMs: 120_000 } : {}),
  }),
)
