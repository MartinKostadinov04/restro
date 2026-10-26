// The simulator's notices (#108): the venue's refund and the bank's dispute leave a notice in the
// outbox, a pointer with no amounts; the payment reads back as it stands; and the signed wire
// format is pinned by a vector the web's verifier test pins too.

import { newId, providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { ManualClock } from './clock'
import { SimPayEngine, type SimPaySwitches } from './engine'
import { SIM_PAY_SIGNATURE_HEADER, signSimPayNotice, simPayNotice } from './notices'
import { createSimPayProvider } from './provider'

async function capturedPayment(switches: Partial<SimPaySwitches> = {}) {
  const engine = new SimPayEngine({ clock: new ManualClock(), switches })
  const provider = createSimPayProvider({ env: 'test', engine })
  const account = engine.addAccount()
  const paymentId = newId('py')
  const created = await provider.createHold({
    paymentId,
    accountRef: account,
    amountMinor: 2_000,
    currency: 'EUR',
    idempotencyKey: `${paymentId}:hold`,
    description: 'Club, table 4',
  })
  if (created.kind !== 'done') throw new Error('no hold')
  const ref = created.result.paymentRef
  engine.guest.pay(ref)
  // The hold's own notice (#110) is not what these tests are about.
  expect(engine.takeNotices().map((e) => e.type)).toEqual(['payment.held'])
  await provider.capture({
    accountRef: account,
    paymentRef: ref,
    amountMinor: 2_000,
    idempotencyKey: `${paymentId}:capture`,
  })
  return { engine, provider, account, ref }
}

describe('the outbox', () => {
  it('holds a refund notice only where the simulator declares refund notices', async () => {
    const quiet = await capturedPayment()
    quiet.engine.venue.refundsInDashboard(quiet.account, quiet.ref, 500)
    expect(quiet.engine.takeNotices()).toEqual([])

    const { engine, account, ref } = await capturedPayment({ refundNotices: true })
    const event = engine.venue.refundsInDashboard(account, ref, 500)
    expect(engine.takeNotices()).toEqual([event])
    expect(engine.takeNotices()).toEqual([])
    expect(Object.keys(event).sort()).toEqual(['account', 'id', 'livemode', 'object', 'type'])
  })

  it('always sends a dispute notice, opened and closed', async () => {
    const { engine, account, ref } = await capturedPayment()
    const opened = engine.bank.opensDispute(account, ref)
    const closed = engine.bank.closesDispute(account, providerRef(opened.object), 'lost')
    expect(engine.takeNotices().map((e) => e.type)).toEqual(['dispute.opened', 'dispute.closed'])
    expect(closed.object).toBe(opened.object)
  })
})

describe("the guest's card at the form (#110)", () => {
  it('sends a payment notice when the card is held or declined, and reads it back', async () => {
    const engine = new SimPayEngine({ clock: new ManualClock() })
    const provider = createSimPayProvider({ env: 'test', engine })
    const account = engine.addAccount()
    const hold = async () => {
      const paymentId = newId('py')
      const created = await provider.createHold({
        paymentId,
        accountRef: account,
        amountMinor: 1_000,
        currency: 'EUR',
        idempotencyKey: `${paymentId}:hold`,
        description: 'Club, table 4',
      })
      if (created.kind !== 'done') throw new Error('no hold')
      return created.result.paymentRef
    }
    const held = await hold()
    engine.guest.pay(held)
    const declined = await hold()
    engine.guest.decline(declined)
    const notices = engine.takeNotices()
    expect(notices.map((e) => [e.type, e.object])).toEqual([
      ['payment.held', held.provider],
      ['payment.failed', declined.provider],
    ])
    const [heldNotice] = notices.map(simPayNotice)
    if (heldNotice === undefined) throw new Error('no notice')
    expect(heldNotice.kind).toBe('payment')
    const reading = await provider.readNoticeSubject(account, heldNotice)
    expect(reading.complete && reading.value?.status).toBe('held')
  })
})

describe('reading a notice back', () => {
  it('reads the total refunded and the dispute as they stand, whichever notice', async () => {
    const { engine, provider, account, ref } = await capturedPayment()
    const first = simPayNotice(engine.venue.refundsInDashboard(account, ref, 500))
    simPayNotice(engine.venue.refundsInDashboard(account, ref, 700))
    const opened = simPayNotice(engine.bank.opensDispute(account, ref))
    const reading = await provider.readNoticeSubject(account, first)
    expect(reading).toMatchObject({
      complete: true,
      value: { refundedMinor: 1_200, dispute: 'open' },
    })
    expect(await provider.readNoticeSubject(account, opened)).toEqual(reading)
  })

  it('reads nothing for another account, an unknown object, or a notice with no object', async () => {
    const { engine, provider, account, ref } = await capturedPayment()
    const notice = simPayNotice(engine.venue.refundsInDashboard(account, ref, 500))
    const other = engine.addAccount()
    expect(await provider.readNoticeSubject(other, notice)).toEqual({ complete: true, value: null })
    const unknown = { ...notice, objectRef: providerRef('simrefund_999') }
    expect(await provider.readNoticeSubject(account, unknown)).toEqual({
      complete: true,
      value: null,
    })
    const none = { ...notice, objectRef: null }
    expect(await provider.readNoticeSubject(account, none)).toEqual({ complete: true, value: null })
  })

  it('refuses a refund above what is left, and a dispute on a payment not captured', async () => {
    const { engine, account, ref } = await capturedPayment()
    engine.venue.refundsInDashboard(account, ref, 1_500)
    expect(() => engine.venue.refundsInDashboard(account, ref, 501)).toThrow(/left to refund/)
    expect(() => engine.venue.refundsInDashboard(account, ref, 0)).toThrow()
    expect(() => engine.bank.opensDispute(account, providerRef('simpay_999'))).toThrow()
  })
})

describe('the signed notice', () => {
  it('maps its types to the platform kinds, unknown ones to other', () => {
    const event = {
      id: 'simevt_7',
      type: 'refund.made',
      account: 'simacct_1',
      object: 'simrefund_6',
      livemode: false,
    } as const
    expect(simPayNotice(event).kind).toBe('refund')
    expect(simPayNotice({ ...event, type: 'dispute.closed' }).kind).toBe('dispute')
  })

  // The same vector is pinned in apps/web/src/connectors/sim-pay/notices.test.ts.
  it('signs `timestamp.body` with HMAC-SHA256 (the pinned vector)', () => {
    const wire = signSimPayNotice(
      {
        id: 'simevt_7',
        type: 'refund.made',
        account: 'simacct_1',
        object: 'simrefund_6',
        livemode: false,
      },
      'whsec_sim_test',
      new Date('2026-10-25T21:00:00.000Z'),
    )
    expect(wire.body).toBe(
      '{"id":"simevt_7","type":"refund.made","account":"simacct_1","object":"simrefund_6","livemode":false}',
    )
    expect(wire.headers[SIM_PAY_SIGNATURE_HEADER]).toBe(
      't=1792962000,v1=11e8c66b982d8e1159dad20c819fd1e346c72cb72b1482e04560d602c080943d',
    )
  })
})
