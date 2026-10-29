// The seam's timings. They are platform configuration, each with its source named, handed to
// the connector in its context on every call; never a connector's own constant and never taken
// from the simulated POS (#51 design §2: "timings from #47's measurements, not the simulator").
// These are starting values that may be tuned without a new decision (D120, "Technical tuning
// from best practice"). Constants and types only, with no imports: the service path reads them
// (its slot leases are derived from them) and may import nothing of the connectors (D117).
// `connectors/service/timings.ts` holds their schema and re-exports them.

export interface ServiceTimings {
  /** The probe must answer correctly within this, through the same path as an order. */
  readonly probeBudgetMs: number
  /** A read slower than this is an incomplete reading. */
  readonly readTimeoutMs: number
  /** A write slower than this is `unknown`: read back, never sent again (D115). */
  readonly writeTimeoutMs: number
  /** How long a timed-out write is read back before it ends Unconfirmed (D115, D116). */
  readonly readBackWindowMs: number
}

/** The default timings. */
export const SERVICE_TIMINGS: ServiceTimings = Object.freeze({
  probeBudgetMs: 3_000,
  readTimeoutMs: 10_000,
  writeTimeoutMs: 10_000,
  readBackWindowMs: 60_000,
})

/** Where each default comes from. A measurement replaces a starting value and its source here. */
export const SERVICE_TIMING_SOURCES: { readonly [K in keyof ServiceTimings]: string } = {
  probeBudgetMs: 'D122 §6: "the probe must answer correctly within 3 s"',
  readTimeoutMs:
    "starting value, no POS measured yet; replace with the measurements of #47 and of each connector's test installation",
  writeTimeoutMs:
    "starting value, no POS measured yet; replace with the measurements of #47 (C18) and of each connector's test installation",
  readBackWindowMs: 'D115: "for about a minute Restro reads the table\'s open POS bills"',
}
