// The connector conformance suite (#51 design §5; spec #64, Testing Decisions 2). It registers
// Vitest tests, so call it at the top level of a connector's `*.test.ts`:
//
//   - `serviceReadSuite(harness)`: the waiter-action guard, the probe (writes nothing) and the
//     read checks; every connector, including one that only reads its recordings so far;
//   - `serviceConnectorSuite(harness)`: all of the above plus the write checks, for a connector
//     that implements the whole interface (the simulated POS, #68).
//
// A check whose capability is not declared checks the declared fallback instead; a check the
// harness cannot feed (no table scenario) is registered as a todo with the harness's reason, so a
// gap shows in the test report rather than passing silently.

import { describe, expect, it } from 'vitest'

import {
  availabilityCheck,
  type Check,
  capabilitiesCheck,
  floorCheck,
  floorFailedPartCheck,
  floorTimeoutCheck,
  probeAnswersWithoutWritingCheck,
  probeRefusedCheck,
  probeTimeoutCheck,
  tableCheck,
  tableFailedPartCheck,
} from './checks-read'
import {
  closedBillCheck,
  electronicReceiptCheck,
  emptyTableCheck,
  excludedBillCheck,
  newBillReferenceCheck,
  oldestBillCheck,
  paymentRouteCheck,
  staffBillCheck,
  tipOnCloseCheck,
  tipRetryCheck,
  writesAreDeclaredCheck,
  writeTimeoutCheck,
  yesterdaysBillCheck,
} from './checks-write'
import { waiterActionProblems } from './guard'
import type { ReadHarness, WriteHarness } from './harness'

const SLOW = 10_000

function check<H>(title: string, run: Check<H>, harness: H): void {
  it(
    title,
    async () => {
      expect(await run(harness)).toStrictEqual([])
    },
    SLOW,
  )
}

export function serviceReadSuite(harness: ReadHarness): void {
  describe(`${harness.name}: service connector conformance, reads`, () => {
    it('every exported write is a waiter action (D110), and nothing reaches the POS past the seam', () => {
      expect(
        waiterActionProblems(harness.connector, harness.writeModule, harness.waiterActions),
      ).toStrictEqual([])
    })
    check(
      'declares every capability, and offers availability exactly where declared',
      capabilitiesCheck,
      harness,
    )
    check(
      'the probe answers on a healthy POS and writes nothing',
      probeAnswersWithoutWritingCheck,
      harness,
    )
    check(
      'a stalled probe is unknown within its budget, never refused, and writes nothing',
      probeTimeoutCheck,
      harness,
    )
    if (harness.faults.refuseLogin === undefined) {
      it.todo(
        'a refused login probes as refused, scoped to the login (the harness cannot refuse a login)',
      )
    } else {
      check(
        'a refused login probes as refused, scoped to the login, and writes nothing',
        probeRefusedCheck,
        harness,
      )
    }
    check(
      'the floor reads complete, with no made-up bar and no POS id outside a PosRef',
      floorCheck,
      harness,
    )
    check('a floor read with a failed part is incomplete (rule 6)', floorFailedPartCheck, harness)
    check('a stalled floor read is incomplete within the read timeout', floorTimeoutCheck, harness)
    if ('none' in harness.table) {
      it.todo(`a table reads complete, grouped per POS bill: ${harness.table.none}`)
      it.todo(`a table read with a failed part is incomplete: ${harness.table.none}`)
    } else {
      check(
        'a table reads complete, grouped per POS bill, exactly as the POS holds it',
        tableCheck,
        harness,
      )
      check('a table read with a failed part is incomplete (rule 6)', tableFailedPartCheck, harness)
    }
    if (harness.connector.capabilities.itemAvailability) {
      check('availability answers every asked item and writes nothing', availabilityCheck, harness)
    }
  })
}

export function serviceConnectorSuite(harness: WriteHarness): void {
  serviceReadSuite(harness)
  describe(`${harness.name}: service connector conformance, writes`, () => {
    check(
      'a round on an empty table opens a bill where allowed, else needs_first_item',
      emptyTableCheck,
      harness,
    )
    if (harness.connector.capabilities.firstItemsOpenBill) {
      check(
        'a round on an empty payment table names the bill it opened, and a reading finds it (pay-first)',
        newBillReferenceCheck,
        harness,
      )
    }
    check('a round joins the oldest POS bill of tonight', oldestBillCheck, harness)
    check(
      'a round joins a staff-opened bill only where declared (D124 §3)',
      staffBillCheck,
      harness,
    )
    if (harness.connector.capabilities.billOpeningTime) {
      check(
        'a round never joins a POS bill from before the service day (D124 §2)',
        yesterdaysBillCheck,
        harness,
      )
    }
    check('a round never joins a POS bill under payment', excludedBillCheck, harness)
    if (harness.waiter.closeBillBeforeNextWrite === undefined) {
      it.todo(
        'a round onto a bill closed meanwhile is refused for that bill (the harness cannot close it)',
      )
    } else {
      check(
        'a round onto a bill closed meanwhile is refused for that bill',
        closedBillCheck,
        harness,
      )
    }
    check(
      'a round under stalled writes is unknown within the write timeout, never refused, written once',
      writeTimeoutCheck,
      harness,
    )
    check(
      'the read steps (table, floor, isolated bill) write nothing',
      writesAreDeclaredCheck,
      harness,
    )
    check(
      'the payment route, by capability: isolating moves exactly the pick, undo, close once',
      paymentRouteCheck,
      harness,
    )
    check(
      'a close with the guest email asks for an electronic receipt only where declared, and returns its file only where declared',
      electronicReceiptCheck,
      harness,
    )
    if (!harness.connector.capabilities.recordTipOnClose) {
      check(
        'a close with a tip is refused not_supported before any write (recordTipOnClose undeclared)',
        tipOnCloseCheck,
        harness,
      )
    } else if (harness.waiter.closedBill === undefined) {
      it.todo(
        'a tip on close lands on the same bill, its total lines plus tip (the harness cannot show a closed bill)',
      )
    } else {
      check(
        'a tip on close lands on the same bill as one line or field, its total lines plus tip',
        tipOnCloseCheck,
        harness,
      )
      if (harness.faults.stallNextWrite === undefined) {
        it.todo(
          'a retried close with a tip closes once, one tip (the harness cannot stall one write)',
        )
      } else {
        check(
          'a close with a tip retried after its write hung closes once, with one tip',
          tipRetryCheck,
          harness,
        )
      }
    }
  })
}
