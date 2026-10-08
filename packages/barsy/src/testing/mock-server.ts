// MSW harness: replays recorded (or handmade) barsy responses, for tests only. Exported as
// `@restro/barsy/testing`, never from the package index, so production bundles do not pull in msw.
//
// It serves the two wire shapes of the official docs (usage/raw.html):
//   POST https://<host>/endpoints/json/<Method>?bid=...   the fixture body of <Method>, as recorded
//   POST https://<host>/endpoints/json/?bid=...           { "<Method>": <fixture body>, ... }
// The multi-method response is assembled from the recorded body texts without re-serialising them,
// so a recorded `2.40` is still `2.40`.
//
// Anything it cannot answer from a fixture returns 501 with an explanatory text. How barsy behaves
// when one method of a multi-method call fails is undocumented, so the harness refuses to invent it:
// a multi-method call that touches a non-2xx fixture is answered with 501. Requests to any other
// URL fail the test (`onUnhandledRequest: 'error'`); nothing ever reaches the real network.

import { HttpResponse, http } from 'msw'
import { type SetupServer, setupServer } from 'msw/node'
import type { BarsyFixture } from '../fixture.ts'
import { BARSY_DEMO_HOST, normaliseHost } from '../hosts.ts'

export interface BarsyMockRequest {
  /** The full request URL as received, query included. */
  readonly url: string
  /** Method names asked for; one entry for a single call. */
  readonly methods: readonly string[]
  readonly multi: boolean
  readonly bid: string | null
  /** The Authorization header as received (null when none was sent). Test data only. */
  readonly authorization: string | null
  readonly contentType: string | null
  /** Single call: the parameters. Multi-method call: the whole request body. */
  readonly params: unknown
}

export interface BarsyMockServerOptions {
  /** Host to answer for. Default: the demo host. */
  readonly host?: string
}

export interface BarsyMockServer {
  readonly host: string
  /** The underlying MSW server, for one-off overrides (`server.use(...)`) such as a delay or a network error. */
  readonly server: SetupServer
  /** Every request the harness has seen since `listen()` or the last `reset()`. */
  readonly requests: readonly BarsyMockRequest[]
  listen(): void
  close(): void
  /** Forgets seen requests, drops overrides and restores the fixtures given at creation. */
  reset(): void
  /** Replaces the whole fixture set (for example to switch `Misc_ping_user` to a 401). */
  setFixtures(fixtures: readonly BarsyFixture[]): void
}

const PATH = '/endpoints/json/'

export function createBarsyMockServer(
  initialFixtures: readonly BarsyFixture[],
  options: BarsyMockServerOptions = {},
): BarsyMockServer {
  const host = normaliseHost(options.host ?? BARSY_DEMO_HOST)
  const byMethod = new Map<string, BarsyFixture>()
  const seen: BarsyMockRequest[] = []

  function load(fixtures: readonly BarsyFixture[]): void {
    byMethod.clear()
    for (const fixture of fixtures) {
      if (byMethod.has(fixture.method)) {
        throw new Error(
          `two fixtures for ${fixture.method}: the harness serves one fixture per method`,
        )
      }
      byMethod.set(fixture.method, fixture)
    }
  }
  load(initialFixtures)

  const server = setupServer(
    http.post(`https://${host}${PATH}`, async ({ request }) => {
      const text = await request.text()
      const bid = new URL(request.url).searchParams.get('bid')
      const authorization = request.headers.get('authorization')
      const parsed = tryParse(text)
      if (!isPlainObject(parsed)) {
        seen.push({
          ...describe(request),
          methods: [],
          multi: true,
          bid,
          authorization,
          params: parsed,
        })
        return refuse(400, 'multi-method body must be a JSON object keyed by method name')
      }
      const methods = Object.keys(parsed)
      seen.push({ ...describe(request), methods, multi: true, bid, authorization, params: parsed })

      const parts: string[] = []
      let requestId: string | null = null
      for (const method of methods) {
        const fixture = byMethod.get(method)
        if (!fixture) return refuse(501, `no fixture for method ${method}`)
        if (fixture.status < 200 || fixture.status > 299) {
          return refuse(
            501,
            `fixture for ${method} has status ${fixture.status}; barsy's multi-method failure behaviour is undocumented, record it first`,
          )
        }
        const body = fixture.body.trim()
        if (tryParse(body) === undefined) {
          return refuse(501, `fixture body for ${method} is not JSON`)
        }
        parts.push(`${JSON.stringify(method)}:${body}`)
        requestId ??= fixture.requestId
      }
      return reply(200, `{${parts.join(',')}}`, requestId)
    }),

    http.post(`https://${host}${PATH}:method`, async ({ request, params }) => {
      const method = String(params.method)
      const text = await request.text()
      seen.push({
        ...describe(request),
        methods: [method],
        multi: false,
        bid: new URL(request.url).searchParams.get('bid'),
        authorization: request.headers.get('authorization'),
        params: tryParse(text) ?? text,
      })
      const fixture = byMethod.get(method)
      if (!fixture) return refuse(501, `no fixture for method ${method}`)
      return reply(fixture.status, fixture.body, fixture.requestId)
    }),
  )

  return {
    host,
    server,
    requests: seen,
    listen() {
      server.listen({ onUnhandledRequest: 'error' })
    },
    close() {
      server.close()
    },
    reset() {
      seen.length = 0
      load(initialFixtures)
      server.resetHandlers()
    },
    setFixtures(fixtures) {
      load(fixtures)
    },
  }
}

function describe(request: Request): Pick<BarsyMockRequest, 'url' | 'contentType'> {
  return { url: request.url, contentType: request.headers.get('content-type') }
}

function reply(status: number, body: string, requestId: string | null): Response {
  const headers: Record<string, string> = {}
  if (body !== '') headers['content-type'] = 'application/json; charset=utf-8'
  if (requestId !== null) headers.BARSY_REQUEST_ID = requestId
  // Statuses such as 204 may not carry a body; an empty fixture body is sent as no body at all.
  return new HttpResponse(body === '' ? null : body, { status, headers })
}

function refuse(status: number, message: string): Response {
  return new HttpResponse(`barsy-mock: ${message}`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
