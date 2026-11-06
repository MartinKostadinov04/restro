// @vitest-environment jsdom

// DA-B2 (designer audit, money on the new screens), brought in by #293. DA-B2-1 and DA-B2-4 are
// fixed here and now say what the face must do; DA-B2-2 and DA-B2-3 belong to #294 (Call a waiter)
// and still pin the behaviour as it stands, so that ticket's fix turns them round.

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
    await waitFor(() => expect(blocked()?.textContent).toContain('Request sent'))
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

describe('DA-B2-2: Call a waiter claims "Request sent" when the answer was lost', () => {
  const openCall = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Call a server' }))
    return screen.getByRole('dialog', { name: 'Call a server' })
  }

  it('shows "Request sent" for the guest client\'s pending answer_lost (a network error or a 5xx)', async () => {
    const host = fakeHost()
    drawFace(host)
    const sheet = openCall()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Call waiter' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    // services-client.ts unknown(): what the page's host answers for a lost request of any kind.
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'pending', code: ANSWER_LOST_CODE }),
    )
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    expect(within(sheet).queryByRole('alert')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('words every refusal the same: calls_off, kind_not_offered and table_not_open read "Ask your waiter."', async () => {
    for (const code of ['calls_off', 'kind_not_offered', 'table_not_open']) {
      const host = fakeHost()
      drawFace(host)
      const sheet = openCall()
      fireEvent.click(within(sheet).getByRole('radio', { name: 'Water' }))
      fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
      // The guest client answers with message null and the code only.
      await act(async () => host.of('service.request')[0]?.answer({ status: 'rejected', code }))
      expect(within(sheet).getByText('Ask your waiter.'), code).toBeTruthy()
      cleanup()
      resetPage()
    }
  })
})

describe('DA-B2-3: Call a waiter on the paying screens shows nothing of its answer', () => {
  it('a refused call from the "checking" screen leaves the screen as it was, with no word', async () => {
    const host = payFirstHost(false, [
      orderLine(mojito, 1, { mode: 'pay_first' as const, held: true }),
    ])
    host.set({ payment: paymentOf({ mode: 'pay_first', state: 'unconfirmed', form: null }) })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-pay-screen="checking"]')).not.toBeNull()
    const before = sheet.textContent
    const call = sheet.querySelector('[data-slot="pay.call"]') as HTMLButtonElement
    fireEvent.click(call)
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    // No "Sending your request" while it is on its way.
    expect(sheet.textContent).toBe(before)
    await act(async () =>
      host.of('service.request')[0]?.answer({ status: 'rejected', code: 'calls_off' }),
    )
    // Refused, and the guest is told nothing: no alert, no change on the screen.
    expect(within(sheet).queryByRole('alert')).toBeNull()
    expect(sheet.textContent).toBe(before)
    expect(call.disabled).toBe(false)
  })
})
