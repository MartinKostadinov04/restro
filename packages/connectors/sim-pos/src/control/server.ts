// The simulator's standalone server (#71; #51 design §2.1 part 4): the POS-shaped wire at `/api/`,
// the control page at `/control`, its data calls under `/control/api/` and nothing else. Plain
// Node `http`, no new dependency. One engine at a time; "load a scenario" builds a new one (a
// reset that also brings back the faults and the setup, which `engine.reset()` does not).
//
// Safety (design §7 risk 4): the control calls need the token from the environment when one is
// set, and the server refuses to listen anywhere but this machine without one. The page itself is
// static and holds no data. The server holds no guest data and no Restro data at all.

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { Clock } from '../engine/clock'
import type { SimEngine } from '../engine/engine'
import { PosRefusal, SimSetupError, UndefinedBehaviour } from '../engine/errors'
import {
  buildEngine,
  DEFAULT_SCENARIO_NAME,
  listScenarioNames,
  loadScenarioFile,
  type ResolvedScenario,
  ScenarioFileError,
} from '../scenario-file'
import { serveWire, WireAborted } from '../wire/serve'
import { runWaiterOp, WaiterOpError } from './ops'
import { CONTROL_PAGE } from './page'
import { controlView } from './view'

/** The header the control calls carry their token in. */
export const TOKEN_HEADER = 'x-sim-token'

/** The default port: `pnpm sim:serve` and the CLI agree on it. */
export const DEFAULT_PORT = 4010

const MAX_BODY_BYTES = 64 * 1024

const systemClock: Clock = { now: () => new Date() }

export interface SimServerOptions {
  /** The scenario to start from. Default: `quiet-night`. */
  readonly scenario?: string
  /** The control token, or null/absent for none (local use only). */
  readonly token?: string | null
  /** The engine's clock. Default: the system clock. */
  readonly clock?: Clock
  /** Where chaos prints its seed. Default: the console. */
  readonly print?: (line: string) => void
}

/** The engine being served, and the scenario it was built from. */
export class SimHost {
  engine: SimEngine
  scenario: ResolvedScenario
  readonly #clock: Clock
  readonly #print: ((line: string) => void) | undefined

  constructor(options: SimServerOptions = {}) {
    this.#clock = options.clock ?? systemClock
    this.#print = options.print
    this.scenario = loadScenarioFile(options.scenario ?? DEFAULT_SCENARIO_NAME)
    this.engine = this.#build(this.scenario)
  }

  /** Builds a fresh engine from the named scenario and serves it from now on. */
  load(name: string): void {
    const resolved = loadScenarioFile(name)
    this.engine = this.#build(resolved)
    this.scenario = resolved
  }

  #build(resolved: ResolvedScenario): SimEngine {
    return buildEngine(resolved, {
      clock: this.#clock,
      ...(this.#print === undefined ? {} : { print: this.#print }),
    })
  }

  view() {
    return controlView(this.engine, {
      name: this.scenario.name,
      description: this.scenario.description,
      profile: this.scenario.profile,
      scenarios: listScenarioNames(),
      chaosSeed: this.engine.faults.chaosSeed,
    })
  }
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new WaiterOpError('the request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(size === 0 ? null : Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response: ServerResponse, status: number, body: string, type: string): void {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(body)
}

const sendJson = (response: ServerResponse, status: number, body: unknown) =>
  send(response, status, JSON.stringify(body), 'application/json; charset=utf-8')

/** A POS rule or a mistake of the caller, as the control calls answer it. */
function failure(error: unknown): { status: number; message: string } {
  if (error instanceof WaiterOpError || error instanceof ScenarioFileError) {
    return { status: 400, message: error.message }
  }
  if (
    error instanceof PosRefusal ||
    error instanceof UndefinedBehaviour ||
    error instanceof SimSetupError
  ) {
    return { status: 409, message: error.message }
  }
  return { status: 500, message: 'the simulator failed' }
}

export interface SimServer {
  readonly server: Server
  readonly host: SimHost
  /** Starts listening; resolves with the port actually bound. */
  listen(port: number, hostname?: string): Promise<number>
  close(): Promise<void>
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/** Builds the server. Nothing listens until `listen`. */
export function createSimServer(options: SimServerOptions = {}): SimServer {
  const host = new SimHost(options)
  const token = options.token === undefined || options.token === '' ? null : options.token

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://sim-pos.localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'

    if (path === '/healthz') return send(response, 200, 'ok', 'text/plain; charset=utf-8')

    if (path.startsWith('/api/')) {
      const abort = new AbortController()
      response.on('close', () => abort.abort())
      const body = await readBody(request)
      try {
        const served = await serveWire(host.engine, {
          method,
          url: url.href,
          headers: Object.fromEntries(
            Object.entries(request.headers).flatMap(([name, value]) =>
              typeof value === 'string' ? [[name, value]] : [],
            ),
          ),
          body,
          signal: abort.signal,
        })
        return send(response, served.status, served.body, 'application/json; charset=utf-8')
      } catch (error) {
        // The caller gave up on a call that never answers: nothing is sent.
        if (error instanceof WireAborted) return
        throw error
      }
    }

    if (path === '/control' || path === '/control/') {
      return send(response, 200, CONTROL_PAGE, 'text/html; charset=utf-8')
    }

    if (path.startsWith('/control/api/')) {
      if (token !== null) {
        const given = request.headers[TOKEN_HEADER]
        if (!sameToken(typeof given === 'string' ? given : undefined, token)) {
          return sendJson(response, 401, { error: 'the control token is missing or wrong' })
        }
      }
      try {
        if (method === 'GET' && path === '/control/api/state') {
          return sendJson(response, 200, host.view())
        }
        if (method === 'POST' && path === '/control/api/scenario') {
          const parsed = JSON.parse((await readBody(request)) ?? '{}') as { name?: unknown }
          if (typeof parsed.name !== 'string') throw new WaiterOpError('name the scenario')
          host.load(parsed.name)
          return sendJson(response, 200, { loaded: host.scenario.name })
        }
        const op = /^\/control\/api\/waiter\/([a-z-]+)$/.exec(path)
        if (method === 'POST' && op?.[1] !== undefined) {
          const args = JSON.parse((await readBody(request)) ?? '{}')
          return sendJson(response, 200, { result: runWaiterOp(host.engine, op[1], args) })
        }
        return sendJson(response, 404, { error: 'no such control call' })
      } catch (error) {
        if (error instanceof SyntaxError) return sendJson(response, 400, { error: 'not JSON' })
        const { status, message } = failure(error)
        return sendJson(response, status, { error: message })
      }
    }

    return send(response, 404, 'not found', 'text/plain; charset=utf-8')
  }

  const server = createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'the simulator failed' })
      else response.end()
    })
  })

  return {
    server,
    host,
    listen(port, hostname = '127.0.0.1') {
      if (token === null && !LOOPBACK.has(hostname)) {
        return Promise.reject(
          new Error(
            `the simulator listens on ${hostname} only with a control token (SIM_POS_CONTROL_TOKEN)`,
          ),
        )
      }
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, hostname, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address !== null ? address.port : port)
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}
