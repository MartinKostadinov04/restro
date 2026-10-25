// What a connector hands the conformance kit (#51 design §5): the connector, a view of its POS
// (the calls it made, and a state digest where the POS has one), faults the kit can switch on, a
// waiter driver for the write checks, and the connector package's waiter-action declaration.
// POS-neutral: a connector's harness may replay recordings over MSW or drive a simulated engine.

import type { ServiceConnector, ServiceReader } from '../connector'
import type { PosRef } from '../pos-ref'
import type { PosBill, TableBills } from '../schemas'
import type { ServiceTimings } from '../timings'
import type { WaiterActionDeclaration } from '../waiter-actions'

/** One call the connector made to its POS, as the harness saw it on the wire. */
export interface PosCall {
  /** The POS's name for the call (a method or a path). */
  readonly name: string
  /** Whether the call can change the POS: anything not on the connector's read allowlist. */
  readonly write: boolean
}

/** The harness's view of the POS. */
export interface ConformancePos {
  /** Back to the starting state: faults off, calls forgotten. */
  reset(): void | Promise<void>
  /** Every POS call since the last reset, in order. */
  calls(): readonly PosCall[]
  /** A digest of the POS's whole state, where the harness holds one (the simulated POS). */
  digest?(): string | Promise<string>
}

/** Faults the kit switches on; `reset` switches them off. */
export interface ConformanceFaults {
  /** Every POS call from now on hangs and never answers. */
  stall(): void
  /**
   * From the `n`th read call after this one on (1-based), every read fails with an error answer;
   * the reads before it answer. The kit runs it for each read a whole reading takes, so a reading
   * that drops a failed page and returns the rest as complete is caught (rule 6). Later reads
   * fail too, so a connector that retries a failed page is not mistaken for one that drops it.
   */
  failReadsFrom(n: number): void
  /** The POS refuses the login's credentials, where the harness can say so. */
  refuseLogin?(): void
}

/** The faults the write checks need beyond the read checks. */
export interface WriteFaults extends ConformanceFaults {
  /** Every write from now on hangs and never answers; reads still answer. */
  stallWrites(): void
}

/** A table to read and what its reading must be, or why the harness has none. */
export type TableScenario =
  | { readonly ref: PosRef; readonly expected: TableBills }
  | { readonly none: string }

/** What the read checks and the waiter-action guard need. */
export interface ReadHarness {
  /** The connector's name in test titles. */
  readonly name: string
  readonly connector: ServiceReader
  readonly pos: ConformancePos
  readonly faults: ConformanceFaults
  readonly table: TableScenario
  /** Items for the availability read, where `itemAvailability` is declared. */
  readonly items?: readonly PosRef[]
  /** The connector package's write module, as `import * as write from '…'`. */
  readonly writeModule: Readonly<Record<string, unknown>>
  /** Its declaration: each export of the write module and the waiter actions it performs. */
  readonly waiterActions: WaiterActionDeclaration
  /** The clock handed to the connector. Default: the real clock. */
  readonly now?: () => Date
}

/** A waiter at the POS's front end, setting up what each write check needs. */
export interface WaiterDriver {
  /** A table with no open POS bill. */
  emptyTable(): Promise<PosRef>
  /** An item that can be sold now. */
  sellableItem(): Promise<PosRef>
  /** Opens a POS bill with one line, as staff or through Restro's own login, at `openedAt`. */
  openBill(
    table: PosRef,
    options: { readonly openedAt: Date; readonly byRestro: boolean },
  ): Promise<PosRef>
  /** A payment table, where the POS isolates by moving lines to a table (`moveLinesToTable`); else null. */
  paymentTable(): Promise<PosRef | null>
  /** Closes the bill right before the connector's next write lands, where the harness can. */
  closeBillBeforeNextWrite?(bill: PosRef): void
  /**
   * A closed POS bill as the till shows it: its lines and its total, null where it is not closed.
   * The tip check needs it where `recordTipOnClose` is declared (D127); the interface reads no
   * closed bill, so the waiter looks.
   */
  closedBill?(bill: PosRef): Promise<PosBill | null>
}

/** What the write checks need beyond the read checks. */
export interface WriteHarness extends ReadHarness {
  readonly connector: ServiceConnector
  readonly faults: WriteFaults
  readonly waiter: WaiterDriver
}

/**
 * The kit's own timings: small, so a stalled call ends quickly. They are handed to the connector
 * in its context, which proves it takes its timings from the platform, not from a constant.
 */
export const KIT_TIMINGS: ServiceTimings = Object.freeze({
  probeBudgetMs: 200,
  readTimeoutMs: 300,
  writeTimeoutMs: 300,
  readBackWindowMs: 1_000,
})

/** How much later than its timing a stalled call may answer before the kit calls it hung. */
export const KIT_MARGIN_MS = 1_500
