// @vitest-environment jsdom

// The bag and what sending it shows (D72, brief SH-06 tests 1 to 3): a draft the guest keeps until
// the host says yes. No local success: pending, then accepted or rejected from the host.

import type { ViewModel } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketFace } from '../face'
import { itemsOf, viewOf } from '../test-views'
import { SERVICE_TIMEOUT_MS } from './command'
import {
  billLine,
  billOf,
  billRound,
  drawFace,
  fakeHost,
  itemNamed,
  orderingView,
  resetPage,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const view = orderingView()
const hummus = itemNamed(view, 'Hummus')
const mojito = itemNamed(view, 'Mojito')

const quickAdd = (name: string) => screen.getByRole('button', { name: `Add ${name}` })
const bagButton = () => screen.queryByRole('button', { name: /View bag/ })
const openBag = () => {
  const button = bagButton()
  if (button === null) throw new Error('the bag button is not there')
  fireEvent.click(button)
  return screen.getByRole('dialog', { name: 'Your bag' })
}
const sendButton = (sheet: HTMLElement) =>
  within(sheet).getByRole('button', { name: /Send to kitchen/ })

/** The view with one dish no longer orderable (sold out): the same ids, so the bag still points at it. */
function withoutControls(source: ViewModel, name: string): ViewModel {
  return {
    ...source,
    sections: source.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.name.text === name
          ? {
              ...item,
              order: { controls: false, askWaiter: null },
              state: { ...item.state, code: 'sold_out' as const },
            }
          : item,
      ),
    })),
  }
}

describe('what is drawn, and what is not (test 1)', () => {
  it('draws no quick add, bag bar, waiter, bill or pay button when the host binds no services', () => {
    render(<EditorialMarketFace view={view} />)
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
    expect(bagButton()).toBeNull()
    for (const name of ['Call a server', 'Table order', 'Pay']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull()
    }
    expect(document.querySelector('.ro-bagbar')).toBeNull()
  })

  it('draws none of them when the venue switched the services off, though the host bound them', () => {
    const off = viewOf(fixture('features-off'))
    drawFace(fakeHost(), off)
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
    expect(
      document.querySelector(
        '[data-slot^="menu.b"], [data-slot="menu.pay"], [data-slot="menu.call_waiter"]',
      ),
    ).toBeNull()
    expect(document.querySelector('.ro-bagbar')).toBeNull()
  })

  it('draws each service on its own: only the controls of the services that are on', () => {
    const only: ViewModel['features'] = {
      ...view.features,
      callWaiter: null,
      bill: false,
      ordering: false,
      pay: false,
    }
    const cases: [string, Partial<ViewModel['features']>, string[]][] = [
      ['waiter', { callWaiter: { kinds: ['waiter' as const] } }, ['menu.call_waiter']],
      ['bill', { bill: true }, ['menu.bill']],
      ['ordering', { ordering: true }, ['menu.bag']],
      ['pay', { pay: true }, ['menu.pay']],
    ]
    for (const [name, on, slots] of cases) {
      const { unmount } = drawFace(fakeHost(), { ...view, features: { ...only, ...on } })
      // The service controls only: the layout switch is the menu's (D92), not a service.
      const drawn = [
        ...document.querySelectorAll('[data-slot^="menu."]:not([data-slot="menu.layout_switch"])'),
      ].map((e) => e.getAttribute('data-slot'))
      expect(drawn, name).toEqual(slots)
      // The quick add belongs to ordering alone.
      expect(screen.queryAllByRole('button', { name: /^Add / }).length > 0, name).toBe(
        name === 'ordering',
      )
      unmount()
    }
  })

  it('draws no quick add on an item without ordering controls, even with ordering on (test 2)', () => {
    drawFace(fakeHost())
    expect(quickAdd('Hummus')).toBeTruthy()
    expect(quickAdd('Mojito')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add Steak' })).toBeNull() // sold out
    expect(screen.queryByRole('button', { name: 'Add Vodka' })).toBeNull() // ask the waiter
    expect(itemNamed(view, 'Steak').order.controls).toBe(false)
    expect(itemNamed(view, 'Vodka').order.controls).toBe(false)
  })

  it("draws no quick add when the feature is on but the item lost its controls (R11 is the item's own word)", () => {
    drawFace(fakeHost(), withoutControls(view, 'Hummus'))
    expect(screen.queryByRole('button', { name: 'Add Hummus' })).toBeNull()
    expect(quickAdd('Mojito')).toBeTruthy()
  })

  it('draws the controls of the dish page only for a dish that can be ordered', () => {
    drawFace(fakeHost())
    fireEvent.click(screen.getByRole('button', { name: /^Steak/ }))
    const page = screen.getByRole('dialog', { name: 'Steak' })
    expect(within(page).queryByRole('button', { name: /Add to bag/ })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    expect(
      within(screen.getByRole('dialog', { name: 'Hummus' })).getByRole('button', {
        name: /Add to bag/,
      }),
    ).toBeTruthy()
  })
})

describe('the bag before it is sent', () => {
  it('shows a bag bar with the count and an estimate labelled "approx." once something is added', () => {
    drawFace(fakeHost())
    const slot = document.querySelector('[data-slot="menu.bag"]')
    expect(slot).not.toBeNull()
    expect(bagButton()).toBeNull()
    fireEvent.click(quickAdd('Hummus'))
    fireEvent.click(quickAdd('Mojito'))
    const bar = bagButton()
    expect(bar?.closest('[data-slot="menu.bag"]')).toBe(slot)
    expect(bar?.textContent).toContain('2')
    expect(bar?.textContent).toContain('approx.')
    expect(bar?.textContent).toContain('€17.00')
  })

  it('turns the "+" into a counter, counts the same dish once, and drops it at zero', () => {
    drawFace(fakeHost())
    fireEvent.click(quickAdd('Hummus'))
    expect(screen.queryByRole('button', { name: 'Add Hummus' })).toBeNull()
    expect(document.querySelector(`[data-item="${hummus.id}"] .ro-quick output`)?.textContent).toBe(
      '1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'One more: Hummus' }))
    expect(bagButton()?.textContent).toContain('€14.00')
    fireEvent.click(screen.getByRole('button', { name: 'One less: Hummus' }))
    fireEvent.click(screen.getByRole('button', { name: 'One less: Hummus' }))
    expect(bagButton()).toBeNull()
    expect(quickAdd('Hummus')).toBeTruthy()
  })

  it('opens the dish page instead of adding a dish that needs a choice, and adds it from there', async () => {
    drawFace(fakeHost())
    fireEvent.click(quickAdd('Bowl'))
    expect(bagButton()).toBeNull()
    const page = screen.getByRole('dialog', { name: 'Bowl' })
    const add = within(page).getByRole('button', { name: /Add to bag/ })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(add) // the Size is required: the page stays and says so
    expect(screen.getByRole('dialog', { name: 'Bowl' })).toBeTruthy()
    expect(page.querySelector('.ro-group.is-invalid')).not.toBeNull()
    expect(bagButton()).toBeNull()

    fireEvent.click(within(page).getByRole('radio', { name: /Large/ }))
    fireEvent.click(within(page).getByRole('button', { name: /Avocado/ }))
    expect(
      within(page)
        .getByRole('button', { name: /Avocado/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    // The price moves with the choices: 10,00 + 2,50 + 1,80.
    expect(add.textContent).toContain('€14.30')
    fireEvent.change(within(page).getByRole('textbox'), { target: { value: '  extra hot  ' } })
    fireEvent.click(add)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bagButton()?.textContent).toContain('€14.30')
  })

  it('edits a line from the bag: the dish page opens with its choices, and the line is replaced', async () => {
    drawFace(fakeHost())
    fireEvent.click(quickAdd('Bowl'))
    let page = screen.getByRole('dialog', { name: 'Bowl' })
    fireEvent.click(within(page).getByRole('radio', { name: /Large/ }))
    fireEvent.click(within(page).getByRole('button', { name: /Add to bag/ }))

    let sheet = openBag()
    expect(within(sheet).getByText('Bowl')).toBeTruthy()
    expect(within(sheet).getByText('Large')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit: Bowl' }))

    page = screen.getByRole('dialog', { name: 'Bowl' })
    expect(within(page).getByRole('radio', { name: /Large/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(within(page).getByRole('button', { name: 'One more: Bowl' }))
    fireEvent.click(within(page).getByRole('button', { name: /Avocado/ }))
    fireEvent.click(within(page).getByRole('button', { name: /Add to bag/ }))

    // Back on the bag (the address goes back to #bag): one line, two of it, with the avocado.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bowl' })).toBeNull())
    sheet = await screen.findByRole('dialog', { name: 'Your bag' })
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(1)
    expect(within(sheet).getByText('Avocado')).toBeTruthy()
    expect(sheet.querySelector('.ro-line-side output')?.textContent).toBe('2')
    expect(within(sheet).getAllByText('€28.60').length).toBeGreaterThan(0) // (10,00 + 2,50 + 1,80) × 2
  })

  it('does not keep an abandoned edit for the next time the dish page opens', async () => {
    drawFace(fakeHost())
    fireEvent.click(quickAdd('Bowl'))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Bowl' })).getByRole('radio', { name: /Large/ }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Bowl' })).getByRole('button', {
        name: /Add to bag/,
      }),
    )
    fireEvent.click(within(openBag()).getByRole('button', { name: 'Edit: Bowl' }))
    // The guest backs out of the edit without adding.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bowl' })).toBeNull())
    fireEvent.click(quickAdd('Bowl'))
    expect(
      within(screen.getByRole('dialog', { name: 'Bowl' }))
        .getByRole('radio', { name: /Large/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('lets the guest remove a line, and says the bag is empty when the last one goes', () => {
    drawFace(fakeHost())
    fireEvent.click(quickAdd('Hummus'))
    const sheet = openBag()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove: Hummus' }))
    expect(within(sheet).getByText('Your bag is empty. Add something from the menu.')).toBeTruthy()
  })
})

describe('sending the bag: no local success (test 3)', () => {
  async function bagWithTwo(host = fakeHost()) {
    const page = drawFace(host)
    fireEvent.click(quickAdd('Hummus'))
    fireEvent.click(quickAdd('Mojito'))
    const sheet = openBag()
    return { host, page, sheet }
  }
  const send = async (host: ReturnType<typeof fakeHost>, sheet: HTMLElement, count: number) => {
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(count))
    return host.of('order.send')[count - 1]
  }

  it('sends our ids, the quantities and the notes, with a uuid, and no price', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    expect(call?.command.actionId).toMatch(UUID)
    expect(call?.command.lines).toEqual([
      { itemId: hummus.id, optionIds: [], qty: 1, note: '' },
      { itemId: mojito.id, optionIds: [], qty: 1, note: '' },
    ])
    expect(JSON.stringify(call?.command)).not.toMatch(/price|minor|1700|€/)
  })

  it('shows pending until the host answers, then clears the bag and opens the bill', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    // Pending: nothing has succeeded. The bag is still there, the button says so, the bill is not open.
    const busy = within(sheet).getByRole('button', { name: 'Sending your order' })
    expect(busy.hasAttribute('disabled')).toBe(true)
    expect(sheet.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()

    await act(async () => call?.answer({ ref: 'K-12' }))
    const bill = await screen.findByRole('dialog', { name: 'Table order' })
    expect(screen.queryByRole('dialog', { name: 'Your bag' })).toBeNull()
    // The face drew no round of its own: the host's state is still empty, so is the bill.
    expect(within(bill).getByText('Nothing has been ordered yet.')).toBeTruthy()
    expect(bill.querySelector('.ro-round')).toBeNull()
    fireEvent.click(within(bill).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bagButton()).toBeNull() // the bag was spent
    expect(quickAdd('Hummus')).toBeTruthy()
  })

  it("keeps the bag and shows the host's message when the host rejects the order", async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    await act(async () =>
      call?.answer({ status: 'rejected', message: text('The kitchen is closed.'), ref: 'K-9' }),
    )
    const alert = within(sheet).getByRole('alert')
    expect(alert.textContent).toContain('The kitchen could not take your order')
    expect(alert.textContent).toContain('The kitchen is closed.')
    expect(alert.textContent).toContain('Reference K-9')
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(within(sheet).getByText('Mojito')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    // And the guest can send again; a definite no was an end, so it is a new action.
    const again = await send(host, sheet, 2)
    expect(again?.command.actionId).not.toBe(call?.command.actionId)
  })

  it('says "ask your waiter" when the host rejects without a reason', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'rejected' }))
    expect(within(sheet).getByRole('alert').textContent).toContain('Ask your waiter.')
  })

  it('keeps the bag after a thrown error, and the retry reuses the actionId', async () => {
    const { host, sheet } = await bagWithTwo()
    const first = await send(host, sheet, 1)
    await act(async () => first?.fail())
    const alert = within(sheet).getByRole('alert')
    expect(alert.textContent).toContain('Your order was not confirmed')
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()

    fireEvent.click(within(sheet).getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(2))
    const second = host.of('order.send')[1]
    expect(second?.command.actionId).toBe(first?.command.actionId)
    expect(second?.command.lines).toEqual(first?.command.lines)
    await act(async () => second?.answer())
    await screen.findByRole('dialog', { name: 'Table order' })
  })

  it('treats a host that does not answer in time as a failure, keeps the bag, and retries with the same actionId', async () => {
    const { host, sheet } = await bagWithTwo()
    vi.useFakeTimers()
    fireEvent.click(sendButton(sheet))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const first = host.of('order.send')[0]
    expect(first).toBeDefined()
    expect(within(sheet).getByRole('button', { name: 'Sending your order' })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS + 10)
    })
    expect(within(sheet).getByRole('alert').textContent).toContain('Your order was not confirmed')
    expect(within(sheet).getByText('Hummus')).toBeTruthy()

    // The host answers late: that answer is ignored (it is the answer to a send the face gave up on).
    await act(async () => first?.answer())
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    expect(within(sheet).getByText('Hummus')).toBeTruthy()

    fireEvent.click(within(sheet).getByRole('button', { name: /Try again/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(host.of('order.send')).toHaveLength(2)
    expect(host.of('order.send')[1]?.command.actionId).toBe(first?.command.actionId)
  })

  it('uses a new actionId when the bag changed after a failure', async () => {
    const { host, sheet } = await bagWithTwo()
    const first = await send(host, sheet, 1)
    await act(async () => first?.fail())
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more: Hummus' }))
    const second = await send(host, sheet, 2)
    expect(second?.command.actionId).not.toBe(first?.command.actionId)
    expect(second?.command.lines[0]?.qty).toBe(2)
  })

  it('sends once for two quick taps', async () => {
    const { host, sheet } = await bagWithTwo()
    const button = sendButton(sheet)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    await act(async () => {})
    expect(host.of('order.send')).toHaveLength(1)
  })

  it("waits on an order the host has but has not decided, and takes the bill's round for the answer", async () => {
    const { host, page, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'pending' }))
    expect(within(sheet).getByText(/Your order is received/)).toBeTruthy()
    expect(
      within(sheet).getByRole('button', { name: 'Sending your order' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()

    // The host's own bill now holds a guest round for this action: that is the acceptance.
    page.update({
      bill: billOf(
        [
          billRound(
            'r1',
            'guest',
            [billLine('l1', 'Hummus', 1, 700), billLine('l2', 'Mojito', 1, 1000)],
            call?.command.actionId,
          ),
        ],
        1700,
      ),
    })
    const bill = await screen.findByRole('dialog', { name: 'Table order' })
    expect(within(bill).getAllByText('Hummus')).toHaveLength(1)
    fireEvent.click(within(bill).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bagButton()).toBeNull()
  })

  it('lets the guest try again when the host stays undecided', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    vi.useFakeTimers()
    await act(async () => call?.answer({ status: 'pending' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS + 10)
    })
    expect(within(sheet).getByRole('alert').textContent).toContain('Your order was not confirmed')
    fireEvent.click(within(sheet).getByRole('button', { name: /Try again/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(host.of('order.send')[1]?.command.actionId).toBe(call?.command.actionId)
  })

  it("takes the bill's round for the answer of a send whose answer never came", async () => {
    const { host, page, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    await act(async () => call?.fail())
    expect(within(sheet).getByRole('alert')).toBeTruthy()
    page.update({
      bill: billOf(
        [billRound('r1', 'guest', [billLine('l1', 'Hummus', 1, 700)], call?.command.actionId)],
        700,
      ),
    })
    await screen.findByRole('dialog', { name: 'Table order' })
  })

  it('locks the quantities while the bag is with the host', async () => {
    const { host, sheet } = await bagWithTwo()
    await send(host, sheet, 1)
    for (const name of ['One more: Hummus', 'One less: Mojito']) {
      expect(within(sheet).getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    }
    expect(
      within(sheet).getByRole('button', { name: 'Remove: Hummus' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('spends only the lines the host accepted: what the guest added while it waited stays in the bag', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    fireEvent.keyDown(window, { key: 'Escape' }) // the guest goes back to the menu while the order is with the host
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'One more: Mojito' }))
    await act(async () => call?.answer())
    // One Hummus and one Mojito were sent; the second Mojito was added meanwhile and is still in the bag.
    expect(screen.queryByRole('button', { name: /One more: Hummus/ })).toBeNull()
    expect(screen.getByRole('button', { name: /View bag/ }).textContent).toContain('€10.00')
    const again = openBag()
    expect(within(again).getAllByRole('listitem')).toHaveLength(1)
    expect(within(again).getByText('Mojito')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
  })

  it('only clears the bag, without opening the bill over the menu, if the guest has left the bag', async () => {
    const { host, page, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    fireEvent.keyDown(window, { key: 'Escape' }) // the guest closes the bag while it is pending
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await act(async () => call?.answer())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bagButton()).toBeNull()
    page.update({
      bill: billOf(
        [billRound('r1', 'guest', [billLine('l1', 'Hummus', 1, 700)], call?.command.actionId)],
        700,
      ),
    })
    expect(screen.getByRole('button', { name: 'Table order' }).textContent).toContain('€7.00')
  })

  it('tells the guest it was sent, when the venue shows no bill to open', async () => {
    const noBill: ViewModel = { ...view, features: { ...view.features, bill: false } }
    const host = fakeHost()
    drawFace(host, noBill)
    fireEvent.click(quickAdd('Hummus'))
    const sheet = openBag()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ ref: 'K-1' }))
    expect(await within(sheet).findByText('Sent to the kitchen')).toBeTruthy()
    expect(sheet.textContent).toContain('Reference K-1')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back to menu' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bagButton()).toBeNull()
    fireEvent.click(quickAdd('Hummus'))
    fireEvent.click(bagButton() as HTMLElement)
    expect(screen.queryByText('Sent to the kitchen')).toBeNull()
  })

  it('answers to the actionId of the command only: an answer to another command is no answer', async () => {
    const { host, sheet } = await bagWithTwo()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ actionId: '00000000-0000-4000-8000-000000000000' }))
    expect(within(sheet).getByRole('alert').textContent).toContain('Your order was not confirmed')
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
  })
})

describe('a line that can no longer be ordered', () => {
  it('is flagged, blocks sending until it is removed, and is not counted in the estimate', async () => {
    const host = fakeHost()
    const page = drawFace(host)
    fireEvent.click(quickAdd('Hummus'))
    fireEvent.click(quickAdd('Mojito'))
    const sheet = openBag()
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(false)

    page.update({}, withoutControls(view, 'Hummus')) // sold out meanwhile
    expect(within(sheet).getByText('No longer available')).toBeTruthy()
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'Remove the items that are no longer available',
    )
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(true)
    expect(within(sheet).queryByRole('button', { name: 'Edit: Hummus' })).toBeNull()
    expect(sheet.textContent).toContain('€10.00') // only the Mojito

    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove: Hummus' }))
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(false)
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.lines.map((line) => line.itemId)).toEqual([mojito.id])
  })

  it('is flagged by name for a dish that left the menu, with only "remove" left to do', () => {
    const page = drawFace(fakeHost())
    fireEvent.click(quickAdd('Hummus'))
    const sheet = openBag()
    const gone: ViewModel = {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.name.text !== 'Hummus'),
      })),
    }
    page.update({}, gone)
    expect(within(sheet).getAllByText('No longer available').length).toBeGreaterThan(0)
    expect(within(sheet).queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(true)
    expect(itemsOf(gone).some((item) => item.id === hummus.id)).toBe(false)
  })
})
