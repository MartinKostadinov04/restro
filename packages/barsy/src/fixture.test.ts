import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BarsyConfigError } from './errors.ts'
import {
  assertFixtureName,
  type BarsyFixture,
  defaultFixtureName,
  fixtureHostLabel,
  fixtureSchema,
  serialiseFixture,
} from './fixture.ts'
import { FIXTURES_ROOT, readFixture, readFixtureDir, writeFixture } from './fixture-files.ts'

const RECORDED: BarsyFixture = {
  method: 'Misc_ping_user',
  params: {},
  bid: '1',
  recordedAt: '2026-10-08T17:00:00.000Z',
  status: 200,
  requestId: '1:108914',
  body: '1',
}

describe('fixtureSchema', () => {
  it('accepts a recording and a handmade fixture', () => {
    expect(fixtureSchema.parse(RECORDED)).toStrictEqual(RECORDED)
    const handmade = { ...RECORDED, bid: null, recordedAt: null, requestId: null, handmade: true }
    expect(fixtureSchema.parse(handmade)).toStrictEqual(handmade)
  })

  it('only lets a handmade fixture have no recording time', () => {
    expect(() => fixtureSchema.parse({ ...RECORDED, recordedAt: null })).toThrow()
  })

  it('rejects unknown keys, so headers or credentials cannot sneak into a fixture', () => {
    expect(() => fixtureSchema.parse({ ...RECORDED, headers: { authorization: 'x' } })).toThrow()
    expect(() => fixtureSchema.parse({ ...RECORDED, password: 'x' })).toThrow()
  })

  it('rejects a bad method name, status or timestamp', () => {
    expect(() => fixtureSchema.parse({ ...RECORDED, method: '../x' })).toThrow()
    expect(() => fixtureSchema.parse({ ...RECORDED, status: 99 })).toThrow()
    expect(() => fixtureSchema.parse({ ...RECORDED, recordedAt: 'yesterday' })).toThrow()
  })
})

describe('fixtureHostLabel', () => {
  it('labels the demo host "demo", however it is written', () => {
    expect(fixtureHostLabel('demo.barsyonline.com')).toBe('demo')
    expect(fixtureHostLabel('https://demo.barsyonline.com/')).toBe('demo')
    expect(fixtureHostLabel('demo.barsyonline.com', 'demo')).toBe('demo')
  })

  it('needs an explicit pilot-<n> label for any other host', () => {
    expect(fixtureHostLabel('club.example.bg', 'pilot-1')).toBe('pilot-1')
    expect(fixtureHostLabel('club.example.bg', 'pilot-12')).toBe('pilot-12')
    expect(() => fixtureHostLabel('club.example.bg')).toThrow(/--label pilot-<n>/)
    for (const bad of ['demo', 'pilot-0', 'pilot-', 'pilot-01', 'club', '../pilot-1', 'Pilot-1']) {
      expect(() => fixtureHostLabel('club.example.bg', bad), bad).toThrow(BarsyConfigError)
    }
  })

  it('refuses another label for the demo host', () => {
    expect(() => fixtureHostLabel('demo.barsyonline.com', 'pilot-1')).toThrow(BarsyConfigError)
  })

  it('never puts a customer host name in the label', () => {
    expect(fixtureHostLabel('secret-club.example.bg', 'pilot-3')).not.toContain('secret')
  })
})

describe('names', () => {
  it('derives the default file name from the method', () => {
    expect(defaultFixtureName('Misc_ping_user')).toBe('misc-ping-user')
    expect(defaultFixtureName('Misc_ping')).toBe('misc-ping')
  })

  it('accepts only lowercase letters, digits and dashes', () => {
    expect(assertFixtureName('ping-user-unauthorised')).toBe('ping-user-unauthorised')
    for (const bad of ['', '../x', 'a/b', 'A', 'a b', '-a', 'a.json', 'a\\b']) {
      expect(() => assertFixtureName(bad), bad).toThrow(BarsyConfigError)
    }
  })
})

describe('fixture files', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'barsy-fixtures-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes <root>/<label>/<name>.json, round-trips, and ends with a newline', async () => {
    const path = await writeFixture(RECORDED, { root, label: 'demo', name: 'misc-ping-user' })
    expect(path).toBe(join(root, 'demo', 'misc-ping-user.json'))
    const text = await readFile(path, 'utf8')
    expect(text).toBe(serialiseFixture(RECORDED))
    expect(text.endsWith('}\n')).toBe(true)
    expect(Object.keys(JSON.parse(text))).toStrictEqual([
      'method',
      'params',
      'bid',
      'recordedAt',
      'status',
      'requestId',
      'body',
    ])
    expect(await readFixture(path)).toStrictEqual(RECORDED)
  })

  it('keeps the body text byte for byte', async () => {
    const body = '{"actual_price": 2.40,\n "n": 12345678901234567890}'
    const path = await writeFixture({ ...RECORDED, body }, { root, label: 'demo', name: 'prices' })
    expect((await readFixture(path)).body).toBe(body)
  })

  it('never overwrites a recording unless told to', async () => {
    await writeFixture(RECORDED, { root, label: 'demo', name: 'x' })
    await expect(
      writeFixture({ ...RECORDED, body: '2' }, { root, label: 'demo', name: 'x' }),
    ).rejects.toThrow(/--force/)
    expect((await readFixture(join(root, 'demo', 'x.json'))).body).toBe('1')
    await writeFixture({ ...RECORDED, body: '2' }, { root, label: 'demo', name: 'x', force: true })
    expect((await readFixture(join(root, 'demo', 'x.json'))).body).toBe('2')
  })

  it('refuses a file name that would leave the folder', async () => {
    await expect(
      writeFixture(RECORDED, { root, label: 'demo', name: '../escape' }),
    ).rejects.toThrow(BarsyConfigError)
  })

  it('names the file, not its contents, when a fixture is malformed', async () => {
    const path = await writeFixture(RECORDED, { root, label: 'demo', name: 'x' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, '{"method": "secret-looking-value", "status": "nope"}')
    const error = await readFixture(path).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyConfigError)
    expect((error as Error).message).toContain(path)
    expect((error as Error).message).not.toContain('secret-looking-value')
  })
})

describe('the committed handmade fixtures', () => {
  const dir = join(FIXTURES_ROOT, 'handmade')

  it('are all marked handmade, carry a note, and have no recording time', async () => {
    for (const name of ['ping-ok', 'ping-user-ok', 'ping-user-unauthorised']) {
      const fixture = await readFixture(join(dir, `${name}.json`))
      expect(fixture.handmade, name).toBe(true)
      expect(fixture.note, name).toMatch(/^HANDMADE/)
      expect(fixture.recordedAt, name).toBeNull()
      expect(fixture.requestId, name).toBeNull()
    }
  })

  it('ping-ok is Misc_ping answering 1', async () => {
    expect(await readFixture(join(dir, 'ping-ok.json'))).toMatchObject({
      method: 'Misc_ping',
      status: 200,
      body: '1',
    })
  })

  it('ping-user-unauthorised is Misc_ping_user answering 401 with an empty body', async () => {
    expect(await readFixture(join(dir, 'ping-user-unauthorised.json'))).toMatchObject({
      method: 'Misc_ping_user',
      status: 401,
      body: '',
    })
  })

  it('readFixtureDir loads the whole folder', async () => {
    const all = await readFixtureDir(dir)
    expect(all.map((fixture) => fixture.method).sort()).toStrictEqual([
      'Misc_ping',
      'Misc_ping_user',
      'Misc_ping_user',
    ])
  })
})
