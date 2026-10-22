// The worker's HTTP server, on node:http (no framework). Railway (and later an external uptime
// check) probes `GET /health`; the answer comes from memory (see health.ts), never from the
// database. The one other route is the reveal endpoint (`POST /internal/reveal`, reveal.ts, #70),
// for the web app's server on the private network only: it exists once the worker has set its
// handler (after the database pool is open) and only with REVEAL_SERVICE_TOKEN set. Nothing else
// is served, and no body carries host names, versions or ids. No request line or header is
// logged here.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { HealthReport } from './health'
import {
  hasServiceToken,
  isPrivateHost,
  MAX_REVEAL_BODY_BYTES,
  REVEAL_PATH,
  type RevealAnswer,
  type RevealRequest,
  RevealRequestSchema,
} from './reveal'

export const HEALTH_PATH = '/health'

/** What answers a reveal once the worker is ready: the service token and the reveal itself. */
export interface RevealHandler {
  readonly token: string
  reveal(request: RevealRequest): Promise<RevealAnswer>
  /** Called when a reveal throws; must not log the request. */
  failed(error: unknown): void
}

export interface HealthServer {
  /** The port actually listening (differs from the requested one only for port 0). */
  readonly port: number
  /** Turns the reveal endpoint on (a handler) or off (null). */
  setRevealHandler(handler: RevealHandler | null): void
  /** Stops listening and drops open connections. Resolves when the port is free. */
  close(): Promise<void>
}

class BodyTooLarge extends Error {}

/** The request body as text, refused past `limit` bytes. */
async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > limit) throw new BodyTooLarge()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Starts listening on `port` (all interfaces, so another container can probe it) and answers
 * `GET /health` with `report()`. Rejects if the port cannot be bound.
 */
export function startHealthServer(port: number, report: () => HealthReport): Promise<HealthServer> {
  let revealHandler: RevealHandler | null = null

  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...headers,
      })
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body))
    }

    if (path === REVEAL_PATH) {
      void answerReveal(request, send)
    } else if (path !== HEALTH_PATH) {
      send(404, { error: 'not found' })
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
    } else {
      const { httpStatus, body } = report()
      send(httpStatus, body)
    }
  })

  async function answerReveal(
    request: IncomingMessage,
    send: (status: number, body: unknown, headers?: Record<string, string>) => void,
  ): Promise<void> {
    const handler = revealHandler
    // Off, or asked through a public name: as if there were nothing here.
    if (handler === null || !isPrivateHost(request.headers.host)) {
      send(404, { error: 'not found' })
      return
    }
    if (request.method !== 'POST') {
      send(405, { error: 'method not allowed' }, { allow: 'POST' })
      return
    }
    if (!hasServiceToken(request.headers.authorization, handler.token)) {
      send(401, { error: 'unauthorized' })
      return
    }
    let parsed: RevealRequest
    try {
      const body = await readBody(request, MAX_REVEAL_BODY_BYTES)
      const result = RevealRequestSchema.safeParse(JSON.parse(body))
      if (!result.success) {
        send(400, { error: 'invalid request' })
        return
      }
      parsed = result.data
    } catch (error) {
      send(error instanceof BodyTooLarge ? 413 : 400, { error: 'invalid request' })
      return
    }
    try {
      const answer = await handler.reveal(parsed)
      send(answer.status === 'accepted' ? 200 : 403, answer)
    } catch (error) {
      handler.failed(error)
      send(500, { error: 'reveal failed' })
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        setRevealHandler(handler) {
          revealHandler = handler
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            // Probes keep connections alive; without this close() would wait for them.
            server.closeAllConnections()
          }),
      })
    })
  })
}
