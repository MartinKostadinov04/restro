// The simulated POS's switches and profiles (#51 design §2.4, decision log §1 row 1.4; spec #64,
// Implementation Decisions 2). Everything the facts of D122 §1 don't fix is a switch, and each
// switch starts on the cautious answer: the one that makes the platform's job harder, or, for a
// capability, "not declared". A switch claims nothing about any real POS.
//
// Each comment names the open POS question it stands for as "Q<n>": the numbered list of
// 2026-10-21 in docs/deliverables/ (the "…-questions.md" file of that day; C-numbers are the
// connector checks it cites). A new switch needs such a number, or it isn't added (risk 2).

import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from '@restro/core'

export interface SimSwitches {
  /** Q10. `one` is the fact of D122 §1; `several` exists only to test D115's several-bill path. */
  readonly billsPerTable: 'one' | 'several'
  /** Q40, Q22. Off: a first round on a table with no bill is refused ("Ask your waiter…"). */
  readonly firstItemsOpenBill: boolean
  /**
   * Q40, Q3 (D124 §3). On: an outside app may add a round to a bill a waiter opened. The default
   * is on, not off: with `firstItemsOpenBill` off as well, off would leave a sent order nowhere
   * to land, and the design's "Ask your waiter to put your first item on" assumes Restro then
   * adds to that bill. Off tests D124 §3's fallback.
   */
  readonly addToStaffOpenedBill: boolean
  /** Q3, Q14. On: Restro's rows wait at the bar, unread, and the ticket prints on approval. */
  readonly approvalAtBar: boolean
  /** Q15. On: a row reads with the login that entered it and when. */
  readonly lineShowsWhoAndWhen: boolean
  /** Q15 (C21). On: a row carries the caller's reference and reads it back. */
  readonly lineCarriesCallerRef: boolean
  /** Q15 (C20). On: a repeated add with the same call reference creates nothing. */
  readonly repeatSafeAdd: boolean
  /** Q15 (C18). Off: a timed-out add may land only a prefix of its rows (the `landsPartly` fault). */
  readonly addIsAllOrNothing: boolean
  /** Q15, C52. How long after its call a late write lands (the `landsLate` fault). */
  readonly lateLandingMs: number
  /** Q11. On: rows move between tables (the payment route of a one-bill POS). */
  readonly moveLines: boolean
  /** Q11. On: part of a row's quantity moves; off, whole rows only. */
  readonly movePartialQuantity: boolean
  /** Q11. On: a move prints a ticket again, at the bar of the table the rows move to. */
  readonly moveReprintsTicket: boolean
  /** Q30. What a bill becomes when its last row moves off: closed, or open and empty. */
  readonly emptiedBill: 'closes' | 'staysOpen'
  /** Q16. On: the floor reads the bars and which bar serves each table. */
  readonly readsTableBar: boolean
  /** Q19. On: each bar has its own login, which sees and acts on its bar's tables only. */
  readonly oneLoginPerBar: boolean
  /** Q31, Q13. On: a row may carry a note and options, and they print on the ticket. */
  readonly notesReachTicket: boolean
  /** Q24. On: today's closed bills of a table can be read. */
  readonly readClosedBills: boolean
  /** Q4, Q26, Q36. On: an outside app closes a bill with a payment of a chosen type. */
  readonly closeWithPaymentType: boolean
  /** Q4, Q12, Q13. On: one call opens, pays and closes a sale on a table. */
  readonly oneCallSale: boolean
  /** Q13. On: a one-call sale prints a ticket at the table's bar. */
  readonly ticketOnOneCallSale: boolean
  /** Q25, Q39. On: a close answers the receipt number. */
  readonly receiptNumberOnClose: boolean
  /** Q25. On: a close succeeds while the fiscal printer fails, with no receipt. */
  readonly closeSucceedsWithoutPrinter: boolean
  /** Q38. On: a close may ask for an electronic receipt to an email address. */
  readonly electronicReceipt: boolean
  /** Q35. On: a close may carry a note. */
  readonly closeCarriesNote: boolean
  /** Q20. On: one close may carry several payments. */
  readonly severalPaymentsPerClose: boolean
  /** Q41. On: a tip may be added as a row of the tip article, with its amount. */
  readonly tipAsLine: boolean
  /** Q28. On: one call reads every open bill of the login's tables. */
  readonly readAllOpenBillsInOneCall: boolean
  /** Q28. Per login: calls in flight at once, and calls in any second. Beyond either: busy. */
  readonly rateLimit: { readonly concurrent: number; readonly perSecond: number }
  /** Q27. On: the POS has a training mode, and the probe reports the current mode. */
  readonly trainingMode: boolean
  /** Q27 (verification of 10-22, row 26). On: the POS starts in training mode. Needs `trainingMode`. */
  readonly startsInTrainingMode: boolean
  /**
   * Q37 (verification of 10-22, rows 17+31). On: a bill may carry a charge of its own beside its
   * rows, so its total is not the sum of its rows. Moving rows off such a bill is undefined.
   */
  readonly billTotalDiffersFromLines: boolean
  /** No question: a wire-format choice, not a POS claim. On: prices travel as JSON numbers (rule 8). */
  readonly pricesAsJsonFloats: boolean
}

/** Every switch at its cautious default. */
export const CAUTIOUS: SimSwitches = Object.freeze({
  billsPerTable: 'one',
  firstItemsOpenBill: false,
  addToStaffOpenedBill: true,
  approvalAtBar: false,
  lineShowsWhoAndWhen: false,
  lineCarriesCallerRef: false,
  repeatSafeAdd: false,
  addIsAllOrNothing: false,
  lateLandingMs: 120_000,
  moveLines: false,
  movePartialQuantity: false,
  moveReprintsTicket: true,
  emptiedBill: 'closes',
  readsTableBar: false,
  oneLoginPerBar: true,
  notesReachTicket: false,
  readClosedBills: false,
  closeWithPaymentType: false,
  oneCallSale: false,
  ticketOnOneCallSale: false,
  receiptNumberOnClose: false,
  closeSucceedsWithoutPrinter: true,
  electronicReceipt: false,
  closeCarriesNote: false,
  severalPaymentsPerClose: false,
  tipAsLine: false,
  readAllOpenBillsInOneCall: false,
  rateLimit: Object.freeze({ concurrent: 1, perSecond: 5 }),
  trainingMode: false,
  startsInTrainingMode: false,
  billTotalDiffersFromLines: true,
  pricesAsJsonFloats: true,
} satisfies SimSwitches)

export const PROFILE_NAMES = ['cautious', 'pilot'] as const
export type ProfileName = (typeof PROFILE_NAMES)[number]

/**
 * The named profiles. `pilot` is the least the payment route needs: moving rows (Q11) and closing
 * with a payment type (Q4, Q26). The pilot venue's facts make both likely; no API has confirmed
 * them. Tests of paying run on `pilot`; everything else runs on both.
 */
export const PROFILES: { readonly [P in ProfileName]: SimSwitches } = Object.freeze({
  cautious: CAUTIOUS,
  pilot: Object.freeze({ ...CAUTIOUS, moveLines: true, closeWithPaymentType: true }),
})

/** A profile with some switches changed; refuses combinations the switches don't define. */
export function switchesOf(
  base: ProfileName | SimSwitches,
  changes: Partial<SimSwitches> = {},
): SimSwitches {
  const switches: SimSwitches = {
    ...(typeof base === 'string' ? PROFILES[base] : base),
    ...changes,
  }
  if (switches.startsInTrainingMode && !switches.trainingMode) {
    throw new Error('startsInTrainingMode needs trainingMode: a POS without one cannot start in it')
  }
  if (switches.movePartialQuantity && !switches.moveLines && switches.billsPerTable === 'one') {
    throw new Error('movePartialQuantity needs a way to move rows (moveLines or several bills)')
  }
  const { concurrent, perSecond } = switches.rateLimit
  if (!Number.isSafeInteger(concurrent) || concurrent < 1) {
    throw new Error('rateLimit.concurrent must be a whole number of at least 1')
  }
  if (!Number.isSafeInteger(perSecond) || perSecond < 1) {
    throw new Error('rateLimit.perSecond must be a whole number of at least 1')
  }
  if (!Number.isSafeInteger(switches.lateLandingMs) || switches.lateLandingMs < 0) {
    throw new Error('lateLandingMs must be a whole number of milliseconds')
  }
  return Object.freeze(switches)
}

/** What the simulated POS declares from its switches (D122 §3). Undeclared is the cautious answer. */
export function capabilitiesOf(switches: SimSwitches): ServiceCapabilities {
  const several = switches.billsPerTable === 'several'
  return Object.freeze({
    ...NO_SERVICE_CAPABILITIES,
    approvalAtBar: switches.approvalAtBar,
    whoEnteredLine: switches.lineShowsWhoAndWhen,
    moveLinesToTable: switches.moveLines,
    movePartOfLineQuantity: switches.movePartialQuantity && (switches.moveLines || several),
    tableBar: switches.readsTableBar,
    severalBillsPerTable: several,
    firstItemsOpenBill: switches.firstItemsOpenBill,
    readClosedBills: switches.readClosedBills,
    notesReachTicket: switches.notesReachTicket,
    receiptNumberOnClose: switches.receiptNumberOnClose,
    electronicFiscalReceipt: switches.electronicReceipt,
    trainingMode: switches.trainingMode,
    closeWithPaymentType: switches.closeWithPaymentType,
    openPayCloseInOneCall: switches.oneCallSale,
    ownLineReference: switches.lineCarriesCallerRef,
    idempotentAdd: switches.repeatSafeAdd,
    addToStaffOpenedBill: switches.addToStaffOpenedBill,
    // No switch and no question for these two: not claimed (D124 §2 can't be checked here).
    itemAvailability: false,
    billOpeningTime: false,
  })
}
