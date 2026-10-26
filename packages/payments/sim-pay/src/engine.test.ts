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
