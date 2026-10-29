import { describe, expect, it } from 'vitest'

import { createLogger } from './logger'

function capture() {
  const lines: string[] = []
  return {
    destination: { write: (line: string) => void lines.push(line) },
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => lines.join(''),
  }
}

describe('createLogger', () => {
  it('writes one JSON object per line with level, time, name and message', async () => {
    const out = capture()
    const log = await createLogger({ level: 'info', pretty: false, destination: out.destination })
    log.info({ workerId: 'w1' }, 'hello')
    const [record] = out.records()
    expect(record).toMatchObject({ name: 'restro-worker', level: 30, msg: 'hello', workerId: 'w1' })
    expect(typeof record?.time).toBe('number')
  })

  it('honours the level', async () => {
    const out = capture()
    const log = await createLogger({ level: 'warn', pretty: false, destination: out.destination })
    log.info('quiet')
    log.warn('loud')
    expect(out.records().map((record) => record.msg)).toEqual(['loud'])
  })

  it('serialises `err` through describeError: no query parameters, no Postgres detail', async () => {
    const out = capture()
    const log = await createLogger({ level: 'info', pretty: false, destination: out.destination })
    const cause = Object.assign(new Error('null value in column "version"'), {
      code: '23502',
      detail: 'Failing row contains (SECRET-VALUE)',
    })
    const wrapper = Object.assign(new Error('Failed query: insert ...\nparams: SECRET-VALUE'), {
      query: 'insert ...',
      params: ['SECRET-VALUE'],
      cause,
    })
    log.error({ err: wrapper }, 'job failed')
    expect(out.text()).not.toContain('SECRET-VALUE')
    expect(out.records()[0]?.err).toMatchObject({ cause: { code: '23502' } })
  })

  it('redacts credentials a caller puts in a log object', async () => {
    const out = capture()
    const log = await createLogger({ level: 'info', pretty: false, destination: out.destination })
    log.info(
      { password: 'p1', connectionString: 'postgres://u:p2@h/db', config: { DATABASE_URL: 'p3' } },
      'config',
    )
    expect(out.text()).not.toMatch(/p1|p2|p3/)
    expect(out.records()[0]).toMatchObject({ password: '[redacted]' })
  })

  it('redacts a table code by name, in a request path and in its headers (#70)', async () => {
    const out = capture()
    const log = await createLogger({ level: 'info', pretty: false, destination: out.destination })
    const code = 'Ab3dEfGh1jKlMnOpQrStUv'
    log.info({ tableCode: code, result: { tableCodes: [code] } }, 'one')
    log.info(
      {
        req: {
          url: `/t/${code}`,
          headers: { 'x-table-code': code, authorization: `Bearer ${code}` },
        },
      },
      'two',
    )
    expect(out.text()).not.toContain(code)
  })
})
