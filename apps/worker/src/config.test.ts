import { describe, expect, it } from 'vitest'

import { ConfigError, DEFAULT_HEALTH_PORT, loadConfig } from './config'

const URL = 'postgres://restro_app:s3cret-pw@localhost:54329/restro'

describe('loadConfig', () => {
  it('applies the defaults', () => {
    expect(loadConfig({ DATABASE_URL: URL }, () => 'my-host')).toEqual({
      databaseUrl: URL,
      workerId: 'my-host',
      healthPort: DEFAULT_HEALTH_PORT,
      logLevel: 'info',
      prettyLogs: true,
    })
    expect(DEFAULT_HEALTH_PORT).toBe(8081)
  })

  it('reads every setting', () => {
    expect(
      loadConfig({
        DATABASE_URL: ` ${URL} `,
        WORKER_ID: ' worker-a ',
        WORKER_HEALTH_PORT: '9090',
        LOG_LEVEL: 'DEBUG',
        NODE_ENV: 'production',
      }),
    ).toEqual({
      databaseUrl: URL,
      workerId: 'worker-a',
      healthPort: 9090,
      logLevel: 'debug',
      prettyLogs: false,
    })
  })

  it('accepts postgresql:// too', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://u:p@h/db' })).not.toThrow()
  })

  it('names every problem and never repeats the connection string', () => {
    const bad = 'mysql://restro_app:s3cret-pw@localhost/restro'
    let error: unknown
    try {
      loadConfig({ DATABASE_URL: bad, WORKER_HEALTH_PORT: '70000', LOG_LEVEL: 'loud' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConfigError)
    const message = (error as Error).message
    expect(message).toContain('DATABASE_URL must be a postgres://')
    expect(message).toContain('WORKER_HEALTH_PORT')
    expect(message).toContain('LOG_LEVEL')
    expect(message).not.toContain('s3cret-pw')
  })

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is not set/)
    expect(() => loadConfig({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL is not set/)
  })

  it.each(['0', '-1', '80.5', 'abc', '65536', '1e3'])('rejects WORKER_HEALTH_PORT=%s', (port) => {
    expect(() => loadConfig({ DATABASE_URL: URL, WORKER_HEALTH_PORT: port })).toThrow(
      /WORKER_HEALTH_PORT/,
    )
  })

  it('rejects an over-long WORKER_ID', () => {
    expect(() => loadConfig({ DATABASE_URL: URL, WORKER_ID: 'x'.repeat(129) })).toThrow(/WORKER_ID/)
  })
})
