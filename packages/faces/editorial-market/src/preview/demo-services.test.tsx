// @vitest-environment jsdom

// The demo host of the admin's preview: it keeps its own state, answers slowly enough to see every
// state, and does its money in core's integers.

import type { GuestCommand, ViewModel } from '@restro/shell'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketFace } from '../face'
import { itemNamed, orderingView, resetPage } from '../services/test-kit'
import { DEMO_DELAYS, useDemoServices } from './demo-services'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  resetPage()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const view = orderingView()

function Demo({ source = view }: { source?: ViewModel }) {
  return <EditorialMarketFace view={source} services={useDemoServices(source)} />
}

const later = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const dialog = (name: string) => screen.getByRole('dialog', { name })

describe('the demo host', () => {
  it('starts with a table: one waiter round, a total, and the "Preview" marker on the sheet', () => {
    render(<Demo />)
    click('Table order')
    const sheet = dialog('Table order')
    expect(sheet.querySelector('.ro-preview')?.textContent).toBe('Preview')
    const rounds = sheet.querySelectorAll('.ro-round')
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.getAttribute('data-source')).toBe('staff')
    expect(sheet.textContent).toContain('Still water 750 ml')
    expect(sheet.textContent).toContain('2×Glass of house wine')
    expect(sheet.querySelector('.ro-sum.is-big')?.textContent).toBe('Table total€22.30') // 4,50 + 14,00 + 3,80
  })

  it('speaks Bulgarian to a Bulgarian menu', () => {
    render(<Demo source={orderingView('bg_BG')} />)
    click('Поръчка на масата')
    const sheet = dialog('Поръчка на масата')
    expect(sheet.textContent).toContain('Минерална вода 750 мл')
    expect(sheet.querySelector('.ro-preview')?.textContent).toBe('Преглед')
  })

  it('accepts an order after about 800 ms and adds it as one guest round, which moves from received to served', async () => {
    render(<Demo />)
    click('Add Hummus')
    click('Add Mojito')
    click(/View bag/)
    click(/Send to kitchen/)
    await later(0)
    // Pending: the host has not answered.
    expect(
      within(dialog('Your bag')).getByRole('button', { name: 'Sending your order' }),
    ).toBeTruthy()
    await later(DEMO_DELAYS.order - 100)
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    await later(150)

    const bill = dialog('Table order')
    const rounds = [...bill.querySelectorAll('.ro-round')]
    expect(rounds.map((round) => round.getAttribute('data-source'))).toEqual(['staff', 'guest'])
    expect(rounds[1]?.textContent).toContain('Hummus')
    expect(rounds[1]?.textContent).toContain('Mojito')
    expect(within(rounds[1] as HTMLElement).getAllByText('Received')).toHaveLength(2)
    expect(bill.querySelector('.ro-sum.is-big')?.textContent).toBe('Table total€39.30') // 22,30 + 17,00

    await later(DEMO_DELAYS.preparing)
    expect(within(rounds[1] as HTMLElement).getAllByText('Preparing')).toHaveLength(2)
    await later(DEMO_DELAYS.served - DEMO_DELAYS.preparing)
    expect(within(rounds[1] as HTMLElement).getAllByText('Served')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /View bag/ })).toBeNull() // the bag was spent
  })

  it('rejects an order with something that is no longer for sale', async () => {
    const soldOut: ViewModel = {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.name.text === 'Hummus'
            ? { ...item, order: { controls: false, askWaiter: null } }
            : item,
        ),
      })),
    }
    const { result } = renderHook(() => useDemoServices(soldOut))
    const pending = result.current.dispatch({
      kind: 'order.send',
      actionId: '33333333-3333-4333-8333-333333333333',
      lines: [{ itemId: itemNamed(view, 'Hummus').id, optionIds: [], qty: 1, note: '' }],
    })
    await later(DEMO_DELAYS.order)
    const answer = await pending
    expect(answer.status).toBe('rejected')
    expect(answer.message?.text).toContain('no longer available')
    expect(result.current.state.bill?.rounds.filter((round) => round.origin === 'guest')).toEqual(
      [],
    )
  })

  it('answers a repeat of an action with the first answer, and adds nothing twice (idempotency)', async () => {
    const { result } = renderHook(() => useDemoServices(view))
    const command: GuestCommand = {
      kind: 'order.send',
      actionId: '44444444-4444-4444-8444-444444444444',
      lines: [{ itemId: itemNamed(view, 'Mojito').id, optionIds: [], qty: 2, note: '' }],
    }
    const first = result.current.dispatch(command)
    const second = result.current.dispatch(command) // while the first is still being answered
    await later(DEMO_DELAYS.order)
    expect(await first).toBe(await second)
    const third = await result.current.dispatch(command) // and after
    expect(third).toBe(await first)
    const rounds = result.current.state.bill?.rounds ?? []
    expect(rounds.filter((round) => round.origin === 'guest')).toHaveLength(1)
    expect(result.current.state.bill?.total.minor).toBe(2230 + 2000)
    expect(result.current.state.preview).toBe(true)
  })

  it('sends a waiter request, makes it "on the way" a moment later, and cancels it', async () => {
    render(<Demo />)
    click('Call a server')
    const sheet = dialog('Call a server')
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Call waiter' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
    await later(0)
    expect(within(sheet).getByText('Sending your request')).toBeTruthy()
    await later(DEMO_DELAYS.request)
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    expect(sheet.textContent).not.toContain('on the way')
    await later(DEMO_DELAYS.onTheWay)
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }))
    await later(DEMO_DELAYS.request)
    expect(within(sheet).getByText('Request cancelled')).toBeTruthy()
  })

  it("quotes the table with core's integers: tip, VAT inside the price, a split and the code DEMO10", async () => {
    render(<Demo />)
    click('Pay')
    const sheet = dialog('Pay')
    await later(0)
    await later(DEMO_DELAYS.quote)
    // 22,30 + the default tip of 10 % (2,23); the VAT is the 20 % that is in the price (3,72).
    expect(sheet.textContent).toContain('Subtotal€22.30')
    expect(sheet.textContent).toContain('Tip for the team€2.23')
    expect(sheet.textContent).toContain('incl. VAT 20%€3.72')
    expect(sheet.textContent).toContain('Total€24.53')
    expect(
      within(sheet)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(
      expect.arrayContaining(['Apple Pay', 'Google Pay', 'Card', 'Pay the waiter at the table']),
    )

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Split equally' }))
    await later(0)
    await later(DEMO_DELAYS.quote)
    expect(sheet.textContent).toContain('Subtotal€11.15') // 22,30 ÷ 2
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Full table' }))
    await later(0)
    await later(DEMO_DELAYS.quote)

    fireEvent.click(within(sheet).getByRole('radio', { name: '15%' }))
    await later(0)
    await later(DEMO_DELAYS.quote)
    expect(sheet.textContent).toContain('Tip for the team€3.35') // 15 % of 22,30 = 3,345, half-up

    fireEvent.change(within(sheet).getByLabelText('Promo code'), { target: { value: 'demo10' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }))
    await later(0)
    await later(DEMO_DELAYS.quote)
    expect(sheet.textContent).toContain('Code applied')
    expect(sheet.textContent).toContain('Subtotal€20.07') // 22,30 − 10 % (2,23)
  })

  it('takes a payment after a moment, issues a receipt and settles the table', async () => {
    render(<Demo />)
    click('Pay')
    const sheet = dialog('Pay')
    await later(0)
    await later(DEMO_DELAYS.quote)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Card' }))
    await later(0)
    expect(within(sheet).getByText('Processing your payment')).toBeTruthy()
    expect(sheet.textContent).not.toContain('Payment complete')
    await later(DEMO_DELAYS.pay)
    expect(within(sheet).getByText('Payment complete')).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: 'View receipt' }))
    const receipt = dialog('Receipt')
    expect(receipt.querySelector('.ro-preview')?.textContent).toBe('Preview')
    expect(receipt.textContent).toContain('Demo venue')
    expect(receipt.textContent).toContain('2× Glass of house wine')
    expect(receipt.textContent).toContain('Total€24.53')
    expect(receipt.textContent).toContain('Paid withCard')
    fireEvent.click(within(receipt).getByRole('button', { name: 'Email receipt' }))
    await later(0)
    await later(DEMO_DELAYS.receiptAction)
    expect(within(receipt).getByRole('status').textContent).toBe('Demo: sent to your phone.')

    fireEvent.click(within(receipt).getByRole('button', { name: 'Back to menu' }))
    await act(async () => {
      window.history.back()
      await vi.advanceTimersByTimeAsync(0)
    })
    click('Table order')
    expect(within(dialog('Table order')).getByText('Nothing has been ordered yet.')).toBeTruthy()
  })

  it('leaves no timer running when it is taken away', async () => {
    const { result, unmount } = renderHook(() => useDemoServices(view))
    const idle = vi.getTimerCount()
    const pending = result.current.dispatch({
      kind: 'order.send',
      actionId: '55555555-5555-4555-8555-555555555555',
      lines: [{ itemId: itemNamed(view, 'Hummus').id, optionIds: [], qty: 1, note: '' }],
    })
    await later(DEMO_DELAYS.order)
    expect((await pending).status).toBe('accepted')
    expect(vi.getTimerCount()).toBeGreaterThan(idle) // the line statuses are on their way
    unmount()
    expect(vi.getTimerCount()).toBe(idle)
  })
})
