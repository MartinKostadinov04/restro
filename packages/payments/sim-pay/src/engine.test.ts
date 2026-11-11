// The simulated provider's account rules (#103 review): an unfinished account gets a fresh link
// for itself, an account it never made is not found, and a restricted account still releases a
// hold but captures nothing. #110: an engine given a run puts it in every ref it makes, so a
// restarted engine never reuses a ref an earlier run stored.

import { newId, providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { ManualClock } from './clock'
import { SimPayEngine } from './engine'
import { createSimPayProvider } from './provider'

function simPay() {
  const engine = new SimPayEngine({ clock: new ManualClock() })
  return { engine, provider: createSimPayProvider({ env: 'test', engine }) }
}

const urls = {
  returnUrl: 'https://pay.sim-pay.test/admin/settings/paying?connected=1',
  refreshUrl: 'https://pay.sim-pay.test/admin/settings/paying?retry=1',
}

describe('an account named by the caller', () => {
  it('can take payments at once, and is the same account on a second start', () => {
    const { engine, provider } = simPay()
    const ref = engine.addNamedAccount('simpay_club_biad', 'Клуб Биад ЕООД')
    expect(ref.provider).toBe('simpay_club_biad')
    expect(engine.readConnection(ref)).toMatchObject({
      complete: true,
      value: { canTakePayments: true, displayName: 'Клуб Биад ЕООД', missing: [] },
    })
    // A restart names the same reference again: one account, still able to take payments.
    expect(engine.addNamedAccount('simpay_club_biad').provider).toBe('simpay_club_biad')
    expect(engine.readConnection(ref)).toMatchObject({ value: { canTakePayments: true } })
    expect(provider.kind).toBe('sim-pay')
  })

  it('is not the account an engine that was never told about it knows', () => {
    const { engine } = simPay()
    expect(engine.readConnection(providerRef('simpay_club_biad'))).toMatchObject({
      value: { canTakePayments: false, missing: ['account'] },
    })
  })
})

describe('a card the bank accepts at the hold (guestCardAccepted)', () => {
  it('holds without anyone playing the guest, and still captures as always', () => {
    const engine = new SimPayEngine({
      clock: new ManualClock(),
      switches: { guestCardAccepted: true },
    })
    const account = engine.addNamedAccount('simpay_club_biad')
    const paymentId = newId('py') as `py_${string}`
    const made = engine.createHold({
      accountRef: account,
      paymentId,
      currency: 'EUR',
      amountMinor: 3450,
      idempotencyKey: `${paymentId}:hold`,
      description: 'Club Biad, table 45',
    })
    expect(made.kind).toBe('done')
    if (made.kind !== 'done') return
    const read = engine.findByPaymentId(account, paymentId)
    expect(read).toMatchObject({ value: { status: 'held', heldMinor: 3450 } })
    expect(
      engine.capture({
        accountRef: account,
        paymentRef: made.result.paymentRef,
        amountMinor: 3450,
        idempotencyKey: `${paymentId}:capture`,
      }).kind,
    ).toBe('done')
    expect(engine.movedMinor(account)).toBe(3450)
  })

  it('is off by default: the hold waits for the guest at the form', () => {
    const { engine } = simPay()
    const account = engine.addNamedAccount('simpay_club_biad')
    const paymentId = newId('py') as `py_${string}`
    engine.createHold({
      accountRef: account,
      paymentId,
      currency: 'EUR',
      amountMinor: 3450,
      idempotencyKey: `${paymentId}:hold`,
      description: 'Club Biad, table 45',
    })
    expect(engine.findByPaymentId(account, paymentId)).toMatchObject({
      value: { status: 'awaiting_guest' },
    })
  })
})

describe('a run', () => {
  it('goes inside every ref, and is letters and digits only', () => {
    const clock = new ManualClock()
    expect(new SimPayEngine({ clock }).addAccount().provider).toBe('simacct_1')
    expect(new SimPayEngine({ clock, run: 'r2a' }).addAccount().provider).toBe('simacct_r2a_1')
    for (const run of ['', 'a_b', 'x'.repeat(33)]) {
      expect(() => new SimPayEngine({ clock, run })).toThrow()
    }
  })
})

describe('connecting', () => {
  it('gives an unfinished account a fresh link for the same account', async () => {
    const { provider } = simPay()
    const venueId = newId('vn')
    const first = await provider.startConnection({
      venueId,
      accountRef: null,
      ...urls,
      idempotencyKey: `${venueId}:connect:1`,
    })
    if (first.kind !== 'done') throw new Error(`startConnection answered ${first.kind}`)
    const status = await provider.readConnection(first.result.accountRef)
    expect(status).toMatchObject({ complete: true, value: { canTakePayments: false } })

    const again = await provider.startConnection({
      venueId,
      accountRef: first.result.accountRef,
      ...urls,
      idempotencyKey: `${venueId}:connect:2`,
    })
    expect(again).toMatchObject({
      kind: 'done',
      result: { accountRef: first.result.accountRef },
    })
  })

  it('answers not_found for an account it never made', async () => {
    const { provider } = simPay()
    const venueId = newId('vn')
    expect(
      await provider.startConnection({
        venueId,
        accountRef: providerRef('simacct_unknown'),
        ...urls,
        idempotencyKey: `${venueId}:connect`,
      }),
    ).toEqual({ kind: 'refused', refusal: { code: 'not_found', scope: 'account', detail: null } })
  })
})

describe('a restricted account', () => {
  async function heldOnRestricted() {
    const { engine, provider } = simPay()
    const accountRef = engine.addAccount()
    const paymentId = newId('py')
    const created = await provider.createHold({
      paymentId,
      accountRef,
      amountMinor: 1_200,
      currency: 'EUR',
      idempotencyKey: `${paymentId}:hold`,
      description: 'Test Bar, table 1',
    })
    if (created.kind !== 'done') throw new Error(`createHold answered ${created.kind}`)
    const paymentRef = created.result.paymentRef
    engine.guest.pay(paymentRef)
    engine.restrictAccount(accountRef, ['identity document'])
    return { engine, provider, accountRef, paymentRef }
  }

  it('refuses a capture', async () => {
    const { engine, provider, accountRef, paymentRef } = await heldOnRestricted()
    expect(
      await provider.capture({
        accountRef,
        paymentRef,
        amountMinor: 1_200,
        idempotencyKey: `${paymentRef.provider}:capture`,
      }),
    ).toEqual({
      kind: 'refused',
      refusal: { code: 'account_restricted', scope: 'account', detail: null },
    })
    expect(engine.movedMinor(accountRef)).toBe(0)
  })

  it('still releases the hold, so the guest is not left with money held', async () => {
    const { engine, provider, accountRef, paymentRef } = await heldOnRestricted()
    const released = await provider.release({
      accountRef,
      paymentRef,
      idempotencyKey: `${paymentRef.provider}:release`,
    })
    expect(released).toMatchObject({
      kind: 'done',
      result: { status: 'released', heldMinor: 0 },
    })
    expect(engine.movedMinor(accountRef)).toBe(0)
  })

  it('refuses a new hold', async () => {
    const { provider, accountRef } = await heldOnRestricted()
    const paymentId = newId('py')
    expect(
      await provider.createHold({
        paymentId,
        accountRef,
        amountMinor: 1_200,
        currency: 'EUR',
        idempotencyKey: `${paymentId}:hold`,
        description: 'Test Bar, table 1',
      }),
    ).toMatchObject({ kind: 'refused', refusal: { code: 'account_restricted' } })
  })
})
