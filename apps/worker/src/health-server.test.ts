import { request } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import type { HealthReport } from './health'
import { type HealthServer, type RevealHandler, startHealthServer } from './health-server'
import type { RevealRequest } from './reveal'

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

function call(
  port: number,
  path: string,
  method = 'GET',
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, agent: false, headers: options.headers },
      (res) => {
        let text = ''
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }))
      },
    )
    req.on('error', reject)
    req.end(options.body)
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

  describe('the reveal endpoint (#70)', () => {
    const TOKEN = 'a-service-token-of-at-least-32-characters'
    const REQUEST: RevealRequest = {
      tenantId: 'tn_0000000000000000000001',
      venueId: 'vn_0000000000000000000001',
      tableIds: ['tb_0000000000000000000001'],
      actor: { kind: 'user', userId: 'user-1', sessionId: 'session-1' },
    }
    const asked: RevealRequest[] = []
    const failures: unknown[] = []
    const handler: RevealHandler = {
      token: TOKEN,
      reveal: async (request) => {
        asked.push(request)
        if (request.actor.userId === 'refused') return { status: 'refused', code: 'forbidden' }
        if (request.actor.userId === 'throws') throw new Error('boom')
        return {
          status: 'accepted',
          codes: { [request.tableIds[0] ?? '']: 'Ab3dEfGh1jKlMnOpQrStUv' },
        }
      },
      failed: (error) => void failures.push(error),
    }
    const reveal = (
      port: number,
      options: { host?: string; token?: string | null; body?: unknown; method?: string } = {},
    ) => {
      const headers: Record<string, string> = {
        host: options.host ?? `localhost:${port}`,
        'content-type': 'application/json',
      }
      if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`
      const body = options.body === undefined ? JSON.stringify(REQUEST) : options.body
      return call(port, '/internal/reveal', options.method ?? 'POST', {
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      })
    }

    afterEach(() => {
      asked.length = 0
      failures.length = 0
    })

    it('does not exist until a handler is set, nor after it is taken away', async () => {
      const port = await start()
      expect((await reveal(port)).status).toBe(404)
      server?.setRevealHandler(handler)
      expect((await reveal(port)).status).toBe(200)
      server?.setRevealHandler(null)
      expect((await reveal(port)).status).toBe(404)
    })

    it('answers only a private host name: localhost or *.railway.internal', async () => {
      const port = await start()
      server?.setRevealHandler(handler)
      expect((await reveal(port, { host: 'worker.railway.internal:8081' })).status).toBe(200)
      expect((await reveal(port, { host: 'restro-worker.up.railway.app' })).status).toBe(404)
      expect((await reveal(port, { host: 'evil.railway.internal.example.com' })).status).toBe(404)
      expect(asked).toHaveLength(1)
    })

    it('needs POST and the service token, compared exactly', async () => {
      const port = await start()
      server?.setRevealHandler(handler)
      const get = await reveal(port, { method: 'GET', body: '' })
      expect(get.status).toBe(405)
      expect(get.headers.allow).toBe('POST')
      expect((await reveal(port, { token: null })).status).toBe(401)
      expect((await reveal(port, { token: `${TOKEN}x` })).status).toBe(401)
      expect((await reveal(port, { token: '' })).status).toBe(401)
      expect(asked).toEqual([])
    })

    it('refuses a malformed or over-long body before asking the handler', async () => {
      const port = await start()
      server?.setRevealHandler(handler)
      expect((await reveal(port, { body: 'not json' })).status).toBe(400)
      expect((await reveal(port, { body: { ...REQUEST, tableIds: [] } })).status).toBe(400)
      expect((await reveal(port, { body: { ...REQUEST, extra: 1 } })).status).toBe(400)
      expect((await reveal(port, { body: 'x'.repeat(40 * 1024) })).status).toBe(413)
      expect(asked).toEqual([])
    })

    it('answers the codes with no-store; a refusal is 403 and a failure 500, with no detail', async () => {
      const port = await start()
      server?.setRevealHandler(handler)
      const accepted = await reveal(port)
      expect(accepted.status).toBe(200)
      expect(accepted.headers['cache-control']).toBe('no-store')
      expect(JSON.parse(accepted.text)).toEqual({
        status: 'accepted',
        codes: { tb_0000000000000000000001: 'Ab3dEfGh1jKlMnOpQrStUv' },
      })
      const refused = await reveal(port, {
        body: { ...REQUEST, actor: { ...REQUEST.actor, userId: 'refused' } },
      })
      expect(refused.status).toBe(403)
      expect(JSON.parse(refused.text)).toEqual({ status: 'refused', code: 'forbidden' })
      const failed = await reveal(port, {
        body: { ...REQUEST, actor: { ...REQUEST.actor, userId: 'throws' } },
      })
      expect(failed.status).toBe(500)
      expect(failed.text).not.toContain('boom')
      expect(failures).toHaveLength(1)
    })
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
