// Serving the wire: one HTTP-shaped request in, the engine's answer out. Basic authentication
// names the login. The engine's plan says when the answer comes: at once, after a real delay (a
// slow answer), or never (a hang, which ends only when the caller gives up). The same function
// backs the MSW handlers and the in-process transport (`../testing`), and later the simulator's
// server (#71).

import type { SimAnswer, SimEngine } from '../engine/engine'
import { parseWireJson, renderWireJson } from './json'
import { route } from './routes'

export interface WireRequest {
  readonly method: string
  /** The full URL: only its path and query are read. */
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | null
  readonly signal?: AbortSignal
}

export interface WireResponse {
  readonly status: number
  readonly body: string
}

/** Thrown (as a rejected promise) when the caller gives up on a call that never answers. */
export class WireAborted extends Error {
  override name = 'AbortError'
}

export function basicAuthHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`)
  return `Basic ${btoa(String.fromCharCode(...bytes))}`
}

function credentialsOf(
  headers: Readonly<Record<string, string>>,
): { user: string; password: string } | null {
  const header = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')
  const match = header === undefined ? null : /^Basic ([A-Za-z0-9+/=]+)$/.exec(header[1])
  if (match?.[1] === undefined) return null
  try {
    const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const colon = text.indexOf(':')
    return colon < 0 ? null : { user: text.slice(0, colon), password: text.slice(colon + 1) }
  } catch {
    return null
  }
}

function errorBody(answer: Extract<SimAnswer, { ok: false }>): string {
  return JSON.stringify({
    error: answer.code,
    detail: answer.detail,
    ...(answer.line === null ? {} : { line: answer.line }),
  })
}

export async function serveWire(engine: SimEngine, request: WireRequest): Promise<WireResponse> {
  let body: unknown = null
  if (request.body !== null && request.body !== '') {
    try {
      body = parseWireJson(request.body)
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'bad_request', detail: 'not JSON' }) }
    }
  }
  const routed = route(request.method, new URL(request.url), body)
  if (routed.kind === 'error') {
    const error = routed.status === 404 ? 'not_found' : 'bad_request'
    return { status: routed.status, body: JSON.stringify({ error, detail: routed.detail }) }
  }
  const plan = engine.call(credentialsOf(request.headers), routed.call)
  if (plan.hang) return never(request.signal)
  if (plan.delayMs > 0) {
    try {
      await wait(plan.delayMs, request.signal)
    } finally {
      if (plan.login !== null) engine.release(plan.login)
    }
  }
  const { answer } = plan
  if (!answer.ok) return { status: answer.status, body: errorBody(answer) }
  return {
    status: 200,
    body: renderWireJson(answer.value, { pricesAsJsonFloats: engine.switches.pricesAsJsonFloats }),
  }
}

function never(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal === undefined) return
    if (signal.aborted) reject(new WireAborted('the call was given up'))
    signal.addEventListener('abort', () => reject(new WireAborted('the call was given up')), {
      once: true,
    })
  })
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WireAborted('the call was given up'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new WireAborted('the call was given up'))
      },
      { once: true },
    )
  })
}
