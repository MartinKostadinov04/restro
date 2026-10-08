// The health endpoint, on node:http (no framework). Railway (and later an external uptime check)
// probes `GET /health`; the answer comes from memory (see health.ts), never from the database.
// Nothing else is served, and the body carries no host names, versions or ids.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { HealthReport } from './health'

export const HEALTH_PATH = '/health'

export interface HealthServer {
  /** The port actually listening (differs from the requested one only for port 0). */
  readonly port: number
  /** Stops listening and drops open connections. Resolves when the port is free. */
  close(): Promise<void>
}

/**
 * Starts listening on `port` (all interfaces, so another container can probe it) and answers
 * `GET /health` with `report()`. Rejects if the port cannot be bound.
 */
export function startHealthServer(port: number, report: () => HealthReport): Promise<HealthServer> {
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

    if (path !== HEALTH_PATH) {
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
