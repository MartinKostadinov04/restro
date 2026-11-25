// Recordings of the sandbox (#107): one cassette per conformance check, recorded against Stripe's
// sandbox and played back with MSW in CI, as barsy's fixtures are. A `test-*` helper: only tests
// import it.
//
// A cassette holds, in order, each response Stripe gave (method, path, status, a few headers and
// the scrubbed body: `test-scrub.ts`); requests are not kept, so no key or header is. Playback
// answers the requests in the same order and fails the test on a request out of order or left
// over. The ids the check makes (`py_…`) come from a generator seeded per check and recording, so
// playback makes the same ids and a new recording never meets an older one's ids or keys.

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { HttpResponse, http } from 'msw'
import { type SetupServer, setupServer } from 'msw/node'
import { vi } from 'vitest'

import { scrubBody } from './test-scrub'

export const STRIPE_API = 'https://api.stripe.com'

/** The headers a cassette keeps: what stripe-node or the provider reads. */
const KEPT_HEADERS = ['content-type', 'idempotent-replayed', 'request-id', 'stripe-version']

export interface CassetteEntry {
  readonly method: string
  /** The path, without the query (a read's query carries the time of the run). */
  readonly path: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface Cassette {
  /** Seeds the check's ids: fresh for every recording. */
  readonly nonce: string
  /** The sandbox accounts the check ran on. */
  readonly account: string
  readonly otherAccount: string
  readonly entries: CassetteEntry[]
}

/** True when the run records against the sandbox (`STRIPE_CONFORMANCE=record`). */
export function recording(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRIPE_CONFORMANCE === 'record'
}

/** The cassette file of a check: its title as a slug, with a hash against clashes. */
export function cassettePath(dir: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
  const hash = createHash('sha256').update(title).digest('hex').slice(0, 8)
  return join(dir, `${slug}-${hash}.json`)
}

export function readCassette(path: string): Cassette | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Cassette
}

/** Writes the cassette, one entry per line, so a diff shows which answers changed. */
export function writeCassette(dir: string, path: string, cassette: Cassette): void {
  mkdirSync(dir, { recursive: true })
  const lines = [
    '{',
    `  "nonce": ${JSON.stringify(cassette.nonce)},`,
    `  "account": ${JSON.stringify(cassette.account)},`,
    `  "otherAccount": ${JSON.stringify(cassette.otherAccount)},`,
    '  "entries": [',
    cassette.entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n'),
    '  ]',
    '}',
  ]
  writeFileSync(path, `${lines.join('\n')}\n`)
}

export function newCassette(account: string, otherAccount: string): Cassette {
  return { nonce: randomBytes(8).toString('hex'), account, otherAccount, entries: [] }
}

/** The tape one check runs on: its cassette and how far playback has read it. */
export class Tape {
  cursor = 0
  readonly problems: string[] = []

  constructor(readonly cassette: Cassette) {}

  /** The next recorded answer, if it is for this request. */
  next(method: string, path: string): CassetteEntry | null {
    const entry = this.cassette.entries[this.cursor]
    if (entry === undefined || entry.method !== method || entry.path !== path) {
      const expected = entry === undefined ? 'nothing more' : `${entry.method} ${entry.path}`
      this.problems.push(`request ${this.cursor}: ${method} ${path}, the recording has ${expected}`)
      return null
    }
    this.cursor += 1
    return entry
  }

  /** What playback left unread. */
  leftOver(): string[] {
    return this.cassette.entries.slice(this.cursor).map((entry) => `${entry.method} ${entry.path}`)
  }
}

function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name)
    if (value !== null) kept[name] = value
  }
  return kept
}

/**
 * Recording: a fetch that sends the request to Stripe, keeps the scrubbed answer on the tape and
 * hands the code the same scrubbed answer.
 */
export function recordingFetch(tape: () => Tape, realFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const response = await realFetch(input, init)
    const body = scrubBody(await response.text())
    const headers = keptHeaders(response.headers)
    tape().cassette.entries.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      status: response.status,
      headers,
      body,
    })
    return new Response(body, { status: response.status, headers })
  }
}

/** Playback: an MSW server that answers Stripe's API from the current tape, in order. */
export function playbackServer(tape: () => Tape): SetupServer {
  return setupServer(
    http.all(`${STRIPE_API}/*`, ({ request }) => {
      const entry = tape().next(request.method, new URL(request.url).pathname)
      if (entry === null) {
        return new HttpResponse('the recording has no such answer', { status: 501 })
      }
      return new HttpResponse(entry.body, { status: entry.status, headers: entry.headers })
    }),
  )
}

/**
 * Seeds `crypto.getRandomValues` (which `newId` reads) from the cassette's nonce and the check's
 * title, so recording and playback make the same ids. Returns the undo.
 */
export function seedRandom(seed: string): () => void {
  let counter = 0
  const spy = vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array === null) return array
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let at = 0; at < bytes.length; at += 32) {
        const block = createHash('sha256').update(`${seed}:${counter++}`).digest()
        bytes.set(block.subarray(0, Math.min(32, bytes.length - at)), at)
      }
      return array
    })
  return () => spy.mockRestore()
}
