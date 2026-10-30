// @vitest-environment jsdom

// The table bill (brief SH-06 test 4): the face draws the host's `state.bill` and nothing else.

import { type ServiceState, stringsFor } from '@restro/shell'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { distinctRounds, keyed } from './bill'
import {
  billLine,
  billOf,
  billRound,
  drawFace,
  eur,
  fakeHost,
  itemNamed,
  orderingView,
  orderLine,
  orderOf,
  payingOf,
  resetPage,
  tableBillOf,
  tableLine,
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
    const host = fakeHost({ order: orderOf([orderLine(itemNamed(orderingView(), 'Hummus'))]) })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Send 1 item/ }),
    )
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    await act(async () => host.of('order.send')[0]?.answer())
    // The face opens nothing and draws no round: the bill is the host's.
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
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

  it('offers "Pay" only when the venue has pay on', () => {
    const noPay = { ...view, features: { ...view.features, pay: false } }
    drawFace(fakeHost({ bill: billOf([staff], 1850) }), noPay)
    const sheet = openBill()
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
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

describe("the table's bill as the POS reads it (state.tableBill, D127)", () => {
  const w = stringsFor('en_US').services
  const own = (changes: Partial<ServiceState> = {}) =>
    fakeHost({ tableBill: tableBillOf(), paying: payingOf(), ...changes })

  it('draws the POS’s own lines and amounts, how old the reading is, and what is left to pay', () => {
    drawFace(own())
    const sheet = openBill()
    const lines = [...sheet.querySelectorAll('[data-slot="bill.lines"] li')].map(
      (line) => line.textContent,
    )
    expect(lines).toEqual(['House wine · €12.50', 'Mojito · €10.00'])
    expect(sheet.querySelector('[data-slot="bill.updated"]')?.textContent).toBe(w.paying.updated(4))
    expect(sheet.querySelector('[data-slot="bill.owed"]')?.textContent).toBe(
      `${w.paying.leftToPay}€22.50`,
    )
    expect(within(sheet).queryByText(w.emptyTab)).toBeNull()
  })

  it('says the reading is not up to date when the host’s last reading failed', () => {
    drawFace(own({ tableBill: tableBillOf(undefined, { complete: false, readAgoSeconds: 40 }) }))
    expect(openBill().querySelector('[data-slot="bill.updated"]')?.textContent).toBe(
      w.paying.stale(40),
    )
  })

  it('greys a line in a payment that is not final with "Being paid"', () => {
    drawFace(
      own({
        tableBill: tableBillOf([
          tableLine(1, 'House wine', 1250, { beingPaid: true }),
          tableLine(2, 'Mojito', 1000),
        ]),
      }),
    )
    const [wine, mojito] = [...openBill().querySelectorAll('[data-slot="bill.lines"] li')]
    expect(wine?.getAttribute('data-being-paid')).toBe('')
    expect(wine?.textContent).toContain(w.paying.beingPaid)
    expect(mojito?.hasAttribute('data-being-paid')).toBe(false)
  })

  it('offers Pay with the amount left, and shows the same amount on the bill button in the bar', () => {
    drawFace(own())
    expect(screen.getByRole('button', { name: 'Table order' }).textContent).toContain('€22.50')
    const sheet = openBill()
    expect(within(sheet).getByRole('button', { name: /^Pay/ }).textContent).toContain('€22.50')
  })

  it('says the bill is empty when the POS has no line and nothing was paid in the app', () => {
    drawFace(own({ tableBill: tableBillOf([]) }))
    const sheet = openBill()
    expect(within(sheet).getByText(w.paying.emptyBill)).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it('keeps the lines paid in the app on the bill, greyed, and offers no Pay once everything is paid', () => {
    drawFace(
      own({
        tableBill: tableBillOf([], {
          owedMinor: 0,
          paidLines: [{ name: { en_US: 'House wine' }, quantity: '1', amountMinor: 1250 }],
        }),
      }),
    )
    const sheet = openBill()
    expect(sheet.querySelector('[data-paid-in-app]')?.textContent).toContain('House wine')
    expect(within(sheet).queryByText(w.paying.emptyBill)).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /^Pay/ })).toBeNull()
  })
})
