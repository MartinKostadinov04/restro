// The reading side of the service seam for barsy (spec #64 §1, ticket #65): the probe and the
// floor over the existing read client. Read-only by construction: it holds only the client's read
// methods, and barsy's write module stays empty until the ticket that adds the first waiter
// action (D110). Every call is bounded by the timings in the platform's context, not by a
// constant of this package; barsy's own client timeout stays as the outer bound.

import {
  type Floor,
  type FloorTable,
  type PosRef,
  type ProbeResult,
  posRef,
  type Reading,
  type ServiceContext,
  type ServiceReader,
  type TableBills,
} from '@restro/core'

import type { BarsyBid, BarsyClient } from '../client.ts'
import { BarsyAuthError } from '../errors.ts'
import { createBarsyReader } from '../read/reader.ts'
import type { Place } from '../read/schemas.ts'
import { BARSY_SERVICE_CAPABILITIES } from './capabilities.ts'

export interface BarsyServiceReaderOptions {
  readonly client: BarsyClient
  /** The barsy venue (barsy_id) this connection serves. */
  readonly bid: BarsyBid
}

const LATE = Symbol('late')

/** Runs `run` and answers `LATE` once `ms` have passed; the call itself is left to finish. */
async function within<T>(ms: number, run: () => Promise<T>): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms)
  })
  try {
    return await Promise.race([run(), late])
  } finally {
    clearTimeout(timer)
  }
}

function text(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

/**
 * `Places_getlist` → the floor. A place is a table; its label is `place_num` (documented as an
 * int, recorded as text, so kept as text) and its area the hall (`salon_name`). barsy has no bars
 * (D124 §1: none made up) and no payment-table mark. A place without a label makes the reading
 * incomplete rather than shorter (rule 6).
 */
function floorOf(places: readonly Place[]): Reading<Floor> {
  const tables: FloorTable[] = []
  const seen = new Set<number>()
  for (const place of [...places].sort((a, b) => a.place_id - b.place_id)) {
    if (seen.has(place.place_id)) continue
    seen.add(place.place_id)
    const name = text(place.place_num)
    if (name === null) return { complete: false, reason: 'a place has no label (place_num)' }
    tables.push({
      ref: posRef(place.place_id),
      name,
      area: text(place.salon_name),
      bar: null,
      paymentTable: null,
    })
  }
  return { complete: true, value: { tables, bars: [] } }
}

export function createBarsyServiceReader(options: BarsyServiceReaderOptions): ServiceReader {
  const { client, bid } = options
  const reader = createBarsyReader(client)

  return {
    kind: 'barsy',
    capabilities: BARSY_SERVICE_CAPABILITIES,

    // https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html: "checks that the API is
    // reachable and the user's credentials are valid", returns 1. A read: it writes nothing.
    // barsy reports no mode, no degraded state and no fiscal device here, so those are null/false.
    async probe(ctx: ServiceContext): Promise<ProbeResult> {
      try {
        const answer = await within(ctx.timings.probeBudgetMs, () => client.pingUser({ bid }))
        if (answer === LATE) return { kind: 'unknown', reason: 'the probe ran past its budget' }
        return { kind: 'answered', mode: null, degraded: false, fiscalDevice: null }
      } catch (error) {
        if (error instanceof BarsyAuthError) {
          return {
            kind: 'refused',
            refusal: { code: 'credentials', scope: 'login', line: null, detail: null },
          }
        }
        return { kind: 'unknown', reason: error instanceof Error ? error.name : 'unknown error' }
      }
    },

    // https://docs.lukanet.com/barsy.api/methods/places/getlist.html
    async readFloor(ctx: ServiceContext): Promise<Reading<Floor>> {
      try {
        const answer = await within(ctx.timings.readTimeoutMs, () => reader.getPlaces(bid))
        if (answer === LATE) return { complete: false, reason: 'the floor read timed out' }
        return floorOf(answer.data)
      } catch (error) {
        return {
          complete: false,
          reason: `the floor read failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        }
      }
    },

    // Not wired: reading a table's open POS bills needs Accounts_getlist on the read allowlist and
    // a recording of it from the test installation (#47). Until then nothing is concluded.
    async readTable(_ctx: ServiceContext, _table: PosRef): Promise<Reading<TableBills>> {
      return { complete: false, reason: 'reading a table is not wired for barsy yet' }
    },
  }
}
