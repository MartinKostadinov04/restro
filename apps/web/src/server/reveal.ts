// The web app's side of the worker's reveal endpoint (D122 §9; ticket #70). A table's code is
// stored as its hash and a copy sealed for the worker, and only the worker may open a seal (D55):
// the Tables screen asks it, once per page load, for the codes it draws, and a sticker download
// asks for one. The worker checks the signed-in person may see codes at the venue and writes the
// Log entry; this file only carries the question over the private network
// (`WORKER_REVEAL_URL`, with `REVEAL_SERVICE_TOKEN` as a bearer). Nothing here stores or logs a
// code; any failure gives no codes (the screen then draws none) and is logged without detail.
import { MAX_REVEALED_CODES } from '@restro/core/service'
import { z } from 'zod'

import { serverEnv } from './env'
import { logError } from './log'

/** The signed-in person asking, with their session. */
export interface RevealActor {
  readonly userId: string
  readonly sessionId: string
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
  target: { readonly tenantId: string; readonly venueId: string; readonly actor: RevealActor },
  fetchImpl: typeof fetch = fetch,
): RevealCodes {
  return async (tableIds) => {
    const codes = new Map<string, string>()
    if (config.url === undefined || config.token === undefined || tableIds.length === 0) {
      return codes
    }
    const unique = [...new Set(tableIds)]
    for (let start = 0; start < unique.length; start += MAX_REVEALED_CODES) {
      const batch = unique.slice(start, start + MAX_REVEALED_CODES)
      for (const [id, code] of await revealBatch(config, target, batch, fetchImpl)) {
        codes.set(id, code)
      }
    }
    return codes
  }
}

async function revealBatch(
  config: RevealConfig,
  target: { readonly tenantId: string; readonly venueId: string; readonly actor: RevealActor },
  tableIds: readonly string[],
  fetchImpl: typeof fetch,
): Promise<[string, string][]> {
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
        tableIds,
        actor: { kind: 'user', userId: target.actor.userId, sessionId: target.actor.sessionId },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status !== 200 && response.status !== 403) {
      logError('table_code_reveal_failed', new Error(`the worker answered ${response.status}`))
      return []
    }
    const answer = AnswerSchema.parse(await response.json())
    if (answer.status === 'refused') {
      logError('table_code_reveal_refused', new Error(answer.code))
      return []
    }
    return Object.entries(answer.codes).flatMap(([id, code]) =>
      code === null ? [] : [[id, code] as [string, string]],
    )
  } catch (error) {
    // Never the request or the answer: they carry codes.
    logError('table_code_reveal_failed', error instanceof Error ? new Error(error.name) : error)
    return []
  }
}
