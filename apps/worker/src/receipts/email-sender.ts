// The email service as the venue's electronic receipt uses it (#186, D127): send the POS's own
// receipt file, unchanged, to the guest, from the venue's name. Resend is the stack's email
// service; plain `fetch`, no library. The guest's address and the API key are secrets here: no
// error carries either, and nothing logs either. Restro never draws or edits the receipt: the
// file goes on as it came (`ReceiptFile`), and the words around it are the only text this sends.

import { RECEIPT_FILE_MAX_BYTES, type ReceiptFile, ReceiptFileSchema } from '@restro/core'

/** One electronic receipt to send: where, from which venue, and the POS's file. */
export interface ReceiptMessage {
  /** The guest's address. Personal data: carried to this one send and dropped. */
  readonly to: string
  /** The venue's name, shown as the sender's name. */
  readonly venueName: string
  /** The POS's file, as the close returned it. */
  readonly file: ReceiptFile
  /**
   * A key that makes a repeated send of the same receipt go out once (the payment's id, never the
   * address): the sender passes it on where the service honours one.
   */
  readonly idempotencyKey: string
}

/** What the receipt job needs of the email service. The worker's tests replace it. */
export interface EmailSender {
  sendReceipt(message: ReceiptMessage): Promise<void>
}

/** The service refused, or could not be reached (`status` null). Never carries the address or key. */
export class EmailSendError extends Error {
  constructor(
    readonly status: number | null,
    /** Worth sending again: the service was busy or unreachable, not a refusal of this message. */
    readonly retryable: boolean,
    description: string,
  ) {
    super(`The email service failed: ${description}`)
    this.name = 'EmailSendError'
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ResendOptions {
  /** RESEND_API_KEY. A secret. */
  readonly apiKey: string
  /** RECEIPT_FROM_ADDRESS: an address on the sending domain Restro verified with the service. */
  readonly fromAddress: string
  /** Replaced in tests. */
  readonly fetch?: Fetch
  /** How long the service gets to answer, in milliseconds. Short in tests. */
  readonly timeoutMs?: number
}

const API = 'https://api.resend.com/emails'
const CALL_TIMEOUT_MS = 15_000
/** The longest display name Restro puts on a sender; a venue's name is cut here, never refused. */
const MAX_SENDER_NAME = 60

/**
 * The venue's name as a sender's display name: no control characters and none that end or split
 * a header value (quotes, angle brackets, backslashes, commas, semicolons), spaces collapsed.
 * Empty after that, the name is Restro's.
 */
export function senderName(venueName: string): string {
  const cleaned = venueName
    .replace(/[\p{Cc}\p{Cf}"<>\\,;]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SENDER_NAME)
    .trim()
  return cleaned === '' ? 'Restro' : cleaned
}

/** The words around the file: the venue's name and one line, Bulgarian first (D105's order). */
export function receiptWords(venueName: string): {
  readonly subject: string
  readonly text: string
} {
  const name = senderName(venueName)
  return {
    subject: `${name}: вашата разписка / your receipt`,
    text: [
      `Вашата разписка от ${name} е приложена.`,
      '',
      `Your receipt from ${name} is attached.`,
    ].join('\n'),
  }
}

/**
 * The sender over Resend's HTTP API. Refuses to be made without a key or a from-address, so a
 * missing setting stops a send before it is tried, never after a guest was told it went.
 */
export function createResendSender(options: ResendOptions): EmailSender {
  const apiKey = options.apiKey.trim()
  const fromAddress = options.fromAddress.trim()
  if (apiKey === '') throw new Error('RESEND_API_KEY is not set: no receipt can be emailed')
  if (fromAddress === '') {
    throw new Error('RECEIPT_FROM_ADDRESS is not set: no receipt can be emailed')
  }
  const fetchImpl: Fetch = options.fetch ?? fetch
  const limitMs = options.timeoutMs ?? CALL_TIMEOUT_MS

  return {
    async sendReceipt(message) {
      // The file is the POS's own: parsed, never changed, and never larger than Restro passes on.
      const file = ReceiptFileSchema.parse(message.file)
      if (Buffer.byteLength(file.contentBase64, 'base64') > RECEIPT_FILE_MAX_BYTES) {
        throw new EmailSendError(null, false, 'the receipt file is too large')
      }
      const words = receiptWords(message.venueName)
      const timeout = AbortSignal.timeout(limitMs)
      let response: Response
      try {
        response = await fetchImpl(API, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': message.idempotencyKey,
          },
          body: JSON.stringify({
            from: `"${senderName(message.venueName)}" <${fromAddress}>`,
            to: [message.to],
            subject: words.subject,
            text: words.text,
            attachments: [{ filename: file.filename, content: file.contentBase64 }],
          }),
          signal: timeout,
        })
      } catch {
        // The network error's own text can carry the address; only the fact is kept.
        throw new EmailSendError(
          null,
          true,
          timeout.aborted
            ? 'the service did not answer in time'
            : 'the service could not be reached',
        )
      }
      if (response.ok) return
      // Only the service's own error name is repeated: its message can echo the address.
      let code = `status ${response.status}`
      try {
        const body = (await response.json()) as { name?: unknown }
        if (typeof body.name === 'string' && /^[a-z_]{1,64}$/.test(body.name)) {
          code = `${body.name}, status ${response.status}`
        }
      } catch {
        // The status says it.
      }
      throw new EmailSendError(
        response.status,
        response.status === 429 || response.status >= 500,
        code,
      )
    },
  }
}

/** What a test's sender remembers: the message as it was handed over. */
export interface FakeEmailSender extends EmailSender {
  readonly sent: ReceiptMessage[]
  /** The next sends fail with this error, until it is set to null. */
  failWith: EmailSendError | null
}

/** A sender that sends nothing: tests use it, and nothing real is ever reached. */
export function createFakeEmailSender(): FakeEmailSender {
  const fake: FakeEmailSender = {
    sent: [],
    failWith: null,
    async sendReceipt(message) {
      if (fake.failWith !== null) throw fake.failWith
      fake.sent.push(message)
    },
  }
  return fake
}
