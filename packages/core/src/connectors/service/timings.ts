// The schema of the seam's timings; the timings themselves live in `../../timings.ts`, where the
// service path can read them without importing the connectors (D117), and are re-exported here.

import { z } from 'zod'

import type { ServiceTimings } from '../../timings'

export { SERVICE_TIMING_SOURCES, SERVICE_TIMINGS, type ServiceTimings } from '../../timings'

export const ServiceTimingsSchema = z.strictObject({
  /** The probe must answer correctly within this, through the same path as an order. */
  probeBudgetMs: z.int().positive().max(60_000),
  /** A read slower than this is an incomplete reading. */
  readTimeoutMs: z.int().positive().max(120_000),
  /** A write slower than this is `unknown`: read back, never sent again (D115). */
  writeTimeoutMs: z.int().positive().max(120_000),
  /** How long a timed-out write is read back before it ends Unconfirmed (D115, D116). */
  readBackWindowMs: z.int().positive().max(600_000),
}) satisfies z.ZodType<ServiceTimings>
