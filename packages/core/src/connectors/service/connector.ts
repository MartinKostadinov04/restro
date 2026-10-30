// The POS-neutral service connector (spec #64, Implementation Decisions 1). The integration
// layer owns it; connector packages implement it. The platform only says "put these lines on
// this table's bill" and each connector does it the safest way its POS allows (D115); the saga,
// the queue per bar, the locks, the deadlines and the Log stay in the platform (D122 §8).
//
// Every POS id crosses inside a `PosRef` (rule 3); every write is a waiter's action (rule 7,
// D110; `SERVICE_WRITE_STEPS`); a timeout is `unknown` and a partial reading is incomplete.

import type { ServiceCapabilities } from './capabilities'
import type { PosRef } from './pos-ref'
import type {
  AddLinesRequest,
  AddLinesResult,
  Availability,
  ClosedBill,
  EmptyResult,
  Floor,
  IsolatedBill,
  IsolatedHandle,
  IsolateLinesRequest,
  IsolateLinesResult,
  PayAndCloseRequest,
  PayAndCloseResult,
  ProbeResult,
  Reading,
  TableBills,
  UndoIsolateRequest,
  WriteOutcome,
} from './schemas'
import type { ServiceTimings } from './timings'

/**
 * The calls a second a connector with no figure of its own gets (`callsPerSecond`). Unknown for
 * every real POS: none has stated a limit yet. This is the cautious value the test POS's `cautious`
 * profile holds to, not a fact about any POS.
 */
export const CAUTIOUS_CALLS_PER_SECOND = 5

/** What the platform hands a connector on every call. */
export interface ServiceContext {
  /** The platform's clock (injected, so tests and the simulator share one). */
  now(): Date
  /** The seam's timings, from platform configuration (`SERVICE_TIMINGS`). */
  readonly timings: ServiceTimings
  /**
   * Waits for room in the login's per-second budget, shared by every call of the worker. A
   * connector asks once per call on the wire, right before it leaves, since one seam call may be
   * several. False when `signal` ended first: that call never left.
   */
  pace?(signal: AbortSignal): Promise<boolean>
}

/** The reading side: everything the platform asks without changing the POS. */
export interface ServiceReader {
  /** The connector kind (`integrations.kind`). */
  readonly kind: string
  /** What the POS lets Restro do and read (D122 §3), read at wiring time. */
  readonly capabilities: ServiceCapabilities
  /**
   * The calls a second one POS login may make, where the POS states a limit; left out, the worker
   * keeps to `CAUTIOUS_CALLS_PER_SECOND`.
   */
  readonly callsPerSecond?: number
  /** A cheap POS read through the same path as an order. Never writes (rule 7, D120). */
  probe(ctx: ServiceContext): Promise<ProbeResult>
  /** Tables, payment tables and, where the POS knows them, bars. */
  readFloor(ctx: ServiceContext): Promise<Reading<Floor>>
  /** The table's open POS bills with their lines, oldest first. */
  readTable(ctx: ServiceContext, table: PosRef): Promise<Reading<TableBills>>
  /** Item availability right before an order; present only where `itemAvailability` is declared. */
  readAvailability?(ctx: ServiceContext, items: readonly PosRef[]): Promise<Reading<Availability>>
  /**
   * The bill on this table if it is closed, else null; present only where `readClosedBills` is
   * declared. Never a guess: a bill that can't be found is null, and null proves nothing.
   */
  readClosedBill?(ctx: ServiceContext, bill: IsolatedHandle): Promise<Reading<ClosedBill | null>>
}

/** The whole interface: the reads and the four waiter-action writes. */
export interface ServiceConnector extends ServiceReader {
  /**
   * Add a round to the table's bill: the bill `chooseTargetBill` picks, or a new one where
   * allowed. A new one is named in the result where `firstItemsOpenBill` is declared (pay-first).
   */
  addLines(ctx: ServiceContext, request: AddLinesRequest): Promise<WriteOutcome<AddLinesResult>>
  /** Part 2: isolate the picked lines for paying (D122 §8 step 3). */
  isolateLines(
    ctx: ServiceContext,
    request: IsolateLinesRequest,
  ): Promise<WriteOutcome<IsolateLinesResult>>
  /** Part 2: read the isolated bill back (the last check before close and capture). */
  readIsolated(ctx: ServiceContext, isolated: IsolatedHandle): Promise<Reading<IsolatedBill>>
  /**
   * Part 2: close the isolated bill with its payment, the tip on the same bill and receipt where
   * `recordTipOnClose` is declared (D127); undeclared, a tip above 0 is refused before any write.
   * Adding the tip is part of taking the payment, as a waiter does at the till (D110). A second
   * close is refused. With a `receiptEmail` it asks the POS for the sale as an electronic receipt
   * (`electronicReceipt`, D127): the POS sends it, or, with `electronicReceiptFile`, the result
   * carries the POS's file for Restro to send. The result says which came of it
   * (`electronicReceipt`: `sent`, `file` or `not_issued`). Undeclared, an email is refused
   * `not_supported` before any write. The email goes nowhere but into that one call.
   */
  payAndClose(
    ctx: ServiceContext,
    request: PayAndCloseRequest,
  ): Promise<WriteOutcome<PayAndCloseResult>>
  /** Part 2: put the isolated lines back on the real table. */
  undoIsolate(ctx: ServiceContext, request: UndoIsolateRequest): Promise<WriteOutcome<EmptyResult>>
}
