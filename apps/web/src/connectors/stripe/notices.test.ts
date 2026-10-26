// Stripe's notices (#108): a signed event becomes a pointer in the platform's words; an event
// in the other mode, a body that is not an event, and a bad signature are refused.
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { noticeConnector, STRIPE_SIGNATURE_HEADER, stripeNoticeKind } from './notices'

const secret = 'whsec_test_secret'
const now = new Date('2026-10-26T12:00:00.000Z')
const t = Math.floor(now.getTime() / 1000)

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt_1Q2w3E4r5T6y7U8i',
  object: 'event',
  api_version: '2026-09-30.clover',
  type: 'charge.refunded',
  livemode: false,
  account: 'acct_1Venue',
  created: t,
  data: { object: { id: 'ch_3Abc', object: 'charge', amount_refunded: 500 } },
  ...overrides,
})
const signed = (body: string, key = secret) =>
  new Headers({
    [STRIPE_SIGNATURE_HEADER]: `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`,
  })
const verify = (body: string, live = false, headers = signed(body)) =>
  noticeConnector.verify(body, headers, secret, now, live)

describe("Stripe's notices", () => {
  it('turns a signed event into a pointer: kind, account and object, no amounts', () => {
    const body = JSON.stringify(event())
    const result = verify(body)
    expect(result).toEqual({
      ok: true,
      notice: {
        id: 'evt_1Q2w3E4r5T6y7U8i',
        type: 'charge.refunded',
        kind: 'refund',
        accountRef: { provider: 'acct_1Venue' },
        objectRef: { provider: 'ch_3Abc' },
      },
    })
  })

  it('takes an event with no account (the platform itself) with no account ref', () => {
    const { account: _account, ...own } = event()
    const result = verify(JSON.stringify(own))
    expect(result).toMatchObject({ ok: true, notice: { accountRef: null } })
  })

  it('refuses a test event in production and a live event elsewhere', () => {
    expect(verify(JSON.stringify(event()), true)).toEqual({ ok: false, reason: 'wrong_mode' })
    expect(verify(JSON.stringify(event({ livemode: true })))).toEqual({
      ok: false,
      reason: 'wrong_mode',
    })
    expect(verify(JSON.stringify(event({ livemode: true })), true)).toMatchObject({ ok: true })
  })

  it('refuses a signed body that is not an event', () => {
    for (const body of [
      'not json',
      '[]',
      JSON.stringify(event({ object: 'charge' })),
      JSON.stringify(event({ data: {} })),
      JSON.stringify(event({ id: 'evt 1' })),
      JSON.stringify(event({ account: 'acct 1' })),
    ]) {
      expect(verify(body), body).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('checks the signature before it reads the body', () => {
    const body = JSON.stringify(event())
    expect(verify(body, false, signed(body, 'whsec_other'))).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(verify('not json', false, new Headers())).toEqual({ ok: false, reason: 'unsigned' })
  })

  it('maps refund and dispute events to their kinds, and every other type to other', () => {
    for (const type of [
      'charge.refunded',
      'charge.refund.updated',
      'refund.created',
      'refund.updated',
      'refund.failed',
    ]) {
      expect(stripeNoticeKind(type), type).toBe('refund')
    }
    for (const type of [
      'charge.dispute.created',
      'charge.dispute.updated',
      'charge.dispute.closed',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated',
    ]) {
      expect(stripeNoticeKind(type), type).toBe('dispute')
    }
    // A guest's payment (#110): the PaymentIntent's own events.
    for (const type of [
      'payment_intent.amount_capturable_updated',
      'payment_intent.requires_action',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
      'payment_intent.succeeded',
    ]) {
      expect(stripeNoticeKind(type), type).toBe('payment')
    }
    for (const type of ['account.updated', 'charge.captured', 'payout.paid']) {
      expect(stripeNoticeKind(type), type).toBe('other')
    }
  })

  it('takes its secret from STRIPE_NOTICE_SECRET and is offered everywhere', () => {
    expect(noticeConnector.secret({ STRIPE_NOTICE_SECRET: ' whsec_x ' })).toBe('whsec_x')
    expect(noticeConnector.secret({ STRIPE_NOTICE_SECRET: '' })).toBeNull()
    expect(noticeConnector.offered('production')).toBe(true)
  })
})
