// The web app's side of the worker's reveal endpoint (#70): what it asks, in batches, with the
// bearer token, and that any failure gives no codes and logs nothing of them. The worker is a fake.
import { MAX_REVEALED_CODES } from '@restro/core/service'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { revealFor } from './reveal'

const CONFIG = { url: 'http://worker.test:8081/', token: 'x'.repeat(40) }
const TARGET = {
  tenantId: 'tn_test',
  venueId: 'vn_test',
  actor: { userId: 'us_owner', sessionId: 'session-1' },
}
const code = (id: string) => `code${id}`

type Call = { url: string; init: RequestInit }

function worker(answer: (ids: string[]) => Response) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const body = JSON.parse(String(init.body)) as { tableIds: string[] }
    return answer(body.tableIds)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const accepting = (ids: string[]) =>
  Response.json({ status: 'accepted', codes: Object.fromEntries(ids.map((id) => [id, code(id)])) })

describe('the reveal client', () => {
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    errors.push(String(line))
  })
  afterEach(() => {
    errors.length = 0
    spy.mockClear()
  })

  it('asks the private endpoint with the bearer token, the venue and the person, never cached', async () => {
    const { calls, fetchImpl } = worker(accepting)
    const codes = await revealFor(CONFIG, TARGET, fetchImpl)(['tb_1', 'tb_2', 'tb_1'])
    expect([...codes]).toEqual([
      ['tb_1', code('tb_1')],
      ['tb_2', code('tb_2')],
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://worker.test:8081/internal/reveal')
    expect(calls[0]?.init).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${CONFIG.token}`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tenantId: 'tn_test',
      venueId: 'vn_test',
      tableIds: ['tb_1', 'tb_2'],
      actor: { kind: 'user', userId: 'us_owner', sessionId: 'session-1' },
    })
  })

  it(`asks in batches of ${MAX_REVEALED_CODES}`, async () => {
    const { calls, fetchImpl } = worker(accepting)
    const ids = Array.from({ length: MAX_REVEALED_CODES + 3 }, (_, index) => `tb_${index}`)
    const codes = await revealFor(CONFIG, TARGET, fetchImpl)(ids)
    expect(codes.size).toBe(ids.length)
    expect(calls.map((call) => JSON.parse(String(call.init.body)).tableIds.length)).toEqual([
      MAX_REVEALED_CODES,
      3,
    ])
  })

  it('asks nothing without the address, the token or any table', async () => {
    const { calls, fetchImpl } = worker(accepting)
    expect((await revealFor({ ...CONFIG, url: undefined }, TARGET, fetchImpl)(['tb_1'])).size).toBe(
      0,
    )
    expect(
      (await revealFor({ ...CONFIG, token: undefined }, TARGET, fetchImpl)(['tb_1'])).size,
    ).toBe(0)
    expect((await revealFor(CONFIG, TARGET, fetchImpl)([])).size).toBe(0)
    expect(calls).toEqual([])
  })

  it('gives no codes for a refusal, a failure or a strange answer, and logs none', async () => {
    const answers = [
      () => Response.json({ status: 'refused', code: 'permission_denied' }, { status: 403 }),
      () => new Response('nope', { status: 500 }),
      () => Response.json({ codes: { tb_1: code('tb_1') } }),
      () => {
        throw new TypeError('fetch failed')
      },
    ]
    for (const answer of answers) {
      const { fetchImpl } = worker(answer)
      expect((await revealFor(CONFIG, TARGET, fetchImpl)(['tb_1'])).size).toBe(0)
    }
    expect(errors.map((line) => JSON.parse(line).event)).toEqual([
      'table_code_reveal_refused',
      'table_code_reveal_failed',
      'table_code_reveal_failed',
      'table_code_reveal_failed',
    ])
    expect(errors.join('\n')).not.toContain(code('tb_1'))
    expect(errors.join('\n')).not.toContain(CONFIG.token)
  })

  it('leaves out a table the worker gives no code for', async () => {
    const { fetchImpl } = worker(() =>
      Response.json({ status: 'accepted', codes: { tb_1: code('tb_1'), tb_2: null } }),
    )
    const codes = await revealFor(CONFIG, TARGET, fetchImpl)(['tb_1', 'tb_2'])
    expect([...codes.keys()]).toEqual(['tb_1'])
  })
})
