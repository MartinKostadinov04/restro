// The connector's side of the wire: a transport (HTTP through `fetch`, or in process), and a
// client that adds the login and parses answers losslessly. A call that times out or fails on
// the network is `lost`, never an answer: the connector turns it into `unknown` or an incomplete
// reading. A call the budget had no room for is `not_left`: it was never sent. Only the write
// module (`./write`) sends writes.

import { checkSimHost, type SimHostOptions } from './hosts'
import { parseWireJson } from './wire/json'
import { basicAuthHeader } from './wire/serve'

export interface TransportRequest {
  readonly method: 'GET' | 'POST'
  /** The path and query, from `/api/`. */
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | null
  readonly signal: AbortSignal
}

export interface TransportResponse {
  readonly status: number
  readonly body: string
}

export type SimTransport = (request: TransportRequest) => Promise<TransportResponse>

/** HTTP to a simulator at `baseUrl`, through `fetch` (which MSW intercepts in tests). */
export function fetchTransport(baseUrl: string, hosts: SimHostOptions): SimTransport {
  const base = checkSimHost(baseUrl, hosts)
  return async (request) => {
    const response = await fetch(new URL(request.path, base), {
      method: request.method,
      headers: {
        ...request.headers,
        ...(request.body === null ? {} : { 'content-type': 'application/json' }),
      },
      body: request.body,
      signal: request.signal,
    })
    return { status: response.status, body: await response.text() }
  }
}

export type Sent =
  | { readonly kind: 'answer'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'lost'; readonly reason: string }
  | { readonly kind: 'not_left' }

export interface SimClient {
  get(path: string, signal: AbortSignal): Promise<Sent>
  post(path: string, body: unknown, signal: AbortSignal): Promise<Sent>
}

export function simClient(
  transport: SimTransport,
  login: { readonly user: string; readonly password: string },
  /** Waits for the call's place in the login's budget; false: it never leaves. */
  pace?: (signal: AbortSignal) => Promise<boolean>,
): SimClient {
  const headers = { authorization: basicAuthHeader(login.user, login.password) }
  const send = async (
    method: 'GET' | 'POST',
    path: string,
    body: string | null,
    signal: AbortSignal,
  ): Promise<Sent> => {
    if (pace !== undefined && !(await pace(signal))) return { kind: 'not_left' }
    let response: TransportResponse
    try {
      response = await transport({ method, path, headers, body, signal })
    } catch (error) {
      return {
        kind: 'lost',
        reason: signal.aborted ? 'no answer in time' : `no answer: ${String(error)}`.slice(0, 300),
      }
    }
    try {
      return { kind: 'answer', status: response.status, body: parseWireJson(response.body) }
    } catch {
      return { kind: 'lost', reason: `an answer that is not JSON (${response.status})` }
    }
  }
  return {
    get: (path, signal) => send('GET', path, null, signal),
    post: (path, body, signal) => send('POST', path, JSON.stringify(body), signal),
  }
}

/** A path segment for an id, which may hold spaces. */
export function segment(id: string): string {
  return encodeURIComponent(id)
}
