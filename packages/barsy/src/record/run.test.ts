import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type BarsyFixture, fixtureSchema } from '../fixture.ts'
import { createBarsyMockServer } from '../testing/mock-server.ts'
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runRecorder } from './run.ts'

const PASSWORD = 'recorder-test-password'
const ENV = {
  BARSY_HOST: 'https://demo.barsyonline.com',
  BARSY_USER: 'demo',
  BARSY_PASSWORD: PASSWORD,
  BARSY_ENV: 'development',
}

function fixture(overrides: Partial<BarsyFixture> & Pick<BarsyFixture, 'method'>): BarsyFixture {
  return fixtureSchema.parse({
    params: {},
    bid: null,
    recordedAt: '2026-10-08T17:00:00.000Z',
    status: 200,
    requestId: '1:108914',
    body: '1',
    ...overrides,
  })
}

const mock = createBarsyMockServer([
  fixture({ method: 'Misc_ping' }),
  fixture({ method: 'Misc_ping_user' }),
])
beforeAll(() => mock.listen())
afterAll(() => mock.close())

let root: string
let out: string[]
let err: string[]
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'barsy-record-'))
  out = []
  err = []
})
afterEach(async () => {
  mock.reset()
  await rm(root, { recursive: true, force: true })
})

function record(argv: string[], env: Record<string, string | undefined> = ENV) {
  return runRecorder(argv, {
    env,
    fixturesRoot: root,
    now: () => new Date('2026-10-08T17:30:00.000Z'),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    logger: pino({ level: 'silent' }),
  })
}

async function files(): Promise<string[]> {
  const all: string[] = []
  for (const dir of await readdir(root).catch(() => [])) {
    for (const file of await readdir(join(root, dir))) all.push(`${dir}/${file}`)
  }
  return all.sort()
}

describe('barsy:record', () => {
  it('records Misc_ping_user as demo/misc-ping-user.json with exactly the documented fields', async () => {
    expect(await record(['--method', 'Misc_ping_user'])).toBe(EXIT_OK)
    expect(await files()).toStrictEqual(['demo/misc-ping-user.json'])

    const text = await readFile(join(root, 'demo', 'misc-ping-user.json'), 'utf8')
    expect(JSON.parse(text)).toStrictEqual({
      method: 'Misc_ping_user',
      params: {},
      bid: null,
      recordedAt: '2026-10-08T17:30:00.000Z',
      status: 200,
      requestId: '1:108914',
      body: '1',
    })
    expect(out.join('\n')).toContain('demo/misc-ping-user.json')
    expect(out.join('\n')).toContain('1:108914')
    // The call carried credentials; none of it may reach the file or the screen.
    const everything = `${text}${out.join('')}${err.join('')}`
    expect(everything).not.toContain(PASSWORD)
    expect(everything).not.toContain(Buffer.from(`demo:${PASSWORD}`).toString('base64'))
    expect(everything.toLowerCase()).not.toContain('authorization')
  })

  it('sends credentials only to the method that needs them', async () => {
    await record(['--method', 'Misc_ping'])
    await record(['--method', 'Misc_ping_user'])
    expect(mock.requests.map((request) => request.authorization === null)).toStrictEqual([
      true,
      false,
    ])
  })

  it('accepts the literal "--" that pnpm may pass through', async () => {
    expect(await record(['--', '--method', 'Misc_ping'])).toBe(EXIT_OK)
    expect(await files()).toStrictEqual(['demo/misc-ping.json'])
  })

  it('records --bid, --params and --name', async () => {
    const code = await record([
      '--method',
      'Misc_ping',
      '--bid',
      '7',
      '--params',
      '{"length":"1000"}',
      '--name',
      'ping-venue-7',
    ])
    expect(code).toBe(EXIT_OK)
    const saved = JSON.parse(await readFile(join(root, 'demo', 'ping-venue-7.json'), 'utf8'))
    expect(saved).toMatchObject({ bid: '7', params: { length: '1000' } })
    expect(mock.requests[0]).toMatchObject({
      url: 'https://demo.barsyonline.com/endpoints/json/Misc_ping?bid=7',
      params: { length: '1000' },
    })
  })

  it('records the body text exactly as received', async () => {
    mock.setFixtures([fixture({ method: 'Misc_ping', body: '{"actual_price": 2.40}\n' })])
    await record(['--method', 'Misc_ping'])
    const saved = JSON.parse(await readFile(join(root, 'demo', 'misc-ping.json'), 'utf8'))
    expect(saved.body).toBe('{"actual_price": 2.40}\n')
  })

  it('records a 401 as received (the shape of the auth error is what we want to learn)', async () => {
    mock.setFixtures([
      fixture({ method: 'Misc_ping_user', status: 401, body: '', requestId: null }),
    ])
    expect(await record(['--method', 'Misc_ping_user', '--name', 'ping-user-unauthorised'])).toBe(
      EXIT_OK,
    )
    const saved = JSON.parse(
      await readFile(join(root, 'demo', 'ping-user-unauthorised.json'), 'utf8'),
    )
    expect(saved).toMatchObject({ status: 401, body: '', requestId: null })
    expect(out.join('\n')).toContain('HTTP 401 was recorded as received')
  })

  it('refuses a method that is not on the read allowlist, before reading settings or sending anything', async () => {
    for (const method of ['Accounts_place', 'Articles_getlist', 'constructor', '']) {
      // An empty environment proves the check comes first: no settings are needed to be refused.
      expect(await record(['--method', method], {}), method).toBe(EXIT_USAGE)
      expect(err.join('\n')).toContain('read allowlist')
    }
    expect(mock.requests).toHaveLength(0)
    expect(await files()).toStrictEqual([])
  })

  it('requires --method', async () => {
    expect(await record([])).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--method is required')
  })

  it('prints usage for --help and for an unknown option', async () => {
    expect(await record(['--help'])).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('Usage:')
    expect(await record(['--method', 'Misc_ping', '--nope'])).toBe(EXIT_USAGE)
    expect(mock.requests).toHaveLength(0)
  })

  it('never overwrites a recording without --force', async () => {
    expect(await record(['--method', 'Misc_ping'])).toBe(EXIT_OK)
    mock.setFixtures([fixture({ method: 'Misc_ping', body: '2' })])
    expect(await record(['--method', 'Misc_ping'])).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--force')
    expect(JSON.parse(await readFile(join(root, 'demo', 'misc-ping.json'), 'utf8')).body).toBe('1')
    expect(await record(['--method', 'Misc_ping', '--force'])).toBe(EXIT_OK)
    expect(JSON.parse(await readFile(join(root, 'demo', 'misc-ping.json'), 'utf8')).body).toBe('2')
  })

  it('refuses a bad name, bad params and a bad bid before sending anything', async () => {
    expect(await record(['--method', 'Misc_ping', '--name', '../escape'])).toBe(EXIT_USAGE)
    expect(await record(['--method', 'Misc_ping', '--params', '{nope'])).toBe(EXIT_USAGE)
    expect(await record(['--method', 'Misc_ping', '--params', '5'])).toBe(EXIT_USAGE)
    expect(await record(['--method', 'Misc_ping', '--bid', ''])).toBe(EXIT_USAGE)
    expect(mock.requests).toHaveLength(0)
    expect(await files()).toStrictEqual([])
  })

  it('names the missing settings without echoing any value', async () => {
    const code = await record(['--method', 'Misc_ping'], {
      BARSY_HOST: 'demo.barsyonline.com',
      BARSY_PASSWORD: PASSWORD,
    })
    expect(code).toBe(EXIT_USAGE)
    const text = err.join('\n')
    expect(text).toContain('BARSY_USER')
    expect(text).toContain('BARSY_ENV')
    expect(text).not.toContain(PASSWORD)
  })

  it('refuses a host the environment may not use, before sending anything (rule 9)', async () => {
    const code = await record(['--method', 'Misc_ping', '--label', 'pilot-1'], {
      ...ENV,
      BARSY_HOST: 'club.example.bg',
      BARSY_ENV: 'staging',
    })
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('BARSY_ALLOWED_HOSTS')
    expect(mock.requests).toHaveLength(0)
    expect(await files()).toStrictEqual([])
  })

  it('needs --label pilot-<n> for a host other than the demo, and files it under that label', async () => {
    const club = createBarsyMockServer([fixture({ method: 'Misc_ping_user' })], {
      host: 'club.example.bg',
    })
    mock.close() // only one MSW server listens at a time
    club.listen()
    try {
      const env = { ...ENV, BARSY_HOST: 'club.example.bg', BARSY_ALLOWED_HOSTS: 'club.example.bg' }
      expect(await record(['--method', 'Misc_ping_user'], env)).toBe(EXIT_USAGE)
      expect(err.join('\n')).toContain('--label pilot-<n>')
      expect(club.requests).toHaveLength(0)

      expect(await record(['--method', 'Misc_ping_user', '--label', 'pilot-2'], env)).toBe(EXIT_OK)
      expect(await files()).toStrictEqual(['pilot-2/misc-ping-user.json'])
      // The customer's host name is not part of the file or of the path.
      const text = await readFile(join(root, 'pilot-2', 'misc-ping-user.json'), 'utf8')
      expect(text).not.toContain('club.example.bg')
    } finally {
      club.close()
      mock.listen()
    }
  })

  it('exits with a failure code, and writes nothing, when the call itself fails', async () => {
    const { http, HttpResponse } = await import('msw')
    mock.server.use(
      http.post('https://demo.barsyonline.com/endpoints/json/Misc_ping', () =>
        HttpResponse.error(),
      ),
    )
    expect(await record(['--method', 'Misc_ping'])).toBe(EXIT_FAILED)
    expect(err.join('\n')).toContain('could not be sent')
    expect(await files()).toStrictEqual([])
  })
})
