// The worker's HTTP server, on node:http (no framework). Railway (and later an external uptime
// check) probes `GET /health`; the answer comes from memory (see health.ts), never from the
// database. The other routes are for the web app's server on the private network only: the reveal
// endpoint (`POST /internal/reveal`, reveal.ts, #70) and the Telegram link endpoint
// (`POST /internal/telegram`, alerts/telegram-link-api.ts, #87) and the payment connection
// endpoint (`POST /internal/payments/connection`, payments/connection-api.ts, #109). Each exists once the worker has set
// its handler (after the database pool is open) and only with REVEAL_SERVICE_TOKEN set. Nothing
// else is served, and no body carries host names, versions or ids. No request line or header is
// logged here.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  MAX_TELEGRAM_BODY_BYTES,
  TELEGRAM_PATH,
  type TelegramApiAnswer,
  type TelegramRequest,
  TelegramRequestSchema,
} from './alerts/telegram-link-api'
import type { HealthReport } from './health'
import {
  CONNECTION_PATH,
  type ConnectionApiAnswer,
  type ConnectionRequest,
  ConnectionRequestSchema,
  MAX_CONNECTION_BODY_BYTES,
} from './payments/connection-api'
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

/** What answers a Telegram link request once the worker is ready. */
export interface TelegramLinkHandler {
  readonly token: string
  handle(request: TelegramRequest): Promise<TelegramApiAnswer>
  /** Called when a request throws; must not log the request. */
  failed(error: unknown): void
}

/** What answers a payment connection request once the worker is ready. */
export interface ConnectionHandler {
  readonly token: string
  handle(request: ConnectionRequest): Promise<ConnectionApiAnswer>
  /** Called when a request throws; must not log the request. */
  failed(error: unknown): void
}

export interface HealthServer {
  /** The port actually listening (differs from the requested one only for port 0). */
  readonly port: number
  /** Turns the reveal endpoint on (a handler) or off (null). */
  setRevealHandler(handler: RevealHandler | null): void
  /** Turns the Telegram link endpoint on (a handler) or off (null). */
  setTelegramHandler(handler: TelegramLinkHandler | null): void
  /** Turns the payment connection endpoint on (a handler) or off (null). */
  setConnectionHandler(handler: ConnectionHandler | null): void
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

type Send = (status: number, body: unknown, headers?: Record<string, string>) => void

/** An internal endpoint's side: its token, its checks of the body and its work. */
interface Internal<Request, Answer extends { readonly status: string }> {
  readonly handler: { readonly token: string; failed(error: unknown): void } | null
  readonly parse: (value: unknown) => Request | null
  readonly limit: number
  readonly run: (request: Request) => Promise<Answer>
  readonly failure: string
}

/**
 * Answers one request of an internal endpoint: off or a public name is a 404, only POST, the
 * service token as a bearer, a body of the allowed size that parses, then the work. `accepted`
 * answers are 200, any other 403.
 */
async function answerInternal<Request, Answer extends { readonly status: string }>(
  request: IncomingMessage,
  send: Send,
  endpoint: Internal<Request, Answer>,
): Promise<void> {
  const { handler } = endpoint
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
  let parsed: Request | null
  try {
    parsed = endpoint.parse(JSON.parse(await readBody(request, endpoint.limit)))
  } catch (error) {
    send(error instanceof BodyTooLarge ? 413 : 400, { error: 'invalid request' })
    return
  }
  if (parsed === null) {
    send(400, { error: 'invalid request' })
    return
  }
  try {
    const answer = await endpoint.run(parsed)
    send(answer.status === 'accepted' ? 200 : 403, answer)
  } catch (error) {
    handler.failed(error)
    send(500, { error: endpoint.failure })
  }
}

/**
 * Starts listening on `port` (all interfaces, so another container can probe it) and answers
 * `GET /health` with `report()`. Rejects if the port cannot be bound.
 */
export function startHealthServer(port: number, report: () => HealthReport): Promise<HealthServer> {
  let revealHandler: RevealHandler | null = null
  let telegramHandler: TelegramLinkHandler | null = null
  let connectionHandler: ConnectionHandler | null = null

  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]
    const send: Send = (status, body, headers = {}) => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...headers,
      })
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body))
    }

    if (path === REVEAL_PATH) {
      const handler = revealHandler
      void answerInternal(request, send, {
        handler,
        parse: (value) => {
          const result = RevealRequestSchema.safeParse(value)
          return result.success ? result.data : null
        },
        limit: MAX_REVEAL_BODY_BYTES,
        run: (parsed: RevealRequest) => (handler as RevealHandler).reveal(parsed),
        failure: 'reveal failed',
      })
    } else if (path === TELEGRAM_PATH) {
      const handler = telegramHandler
      void answerInternal(request, send, {
        handler,
        parse: (value) => {
          const result = TelegramRequestSchema.safeParse(value)
          return result.success ? result.data : null
        },
        limit: MAX_TELEGRAM_BODY_BYTES,
        run: (parsed: TelegramRequest) => (handler as TelegramLinkHandler).handle(parsed),
        failure: 'request failed',
      })
    } else if (path === CONNECTION_PATH) {
      const handler = connectionHandler
      void answerInternal(request, send, {
        handler,
        parse: (value) => {
          const result = ConnectionRequestSchema.safeParse(value)
          return result.success ? result.data : null
        },
        limit: MAX_CONNECTION_BODY_BYTES,
        run: (parsed: ConnectionRequest) => (handler as ConnectionHandler).handle(parsed),
        failure: 'request failed',
      })
    } else if (path !== HEALTH_PATH) {
      send(404, { error: 'not found' })
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
    } else {
      const { httpStatus, body } = report()
      send(httpStatus, body)
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        setRevealHandler(handler) {
          revealHandler = handler
        },
        setTelegramHandler(handler) {
          telegramHandler = handler
        },
        setConnectionHandler(handler) {
          connectionHandler = handler
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
