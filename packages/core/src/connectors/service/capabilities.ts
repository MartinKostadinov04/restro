// What a connector declares its POS lets Restro do or read during service (D122 §3, D124 §2 and
// §3). A venue setting or a guest feature that depends on one appears only where it is declared,
// and the conformance kit runs each check only where its capability is declared, otherwise the
// declared fallback. Restro checks none of them at setup. Undeclared means "not claimed": the
// cautious answer, never "unknown, so assume yes".

import { z } from 'zod'

/**
 * The capabilities, each with the decision that lists it. The key is the code name; the comment
 * is D122 §3's wording.
 */
export const SERVICE_CAPABILITIES = [
  /** Approval at the bar (D116, D122 §3). */
  'approvalAtBar',
  /** Who entered a line: a reading tells Restro's own lines from staff lines (D115's read-back). */
  'whoEnteredLine',
  /** Move lines to another table (the payment table of a one-bill POS, D122 §8). */
  'moveLinesToTable',
  /** Move part of a line's quantity. */
  'movePartOfLineQuantity',
  /** Which bar a table belongs to (optional since D124 §1: never a made-up bar). */
  'tableBar',
  /** Several bills on one table. */
  'severalBillsPerTable',
  /**
   * First items open a bill: a sent order may open a POS bill on a table with none (D122 §4).
   * Declared, `addLines` that opens one returns its reference (pay-first, D127, #113).
   */
  'firstItemsOpenBill',
  /** Read closed bills. */
  'readClosedBills',
  /** Notes and options reach the ticket. */
  'notesReachTicket',
  /** Receipt number on close. */
  'receiptNumberOnClose',
  /**
   * The close takes the guest's email and asks the POS to issue the sale as an electronic receipt
   * from the venue's fiscal device (D127, #186). The POS sends it itself, unless
   * `electronicReceiptFile` is also declared. Undeclared, a close with an email is refused
   * `not_supported` before any write, and no email field is offered. No real POS declares it
   * until its provider confirms it (open-items Q84).
   */
  'electronicReceipt',
  /**
   * With `electronicReceipt`: the close does not send the receipt but returns the POS's own file,
   * which Restro sends unchanged through its email service (D127, #186). Never without
   * `electronicReceipt`.
   */
  'electronicReceiptFile',
  /** Training mode: the POS has one (the probe then reports the current mode, D124 §5). */
  'trainingMode',
  /** Close a bill with a chosen payment type. */
  'closeWithPaymentType',
  /** Open, pay and close a sale in one call (pay-first). */
  'openPayCloseInOneCall',
  /** Item availability right before an order (D122 §4, Stock): `readAvailability` exists. */
  'itemAvailability',
  /** Restro's own reference on a line, read back (C21). */
  'ownLineReference',
  /** A repeated add creates nothing (C20). */
  'idempotentAdd',
  /** Add to a staff-opened bill (D124 §3); undeclared, a sent order joins only Restro's own. */
  'addToStaffOpenedBill',
  /** A reading gives each POS bill's opening time (D124 §2: else "never yesterday's bill" can't be checked). */
  'billOpeningTime',
  /**
   * A tip on close lands on the same POS bill and fiscal receipt, the connector's own way: a tip
   * field, or one tip line in tax group А with no VAT (D127, design §10). Undeclared, a close
   * with a tip above 0 is refused `not_supported` before any write, and no tip is offered.
   */
  'recordTipOnClose',
] as const

/** One service capability. */
export type ServiceCapability = (typeof SERVICE_CAPABILITIES)[number]

/** A connector's declaration: every capability, true or false. */
export type ServiceCapabilities = { readonly [C in ServiceCapability]: boolean }

/** Zod schema of a declaration: every key present, nothing else. */
export const ServiceCapabilitiesSchema = z.strictObject(
  Object.fromEntries(SERVICE_CAPABILITIES.map((name) => [name, z.boolean()])) as {
    [C in ServiceCapability]: z.ZodBoolean
  },
)

/** A declaration with nothing claimed, to spread the true ones over. */
export const NO_SERVICE_CAPABILITIES: ServiceCapabilities = Object.freeze(
  Object.fromEntries(SERVICE_CAPABILITIES.map((name) => [name, false])) as ServiceCapabilities,
)
