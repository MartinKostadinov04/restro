import { request } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import type { HealthReport } from './health'
import { type HealthServer, startHealthServer } from './health-server'

const OK: HealthReport = {
  httpStatus: 200,
  body: { status: 'ok', lastBeatAt: '2026-10-08T12:00:00.000Z', pgboss: 'started' },
}
const DOWN: HealthReport = {
  httpStatus: 503,
  body: {
    status: 'unavailable',
    lastBeatAt: null,
    pgboss: 'stopped',
    reason: 'pg-boss is stopped',
  },
}

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}

function call(port: number, path: string, method = 'GET'): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, agent: false }, (res) => {
      let text = ''
      res.on('data', (chunk) => {
        text += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('startHealthServer', () => {
  let server: HealthServer | undefined
  let report: HealthReport = OK

  afterEach(async () => {
    await server?.close()
    server = undefined
    report = OK
  })

  async function start() {
    server = await startHealthServer(0, () => report)
    return server.port
  }

  it('answers GET /health with the report: 200 while healthy, 503 otherwise', async () => {
    const port = await start()
    const healthy = await call(port, '/health')
    expect(healthy.status).toBe(200)
    expect(healthy.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(healthy.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(healthy.text)).toEqual(OK.body)

    report = DOWN
    const down = await call(port, '/health?probe=1')
    expect(down.status).toBe(503)
    expect(JSON.parse(down.text)).toEqual(DOWN.body)
  })

  it('answers HEAD with the status and no body', async () => {
    const port = await start()
    const answer = await call(port, '/health', 'HEAD')
    expect(answer.status).toBe(200)
    expect(answer.text).toBe('')
  })

  it('serves nothing else: 404 for other paths, 405 for other methods', async () => {
    const port = await start()
    expect((await call(port, '/')).status).toBe(404)
    expect((await call(port, '/health/extra')).status).toBe(404)
    const post = await call(port, '/health', 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
  })

  it('frees the port when closed', async () => {
    const port = await start()
    await server?.close()
    server = undefined
    await expect(call(port, '/health')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('rejects when the port is taken', async () => {
    const first = await startHealthServer(0, () => OK)
    try {
      await expect(startHealthServer(first.port, () => OK)).rejects.toMatchObject({
        code: 'EADDRINUSE',
      })
    } finally {
      await first.close()
    }
  })
})
