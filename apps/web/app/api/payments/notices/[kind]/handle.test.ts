// The provider notice inbox (#108), with the simulator's verifier and a recorder in place of the
// database: a verified notice is stored once and answered 200 (a duplicate too); everything else
// is refused with its status and a reason code in the log, and nothing of the body, signature,
// headers or secret is ever logged.
import { createHmac } from 'node:crypto'

import type { RecordProviderNoticeInput } from '@restro/core/service/notices'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { noticeConnector } from '@/connectors/sim-pay/notices'

import { handleNotice, MAX_NOTICE_BYTES, type NoticeInbox, readCappedBody } from './handle'

const secret = 'whsec_sim_route_test'
const now = new Date('2026-10-26T12:00:00.000Z')
const t = Math.floor(now.getTime() / 1000)

const body = JSON.stringify({
  id: 'simevt_9',
  type: 'dispute.opened',
  account: 'simacct_1',
  object: 'simdispute_2',
  livemode: false,
})
const signature = (text: string, at = t) =>
  `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${text}`).digest('hex')}`
const post = (text: string, header: string | null = signature(text)) =>
  new Request('http://localhost/api/payments/notices/sim-pay', {
    method: 'POST',
    headers: header === null ? {} : { 'sim-pay-signature': header },
    body: text,
  })

let logs: string[]
let recorded: RecordProviderNoticeInput[]

function inbox(overrides: Partial<NoticeInbox> = {}): NoticeInbox {
  const seen = new Set<string>()
  return {
    env: { SIM_PAY_NOTICE_SECRET: secret },
    paymentsEnv: 'staging',
    connectorFor: (kind, env) =>
      kind === 'sim-pay' && noticeConnector.offered(env) ? noticeConnector : null,
    record: async (input) => {
      recorded.push(input)
      const key = `${input.providerKind}:${input.notice.id}`
      if (seen.has(key)) return 'duplicate'
      seen.add(key)
      return 'recorded'
    },
    newJobId: () => 'jb_test1',
    now: () => now,
    ...overrides,
  }
}

beforeEach(() => {
  logs = []
  recorded = []
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      logs.push(String(line))
    })
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

const events = () => logs.map((line) => JSON.parse(line) as Record<string, unknown>)

describe('the provider notice inbox', () => {
  it('stores a verified notice once and answers 200, a duplicate too', async () => {
    const box = inbox()
    expect((await handleNotice(post(body), 'sim-pay', box)).status).toBe(200)
    expect((await handleNotice(post(body), 'sim-pay', box)).status).toBe(200)
    expect(recorded).toEqual([
      {
        providerKind: 'sim-pay',
        live: false,
        notice: {
          id: 'simevt_9',
          type: 'dispute.opened',
          kind: 'dispute',
          accountRef: { provider: 'simacct_1' },
          objectRef: { provider: 'simdispute_2' },
        },
        jobId: 'jb_test1',
      },
      expect.objectContaining({ providerKind: 'sim-pay' }),
    ])
    expect(events()).toEqual([
      { level: 'info', event: 'payment_notice.recorded', kind: 'sim-pay', notice: 'dispute' },
      { level: 'info', event: 'payment_notice.duplicate', kind: 'sim-pay', notice: 'dispute' },
    ])
  })

  it('refuses unsigned, badly signed, stale, malformed and wrong-mode notices, storing none', async () => {
    const malformed = '{"id":"simevt_1"}'
    const live = body.replace('"livemode":false', '"livemode":true')
    const cases: [Request, string][] = [
      [post(body, null), 'unsigned'],
      [post(body, `t=${t},v1=${'0'.repeat(64)}`), 'bad_signature'],
      [post(body, signature(body, t - 301)), 'stale'],
      [post(malformed), 'malformed'],
      [post(live), 'wrong_mode'],
    ]
    for (const [request, reason] of cases) {
      // A wrong-mode notice is acknowledged, so the provider does not send it again for days.
      const status = reason === 'wrong_mode' ? 200 : 400
      expect((await handleNotice(request, 'sim-pay', inbox())).status, reason).toBe(status)
    }
    expect(recorded).toEqual([])
    expect(events()).toEqual(
      cases.map(([, reason]) => ({
        level: 'warn',
        event: 'payment_notice.refused',
        kind: 'sim-pay',
        reason,
      })),
    )
  })

  it('refuses a body over the cap, by its declared length or as it streams, with 413', async () => {
    const declared = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-length': String(MAX_NOTICE_BYTES + 1) },
      body: 'x',
    })
    expect((await handleNotice(declared, 'sim-pay', inbox())).status).toBe(413)
    const big = 'x'.repeat(MAX_NOTICE_BYTES + 1)
    const streamed = new Request('http://localhost/x', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    expect((await handleNotice(streamed, 'sim-pay', inbox())).status).toBe(413)
    expect(recorded).toEqual([])
    expect(events().map((e) => e.reason)).toEqual(['too_large', 'too_large'])
  })

  it('answers 404 for a kind it has no verifier for, the simulator in production included', async () => {
    expect((await handleNotice(post(body), 'other-pay', inbox())).status).toBe(404)
    const production = inbox({ paymentsEnv: 'production' })
    expect((await handleNotice(post(body), 'sim-pay', production)).status).toBe(404)
    expect(recorded).toEqual([])
  })

  it('answers 503 with no environment label or no secret, so the provider sends it again', async () => {
    expect((await handleNotice(post(body), 'sim-pay', inbox({ paymentsEnv: null }))).status).toBe(
      503,
    )
    expect((await handleNotice(post(body), 'sim-pay', inbox({ env: {} }))).status).toBe(503)
    expect(recorded).toEqual([])
    expect(events().map((e) => e.event)).toEqual([
      'payment_notice.not_configured',
      'payment_notice.not_configured',
    ])
  })

  it('answers 500 when the store fails, and logs only the error class', async () => {
    const failing = inbox({
      record: async () => {
        throw new Error('connection refused')
      },
    })
    expect((await handleNotice(post(body), 'sim-pay', failing)).status).toBe(500)
    expect(events()).toEqual([
      {
        level: 'error',
        event: 'payment_notice.store_failed',
        error: 'Error',
        message: 'connection refused',
      },
    ])
  })

  it('never logs the body, the signature, a header or the secret', async () => {
    await handleNotice(post(body), 'sim-pay', inbox())
    await handleNotice(post(body, `t=${t},v1=${'0'.repeat(64)}`), 'sim-pay', inbox())
    await handleNotice(post('{"id":"simevt_1"}'), 'sim-pay', inbox())
    const text = logs.join('\n')
    for (const secretish of [secret, 'simevt_9', 'simacct_1', 'simdispute_2', 'v1=', 't=']) {
      expect(text).not.toContain(secretish)
    }
  })
})

describe('the raw body', () => {
  it('is the text exactly as sent, byte-order mark included', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: '﻿{"a":1}' })
    expect(await readCappedBody(request, 100)).toBe('﻿{"a":1}')
  })

  it('is nothing for a body that is not UTF-8', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: new Uint8Array([0x7b, 0xff, 0x7d]),
    })
    expect(await readCappedBody(request, 100)).toBeNull()
  })
})
