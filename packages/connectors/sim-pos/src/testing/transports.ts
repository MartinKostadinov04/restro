// Two ways to put the engine behind the connector's transport, for tests: in process (a direct
// call into the wire, no HTTP), or MSW handlers that answer `fetch` to a base URL from the
// engine. Both go through the same `serveWire`, so a test can run on either and see the same POS.

import { HttpResponse, http, type RequestHandler } from 'msw'
import { type SetupServer, setupServer } from 'msw/node'

import type { SimTransport } from '../client'
import type { SimEngine } from '../engine/engine'
import { serveWire, WireAborted } from '../wire/serve'

/** The engine behind a transport, in process. `base` only completes the URL the wire reads. */
export function inProcessTransport(
  engine: SimEngine,
  base = 'http://sim-pos.localhost',
): SimTransport {
  return (request) =>
    serveWire(engine, {
      method: request.method,
      url: new URL(request.path, base).href,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    })
}

/** MSW handlers answering every `/api/` call to `baseUrl` from the engine. */
export function simPosHandlers(engine: SimEngine, baseUrl: string): RequestHandler[] {
  return [
    http.all(`${baseUrl.replace(/\/$/, '')}/api/*`, async ({ request }) => {
      const text = await request.text()
      let answer: Awaited<ReturnType<typeof serveWire>>
      try {
        answer = await serveWire(engine, {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          body: text === '' ? null : text,
          signal: request.signal,
        })
      } catch (error) {
        // The caller gave up on a call that never answers: no response is sent.
        if (error instanceof WireAborted) return HttpResponse.error()
        throw error
      }
      return new HttpResponse(answer.body, {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  ]
}

/** An MSW server for the engine at `baseUrl`; any other request fails the test. */
export function createSimPosMockServer(engine: SimEngine, baseUrl: string): SetupServer {
  return setupServer(...simPosHandlers(engine, baseUrl))
}
