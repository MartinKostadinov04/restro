// A guest email sender that sends nothing (#186, #576): the worker's tests use it, and nothing real
// is ever reached. It lives with the tests, never in the production module.

import {
  EmailSendError,
  type EmailSender,
  type GuestEmail,
  type ReceiptMessage,
} from '../src/email/sender'

/** What a test's sender remembers: each message as it was handed over. */
export interface FakeEmailSender extends EmailSender {
  /** The receipts. */
  readonly sent: ReceiptMessage[]
  /** Every other guest email. */
  readonly guestSent: GuestEmail[]
  /** The next sends fail with this error, until it is set to null. */
  failWith: EmailSendError | null
}

export function createFakeEmailSender(): FakeEmailSender {
  const fake: FakeEmailSender = {
    sent: [],
    guestSent: [],
    failWith: null,
    async sendReceipt(message) {
      if (fake.failWith !== null) throw fake.failWith
      fake.sent.push(message)
    },
    async sendGuestEmail(message) {
      if (fake.failWith !== null) throw fake.failWith
      fake.guestSent.push(message)
    },
  }
  return fake
}

export { EmailSendError }
