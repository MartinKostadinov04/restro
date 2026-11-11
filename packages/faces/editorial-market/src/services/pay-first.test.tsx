// @vitest-environment jsdom

// Pay first at Send on the order screen (#258, D113, D127): "Send and pay", the tip row, "Pay
// later" and the ended screens. One `order.send` carries the on-the-bill lines and the pay-first
// part; the amounts are the shell's; the screen follows the host's state and claims no success of
// its own (D72). Where the phone can't pay (`ordering.payFirst` not `on`) the line stays "Order this
// from your waiter".

import { stringsFor } from '@restro/shell'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
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

const W = stringsFor('en_US').services

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.style.overflow = ''
})

const view = orderingView()
const hummus = itemNamed(view, 'Hummus')
const mojito = itemNamed(view, 'Mojito')

/** A table that takes pay-first: Hummus is on the bill (7.00), the Mojito is paid first (10.00). */
function payFirstHost(
  ordering: { payFirst?: 'on' | 'paused' | 'off'; tips?: boolean; state?: 'on' | 'paused' } = {},
  lines = [orderLine(hummus), orderLine(mojito, 1, { mode: 'pay_first' as const })],
): FakeHost {
  return orderHost({
    order: orderOf(lines),
    ordering: {
      state: ordering.state ?? 'on',
      notesAndOptions: true,
      payFirst: ordering.payFirst ?? 'on',
      ...(ordering.tips === undefined ? {} : { tips: ordering.tips }),
    },
  })
}

const openBag = () => {
  fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
  return screen.getByRole('dialog', { name: 'Your bag' })
}
const sendButton = (sheet: HTMLElement) => sheet.querySelector('[data-send]') as HTMLButtonElement
const payFirstNote = (sheet: HTMLElement) => sheet.querySelector('[data-pay-first-line]')
const tipRow = (sheet: HTMLElement) => sheet.querySelector('[data-slot="pay.tip.row"]')

describe('Send and pay (one tap)', () => {
  it('words the pay-first line "Not ordered until paid" and the button "Send and pay" with the amount', () => {
    drawFace(payFirstHost())
    const sheet = openBag()
    expect(payFirstNote(sheet)?.textContent).toBe(W.notUntilPaid)
    expect(W.notUntilPaid).toBe('Not ordered until paid')
    expect(sendButton(sheet).textContent).toBe('Send and pay €10.00')
    expect(sendButton(sheet).disabled).toBe(false)
  })

  it('sends the bill lines and the pay-first lines in one order.send, with no tip to start with', async () => {
    const host = payFirstHost({ tips: true })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    const { command } = host.of('order.send')[0] ?? {}
    expect(command?.lines.map((line) => line.itemId)).toEqual([hummus.id])
    expect(command?.payFirst).toEqual({
      lines: [{ itemId: mojito.id, optionIds: [], qty: 1, note: '' }],
      tipMinor: null,
      tipPercent: null,
    })
    expect(host.calls).toHaveLength(1)
  })

  it('offers the tip row above the button where the till records a tip: 5, 10, 15 % and an amount', async () => {
    const host = payFirstHost({ tips: true })
    drawFace(host)
    const sheet = openBag()
    const row = tipRow(sheet)
    expect(row).not.toBeNull()
    // The row sits above "Send and pay".
    expect(
      (row as Element).compareDocumentPosition(sendButton(sheet)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const presets = [...sheet.querySelectorAll('[data-slot="pay.tip.preset"]')]
    expect(presets.map((preset) => preset.textContent)).toEqual(['5 %', '10 %', '15 %'])
    // None chosen to start with (no preselected tip).
    expect(presets.every((preset) => preset.getAttribute('aria-pressed') === 'false')).toBe(true)
    // 10 % of 10.00 is 1.00: the shell's sum, on the button.
    fireEvent.click(presets[1] as Element)
    expect(sendButton(sheet).textContent).toBe('Send and pay €11.00')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.payFirst).toMatchObject({
      tipPercent: 10,
      tipMinor: null,
    })
    // Tapping the chosen one clears it.
    cleanup()
    resetPage()
    drawFace(payFirstHost({ tips: true }))
    const again = openBag()
    const chip = again.querySelectorAll('[data-slot="pay.tip.preset"]')[1] as Element
    fireEvent.click(chip)
    fireEvent.click(chip)
    expect(sendButton(again).textContent).toBe('Send and pay €10.00')
  })

  it('sends an amount as tipMinor and reads it in the shell’s sum', async () => {
    const host = payFirstHost({ tips: true })
    drawFace(host)
    const sheet = openBag()
    const other = sheet.querySelector('[data-slot="pay.tip.other"]') as HTMLInputElement
    fireEvent.change(other, { target: { value: '2.50' } })
    expect(sendButton(sheet).textContent).toBe('Send and pay €12.50')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.payFirst).toMatchObject({
      tipMinor: 250,
      tipPercent: null,
    })
  })

  it('greys the button, with the words, for a tip over the lines, and sends nothing', () => {
    const host = payFirstHost({ tips: true })
    drawFace(host)
    const sheet = openBag()
    fireEvent.change(sheet.querySelector('[data-slot="pay.tip.other"]') as HTMLInputElement, {
      target: { value: '99' },
    })
    expect(sendButton(sheet).disabled).toBe(true)
    expect(within(sheet).getByText(W.paying.tipTooBig)).toBeTruthy()
    fireEvent.click(sendButton(sheet))
    expect(host.calls).toHaveLength(0)
  })

  it('draws no tip row where the till can not record a tip, and sends no tip', async () => {
    for (const tips of [undefined, false]) {
      const host = payFirstHost(tips === undefined ? {} : { tips })
      drawFace(host)
      const sheet = openBag()
      expect(tipRow(sheet)).toBeNull()
      fireEvent.click(sendButton(sheet))
      await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
      expect(host.of('order.send')[0]?.command.payFirst).toMatchObject({
        tipMinor: null,
        tipPercent: null,
      })
      cleanup()
      resetPage()
    }
  })

  it('names every pay-first line the phone has, and prices them in the shell', async () => {
    const lines = [
      orderLine(hummus),
      orderLine(mojito, 2, { mode: 'pay_first' }),
      orderLine(itemNamed(view, 'Vodka'), 1, { mode: 'pay_first' }),
    ]
    const host = payFirstHost({}, lines)
    drawFace(host)
    const sheet = openBag()
    // Mojito 2 × 10.00; the Vodka has no ordering controls (ask the waiter), so it is not named.
    expect(sendButton(sheet).textContent).toBe('Send and pay €20.00')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.payFirst?.lines.map((line) => line.qty)).toEqual([2])
  })
})

describe('pay-first lines alone', () => {
  const alone = () => [orderLine(mojito, 1, { mode: 'pay_first' as const })]

  it('can Send: the button reads "Pay" with the amount and sends an empty bill part', async () => {
    const host = payFirstHost({ tips: true }, alone())
    drawFace(host)
    const sheet = openBag()
    expect(payFirstNote(sheet)?.textContent).toBe('Not ordered until paid')
    expect(sendButton(sheet).textContent).toBe('Pay €10.00')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    const { command } = host.of('order.send')[0] ?? {}
    expect(command?.lines).toEqual([])
    expect(command?.payFirst?.lines).toHaveLength(1)
  })

  it('offers "Pay" again when the guest leaves the card form: the lines are back on the order', () => {
    // After "Pay later" the host has no payment of this phone's and the line is free again.
    const host = payFirstHost({}, alone())
    drawFace(host)
    const sheet = openBag()
    expect(within(sheet).getByRole('button', { name: 'Pay €10.00' })).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: /^Send/ })).toBeNull()
  })
})

describe('where the phone can not pay', () => {
  it.each([
    ['paused', 'paused' as const],
    ['off', 'off' as const],
    ['absent', undefined],
  ])(
    'keeps "Order this from your waiter" and sends only the bill lines (pay-first %s)',
    async (_name, payFirst) => {
      const host = orderHost({
        order: orderOf([orderLine(hummus), orderLine(mojito, 1, { mode: 'pay_first' })]),
        ordering: {
          state: 'on',
          notesAndOptions: true,
          tips: true,
          ...(payFirst ? { payFirst } : {}),
        },
      })
      drawFace(host)
      const sheet = openBag()
      expect(payFirstNote(sheet)?.textContent).toBe(W.orderFromWaiter)
      expect(tipRow(sheet)).toBeNull()
      expect(sendButton(sheet).textContent).toBe(W.sendItems(1))
      fireEvent.click(sendButton(sheet))
      await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
      expect(host.of('order.send')[0]?.command.payFirst).toBeUndefined()
    },
  )

  it('offers no Send at all for pay-first lines alone', () => {
    const host = orderHost({
      order: orderOf([orderLine(mojito, 1, { mode: 'pay_first' })]),
      ordering: { state: 'on', notesAndOptions: true, payFirst: 'off' },
    })
    drawFace(host)
    const sheet = openBag()
    expect(sendButton(sheet)).toBeNull()
    expect(payFirstNote(sheet)?.textContent).toBe(W.orderFromWaiter)
  })
})

describe('the same greys as Send (D120, D121)', () => {
  it('greys Send and pay while ordering is paused, and the order stays editable', () => {
    const host = payFirstHost({ state: 'paused' })
    drawFace(host)
    const sheet = openBag()
    expect(within(sheet).getByText(W.orderingPaused)).toBeTruthy()
    expect(sendButton(sheet).textContent).toBe('Send and pay €10.00')
    expect(sendButton(sheet).disabled).toBe(true)
    fireEvent.click(sendButton(sheet))
    expect(host.calls).toHaveLength(0)
    // Still editable: the lines keep their controls.
    expect(within(sheet).getAllByRole('button', { name: /^Remove/ }).length).toBeGreaterThan(0)
  })

  it('greys Send and pay while the phone is offline, and queues nothing', () => {
    const host = payFirstHost()
    host.set({ offline: true })
    drawFace(host)
    const sheet = openBag()
    expect(sendButton(sheet).disabled).toBe(true)
    fireEvent.click(sendButton(sheet))
    expect(host.calls).toHaveLength(0)
  })
})

describe('what a refused Send keeps and says', () => {
  it.each([
    ['paying_paused', 'Card payments are paused right now. Ask your waiter.'],
    ['paying_not_offered', 'Ask your waiter to pay.'],
    ['tip_not_offered', 'A tip can’t be added right now. Pay without a tip.'],
    ['order_changed', 'Someone at your table changed this. Here is the latest order.'],
  ])('%s: the words, and the order is kept', async (code, words) => {
    const host = payFirstHost({ tips: true })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    host.of('order.send')[0]?.answer({ status: 'rejected', code })
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe(words))
    expect(sheet.querySelectorAll('[data-order-line]')).toHaveLength(2)
  })

  it('names the venue’s smallest card payment for below_minimum', async () => {
    const host = payFirstHost({ tips: true })
    host.set({ paying: payingOf({ minCardMinor: 150 }), tableBill: tableBillOf() })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    host.of('order.send')[0]?.answer({ status: 'rejected', code: 'below_minimum' })
    await waitFor(() =>
      expect(within(sheet).getByRole('alert').textContent).toBe(
        'Card payments start at €1.50. Add an item or ask your waiter.',
      ),
    )
  })

  it('shows no success of its own: the lines stay until the host holds them', async () => {
    const host = payFirstHost()
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(sheet.querySelectorAll('[data-order-line]')).toHaveLength(2)
    expect(sheet.querySelector('[data-pay-screen]')).toBeNull()
  })
})

describe('their payment, in the sheet the guest is in', () => {
  const held = () => [orderLine(mojito, 1, { mode: 'pay_first' as const, held: true })]

  it('says a held pay-first line is held, and does not offer to pay it again', () => {
    const host = payFirstHost({}, held())
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector(`[data-item-id="${mojito.id}"]`)?.textContent).toContain(W.heldLine)
    expect(payFirstNote(sheet)).toBeNull()
    expect(sendButton(sheet)).toBeNull()
  })

  it('opens “Preparing your bill…” with Pay later, then the card form, in the bag sheet', () => {
    const host = payFirstHost({}, held())
    host.set({ payment: paymentOf({ mode: 'pay_first', state: 'requested', form: null }) })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-pay-screen="preparing"]')).not.toBeNull()
    expect(within(sheet).getByText('Preparing your bill…')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Pay later' })).toBeTruthy()
    cleanup()
    resetPage()
    const form = payFirstHost({}, held())
    form.set({ payment: paymentOf({ mode: 'pay_first' }) })
    drawFace(form)
    const card = openBag()
    expect(card.querySelector('[data-pay-screen="card"]')).not.toBeNull()
    expect(card.querySelector('[data-slot="pay.form"]')).not.toBeNull()
    expect(form.forms).toHaveLength(1)
    expect(within(card).getByRole('button', { name: 'Pay later' })).toBeTruthy()
  })

  it('Pay later sends pay.cancel, and “Back to the bill” leaves the screen for the order', async () => {
    const host = payFirstHost({}, held())
    host.set({ payment: paymentOf({ mode: 'pay_first' }) })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay later' }))
    await waitFor(() => expect(host.of('pay.cancel')).toHaveLength(1))
    host.of('pay.cancel')[0]?.answer()
    await waitFor(() => expect(host.dismissed()).toBe(1))
  })

  it('draws one waiting state, then Paid, only once the host says captured', () => {
    for (const [state, screenName] of [
      ['held', 'waiting'],
      ['entered', 'waiting'],
      ['captured', 'paid'],
    ] as const) {
      const host = payFirstHost({}, held())
      host.set({ payment: paymentOf({ mode: 'pay_first', state, form: null }) })
      drawFace(host)
      const sheet = openBag()
      expect(sheet.querySelector(`[data-pay-screen="${screenName}"]`), state).not.toBeNull()
      cleanup()
      resetPage()
    }
  })

  it.each([
    [
      'enter_refused',
      'We couldn’t send this order. Nothing was charged. Please call a waiter.',
      false,
    ],
    [
      'item_unavailable',
      'Something ran out, so nothing was sent and nothing was charged. Pay for the rest when you’re ready.',
      false,
    ],
  ])('draws the ended screen for %s with its fixed words', (reason, words, again) => {
    const host = payFirstHost({}, held())
    host.set({
      payment: paymentOf({ mode: 'pay_first', state: 'released', reason, form: null }),
    })
    drawFace(host)
    const sheet = openBag()
    expect(within(sheet).getByText(words)).toBeTruthy()
    expect(sheet.querySelector(`[data-pay-end]`)).not.toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Pay again' }) !== null).toBe(again)
    expect(within(sheet).getByRole('button', { name: 'Back to the bill' })).toBeTruthy()
  })

  it('draws r_pay_first_unpaid for a pay-first round that reached the till, never as a failed bill payment', () => {
    const host = payFirstHost({}, held())
    host.set({
      payment: paymentOf({
        mode: 'pay_first',
        state: 'released',
        reason: 'no_receipt',
        form: null,
      }),
    })
    drawFace(host)
    const sheet = openBag()
    expect(
      within(sheet).getByText(
        'Nothing was charged. Your order went through, and your waiter will take the payment.',
      ),
    ).toBeTruthy()
    expect(sheet.querySelector('[data-pay-end="pay_first_unpaid"]')).not.toBeNull()
  })

  it('leaves a bill payment to the pay sheet: the bag keeps showing the order', () => {
    const host = payFirstHost()
    host.set({ payment: paymentOf({ mode: 'bill' }) })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-pay-screen]')).toBeNull()
    expect(sheet.querySelector('[data-order-line]')).not.toBeNull()
  })
})

describe('in Bulgarian', () => {
  it('words the line and the button in Bulgarian', () => {
    const host = payFirstHost()
    drawFace(host, orderingView('bg_BG'))
    fireEvent.click(document.querySelector('[data-slot="menu.bag"] button') as Element)
    const sheet = screen.getByRole('dialog')
    expect(payFirstNote(sheet)?.textContent).toBe('Не е поръчано, докато не се плати')
    expect(sendButton(sheet).textContent).toMatch(/^Изпрати и плати 10,00/)
  })
})
