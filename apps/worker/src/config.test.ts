import { generateSealKeyPair } from '@restro/core/seal-open'
import { describe, expect, it } from 'vitest'

import { ConfigError, DEFAULT_HEALTH_PORT, loadConfig, requireSealKeys } from './config'

const URL = 'postgres://restro_app:s3cret-pw@localhost:54329/restro'
/** What the alerts' settings are when none is set (#83). */
const NO_ALERTS = { telegramToken: null, teamChatId: null, healthchecksUrl: null, vapid: null }
/** A made-up bot token in the shape Telegram's BotFather gives. */
const BOT_TOKEN = `123456789:${'A'.repeat(35)}`
/** An obviously fake reveal token, long enough for the 32-character minimum. */
const REVEAL_TOKEN = `test-reveal-token-${'x'.repeat(24)}`

/** The lines of the error `loadConfig` throws for `env`. */
function problemsOf(env: Record<string, string | undefined>, defaultWorkerId?: () => string) {
  let error: unknown
  try {
    loadConfig(env, defaultWorkerId)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ConfigError)
  const [heading, ...lines] = (error as Error).message.split('\n')
  expect(heading).toBe('Invalid worker configuration:')
  return lines.map((line) => line.replace(/^- /, ''))
}

describe('loadConfig', () => {
  it('applies the defaults', () => {
    expect(loadConfig({ DATABASE_URL: URL }, () => 'my-host')).toEqual({
      databaseUrl: URL,
      purgeDatabaseUrl: null,
      workerId: 'my-host',
      healthPort: DEFAULT_HEALTH_PORT,
      logLevel: 'info',
      prettyLogs: true,
      seal: null,
      barsy: { env: 'development', allowedHostSuffixes: ['.barsyonline.com'], productionHosts: [] },
      sim: { env: 'development', allowHosts: [] },
      // Local files under the repository's .local/assets unless told otherwise.
      assets: { kind: 'local', dir: expect.stringMatching(/\.local[\\/]assets$/) },
      // And the publish store under .local/cdn.
      publish: { kind: 'local', dir: expect.stringMatching(/\.local[\\/]cdn$/) },
      revealToken: null,
      billIdKey: null,
      posSync: true,
      send: true,
      alerts: NO_ALERTS,
      receiptEmail: null,
    })
    expect(DEFAULT_HEALTH_PORT).toBe(8081)
  })

  it('reads every setting', () => {
    expect(
      loadConfig({
        DATABASE_URL: ` ${URL} `,
        DATABASE_URL_PURGE: ' postgres://restro_purge:secret@localhost:5432/restro ',
        WORKER_ID: ' worker-a ',
        WORKER_HEALTH_PORT: '9090',
        LOG_LEVEL: 'DEBUG',
        NODE_ENV: 'production',
        ASSET_STORE: 'local',
        LOCAL_ASSET_DIR: '/data/assets',
        PUBLISH_STORE: 'local',
        LOCAL_PUBLISH_DIR: '/data/cdn',
        BARSY_ENV: ' Staging ',
        BARSY_ALLOWED_HOST_SUFFIXES: '.barsyonline.com, .barsy.test',
        BARSY_PRODUCTION_HOSTS: 'club.barsyonline.com,https://Other.barsyonline.com/',
        SIM_POS_ALLOWED_HOSTS: 'Demo.Restro.test, sim.staging.example',
        REVEAL_SERVICE_TOKEN: ` ${REVEAL_TOKEN} `,
        BILL_ID_KEY: ` ${'k'.repeat(40)} `,
        WORKER_POS_SYNC: ' OFF ',
        WORKER_SEND: ' On ',
      }),
    ).toEqual({
      databaseUrl: URL,
      purgeDatabaseUrl: 'postgres://restro_purge:secret@localhost:5432/restro',
      workerId: 'worker-a',
      healthPort: 9090,
      logLevel: 'debug',
      prettyLogs: false,
      seal: null,
      barsy: {
        env: 'staging',
        allowedHostSuffixes: ['.barsyonline.com', '.barsy.test'],
        productionHosts: ['club.barsyonline.com', 'other.barsyonline.com'],
      },
      // NODE_ENV is production here, so the simulated POS is refused whatever BARSY_ENV says.
      sim: { env: 'production', allowHosts: ['demo.restro.test', 'sim.staging.example'] },
      assets: { kind: 'local', dir: expect.stringMatching(/assets$/) },
      publish: { kind: 'local', dir: expect.stringMatching(/cdn$/) },
      revealToken: REVEAL_TOKEN,
      billIdKey: 'k'.repeat(40),
      posSync: false,
      send: true,
      alerts: NO_ALERTS,
      receiptEmail: null,
    })
    // Unset, the Send follows the sync.
    expect(loadConfig({ DATABASE_URL: URL, WORKER_POS_SYNC: 'off' }).send).toBe(false)
  })

  it('reads the alerts’ settings (#83) and keeps the secrets out of the errors', () => {
    const vapid = {
      VAPID_PUBLIC_KEY: `B${'p'.repeat(86)}`,
      VAPID_PRIVATE_KEY: 'q'.repeat(43),
      VAPID_SUBJECT: 'mailto:ops@restro.example',
    }
    expect(
      loadConfig({
        DATABASE_URL: URL,
        TELEGRAM_BOT_TOKEN: ` ${BOT_TOKEN} `,
        TELEGRAM_TEAM_CHAT_ID: ' -1001234567890 ',
        HEALTHCHECKS_PING_URL: ' https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee ',
        ...vapid,
      }).alerts,
    ).toEqual({
      telegramToken: BOT_TOKEN,
      teamChatId: '-1001234567890',
      healthchecksUrl: 'https://hc-ping.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      vapid: {
        publicKey: vapid.VAPID_PUBLIC_KEY,
        privateKey: vapid.VAPID_PRIVATE_KEY,
        subject: vapid.VAPID_SUBJECT,
      },
    })

    const lines = problemsOf({
      DATABASE_URL: URL,
      TELEGRAM_BOT_TOKEN: 'not-a-token-s3cret',
      TELEGRAM_TEAM_CHAT_ID: 'my-chat',
      HEALTHCHECKS_PING_URL: 'http://hc-ping.com/plain',
      VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY,
    })
    expect(lines.map((line) => line.split(' ')[0])).toEqual([
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_TEAM_CHAT_ID',
      'HEALTHCHECKS_PING_URL',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ])
    expect(lines.join('\n')).not.toMatch(/s3cret|my-chat|plain/)
  })

  it('reads the receipt email settings (#186), both or none, and keeps the key out of the errors', () => {
    const key = `re_${'k'.repeat(30)}`
    const from = 'receipts@mail.restro.example'
    expect(
      loadConfig({
        DATABASE_URL: URL,
        RESEND_API_KEY: ` ${key} `,
        RECEIPT_FROM_ADDRESS: ` ${from} `,
      }).receiptEmail,
    ).toEqual({ apiKey: key, fromAddress: from })
    const names = (env: Record<string, string>) =>
      problemsOf({ DATABASE_URL: URL, ...env }).map((line) => line.split(' ')[0])
    expect(names({ RESEND_API_KEY: key })).toEqual(['RECEIPT_FROM_ADDRESS'])
    expect(names({ RECEIPT_FROM_ADDRESS: from })).toEqual(['RESEND_API_KEY'])
    const lines = problemsOf({
      DATABASE_URL: URL,
      RESEND_API_KEY: 'sk-s3cret-not-a-resend-key',
      RECEIPT_FROM_ADDRESS: 'not-an-address-s3cret',
    })
    expect(lines.map((line) => line.split(' ')[0])).toEqual([
      'RESEND_API_KEY',
      'RECEIPT_FROM_ADDRESS',
    ])
    expect(lines.join('\n')).not.toMatch(/s3cret/)
  })

  it('refuses the simulated POS in production, by NODE_ENV or by BARSY_ENV, and nowhere else', () => {
    const stores = {
      ASSET_STORE: 'local',
      LOCAL_ASSET_DIR: '/data/assets',
      PUBLISH_STORE: 'local',
      LOCAL_PUBLISH_DIR: '/data/cdn',
    }
    expect(loadConfig({ DATABASE_URL: URL, NODE_ENV: 'production', ...stores }).sim.env).toBe(
      'production',
    )
    expect(loadConfig({ DATABASE_URL: URL, BARSY_ENV: 'production' }).sim.env).toBe('production')
    expect(loadConfig({ DATABASE_URL: URL, BARSY_ENV: 'staging' }).sim.env).toBe('staging')
    expect(loadConfig({ DATABASE_URL: URL, BARSY_ENV: 'test' }).sim.env).toBe('test')
    expect(loadConfig({ DATABASE_URL: URL }).sim).toEqual({ env: 'development', allowHosts: [] })
  })

  it('refuses a short reveal token or bill-id key and an unknown WORKER_POS_SYNC, without repeating them', () => {
    const lines = problemsOf({
      DATABASE_URL: URL,
      REVEAL_SERVICE_TOKEN: 'short-token',
      BILL_ID_KEY: 'short-key',
      WORKER_POS_SYNC: 'sometimes',
    })
    expect(lines.map((line) => line.split(' ')[0])).toEqual([
      'REVEAL_SERVICE_TOKEN',
      'BILL_ID_KEY',
      'WORKER_POS_SYNC',
    ])
    expect(lines.join('\n')).not.toMatch(/short-token|short-key|sometimes/)
  })

  it('refuses unusable barsy and asset settings by name, without repeating the values', () => {
    expect(problemsOf({ DATABASE_URL: URL, BARSY_ENV: 'live' })).toEqual([
      'BARSY_ENV must be one of: development, test, staging, production.',
    ])
    const problems = problemsOf({
      DATABASE_URL: URL,
      BARSY_ALLOWED_HOST_SUFFIXES: 'barsyonline.com',
      BARSY_PRODUCTION_HOSTS: 'http://club.example/path?token=s3cret',
    })
    expect(problems).toEqual([
      'BARSY_ALLOWED_HOST_SUFFIXES must be a comma-separated list of host suffixes that start with a dot, e.g. .barsyonline.com.',
      'BARSY_PRODUCTION_HOSTS must be a comma-separated list of bare host names (no scheme, port or path).',
    ])
    expect(problems.join('\n')).not.toContain('s3cret')
  })

  it('production needs an asset store, and R2 needs its settings', () => {
    expect(problemsOf({ DATABASE_URL: URL, NODE_ENV: 'production' })).toEqual([
      'ASSET_STORE must be set to "local" or "r2" in production.',
    ])
    const r2 = problemsOf({ DATABASE_URL: URL, ASSET_STORE: 'r2', R2_BUCKET: 'bucket-secret-name' })
    expect(r2).toHaveLength(1)
    expect(r2[0]).toContain('R2_ACCOUNT_ID')
    expect(r2[0]).not.toContain('bucket-secret-name')
  })

  it('production needs a publish store too, and R2 needs its public bucket', () => {
    expect(problemsOf({ DATABASE_URL: URL, NODE_ENV: 'production', ASSET_STORE: 'local' })).toEqual(
      ['PUBLISH_STORE must be set to "local" or "r2" in production.'],
    )
    const r2 = problemsOf({
      DATABASE_URL: URL,
      PUBLISH_STORE: 'r2',
      R2_ACCOUNT_ID: '0123456789abcdef',
      R2_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE',
      R2_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
    })
    expect(r2).toHaveLength(1)
    expect(r2[0]).toContain('R2_PUBLIC_BUCKET')
    expect(r2[0]).not.toContain('AKIAFAKEFAKEFAKE')
  })

  it('accepts postgresql:// too', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://u:p@h/db' })).not.toThrow()
  })

  it('treats blank optional settings as unset', () => {
    expect(
      loadConfig(
        { DATABASE_URL: URL, WORKER_ID: '  ', WORKER_HEALTH_PORT: '', LOG_LEVEL: ' ' },
        () => 'my-host',
      ),
    ).toMatchObject({ workerId: 'my-host', healthPort: DEFAULT_HEALTH_PORT, logLevel: 'info' })
  })

  it('ignores variables it does not know, and any NODE_ENV but production means pretty logs', () => {
    const base = { DATABASE_URL: URL, SOMETHING_ELSE: 'x' }
    expect(loadConfig(base).prettyLogs).toBe(true)
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).prettyLogs).toBe(true)
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).prettyLogs).toBe(true)
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        ASSET_STORE: 'local',
        PUBLISH_STORE: 'local',
      }).prettyLogs,
    ).toBe(false)
  })

  it('names every problem and never repeats the connection string', () => {
    const bad = 'mysql://restro_app:s3cret-pw@localhost/restro'
    const problems = problemsOf({
      DATABASE_URL: bad,
      WORKER_HEALTH_PORT: '70000',
      LOG_LEVEL: 'loud',
    })
    expect(problems).toEqual([
      'DATABASE_URL must be a postgres:// or postgresql:// URL.',
      'WORKER_HEALTH_PORT must be a whole number from 1 to 65535.',
      'LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent.',
    ])
    expect(problems.join('\n')).not.toContain('s3cret-pw')
  })

  it('requires DATABASE_URL, with one problem line whether it is missing or blank', () => {
    const expected = [
      'DATABASE_URL is not set. It is the connection string of the app role restro_app ' +
        '(local: see .env.example).',
    ]
    expect(problemsOf({})).toEqual(expected)
    expect(problemsOf({ DATABASE_URL: '' })).toEqual(expected)
    expect(problemsOf({ DATABASE_URL: '   ' })).toEqual(expected)
  })

  it('reports problems in several variables at once', () => {
    const problems = problemsOf({ WORKER_ID: 'x'.repeat(129), WORKER_HEALTH_PORT: 'abc' })
    expect(problems.map((line) => line.split(' ')[0])).toEqual([
      'DATABASE_URL',
      'WORKER_ID',
      'WORKER_HEALTH_PORT',
    ])
  })

  it.each(['0', '-1', '80.5', 'abc', '65536', '1e3', '0x50', '9'.repeat(400)])(
    'rejects WORKER_HEALTH_PORT=%s',
    (port) => {
      expect(problemsOf({ DATABASE_URL: URL, WORKER_HEALTH_PORT: port })).toEqual([
        'WORKER_HEALTH_PORT must be a whole number from 1 to 65535.',
      ])
    },
  )

  it.each(['1', '8081', '65535', ' 443 '])('accepts WORKER_HEALTH_PORT=%s', (port) => {
    expect(loadConfig({ DATABASE_URL: URL, WORKER_HEALTH_PORT: port }).healthPort).toBe(
      Number(port),
    )
  })

  it.each(['FATAL', 'Error', ' warn ', 'silent'])('accepts LOG_LEVEL=%s', (level) => {
    expect(loadConfig({ DATABASE_URL: URL, LOG_LEVEL: level }).logLevel).toBe(
      level.trim().toLowerCase(),
    )
  })

  it('rejects an over-long WORKER_ID without repeating it', () => {
    const id = `id-${'x'.repeat(129)}`
    const problems = problemsOf({ DATABASE_URL: URL, WORKER_ID: id })
    expect(problems).toEqual(['WORKER_ID must be 1 to 128 characters.'])
    expect(problems.join('\n')).not.toContain(id)
  })

  it('rejects a default worker id that is empty or too long', () => {
    expect(problemsOf({ DATABASE_URL: URL }, () => '')).toEqual([
      'WORKER_ID must be 1 to 128 characters.',
    ])
    expect(problemsOf({ DATABASE_URL: URL }, () => 'h'.repeat(129))).toEqual([
      'WORKER_ID must be 1 to 128 characters.',
    ])
  })

  it('does not ask for the default worker id when WORKER_ID is set', () => {
    const config = loadConfig({ DATABASE_URL: URL, WORKER_ID: 'w1' }, () => {
      throw new Error('should not be called')
    })
    expect(config.workerId).toBe('w1')
  })

  describe('SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY', () => {
    const keys = generateSealKeyPair()
    const other = generateSealKeyPair()
    const base = { DATABASE_URL: URL }

    it('reads the pair as KeyObjects that belong together', () => {
      const config = loadConfig({
        ...base,
        SEAL_PUBLIC_KEY: ` ${keys.publicKey} `,
        SEAL_PRIVATE_KEY: keys.privateKey,
      })
      expect(config.seal?.publicKey.type).toBe('public')
      expect(config.seal?.privateKey.type).toBe('private')
      expect(config.seal?.privateKey.asymmetricKeyType).toBe('x25519')
      expect(requireSealKeys(config)).toBe(config.seal)
      // Logging the config can never print the private key.
      expect(JSON.stringify(config)).not.toContain(keys.privateKey)
    })

    it('is optional until the sync jobs need it (requireSealKeys)', () => {
      const config = loadConfig({ ...base, SEAL_PUBLIC_KEY: '', SEAL_PRIVATE_KEY: '  ' })
      expect(config.seal).toBeNull()
      expect(() => requireSealKeys(config)).toThrow(ConfigError)
      expect(() => requireSealKeys(config)).toThrow(/SEAL_PRIVATE_KEY is not set/)
    })

    it('needs both halves, of one pair, in the right formats, and never repeats a key', () => {
      expect(problemsOf({ ...base, SEAL_PUBLIC_KEY: keys.publicKey })).toEqual([
        'SEAL_PRIVATE_KEY is not set. It goes with SEAL_PUBLIC_KEY (pnpm keys:seal).',
      ])
      expect(problemsOf({ ...base, SEAL_PRIVATE_KEY: keys.privateKey })).toEqual([
        'SEAL_PUBLIC_KEY is not set. It goes with SEAL_PRIVATE_KEY (pnpm keys:seal).',
      ])
      const mismatched = problemsOf({
        ...base,
        SEAL_PUBLIC_KEY: keys.publicKey,
        SEAL_PRIVATE_KEY: other.privateKey,
      })
      expect(mismatched).toEqual(['SEAL_PRIVATE_KEY is not the private half of SEAL_PUBLIC_KEY.'])
      const swapped = problemsOf({
        ...base,
        SEAL_PUBLIC_KEY: keys.privateKey,
        SEAL_PRIVATE_KEY: keys.publicKey,
      })
      expect(swapped.map((line) => line.split(' ')[0])).toEqual([
        'SEAL_PUBLIC_KEY',
        'SEAL_PRIVATE_KEY',
      ])
      for (const line of [...mismatched, ...swapped]) {
        for (const key of [keys.publicKey, keys.privateKey, other.privateKey]) {
          expect(line).not.toContain(key)
        }
      }
    })
  })

  it('never repeats a value in its messages, whatever the variable', () => {
    const secret = 's3cret-value'
    const lines = problemsOf({
      DATABASE_URL: `mysql://u:${secret}@h/db`,
      WORKER_ID: secret.repeat(20),
      WORKER_HEALTH_PORT: secret,
      LOG_LEVEL: secret,
      SEAL_PUBLIC_KEY: secret,
      SEAL_PRIVATE_KEY: secret,
    })
    expect(lines).toHaveLength(6)
    expect(lines.join('\n')).not.toContain(secret)
  })
})
