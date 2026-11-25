// A receipt email sender that sends nothing (#186): the worker's tests use it, and nothing real is
// ever reached. It lives with the tests, never in the production module.

import { EmailSendError, type EmailSender, type ReceiptMessage } from '../src/receipts/email-sender'

/** What a test's sender remembers: the message as it was handed over. */
export interface FakeEmailSender extends EmailSender {
  readonly sent: ReceiptMessage[]
  /** The next sends fail with this error, until it is set to null. */
  failWith: EmailSendError | null
}

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

export { EmailSendError }
