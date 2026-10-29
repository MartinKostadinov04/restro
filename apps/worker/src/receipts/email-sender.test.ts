import { describe, expect, it } from 'vitest'

import {
  createFakeEmailSender,
  createResendSender,
  EmailSendError,
  receiptWords,
  senderName,
} from './email-sender'

const KEY = `re_${'k'.repeat(30)}`
const GUEST = 'guest-secret@example.test'
const FILE = {
  filename: 'receipt-0000001.pdf',
  contentType: 'application/pdf',
  contentBase64: Buffer.from('%PDF-1.4 the POS made this').toString('base64'),
} as const

interface Call {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Record<string, unknown>
}

function fakeFetch(reply: { status?: number; json?: unknown } | 'throw') {
  const calls: Call[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    if (reply === 'throw') throw new Error(`connect ECONNREFUSED for ${GUEST} with ${KEY}`)
    return new Response(JSON.stringify(reply.json ?? { id: 'em_1' }), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

function sender(reply: Parameters<typeof fakeFetch>[0]) {
  const { calls, fetchImpl } = fakeFetch(reply)
  return {
    calls,
    sender: createResendSender({
      apiKey: KEY,
      fromAddress: 'receipts@mail.restro.example',
      fetch: fetchImpl,
    }),
  }
}

const MESSAGE = {
  to: GUEST,
  venueName: 'Club "Нощ"',
  file: FILE,
  idempotencyKey: 'py_abc',
}

describe('the Resend sender (#186)', () => {
  it('sends the POS file unchanged, from the venue name, with a key against doubles', async () => {
    const { calls, sender: send } = sender({})
    await send.sendReceipt(MESSAGE)
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.resend.com/emails')
    expect(call?.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'idempotency-key': 'py_abc',
    })
    expect(call?.body).toMatchObject({
      from: '"Club Нощ" <receipts@mail.restro.example>',
      to: [GUEST],
      attachments: [{ filename: FILE.filename, content: FILE.contentBase64 }],
    })
  })

  it('refuses to be made without a key or a from-address', () => {
    expect(() => createResendSender({ apiKey: ' ', fromAddress: 'a@b.example' })).toThrow(
      /RESEND_API_KEY/,
    )
    expect(() => createResendSender({ apiKey: KEY, fromAddress: '' })).toThrow(
      /RECEIPT_FROM_ADDRESS/,
    )
  })

  it('refuses a file that is not a receipt file, and one too large, before any call', async () => {
    const { calls, sender: send } = sender({})
    await expect(
      send.sendReceipt({ ...MESSAGE, file: { ...FILE, filename: '../../etc/passwd' } }),
    ).rejects.toThrow()
    const big = Buffer.alloc(2_000_001, 1).toString('base64')
    await expect(
      send.sendReceipt({ ...MESSAGE, file: { ...FILE, contentBase64: big } }),
    ).rejects.toBeInstanceOf(EmailSendError)
    expect(calls).toHaveLength(0)
  })

  it('an unreachable service is retryable and its error holds neither the address nor the key', async () => {
    const { sender: send } = sender('throw')
    const error = await send.sendReceipt(MESSAGE).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EmailSendError)
    expect(error).toMatchObject({ status: null, retryable: true })
    expect(String((error as Error).message)).not.toContain(GUEST)
    expect(String((error as Error).message)).not.toContain(KEY)
  })

  it('a refusal is not retryable, a busy service is, and neither repeats what the service said', async () => {
    const echo = { name: 'validation_error', message: `The \`to\` field ${GUEST} is invalid` }
    const refused = await sender({ status: 422, json: echo })
      .sender.sendReceipt(MESSAGE)
      .catch((caught: unknown) => caught)
    expect(refused).toMatchObject({ status: 422, retryable: false })
    expect((refused as Error).message).toContain('validation_error')
    expect((refused as Error).message).not.toContain(GUEST)
    for (const status of [429, 500, 503]) {
      const busy = await sender({ status, json: {} })
        .sender.sendReceipt(MESSAGE)
        .catch((caught: unknown) => caught)
      expect(busy).toMatchObject({ status, retryable: true })
    }
  })

  it('cleans the venue name for a header and falls back to Restro', () => {
    expect(senderName('  Club <Нощ>, "Bar"; \\ ')).toBe('Club Нощ Bar')
    expect(senderName('\u0000‮')).toBe('Restro')
    expect(senderName('x'.repeat(200))).toHaveLength(60)
    expect(receiptWords('Club').subject).toContain('Club')
  })

  it('the fake sender remembers what it was given and can be told to fail', async () => {
    const fake = createFakeEmailSender()
    await fake.sendReceipt(MESSAGE)
    expect(fake.sent).toEqual([MESSAGE])
    fake.failWith = new EmailSendError(503, true, 'busy')
    await expect(fake.sendReceipt(MESSAGE)).rejects.toBeInstanceOf(EmailSendError)
    expect(fake.sent).toHaveLength(1)
  })
})
