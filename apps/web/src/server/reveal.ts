// The web app's side of the worker's reveal endpoint (D122 §9; tickets #70 and #72). A table's
// code is stored as its hash and a copy sealed for the worker, and only the worker may open a seal
// (D55): the Tables screen asks it, once per page load, for the codes it draws, and a sticker
// download asks for one. A staff member's PIN is kept the same way, and the people settings ask
// for the PINs they show (`revealPinsFor`). The worker checks the signed-in person may see them at
// the venue and writes the Log entry; this file only carries the question over the private
// network (`WORKER_REVEAL_URL`, with `REVEAL_SERVICE_TOKEN` as a bearer). Nothing here stores or
// logs a code or a PIN; any failure gives none (the screen then shows none) and is logged without
// detail.
import { MAX_REVEALED_CODES, MAX_REVEALED_PINS } from '@restro/core/service'
import { z } from 'zod'

import { serverEnv } from './env'
import { logError } from './log'

/** The signed-in person asking, with their session. */
export interface RevealActor {
  readonly userId: string
  readonly sessionId: string
  /** When they last entered their password (their session's start): PINs need it fresh. */
  readonly signedInAt?: Date
  /** True when they ask as Restro's admin team (`isOperator`), not as the venue's own staff. */
  readonly operator?: boolean
}

/** Who asks and where. */
interface RevealTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly actor: RevealActor
}

/** What one kind of reveal asks for, how many fit in one request, and its log event. */
interface RevealKind {
  readonly field: 'tableIds' | 'staffMemberIds'
  readonly batch: number
  readonly event: string
}

const TABLE_CODES: RevealKind = {
  field: 'tableIds',
  batch: MAX_REVEALED_CODES,
  event: 'table_code_reveal',
}
const STAFF_PINS: RevealKind = {
  field: 'staffMemberIds',
  batch: MAX_REVEALED_PINS,
  event: 'staff_pin_reveal',
}

/** Opens the codes of tables of the venue: table id → code; a table left out has none to show. */
export type RevealCodes = (tableIds: readonly string[]) => Promise<ReadonlyMap<string, string>>

/** Where the endpoint is and its token; either missing turns the reveal off. */
export interface RevealConfig {
  readonly url: string | undefined
  readonly token: string | undefined
}

/** Reveals nothing: for a person who may not see codes, and in tests. */
export const revealNothing: RevealCodes = async () => new Map()

/** The endpoint's path on the worker (apps/worker/src/reveal.ts). */
const REVEAL_PATH = '/internal/reveal'
/** How long one reveal may take before the screen gives up on its codes. */
const TIMEOUT_MS = 5_000

const AnswerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    codes: z.record(z.string(), z.string().nullable()),
  }),
  z.object({ status: z.literal('refused'), code: z.string() }),
])

/** The reveal settings from the environment. */
export function revealConfig(): RevealConfig {
  const env = serverEnv()
  return { url: env.WORKER_REVEAL_URL, token: env.REVEAL_SERVICE_TOKEN }
}

/**
 * The reveal for one person at one venue. Asks in batches of `MAX_REVEALED_CODES`; a batch that
 * fails or is refused gives no codes.
 */
export function revealFor(
  config: RevealConfig,
  target: RevealTarget,
  fetchImpl: typeof fetch = fetch,
): RevealCodes {
  return (tableIds) => revealAll(TABLE_CODES, config, target, tableIds, fetchImpl)
}

/**
 * The PIN reveal for one person at one venue (#72): staff member id → PIN; one left out has none
 * to show, or the reveal was refused (the worker asks for a sign-in of the last 15 minutes).
 */
export function revealPinsFor(
  config: RevealConfig,
  target: RevealTarget,
  fetchImpl: typeof fetch = fetch,
): RevealCodes {
  return (staffMemberIds) => revealAll(STAFF_PINS, config, target, staffMemberIds, fetchImpl)
}

async function revealAll(
  kind: RevealKind,
  config: RevealConfig,
  target: RevealTarget,
  ids: readonly string[],
  fetchImpl: typeof fetch,
): Promise<ReadonlyMap<string, string>> {
  const codes = new Map<string, string>()
  if (config.url === undefined || config.token === undefined || ids.length === 0) {
    return codes
  }
  const unique = [...new Set(ids)]
  for (let start = 0; start < unique.length; start += kind.batch) {
    const batch = unique.slice(start, start + kind.batch)
    for (const [id, code] of await revealBatch(kind, config, target, batch, fetchImpl)) {
      codes.set(id, code)
    }
  }
  return codes
}

async function revealBatch(
  kind: RevealKind,
  config: RevealConfig,
  target: RevealTarget,
  ids: readonly string[],
  fetchImpl: typeof fetch,
): Promise<[string, string][]> {
  const { actor } = target
  try {
    const response = await fetchImpl(`${(config.url ?? '').replace(/\/+$/, '')}${REVEAL_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: target.tenantId,
        venueId: target.venueId,
        [kind.field]: ids,
        actor:
          actor.operator === true
            ? { kind: 'operator', userId: actor.userId }
            : { kind: 'user', userId: actor.userId, sessionId: actor.sessionId },
        ...(actor.signedInAt === undefined ? {} : { signedInAt: actor.signedInAt.toISOString() }),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status !== 200 && response.status !== 403) {
      logError(`${kind.event}_failed`, new Error(`the worker answered ${response.status}`))
      return []
    }
    const answer = AnswerSchema.parse(await response.json())
    if (answer.status === 'refused') {
      logError(`${kind.event}_refused`, new Error(answer.code))
      return []
    }
    return Object.entries(answer.codes).flatMap(([id, code]) =>
      code === null ? [] : [[id, code] as [string, string]],
    )
  } catch (error) {
    // Never the request or the answer: they carry codes.
    logError(`${kind.event}_failed`, error instanceof Error ? new Error(error.name) : error)
    return []
  }
}
