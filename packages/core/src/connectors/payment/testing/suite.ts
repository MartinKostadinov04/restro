// The payment conformance suite (D127 6.2, design §10; ticket #103). It registers Vitest tests,
// so call it at the top level of a provider package's `*.test.ts`:
//
//   paymentProviderSuite(harness)
//
// It runs on the simulated provider in CI and on a real provider's sandbox (#107). A check whose
// fault the harness cannot produce is registered as a todo, so a gap shows in the test report
// rather than passing silently.

import { describe, expect, it } from 'vitest'

import {
  capabilitiesCheck,
  connectionCheck,
  declineCheck,
  disputeReadBackCheck,
  expiryCheck,
  failedReadsCheck,
  guestStepCheck,
  holdCheck,
  idempotentCaptureCheck,
  idempotentCreateCheck,
  landedTimeoutCheck,
  lostTimeoutCheck,
  minimumCheck,
  moneyOnlyByCaptureCheck,
  oneCaptureCheck,
  operationsCheck,
  otherAccountCheck,
  type PaymentCheck,
  partialCaptureCheck,
  reconnectCheck,
  refundReadBackCheck,
  refusedCheck,
  releaseCheck,
  storedErrorCheck,
} from './checks'
import { FAULT_STEPS, type PaymentHarness } from './harness'

/** A sandbox answers in seconds; the simulated provider at once (`checkTimeoutMs` overrides). */
const SLOW = 30_000

function check(title: string, run: PaymentCheck, harness: PaymentHarness): void {
  it(
    title,
    async () => {
      expect(await run(harness)).toStrictEqual([])
    },
    harness.checkTimeoutMs ?? SLOW,
  )
}

/** Registers the check, or a todo naming what the harness cannot do. */
function checkIf(
  available: boolean,
  title: string,
  run: PaymentCheck,
  harness: PaymentHarness,
  missing: string,
): void {
  if (available) check(title, run, harness)
  else it.todo(`${title} (the harness cannot ${missing})`)
}

export function paymentProviderSuite(harness: PaymentHarness): void {
  const { faults, guest } = harness
  const outside = harness.outside ?? {}
  describe(`${harness.name}: payment provider conformance`, () => {
    check('offers the interface steps and nothing else: no refund', operationsCheck, harness)
    check('declares its kind and every capability', capabilitiesCheck, harness)
    check('connecting and reading the connection move no money', connectionCheck, harness)
    check('an unfinished account gets a fresh link for the same account', reconnectCheck, harness)
    check('a hold is found by our payment id, and holds once the guest pays', holdCheck, harness)
    check('a hold below the minimum is refused and leaves nothing', minimumCheck, harness)
    check('the same key creates one payment', idempotentCreateCheck, harness)
    check('the same key captures once', idempotentCaptureCheck, harness)
    check(
      'only one capture: a second key and a later release are refused',
      oneCaptureCheck,
      harness,
    )
    check(
      'a capture never goes above the hold; a partial one releases the rest',
      partialCaptureCheck,
      harness,
    )
    check('a release ends a hold, moves nothing and blocks a capture', releaseCheck, harness)
    check('no step but capture moves money', moneyOnlyByCaptureCheck, harness)
    checkIf(
      faults.nextHoldNeedsStep !== undefined && guest.completeStep !== undefined,
      'a hold whose bank asks the guest waits on the guest and cannot be captured',
      guestStepCheck,
      harness,
      'ask for a guest step and complete it',
    )
    checkIf(
      faults.passCaptureBefore !== undefined,
      'a hold past captureBefore reads released and refuses a capture',
      expiryCheck,
      harness,
      'pass captureBefore',
    )
    checkIf(
      guest.decline !== undefined,
      'a declined card fails the payment and holds nothing',
      declineCheck,
      harness,
      'decline a card',
    )
    checkIf(
      faults.failReads !== undefined,
      'a read with a failed part is incomplete',
      failedReadsCheck,
      harness,
      'fail reads',
    )
    checkIf(
      outside.refundsInDashboard !== undefined,
      "a refund in the venue's dashboard reads back as the total refunded",
      refundReadBackCheck,
      harness,
      "refund in the venue's dashboard",
    )
    checkIf(
      outside.bankOpensDispute !== undefined && outside.disputeCloses !== undefined,
      'a dispute reads back where it stands now',
      disputeReadBackCheck,
      harness,
      'open and close a dispute',
    )
    checkIf(
      outside.refundsInDashboard !== undefined && harness.otherAccount !== undefined,
      "another account reads nothing of this account's objects",
      otherAccountCheck,
      harness,
      'refund and name a second account',
    )
    for (const step of FAULT_STEPS) {
      checkIf(
        faults.landThenTimeOut !== undefined,
        `${step} timing out after it landed is unknown, read back, and repeated once by key`,
        landedTimeoutCheck(step),
        harness,
        'time out after landing',
      )
      checkIf(
        faults.timeOutBeforeLanding !== undefined,
        `${step} timing out before it landed is unknown, reads as not done, and lands once on retry`,
        lostTimeoutCheck(step),
        harness,
        'time out before landing',
      )
      checkIf(
        faults.refuseNext !== undefined,
        `${step} refused changes nothing`,
        refusedCheck(step),
        harness,
        'refuse a call',
      )
      checkIf(
        faults.storeServerError !== undefined,
        `${step} with a stored server error is unknown again for the same key`,
        storedErrorCheck(step),
        harness,
        'store a server error',
      )
    }
  })
}
