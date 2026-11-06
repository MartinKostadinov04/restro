// @vitest-environment jsdom

// DA-B2 (designer audit, money on the new screens), brought in by #293. Every one of them now says
// what the face must do: DA-B2-1 and DA-B2-4 were fixed by #293, DA-B2-2 and DA-B2-3 by #294 (Call
// a waiter, which turned the last two round).

import { ANSWER_LOST_CODE } from '@restro/shell'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
  fakeHost,
  itemNamed,
  orderHost,
  orderingView,
  orderLine,
  orderOf,
  payingOf,
  paymentOf,
  resetPage,
  tableBillOf,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.style.overflow = ''
})

const view = orderingView()
const hummus = itemNamed(view, 'Hummus')
const mojito = itemNamed(view, 'Mojito')

/** Hummus on the bill (7.00), the Mojito paid first (10.00), as pay-first.test.tsx draws them. */
function payFirstHost(
  tips = false,
  lines = [orderLine(hummus), orderLine(mojito, 1, { mode: 'pay_first' as const })],
): FakeHost {
  return orderHost({
    order: orderOf(lines),
    ordering: {
      state: 'on',
      notesAndOptions: true,
      payFirst: 'on',
      ...(tips ? { tips: true } : {}),
    },
  })
}
const openBag = () => {
  fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
  return screen.getByRole('dialog', { name: 'Your bag' })
}
const sendButton = (sheet: HTMLElement) => sheet.querySelector('[data-send]') as HTMLButtonElement

describe('DA-B2-1: below the smallest card payment, the bill lines go on their own', () => {
  it('sends the Hummus alone and greys the pay-first part with "Pay cash" (Martin 11-01)', async () => {
    const host = payFirstHost()
    // The venue's smallest card payment is 15.00; the Mojito is 10.00.
    host.set({ paying: payingOf({ minCardMinor: 1500 }), tableBill: tableBillOf() })
    drawFace(host)
    const sheet = openBag()
    // D117: "Pay unlocks at the minimum". Send is the bill lines alone, and says so.
    expect(sendButton(sheet).disabled).toBe(false)
    expect(sendButton(sheet).textContent).toBe('Send 1 item')
    // The pay-first part is drawn greyed, with Martin's line and a way to pay cash.
    const blocked = () => sheet.querySelector('[data-slot="pay.first.blocked"]')
    expect(blocked()).not.toBeNull()
    expect(blocked()?.textContent).toContain('Your bill is under the minimum for card payment')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    const sent = host.of('order.send')[0]?.command
    expect(sent?.lines.map((line) => line.itemId)).toEqual([hummus.id])
    // No pay-first part goes with it: the server never has to refuse the Send as a whole.
    expect(sent?.payFirst).toBeUndefined()
    await act(async () => host.of('order.send')[0]?.answer())
    // "Pay cash" calls a waiter with the bill (call kind `bill`), and shows what the host said.
    const cash = sheet.querySelector('[data-slot="pay.first.cash"]') as HTMLButtonElement
    expect(cash).not.toBeNull()
    fireEvent.click(cash)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    expect(host.of('service.request')[0]?.command.request).toBe('bill')
    await act(async () => host.of('service.request')[0]?.answer())
    await waitFor(() => expect(blocked()?.textContent).toContain('Waiter called'))
  })

  it('never claims "Request sent" when the "Pay cash" answer was lost (D72, DA-2 again)', async () => {
    const host = payFirstHost()
    host.set({ paying: payingOf({ minCardMinor: 1500 }), tableBill: tableBillOf() })
    drawFace(host)
    const sheet = openBag()
    const blocked = () => sheet.querySelector('[data-slot="pay.first.blocked"]') as HTMLElement
    const cash = sheet.querySelector('[data-slot="pay.first.cash"]') as HTMLButtonElement
    fireEvent.click(cash)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    // services-client.ts unknown(): what the page's host answers for a request whose answer was
    // lost (a network error or a 5xx). It may have reached the staff, so neither word is true.
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'pending', code: ANSWER_LOST_CODE }),
    )
    expect(blocked().textContent).not.toContain('Waiter called')
    expect(within(blocked()).getByRole('alert').textContent).toContain('reach Restro right now')
    // D120: no "Try again" for a request that may have landed.
    expect(cash.disabled).toBe(true)
  })

  it('sends the bill lines and keeps the pay-first ones when the payment is rate-limited', async () => {
    const host = payFirstHost()
    host.set({ paying: payingOf(), tableBill: tableBillOf() })
    drawFace(host)
    const sheet = openBag()
    // Above the minimum, one tap is still "Send and pay" and carries both parts.
    expect(sendButton(sheet).textContent).toBe('Send and pay €10.00')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.payFirst).toBeDefined()
    // The server took the bill lines and refused the pay part alone (core da-b2-money.test.ts).
    await act(async () =>
      host.of('order.send')[0]?.answer({ status: 'accepted', payFirstRefused: 'rate_limited' }),
    )
    await waitFor(() =>
      expect(sheet.querySelector('[data-slot="pay.first.refused"]')?.textContent).toBe(
        'Another payment is in progress, try again in a moment',
      ),
    )
  })
})

describe('DA-B2-4: the tip chosen for one payment does not carry to the next', () => {
  it('clears the 10 % once the payment started, so the next pay-first line starts with none', async () => {
    const host = payFirstHost(true)
    const page = drawFace(host)
    const sheet = openBag()
    const presets = () => [...sheet.querySelectorAll('[data-slot="pay.tip.preset"]')]
    fireEvent.click(presets()[1] as Element)
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    await act(async () => host.of('order.send')[0]?.answer())
    // The round went, the Mojito was paid and left the order. Later the guest adds another Mojito.
    page.update({ order: orderOf([]), payment: null })
    page.update({ order: orderOf([orderLine(mojito, 1, { mode: 'pay_first' as const })]) })
    // D127: "nothing selected". The old 10 % is gone, from the buttons and from the amount.
    expect(presets().map((preset) => preset.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ])
    expect(sendButton(sheet).textContent).toContain('10.00')
  })
})

describe('DA-B2-2: Call a waiter never claims "Request sent" when the answer was lost', () => {
  const openCall = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Call a waiter' }))
    return screen.getByRole('dialog', { name: 'Call a waiter' })
  }

  it("says D120's line for the guest client's pending answer_lost (a network error or a 5xx)", async () => {
    const host = fakeHost()
    drawFace(host)
    const sheet = openCall()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Call the waiter' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    // services-client.ts unknown(): what the page's host answers for a lost request of any kind.
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'pending', code: ANSWER_LOST_CODE }),
    )
    expect(within(sheet).queryByText('Waiter called')).toBeNull()
    expect(within(sheet).getByRole('alert').textContent).toContain('reach Restro right now')
    // A retry is safe for a call: it carries the same action id and a repeat of a kind adds nothing.
    const retry = within(sheet).getByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(2))
    expect(host.of('service.request')[1]?.command).toEqual(host.of('service.request')[0]?.command)
  })

  it('words each refusal from its code: calls_off, kind_not_offered and table_not_open', async () => {
    const said: Record<string, string> = {
      calls_off: 'Calling a waiter from your phone is off here. Ask your waiter.',
      kind_not_offered: 'This can’t be asked for from your phone here. Ask your waiter.',
      table_not_open: 'This table is not taking orders from phones right now.',
    }
    for (const code of Object.keys(said)) {
      const host = fakeHost()
      drawFace(host)
      const sheet = openCall()
      fireEvent.click(within(sheet).getByRole('radio', { name: 'Water' }))
      fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
      // The guest client answers with message null and the code only.
      await act(async () => host.of('service.request')[0]?.answer({ status: 'rejected', code }))
      expect(within(sheet).getByText(said[code] ?? ''), code).toBeTruthy()
      cleanup()
      resetPage()
    }
  })
})

describe('DA-B2-3: Call a waiter on the paying screens shows what became of it', () => {
  it('shows sending, then the refusal, and leaves the button usable (D72)', async () => {
    const host = payFirstHost(false, [
      orderLine(mojito, 1, { mode: 'pay_first' as const, held: true }),
    ])
    host.set({ payment: paymentOf({ mode: 'pay_first', state: 'unconfirmed', form: null }) })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-pay-screen="checking"]')).not.toBeNull()
    const call = sheet.querySelector('[data-slot="pay.call"]') as HTMLButtonElement
    fireEvent.click(call)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    // On its way: the guest is told, and cannot send a second one meanwhile.
    expect(sheet.textContent).toContain('Sending your request')
    expect(call.disabled).toBe(true)
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'rejected', code: 'calls_off' }),
    )
    // Refused: the guest reads it, and the button is theirs again.
    expect(within(sheet).getByRole('alert').textContent).toContain('Ask your waiter')
    expect(call.disabled).toBe(false)
  })

  it('never says a lost call was taken, and keeps the button out of reach (D120)', async () => {
    const host = payFirstHost(false, [
      orderLine(mojito, 1, { mode: 'pay_first' as const, held: true }),
    ])
    host.set({ payment: paymentOf({ mode: 'pay_first', state: 'unconfirmed', form: null }) })
    drawFace(host)
    const sheet = openBag()
    const call = sheet.querySelector('[data-slot="pay.call"]') as HTMLButtonElement
    fireEvent.click(call)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'pending', code: ANSWER_LOST_CODE }),
    )
    expect(sheet.textContent).not.toContain('Waiter called')
    expect(within(sheet).getByRole('alert').textContent).toContain('reach Restro right now')
    expect(call.disabled).toBe(true)
  })

  it('shows the host taking the call, on the bill with no location pass', async () => {
    const host = payFirstHost()
    host.set({
      location: { state: 'needed', prompt: 'none', consent: 'unknown', venueName: 'Club X' },
    })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Your table’s bill' }))
    const sheet = screen.getByRole('dialog', { name: 'Your table’s bill' })
    const call = sheet.querySelector('[data-slot="pay.call"]') as HTMLButtonElement
    expect(call).not.toBeNull()
    fireEvent.click(call)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    await act(async () => host.of('service.request')[0]?.answer())
    expect(sheet.textContent).toContain('Waiter called')
    expect(call.disabled).toBe(true)
  })
})
