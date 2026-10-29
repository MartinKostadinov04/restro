import { describe, expect, it } from 'vitest'

import { createFakeEmailSender } from '../../tests/fake-email-sender'
import {
  createResendSender,
  EmailSendError,
  type ReceiptMessage,
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

const MESSAGE: ReceiptMessage = {
  to: GUEST,
  venueName: 'Club "Нощ"',
  file: FILE,
  idempotencyKey: 'py_abc',
}

/** What a send to the service answering `reply` throws, or null. */
async function thrownBy(reply: Parameters<typeof fakeFetch>[0], message = MESSAGE) {
  const { calls, sender: send } = sender(reply)
  const error = await send.sendReceipt(message).then(
    () => null,
    (caught: unknown) => caught,
  )
  return { error, calls }
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

  describe('a message it cannot send is a final EmailSendError, before any call, never naming the address', () => {
    const big = Buffer.alloc(2_000_001, 1).toString('base64')
    it.each([
      ['an address that is not one', { ...MESSAGE, to: 'not an address' }],
      ['two addresses', { ...MESSAGE, to: 'a@example.test, b@example.test' }],
      ['an unsafe file name', { ...MESSAGE, file: { ...FILE, filename: '../../etc/passwd' } }],
      ['a file of another type', { ...MESSAGE, file: { ...FILE, contentType: 'image/png' } }],
      ['a file too large', { ...MESSAGE, file: { ...FILE, contentBase64: big } }],
      ['a key with a space', { ...MESSAGE, idempotencyKey: 'py abc' }],
      ['a key with a line break', { ...MESSAGE, idempotencyKey: 'py_abc\nx-injected: 1' }],
      ['a key past 256 characters', { ...MESSAGE, idempotencyKey: 'k'.repeat(257) }],
      ['an empty key', { ...MESSAGE, idempotencyKey: '' }],
    ] as [string, ReceiptMessage][])('%s', async (_name, message) => {
      const { error, calls } = await thrownBy({}, message)
      expect(error).toBeInstanceOf(EmailSendError)
      expect(error).toMatchObject({ status: null, retryable: false })
      expect((error as Error).message).not.toContain('example.test')
      expect(calls).toHaveLength(0)
    })

    it('a key of the allowed characters goes out', async () => {
      const { error, calls } = await thrownBy({}, { ...MESSAGE, idempotencyKey: 'py_a.b:c/d-1' })
      expect(error).toBeNull()
      expect(calls).toHaveLength(1)
    })
  })

  it('an unreachable service is retryable and its error holds neither the address nor the key', async () => {
    const { error } = await thrownBy('throw')
    expect(error).toBeInstanceOf(EmailSendError)
    expect(error).toMatchObject({ status: null, retryable: true })
    expect((error as Error).message).not.toContain(GUEST)
    expect((error as Error).message).not.toContain(KEY)
  })

  describe('what the service answers decides whether the same send could still work', () => {
    const echo = `The \`to\` field ${GUEST} is invalid`
    it.each([
      [409, 'concurrent_idempotent_requests', true],
      [409, 'invalid_idempotent_request', false],
      [409, 'something_else', false],
      [429, 'rate_limit_exceeded', true],
      [429, 'daily_quota_exceeded', false],
      [429, 'monthly_quota_exceeded', false],
      [429, undefined, true],
      [422, 'validation_error', false],
      [400, 'missing_required_field', false],
      [401, 'invalid_api_key', false],
      [403, 'invalid_from_address', false],
      [500, 'internal_server_error', true],
      [503, undefined, true],
    ] as [number, string | undefined, boolean][])(
      '%s %s: retryable %s, and neither the message nor the address is repeated',
      async (status, name, retryable) => {
        const { error } = await thrownBy({
          status,
          json: name === undefined ? {} : { name, message: echo, statusCode: status },
        })
        expect(error).toBeInstanceOf(EmailSendError)
        expect(error).toMatchObject({ status, retryable })
        expect((error as Error).message).not.toContain(GUEST)
        if (name !== undefined) expect((error as Error).message).toContain(name)
      },
    )

    it('an answer that is not JSON still gives its status', async () => {
      const { sender: send } = {
        sender: createResendSender({
          apiKey: KEY,
          fromAddress: 'receipts@mail.restro.example',
          fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }),
        }),
      }
      await expect(send.sendReceipt(MESSAGE)).rejects.toMatchObject({
        status: 502,
        retryable: true,
      })
    })

    it('an error name that is not a plain code is not repeated', async () => {
      const { error } = await thrownBy({ status: 422, json: { name: `bad ${GUEST}` } })
      expect((error as Error).message).not.toContain(GUEST)
      expect(error).toMatchObject({ status: 422, retryable: false })
    })

    it('an accepted message without an id in the answer is still accepted', async () => {
      const { error } = await thrownBy({ status: 200, json: {} })
      expect(error).toBeNull()
    })
  })

  it('cleans the venue name for a header, cuts it by code point, and falls back to Restro', () => {
    expect(senderName('  Club <Нощ>, "Bar"; \\ ')).toBe('Club Нощ Bar')
    expect(senderName('\u0000‮')).toBe('Restro')
    expect(senderName('x'.repeat(200))).toHaveLength(60)
    // Sixty-one emoji: cut at sixty whole ones, never a lone half of a pair.
    const cut = senderName('😀'.repeat(61))
    expect(Array.from(cut)).toHaveLength(60)
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(receiptWords('Club').subject).toContain('Club')
  })
})

describe('the fake sender (tests only)', () => {
  it('remembers what it was given and can be told to fail', async () => {
    const fake = createFakeEmailSender()
    await fake.sendReceipt(MESSAGE)
    expect(fake.sent).toEqual([MESSAGE])
    fake.failWith = new EmailSendError(503, true, 'busy')
    await expect(fake.sendReceipt(MESSAGE)).rejects.toBeInstanceOf(EmailSendError)
    expect(fake.sent).toHaveLength(1)
  })
})
