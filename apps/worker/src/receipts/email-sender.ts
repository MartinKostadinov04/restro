// The email service as the venue's electronic receipt uses it (#186, D127): send the POS's own
// receipt file, unchanged, to the guest, from the venue's name. Resend is the stack's email
// service; plain `fetch`, no library. The guest's address and the API key are secrets here: no
// error carries either, and nothing logs either. Restro never draws or edits the receipt: the
// file goes on as it came (`ReceiptFile`), and the words around it are the only text this sends.
//
// Every refusal of a message is an `EmailSendError`, never a ZodError or a TypeError, saying
// whether the same send could still work later (`retryable`). The error holds Resend's own error
// name, never its message, which can echo the address.

import {
  RECEIPT_FILE_MAX_BYTES,
  ReceiptEmailSchema,
  type ReceiptFile,
  ReceiptFileSchema,
} from '@restro/core'
import { z } from 'zod'

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
   * address): the sender passes it on. The service keeps a key for 24 hours.
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
/** What the service accepts as an idempotency key (its own rule: 256 characters at most). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:/-]{1,256}$/

/**
 * The venue's name as a sender's display name: no control characters and none that end or split
 * a header value (quotes, angle brackets, backslashes, commas, semicolons), spaces collapsed, cut
 * at 60 characters (code points, so a Bulgarian or emoji name is never split in half). Empty after
 * that, the name is Restro's.
 */
export function senderName(venueName: string): string {
  const cleaned = Array.from(
    venueName
      .replace(/[\p{Cc}\p{Cf}"<>\\,;]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, MAX_SENDER_NAME)
    .join('')
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
    // Martin 10-29: «Касова бележка от {venue}» / "Your receipt from {venue}".
    subject: `Касова бележка от ${name} / Your receipt from ${name}`,
    text: [
      `Вашата касова бележка от ${name} е приложена.`,
      '',
      `Your receipt from ${name} is attached.`,
    ].join('\n'),
  }
}

/** The service's own error name, the only part of its answer that is repeated (a code). */
const ErrorBodySchema = z.object({ name: z.string().regex(/^[a-z_]{1,64}$/) })

/**
 * Whether the same message could still go out later, from the status and the service's error
 * name: a key in use by a request still running, a busy service and a rate limit can pass; a
 * message the service refused, a key reused for another message, and a spent quota (the waiter
 * brings paper; the quota comes back at midnight or next month) cannot.
 */
function retryableAfter(status: number, name: string | null): boolean {
  if (status === 409) return name === 'concurrent_idempotent_requests'
  if (status === 429) return name !== 'daily_quota_exceeded' && name !== 'monthly_quota_exceeded'
  return status >= 500
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
  const final = (description: string) => new EmailSendError(null, false, description)

  return {
    async sendReceipt(message) {
      // Everything this message holds is checked before the service is called: a refusal here is
      // final, and its text names the part, never the value.
      const to = ReceiptEmailSchema.safeParse(message.to)
      if (!to.success) throw final('the address is not valid')
      const file = ReceiptFileSchema.safeParse(message.file)
      if (!file.success) throw final('the receipt file is not valid')
      if (Buffer.byteLength(file.data.contentBase64, 'base64') > RECEIPT_FILE_MAX_BYTES) {
        throw final('the receipt file is too large')
      }
      if (!IDEMPOTENCY_KEY.test(message.idempotencyKey)) {
        throw final('the idempotency key is not valid')
      }
      const words = receiptWords(message.venueName)
      const headers = {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      }
      try {
        // The fetch's own header check throws a TypeError for a value it refuses: that is a
        // fault of this message, not an unreachable service.
        new Headers(headers)
      } catch {
        throw final('the request could not be built')
      }
      const timeout = AbortSignal.timeout(limitMs)
      let response: Response
      try {
        response = await fetchImpl(API, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from: `"${senderName(message.venueName)}" <${fromAddress}>`,
            to: [to.data],
            subject: words.subject,
            text: words.text,
            attachments: [{ filename: file.data.filename, content: file.data.contentBase64 }],
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
      // The answer is always read, so the connection is freed; an accepted message's `{ id }` is
      // not needed, and one without it is still an accepted message, never sent twice.
      const body: unknown = await response.json().catch(() => null)
      if (response.ok) return
      const named = ErrorBodySchema.safeParse(body)
      const name = named.success ? named.data.name : null
      throw new EmailSendError(
        response.status,
        retryableAfter(response.status, name),
        name === null ? `status ${response.status}` : `${name}, status ${response.status}`,
      )
    },
  }
}
