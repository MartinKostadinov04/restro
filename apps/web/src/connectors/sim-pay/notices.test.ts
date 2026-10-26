// The simulated provider's notices (#108): the vector pinned in
// packages/payments/sim-pay/src/notices.test.ts verifies here, so the two sides agree without
// sharing code; the simulator is never offered in production.
import { describe, expect, it } from 'vitest'

import { noticeConnector, SIM_PAY_SIGNATURE_HEADER } from './notices'

const body =
  '{"id":"simevt_7","type":"refund.made","account":"simacct_1","object":"simrefund_6","livemode":false}'
const header = 't=1792962000,v1=11e8c66b982d8e1159dad20c819fd1e346c72cb72b1482e04560d602c080943d'
const at = new Date('2026-10-25T21:00:00.000Z')

describe("the simulator's notices", () => {
  it('verifies the pinned vector into a refund notice', () => {
    const result = noticeConnector.verify(
      body,
      new Headers({ [SIM_PAY_SIGNATURE_HEADER]: header }),
      'whsec_sim_test',
      at,
      false,
    )
    expect(result).toEqual({
      ok: true,
      notice: {
        id: 'simevt_7',
        type: 'refund.made',
        kind: 'refund',
        accountRef: { provider: 'simacct_1' },
        objectRef: { provider: 'simrefund_6' },
      },
    })
  })

  it('refuses the vector under another secret, too late, or as live', () => {
    const headers = new Headers({ [SIM_PAY_SIGNATURE_HEADER]: header })
    expect(noticeConnector.verify(body, headers, 'whsec_other', at, false)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    const late = new Date(at.getTime() + 301_000)
    expect(noticeConnector.verify(body, headers, 'whsec_sim_test', late, false)).toEqual({
      ok: false,
      reason: 'stale',
    })
    expect(noticeConnector.verify(body, headers, 'whsec_sim_test', at, true)).toEqual({
      ok: false,
      reason: 'wrong_mode',
    })
  })

  it('is offered everywhere but production, with its secret from SIM_PAY_NOTICE_SECRET', () => {
    expect(noticeConnector.offered('production')).toBe(false)
    for (const env of ['development', 'test', 'staging'] as const) {
      expect(noticeConnector.offered(env)).toBe(true)
    }
    expect(noticeConnector.secret({ SIM_PAY_NOTICE_SECRET: 'whsec_sim' })).toBe('whsec_sim')
    expect(noticeConnector.secret({})).toBeNull()
  })
})
