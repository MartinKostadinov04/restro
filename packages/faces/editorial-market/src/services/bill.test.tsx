// @vitest-environment jsdom

// The table bill (brief SH-06 test 4): the face draws the host's `state.bill` and nothing else.

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { distinctRounds, keyed } from './bill'
import {
  billLine,
  billOf,
  billRound,
  drawFace,
  eur,
  fakeHost,
  orderingView,
  receiptOf,
  resetPage,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const view = orderingView()
const A = '11111111-1111-4111-8111-111111111111'

const staff = billRound('s1', 'staff', [
  billLine('w1', 'Still water', 1, 450, 'served'),
  billLine('w2', 'House wine', 2, 1400, 'preparing'),
])
const guest = billRound('g1', 'guest', [billLine('g1-1', 'Hummus', 1, 700, 'received')], A, '20:15')

const openBill = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
  return screen.getByRole('dialog', { name: 'Table order' })
}

describe('distinctRounds', () => {
  it('keeps every round of the host, in its order', () => {
    const bill = billOf([staff, guest], 2550)
    expect(distinctRounds(bill).map((round) => round.id)).toEqual(['s1', 'g1'])
    expect(distinctRounds(null)).toEqual([])
  })

  it('draws a guest round once when the state echoes it, matched by actionId', () => {
    const echo = billRound('g1-echo', 'guest', [billLine('e1', 'Hummus', 1, 700, 'preparing')], A)
    expect(distinctRounds(billOf([staff, guest, echo], 2550)).map((round) => round.id)).toEqual([
      's1',
      'g1',
    ])
  })

  it('draws a round whose id repeats once, and never merges staff rounds (they have no actionId)', () => {
    const second = billRound('s2', 'staff', [billLine('x', 'Bread', 1, 380)])
    expect(
      distinctRounds(billOf([staff, staff, second, { ...second, id: 's3' }], 0)).map(
        (round) => round.id,
      ),
    ).toEqual(['s1', 's2', 's3'])
  })

  it('numbers a repeated option text so each has its own key', () => {
    expect(keyed([text('Ice'), text('Ice'), text('Lemon')]).map((entry) => entry.key)).toEqual([
      'Ice#1',
      'Ice#2',
      'Lemon#1',
    ])
  })
})

describe('the bill sheet', () => {
  it("shows the host's rounds, with who made them, a status for each line, and the host's total", () => {
    // The total is the host's own and is deliberately not the sum of the lines.
    drawFace(fakeHost({ bill: billOf([staff, guest], 9999) }))
    const sheet = openBill()
    const rounds = [...sheet.querySelectorAll('.ro-round')]
    expect(rounds).toHaveLength(2)
    expect(rounds[0]?.textContent).toContain('Round 1 · 19:42')
    expect(rounds[0]?.textContent).toContain('From the waiter')
    expect(rounds[1]?.textContent).toContain('Round 2 · 20:15')
    expect(rounds[1]?.textContent).toContain('From the app')
    expect(rounds[0]?.getAttribute('data-source')).toBe('staff')
    expect(rounds[1]?.getAttribute('data-source')).toBe('guest')
    expect(within(sheet).getByText('Served')).toBeTruthy()
    expect(within(sheet).getByText('Preparing')).toBeTruthy()
    expect(within(sheet).getByText('Received')).toBeTruthy()
    expect(within(sheet).getByText('2×')).toBeTruthy()
    expect(sheet.querySelector('.ro-sum.is-big')?.textContent).toContain('€99.99')
    // The bill button in the header says the same.
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  it("shows the bill button with the host's total only once the bill has a round", () => {
    const host = fakeHost()
    const page = drawFace(host)
    expect(screen.getByRole('button', { name: 'Table order' }).textContent).toBe('Bill')
    page.update({ bill: billOf([staff], 1850) })
    expect(screen.getByRole('button', { name: 'Table order' }).textContent).toBe('Bill · €18.50')
    page.update({ bill: billOf([], 0) })
    expect(screen.getByRole('button', { name: 'Table order' }).textContent).toBe('Bill')
  })

  it('draws a guest round once even when the state lists it twice', () => {
    const echo = billRound(
      'g1-echo',
      'guest',
      [billLine('e1', 'Hummus', 1, 700, 'preparing')],
      A,
      '20:16',
    )
    drawFace(fakeHost({ bill: billOf([staff, guest, echo], 2550) }))
    const sheet = openBill()
    expect(sheet.querySelectorAll('.ro-round[data-source="guest"]')).toHaveLength(1)
    expect(within(sheet).getAllByText('Hummus')).toHaveLength(1)
  })

  it('never adds a round of its own: a bill that is empty stays empty after the host accepted an order', async () => {
    const host = fakeHost()
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Add Hummus' }))
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Send to kitchen/ }),
    )
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    host.of('order.send')[0]?.answer()
    const sheet = await screen.findByRole('dialog', { name: 'Table order' })
    expect(within(sheet).getByText('Nothing has been ordered yet.')).toBeTruthy()
    expect(sheet.querySelector('.ro-round')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it("shows a round when the host's state gets it, and updates a line when the host changes its status", () => {
    const host = fakeHost({ bill: billOf([staff], 1850) })
    const page = drawFace(host)
    const sheet = openBill()
    expect(sheet.querySelectorAll('.ro-round')).toHaveLength(1)
    page.update({ bill: billOf([staff, guest], 2550) })
    expect(sheet.querySelectorAll('.ro-round')).toHaveLength(2)
    expect(within(sheet).getByText('Received')).toBeTruthy()
    page.update({
      bill: billOf(
        [
          staff,
          billRound('g1', 'guest', [billLine('g1-1', 'Hummus', 1, 700, 'served')], A, '20:15'),
        ],
        2550,
      ),
    })
    expect(within(sheet).queryByText('Received')).toBeNull()
    expect(within(sheet).getAllByText('Served').length).toBe(2)
  })

  it('strikes through a cancelled line and keeps it on the bill with its status', () => {
    const cancelled = billRound('s1', 'staff', [billLine('c1', 'Soup', 1, 600, 'cancelled')])
    drawFace(fakeHost({ bill: billOf([cancelled], 0) }))
    const sheet = openBill()
    expect(within(sheet).getByText('Cancelled')).toBeTruthy()
    expect(sheet.querySelector('li[data-status="cancelled"]')).not.toBeNull()
  })

  it('offers "Pay" with the host\'s total while the table owes, and not when it owes nothing', () => {
    const host = fakeHost({ bill: billOf([staff], 1850) })
    const page = drawFace(host)
    const sheet = openBill()
    const pay = within(sheet).getByRole('button', { name: /^Pay/ })
    expect(pay.textContent).toContain('€18.50')
    page.update({ bill: billOf([staff], 0) })
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it('offers "Pay" and the receipt only when the venue has pay on', () => {
    const noPay = { ...view, features: { ...view.features, pay: false } }
    drawFace(fakeHost({ bill: billOf([staff], 1850), receipt: receiptOf() }), noPay)
    const sheet = openBill()
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'View receipt' })).toBeNull()
  })

  it('offers the receipt once the host has one', () => {
    drawFace(fakeHost({ bill: billOf([staff], 0), receipt: receiptOf() }))
    const sheet = openBill()
    fireEvent.click(within(sheet).getByRole('button', { name: 'View receipt' }))
    expect(screen.getByRole('dialog', { name: 'Receipt' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
  })

  it('draws the bill in Bulgarian, with the words of the language', () => {
    drawFace(fakeHost({ bill: billOf([staff, guest], 2550) }), orderingView('bg_BG'))
    fireEvent.click(screen.getByRole('button', { name: 'Поръчка на масата' }))
    const sheet = screen.getByRole('dialog', { name: 'Поръчка на масата' })
    expect(sheet.textContent).toContain('От сервитьора')
    expect(sheet.textContent).toContain('От приложението')
    expect(sheet.textContent).toContain('Сервирана')
    expect(sheet.textContent).toContain('Общо за масата')
  })

  it("keeps the host's lines in their language when the text is a fallback", () => {
    const round = billRound('s1', 'staff', [
      { ...billLine('f1', 'Soupe', 1, 500), name: text('Soupe', 'fr_FR') },
    ])
    drawFace(fakeHost({ bill: billOf([round], 500) }))
    const sheet = openBill()
    expect(within(sheet).getByText('Soupe').getAttribute('lang')).toBe('fr-FR')
  })

  it('shows the option texts of a line', () => {
    const line = { ...billLine('o1', 'Bowl', 1, 1250), options: [text('Large'), text('Avocado')] }
    drawFace(fakeHost({ bill: billOf([billRound('s1', 'staff', [line])], 1250) }))
    expect(openBill().textContent).toContain('Large · Avocado')
    expect(eur(1250).text).toBe('€12.50')
  })
})
