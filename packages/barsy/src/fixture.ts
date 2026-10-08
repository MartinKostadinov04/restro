// The fixture format shared by the recorder (writes) and the MSW harness (reads).
//
//   { method, params, bid, recordedAt, status, requestId, body }
//
// `body` is the response text byte for byte, so a recorded `2.40` stays `2.40`. Nothing else from
// the response is stored: no headers other than BARSY_REQUEST_ID (kept as `requestId`), and never
// the request's Authorization header or the credentials.

import { z } from 'zod'

import { BarsyConfigError } from './errors.ts'
import { BARSY_DEMO_HOST, normaliseHost } from './hosts.ts'

const METHOD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]*$/
const PILOT_LABEL = /^pilot-[1-9][0-9]*$/

const paramsSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])

export const fixtureSchema = z
  .strictObject({
    method: z.string().regex(METHOD_NAME),
    params: paramsSchema,
    /** The `bid` query value, or null when the call had none (barsy then uses the default venue). */
    bid: z.string().min(1).nullable(),
    /** ISO 8601 UTC. Null only for handmade fixtures. */
    recordedAt: z.iso.datetime().nullable(),
    status: z.number().int().min(100).max(599),
    /** BARSY_REQUEST_ID, or null when the response had none (always null for handmade fixtures). */
    requestId: z.string().min(1).nullable(),
    body: z.string(),
    /** Set on fixtures written by hand, never by the recorder. They are placeholders for a real recording. */
    handmade: z.literal(true).optional(),
    note: z.string().optional(),
  })
  .refine((fixture) => fixture.recordedAt !== null || fixture.handmade === true, {
    message: 'recordedAt may only be null on a handmade fixture',
    path: ['recordedAt'],
  })

export type BarsyFixture = z.output<typeof fixtureSchema>

/** `demo` for the demo installation; `pilot-<n>` (chosen with `--label`) for any other host. */
export function fixtureHostLabel(host: string, label?: string): string {
  const normalised = normaliseHost(host)
  if (normalised === BARSY_DEMO_HOST) {
    if (label !== undefined && label !== 'demo') {
      throw new BarsyConfigError(`the demo host is always labelled "demo", not "${label}"`)
    }
    return 'demo'
  }
  if (label === undefined) {
    throw new BarsyConfigError(
      'this host is not the demo installation: pass --label pilot-<n> (for example --label pilot-1)',
    )
  }
  if (!PILOT_LABEL.test(label)) {
    throw new BarsyConfigError(`label must look like pilot-1, pilot-2, ... (got "${label}")`)
  }
  return label
}

/** `Misc_ping_user` becomes `misc-ping-user`. */
export function defaultFixtureName(method: string): string {
  return method.toLowerCase().replaceAll('_', '-')
}

export function assertFixtureName(name: string): string {
  if (!FIXTURE_NAME.test(name)) {
    throw new BarsyConfigError(
      `fixture name must be lowercase letters, digits and dashes (got "${name}")`,
    )
  }
  return name
}

/** File text for a fixture: two-space JSON and a trailing newline. */
export function serialiseFixture(fixture: BarsyFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}
