// The seam's timings. They are platform configuration, each with its source named, handed to
// the connector in its context on every call; never a connector's own constant and never taken
// from the simulated POS (#51 design §2: "timings from #47's measurements, not the simulator").
// These are starting values that may be tuned without a new decision (D120, "Technical tuning
// from best practice").

import { z } from 'zod'

export const ServiceTimingsSchema = z.strictObject({
  /** The probe must answer correctly within this, through the same path as an order. */
  probeBudgetMs: z.int().positive().max(60_000),
  /** A read slower than this is an incomplete reading. */
  readTimeoutMs: z.int().positive().max(120_000),
  /** A write slower than this is `unknown`: read back, never sent again (D115). */
  writeTimeoutMs: z.int().positive().max(120_000),
  /** How long a timed-out write is read back before it ends Unconfirmed (D115, D116). */
  readBackWindowMs: z.int().positive().max(600_000),
})
export type ServiceTimings = z.output<typeof ServiceTimingsSchema>

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
