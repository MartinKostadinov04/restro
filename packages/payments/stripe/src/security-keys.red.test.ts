// RED by design (the repair-review's A7, RR-20). D127: "Refunds stay none". The knowledge file's
// sandbox entry of 10-29 sets the key so ("Refunds: None in both"), and the same entry records a
// 403 `more_permissions_required` for a resource the key lacks. But `intentOfNotice` reads
// GET /v1/refunds/:id (provider.ts:337) for `charge.refund.updated` and `refund.*`, so under the key
// D127 describes each such notice is incomplete and waits for ever. A fake fetch; nothing calls
// Stripe. The 403 on this one path is read from that entry, not observed.
import { providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createStripeProvider } from './provider'

const ACCOUNT = providerRef('acct_1Test')

function keyWithRefundsNone() {
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url)
    if (url.pathname.startsWith('/v1/refunds/')) {
      return Response.json(
        {
          error: {
            type: 'invalid_request_error',
            code: 'more_permissions_required',
            message: 'The key needs refund_read',
          },
        },
        { status: 403 },
      )
    }
    return Response.json(
      { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such' } },
      { status: 404 },
    )
  }
  return createStripeProvider({ env: 'test', key: 'sk_test_fake0', fetch })
}

describe('RR-20: the key D127 describes, and a refund notice', () => {
  for (const type of ['refund.updated', 'refund.failed', 'charge.refund.updated']) {
    it.fails(`RR-20: ${type} must not wait for ever on a read the key may not do`, async () => {
      const reading = await keyWithRefundsNone().readNoticeSubject(ACCOUNT, {
        id: 'evt_1',
        type,
        kind: 'refund',
        accountRef: ACCOUNT,
        objectRef: providerRef('re_3Test'),
      })
      expect(reading.complete, JSON.stringify(reading)).toBe(true)
    }, 60_000)
  }
})
