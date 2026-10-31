// @vitest-environment jsdom

// The table's shared order and what sending it shows (D72, D117, D121; brief SH-06 tests 1 to 3):
// every phone at the table edits one order that lives with the host, so the face draws
// `state.order` and sends `order.add`, `order.change`, `order.remove`, `order.undo`,
// `order.restore` and `order.send`. No local success: nothing is drawn that the host's state does
// not hold, and a Send is pending, then whatever the host says.

import { stringsFor, type ViewModel } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketFace } from '../face'
import { itemsOf, viewOf } from '../test-views'
import { SERVICE_TIMEOUT_MS } from './command'
import {
  drawFace,
  fakeHost,
  itemNamed,
  orderHost,
  orderingView,
  orderLine,
  orderOf,
  resetPage,
  sentOrderOf,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const W = stringsFor('en_US').services

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
const bowl = itemNamed(view, 'Bowl')

const quickAdd = (name: string) => screen.getByRole('button', { name: `Add ${name}` })
const bagButton = () => screen.queryByRole('button', { name: /View bag/ })
const openBag = () => {
  const button = bagButton()
  if (button === null) throw new Error('the bag button is not there')
  fireEvent.click(button)
  return screen.getByRole('dialog', { name: 'Your bag' })
}
const sendButton = (sheet: HTMLElement) =>
  within(sheet).getByRole('button', { name: /^Send (\d+ items?|the other \d+)$/ })
const maybeSendButton = (sheet: HTMLElement) =>
  within(sheet).queryByRole('button', { name: /^Send (\d+ items?|the other \d+)$/ })

/** The view with one dish that lost its ordering controls: still on the menu, the same ids. */
function withoutControls(source: ViewModel, name: string): ViewModel {
  return {
    ...source,
    sections: source.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.name.text === name ? { ...item, order: { controls: false, askWaiter: null } } : item,
      ),
    })),
  }
}

/** The view with one dish sold out: off the menu (D131), its name kept for what is already ordered. */
function withSoldOut(source: ViewModel, name: string): ViewModel {
  const item = itemNamed(source, name)
  return {
    ...source,
    sections: source.sections.map((section) => ({
      ...section,
      items: section.items.filter((entry) => entry.id !== item.id),
    })),
    hiddenItems: { ...source.hiddenItems, [item.id]: { name: item.name, code: 'sold_out' } },
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
    drawFace(orderHost())
    expect(quickAdd('Hummus')).toBeTruthy()
    expect(quickAdd('Mojito')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add Vodka' })).toBeNull() // ask the waiter
    expect(itemNamed(view, 'Vodka').order.controls).toBe(false)
  })

  it("draws no quick add when the feature is on but the item lost its controls (R11 is the item's own word)", () => {
    drawFace(orderHost(), withoutControls(view, 'Hummus'))
    expect(screen.queryByRole('button', { name: 'Add Hummus' })).toBeNull()
    expect(quickAdd('Mojito')).toBeTruthy()
  })

  it('draws the controls of the dish page only for a dish that can be ordered', () => {
    drawFace(orderHost())
    fireEvent.click(screen.getByRole('button', { name: /^Vodka/ }))
    const page = screen.getByRole('dialog', { name: 'Vodka' })
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

describe('putting a dish on the table’s order', () => {
  it('sends order.add with our ids and a uuid, no price, and draws nothing the host has not said', async () => {
    const host = orderHost()
    const page = drawFace(host)
    fireEvent.click(quickAdd('Hummus'))
    await waitFor(() => expect(host.of('order.add')).toHaveLength(1))
    const call = host.of('order.add')[0]
    expect(call?.command).toMatchObject({ itemId: hummus.id, optionIds: [], qty: 1, note: '' })
    expect(call?.command.actionId).toMatch(UUID)
    expect(JSON.stringify(call?.command)).not.toMatch(/price|minor|700|€/)
    // No local line: the "+" stays, and there is no bag button until the host's order has the line.
    await act(async () => call?.answer())
    expect(bagButton()).toBeNull()
    expect(quickAdd('Hummus')).toBeTruthy()

    page.update({ order: orderOf([orderLine(hummus)]) })
    expect(bagButton()?.textContent).toContain('1')
    expect(bagButton()?.textContent).toContain('approx.')
    expect(bagButton()?.textContent).toContain('€7.00')
  })

  it('shows a bag bar with the count and an estimate of the host’s order, whoever added the lines', () => {
    const host = orderHost({ order: orderOf([orderLine(hummus), orderLine(mojito, 2)]) })
    drawFace(host)
    const slot = document.querySelector('[data-slot="menu.bag"]')
    const bar = bagButton()
    expect(bar?.closest('[data-slot="menu.bag"]')).toBe(slot)
    expect(bar?.textContent).toContain('3')
    expect(bar?.textContent).toContain('approx.')
    expect(bar?.textContent).toContain('€27.00') // 7,00 + 2 × 10,00
  })

  it('turns the "+" into a counter of the host’s line, and the counter sends order.change', async () => {
    const host = orderHost({ order: orderOf([orderLine(hummus)]) })
    drawFace(host)
    expect(screen.queryByRole('button', { name: 'Add Hummus' })).toBeNull()
    expect(document.querySelector(`[data-item="${hummus.id}"] .ro-quick output`)?.textContent).toBe(
      '1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'One more: Hummus' }))
    await waitFor(() => expect(host.of('order.change')).toHaveLength(1))
    const [line] = host.state().order?.lines ?? []
    expect(host.of('order.change')[0]?.command).toMatchObject({ lineId: line?.id, delta: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'One less: Hummus' }))
    await waitFor(() => expect(host.of('order.change')).toHaveLength(2))
    expect(host.of('order.change')[1]?.command).toMatchObject({ lineId: line?.id, delta: -1 })
  })

  it('opens the dish page instead of adding a dish that needs a choice, and adds it from there', async () => {
    const host = orderHost()
    drawFace(host)
    fireEvent.click(quickAdd('Bowl'))
    expect(host.of('order.add')).toHaveLength(0)
    const page = screen.getByRole('dialog', { name: 'Bowl' })
    const add = within(page).getByRole('button', { name: /Add to bag/ })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(add) // the Size is required: the page stays and says so
    expect(screen.getByRole('dialog', { name: 'Bowl' })).toBeTruthy()
    expect(page.querySelector('.ro-group.is-invalid')).not.toBeNull()
    expect(host.of('order.add')).toHaveLength(0)

    fireEvent.click(within(page).getByRole('radio', { name: /Large/ }))
    fireEvent.click(within(page).getByRole('button', { name: /Avocado/ }))
    expect(
      within(page)
        .getByRole('button', { name: /Avocado/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    // The price moves with the choices: 10,00 + 2,50 + 1,80.
    expect(add.textContent).toContain('€14.30')
    fireEvent.change(within(page).getByRole('textbox'), { target: { value: 'extra hot' } })
    fireEvent.click(add)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(host.of('order.add')).toHaveLength(1))
    const sizes = bowl.modifierGroups[0]?.options ?? []
    const extras = bowl.modifierGroups[1]?.options ?? []
    expect(host.of('order.add')[0]?.command).toMatchObject({
      itemId: bowl.id,
      optionIds: [sizes[1]?.id, extras[0]?.id],
      qty: 1,
      note: 'extra hot',
    })
  })

  it('says "Order this from your waiter" in place of a dish that needs a choice where the POS takes none (#78)', () => {
    drawFace(fakeHost({ order: orderOf(), ordering: { state: 'on' } }))
    expect(screen.queryByRole('button', { name: 'Add Bowl' })).toBeNull()
    expect(
      document.querySelector(`[data-item="${bowl.id}"] [data-slot="item.order_from_waiter"]`)
        ?.textContent,
    ).toBe(W.orderFromWaiter)
    expect(quickAdd('Hummus')).toBeTruthy()
    // The dish page draws no choices and no note field, and says the staff are told.
    fireEvent.click(screen.getByRole('button', { name: /^Bowl/ }))
    const page = screen.getByRole('dialog', { name: 'Bowl' })
    expect(page.querySelector('[data-slot="item.order_from_waiter"]')).not.toBeNull()
    expect(within(page).queryByRole('textbox')).toBeNull()
    expect(within(page).queryByRole('button', { name: /Add to bag/ })).toBeNull()
  })

  it('draws no note field and adds with no choices where the POS takes none, and says the staff are told', async () => {
    const host = fakeHost({ order: orderOf(), ordering: { state: 'on' } })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    const page = screen.getByRole('dialog', { name: 'Hummus' })
    expect(within(page).queryByRole('textbox')).toBeNull()
    expect(page.querySelector('[data-notes-at-staff]')?.textContent).toBe(W.notesAtStaff)
    fireEvent.click(within(page).getByRole('button', { name: /Add to bag/ }))
    await waitFor(() => expect(host.of('order.add')).toHaveLength(1))
    expect(host.of('order.add')[0]?.command).toMatchObject({
      itemId: hummus.id,
      optionIds: [],
      note: '',
    })
  })

  it('keeps the refusal’s words over the bar when the host refuses an add, until the guest taps them away', async () => {
    const host = orderHost()
    drawFace(host)
    fireEvent.click(quickAdd('Mojito'))
    await waitFor(() => expect(host.of('order.add')).toHaveLength(1))
    await act(async () =>
      host.of('order.add')[0]?.answer({ status: 'rejected', code: 'ordering_paused' }),
    )
    const note = await screen.findByRole('alert')
    expect(note.textContent).toBe(W.refusals.ordering_paused)
    fireEvent.click(within(note).getByRole('button'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves the location codes to the location sheet: no refusal is worded for them', async () => {
    const host = orderHost()
    drawFace(host)
    fireEvent.click(quickAdd('Mojito'))
    await waitFor(() => expect(host.of('order.add')).toHaveLength(1))
    await act(async () =>
      host.of('order.add')[0]?.answer({ status: 'rejected', code: 'location_needed' }),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the order sheet: the lines the host has', () => {
  it('draws the host’s lines with the choices, a note and the estimate, and marks no line as mine', () => {
    const sizes = bowl.modifierGroups[0]?.options ?? []
    const host = orderHost({
      order: orderOf([
        orderLine(hummus, 2),
        orderLine(bowl, 1, { optionIds: [sizes[1]?.id as never], note: 'no onion' }),
      ]),
    })
    drawFace(host)
    const sheet = openBag()
    const lines = sheet.querySelectorAll('[data-order-line]')
    expect(lines).toHaveLength(2)
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(within(sheet).getByText('Large')).toBeTruthy()
    expect(within(sheet).getByText('“no onion”')).toBeTruthy()
    expect(lines[0]?.getAttribute('data-qty')).toBe('2')
    expect(sheet.querySelector('.ro-sum')?.textContent).toContain('€26.50') // 14,00 + 10,00 + 2,50
    expect(sheet.textContent).not.toMatch(/\bmine\b|yours/i)
    // The sheet is the order screen the host polls fast (RR-52).
    expect(host.screens.at(-1)).toBe('bag')
  })

  it('says the order is empty when the host has one with no lines', () => {
    const host = orderHost({
      order: orderOf([], {
        removed: [
          {
            ...orderLine(hummus),
            undoSeconds: 8,
          },
        ],
      }),
    })
    drawFace(host)
    const sheet = openBag()
    expect(within(sheet).getByText(W.emptyOrder)).toBeTruthy()
    expect(sheet.querySelector('[data-order-line]')).toBeNull()
  })

  it('sends order.change for the steppers and order.remove for Remove', async () => {
    const line = orderLine(hummus, 2)
    const host = orderHost({ order: orderOf([line]) })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more: Hummus' }))
    await waitFor(() => expect(host.of('order.change')).toHaveLength(1))
    expect(host.of('order.change')[0]?.command).toMatchObject({ lineId: line.id, delta: 1 })
    fireEvent.click(within(sheet).getByRole('button', { name: 'One less: Hummus' }))
    await waitFor(() => expect(host.of('order.change')).toHaveLength(2))
    expect(host.of('order.change')[1]?.command).toMatchObject({ lineId: line.id, delta: -1 })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove: Hummus' }))
    await waitFor(() => expect(host.of('order.remove')).toHaveLength(1))
    expect(host.of('order.remove')[0]?.command).toMatchObject({ lineId: line.id })
  })

  it('shows a removed line with its Undo, and Undo sends order.undo', async () => {
    const gone = { ...orderLine(mojito, 1), undoSeconds: 9 }
    const host = orderHost({ order: orderOf([orderLine(hummus)], { removed: [gone] }) })
    drawFace(host)
    const sheet = openBag()
    const removed = sheet.querySelector(`[data-removed-line="${gone.id}"]`)
    expect(removed?.textContent).toContain(W.removedNamed('Mojito'))
    fireEvent.click(within(removed as HTMLElement).getByRole('button', { name: W.undo }))
    await waitFor(() => expect(host.of('order.undo')).toHaveLength(1))
    expect(host.of('order.undo')[0]?.command).toMatchObject({ lineId: gone.id })
  })

  it('shows the earlier order with Restore, and Restore sends order.restore for that order', async () => {
    const host = orderHost({
      order: orderOf([], {
        earlier: { setAsideAt: 1_760_000_000_000, lines: [orderLine(mojito, 2)] },
      }),
    })
    drawFace(host)
    const sheet = openBag()
    const earlier = sheet.querySelector('[data-earlier-order]') as HTMLElement
    expect(earlier.textContent).toContain(W.earlierOrder)
    expect(earlier.textContent).toContain('Mojito × 2')
    fireEvent.click(within(earlier).getByRole('button', { name: W.restore }))
    await waitFor(() => expect(host.of('order.restore')).toHaveLength(1))
    expect(host.of('order.restore')[0]?.command).toMatchObject({ setAsideAt: 1_760_000_000_000 })
  })

  it('says "Saving…" for a line the host has not answered yet, and keeps it out of the Send', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus, 1, { pending: true }), orderLine(mojito)]),
    })
    drawFace(host)
    const sheet = openBag()
    expect(within(sheet).getByText(W.saving)).toBeTruthy()
    expect(sheet.querySelector('[data-pending]')?.getAttribute('data-order-line')).toMatch(/^ol_/)
    expect(sendButton(sheet).textContent).toBe(W.sendItems(1))
  })

  it('gives a line a payment holds no controls and says so, and leaves it out of the Send', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus, 1, { held: true }), orderLine(mojito)]),
    })
    drawFace(host)
    const sheet = openBag()
    const held = sheet.querySelector(`[data-item-id="${hummus.id}"]`) as HTMLElement
    expect(held.textContent).toContain(W.heldLine)
    expect(within(held).queryByRole('button')).toBeNull()
    expect(sendButton(sheet).textContent).toBe(W.sendItems(1))
  })

  it('says "Order this from your waiter" on a pay-first line, and never sends it', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus, 1, { mode: 'pay_first' }), orderLine(mojito)]),
    })
    drawFace(host)
    const sheet = openBag()
    const line = sheet.querySelector(`[data-item-id="${hummus.id}"]`) as HTMLElement
    expect(line.textContent).toContain(W.orderFromWaiter)
    expect(sendButton(sheet).textContent).toBe(W.sendItems(1))
  })

  it('greys a sold-out line, keeps it on the order with its name and says "Send the other N"', async () => {
    const host = orderHost({ order: orderOf([orderLine(hummus), orderLine(mojito, 2)]) })
    drawFace(host, withSoldOut(view, 'Hummus'))
    const sheet = openBag()
    const line = sheet.querySelector(`[data-item-id="${hummus.id}"]`) as HTMLElement
    expect(line.getAttribute('data-sold-out')).toBe('')
    expect(line.textContent).toContain(W.lineSoldOut)
    expect(line.textContent).toContain('Hummus')
    expect(sendButton(sheet).textContent).toBe(W.sendOthers(2))
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    expect(host.of('order.send')[0]?.command.lines.map((l) => l.itemId)).toEqual([mojito.id])
  })

  it('says "Send the other N" with the count, and greys a line the POS named as run out', () => {
    const sold = sentOrderOf('so_1', 'not_sent', [{ item: mojito, qty: 1 }], {
      reason: 'item_unavailable',
      lines: [{ itemId: mojito.id, optionIds: [], qty: 1, outOfStock: true }],
    })
    const host = orderHost({
      order: orderOf([orderLine(hummus), orderLine(mojito)]),
      sentOrders: [sold],
    })
    drawFace(host)
    const sheet = openBag()
    expect(sendButton(sheet).textContent).toBe(W.sendOthers(1))
    const line = sheet.querySelector(`[data-item-id="${mojito.id}"]`) as HTMLElement
    expect(line.getAttribute('data-sold-out')).toBe('')
    expect(sheet.textContent).toContain(W.sentNotSentOutOfStock)
  })

  it('flags a line whose dish left the menu with its name unknown, and keeps it out of the Send', () => {
    const gone: ViewModel = {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.name.text !== 'Hummus'),
      })),
    }
    const host = orderHost({ order: orderOf([orderLine(hummus), orderLine(mojito)]) })
    drawFace(host, gone)
    const sheet = openBag()
    expect(within(sheet).getByText(W.otherItem)).toBeTruthy()
    expect(within(sheet).getByText(W.unavailableLine)).toBeTruthy()
    expect(sendButton(sheet).textContent).toBe(W.sendOthers(1))
    expect(itemsOf(gone).some((item) => item.id === hummus.id)).toBe(false)
  })

  it('has no note field in the order, and tells the guest the staff are told, where the POS takes no notes', () => {
    const host = fakeHost({
      order: orderOf([orderLine(hummus)]),
      ordering: { state: 'on' },
    })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-notes-at-staff]')?.textContent).toBe(W.notesAtStaff)
    expect(within(sheet).queryByRole('textbox')).toBeNull()
  })
})

describe('Send: no local success (test 3)', () => {
  function twoLines(extra: Partial<Parameters<typeof orderHost>[0]> = {}) {
    const host = orderHost({
      order: orderOf([orderLine(hummus), orderLine(mojito)]),
      ...extra,
    })
    const page = drawFace(host)
    return { host, page, sheet: openBag() }
  }
  const send = async (host: ReturnType<typeof fakeHost>, sheet: HTMLElement, count: number) => {
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(count))
    return host.of('order.send')[count - 1]
  }

  it('says how many items go, and sends our ids, the quantities and the notes, with a uuid, and no price', async () => {
    const { host, sheet } = twoLines()
    expect(sendButton(sheet).textContent).toBe(W.sendItems(2))
    const call = await send(host, sheet, 1)
    expect(call?.command.actionId).toMatch(UUID)
    expect(call?.command.lines).toEqual([
      { itemId: hummus.id, optionIds: [], qty: 1, note: '' },
      { itemId: mojito.id, optionIds: [], qty: 1, note: '' },
    ])
    expect(call?.command.confirmDuplicateOf).toBeUndefined()
    expect(JSON.stringify(call?.command)).not.toMatch(/price|minor|1700|€/)
  })

  it('shows pending until the host answers, and then changes nothing itself: the order is the host’s', async () => {
    const { host, page, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    const busy = within(sheet).getByRole('button', { name: W.sendingNow })
    expect(busy.hasAttribute('disabled')).toBe(true)
    expect(sheet.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(sheet).getByText('Hummus')).toBeTruthy()

    await act(async () => call?.answer({ ref: 'K-12' }))
    // The face spent nothing and opened nothing: the lines stay until the host's order moves them
    // into a sent order.
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    page.update({
      order: orderOf([]),
      sentOrders: [
        sentOrderOf(
          'so_1',
          'sending',
          [
            { item: hummus, qty: 1 },
            { item: mojito, qty: 1 },
          ],
          { mine: true },
        ),
      ],
    })
    expect(within(sheet).queryByText('Hummus', { selector: 'strong' })).toBeNull()
    expect(sheet.querySelector('[data-sent-order="so_1"]')?.textContent).toContain(W.sendingNow)
  })

  it('keeps the order and shows the refusal’s words when the host says no', async () => {
    const { host, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () =>
      call?.answer({ status: 'rejected', code: 'ordering_paused', message: text('Closed.') }),
    )
    expect(within(sheet).getByRole('alert').textContent).toBe(W.refusals.ordering_paused)
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    // And the guest can send again; a definite no was an end, so it is a new action.
    const again = await send(host, sheet, 2)
    expect(again?.command.actionId).not.toBe(call?.command.actionId)
  })

  it('names the dish that ran out when the refusal names it (item_unavailable)', async () => {
    const { host, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () =>
      call?.answer({ status: 'rejected', code: 'item_unavailable', subjectId: mojito.id }),
    )
    expect(within(sheet).getByRole('alert').textContent).toBe(W.itemUnavailableNamed('Mojito'))
  })

  it('says the general line when the host rejects without a code', async () => {
    const { host, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'rejected' }))
    expect(within(sheet).getByRole('alert').textContent).toBe(W.refusedOther)
  })

  it('keeps the order after a thrown error, says D120’s line and offers no re-send (RR-50)', async () => {
    const { host, sheet } = twoLines()
    const first = await send(host, sheet, 1)
    await act(async () => first?.fail())
    const alert = within(sheet).getByRole('alert')
    // The order may already be in the POS: call a waiter, never "Try again".
    expect(alert.textContent).toContain('We can’t reach Restro right now')
    expect(sheet.textContent).not.toContain('Try again')
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
    expect(maybeSendButton(sheet)).toBeNull()
    await act(async () => {})
    expect(host.of('order.send')).toHaveLength(1)
  })

  it('treats a host that does not answer in time as a lost answer, keeps the order and offers no re-send', async () => {
    const { host, sheet } = twoLines()
    vi.useFakeTimers()
    fireEvent.click(sendButton(sheet))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const first = host.of('order.send')[0]
    expect(first).toBeDefined()
    expect(within(sheet).getByRole('button', { name: W.sendingNow })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS + 10)
    })
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'We can’t reach Restro right now',
    )
    expect(within(sheet).getByText('Hummus')).toBeTruthy()

    // The host answers late: that answer is ignored (it is the answer to a send the face gave up on).
    await act(async () => first?.answer())
    expect(maybeSendButton(sheet)).toBeNull()
    expect(host.of('order.send')).toHaveLength(1)
  })

  it('says D120’s line for the client’s own lost answer (pending, answer_lost), with no re-send', async () => {
    const { host, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'pending', code: 'answer_lost' }))
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'We can’t reach Restro right now',
    )
    expect(maybeSendButton(sheet)).toBeNull()
  })

  it('drops the lost-Send line once the card says "Added to your bill", with no reload (RR-O43)', async () => {
    const { host, page, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'pending', code: 'answer_lost' }))
    expect(sheet.querySelector('[data-send-lost]')).not.toBeNull()
    // The order lands: the host lists it as Added (its lines are the ones this phone sent), and its
    // own hold on the lost Send runs on (the client lets go by the clock alone).
    page.update({
      sendLost: { ref: null },
      sentOrders: [
        sentOrderOf('so_1', 'added', [
          { item: hummus, qty: 1 },
          { item: mojito, qty: 1 },
        ]),
      ],
    })
    expect(sheet.textContent).toContain(W.sentAdded)
    expect(sheet.querySelector('[data-send-lost]')).toBeNull()
    expect(sheet.textContent).not.toContain(W.sendLost)
    expect(within(sheet).queryByRole('alert')).toBeNull()
    // The hold itself stays: the lines are on the order still and no second Send goes out.
    expect(maybeSendButton(sheet)).toBeNull()
  })

  it('keeps the lost-Send line for an order that is not the one sent (another phone’s, or still sending)', async () => {
    const { host, page, sheet } = twoLines()
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'pending', code: 'answer_lost' }))
    page.update({
      sentOrders: [
        // Added, but not what this phone sent.
        sentOrderOf('so_1', 'added', [{ item: mojito, qty: 2 }]),
        // What this phone sent, but not on the bill yet.
        sentOrderOf('so_2', 'sending', [
          { item: hummus, qty: 1 },
          { item: mojito, qty: 1 },
        ]),
      ],
    })
    expect(sheet.querySelector('[data-send-lost]')).not.toBeNull()
  })

  it('does not let an order that was already Added before the Send clear the line', async () => {
    const before = sentOrderOf('so_0', 'added', [
      { item: hummus, qty: 1 },
      { item: mojito, qty: 1 },
    ])
    const { host, page, sheet } = twoLines({ sentOrders: [before] })
    const call = await send(host, sheet, 1)
    await act(async () => call?.answer({ status: 'pending', code: 'answer_lost' }))
    page.update({ sentOrders: [before] })
    expect(sheet.querySelector('[data-send-lost]')).not.toBeNull()
  })

  it('offers Send again after the hold, when the host never said anything more', async () => {
    const { host, sheet } = twoLines()
    vi.useFakeTimers()
    fireEvent.click(sendButton(sheet))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () =>
      host.of('order.send')[0]?.answer({ status: 'pending', code: 'answer_lost' }),
    )
    expect(maybeSendButton(sheet)).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000 + 10)
    })
    expect(maybeSendButton(sheet)).not.toBeNull()
  })

  it('sends once for two quick taps', async () => {
    const { host, sheet } = twoLines()
    const button = sendButton(sheet)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    await act(async () => {})
    expect(host.of('order.send')).toHaveLength(1)
  })

  it('sends nothing while the phone is offline, greys Send and keeps the order editable (D121)', async () => {
    const { host, sheet } = twoLines({ offline: true })
    expect(sheet.querySelector('[data-slot="send.offline"]')?.textContent).toBe(W.offline)
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(true)
    fireEvent.click(sendButton(sheet))
    await act(async () => {})
    expect(host.of('order.send')).toHaveLength(0)
    expect(
      within(sheet).getByRole('button', { name: 'One more: Hummus' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('draws the host’s lost-Send line in place of the weak-signal one, with the reference, and no Send', () => {
    const { sheet } = twoLines({ offline: true, sendLost: { ref: 'K7Q' } })
    expect(sheet.querySelector('[data-send-lost]')?.textContent).toContain(W.sendLost)
    expect(sheet.querySelector('[data-send-lost]')?.textContent).toContain(W.reference('K7Q'))
    expect(sheet.textContent).not.toContain(W.offline)
    expect(maybeSendButton(sheet)).toBeNull()
  })

  it('offers no Send while the host says the table is closed, and keeps the lines', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      ordering: { state: 'closed', notesAndOptions: true },
    })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.textContent).toContain(W.orderingClosed)
    expect(maybeSendButton(sheet)).toBeNull()
    expect(within(sheet).getByText('Hummus')).toBeTruthy()
  })

  it('draws Send greyed, not taken away, while ordering is paused, and the bag stays editable (D120)', async () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      ordering: { state: 'paused', notesAndOptions: true },
    })
    drawFace(host)
    const sheet = openBag()
    // The pause's own line, and Send drawn with its words but greyed.
    expect(sheet.textContent).toContain(W.orderingPaused)
    const send = sendButton(sheet)
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(send.textContent).toContain(W.sendItems(1))
    fireEvent.click(send)
    await act(async () => {})
    expect(host.of('order.send')).toHaveLength(0)
    // The lines can still be changed and removed, so the table can send once ordering is back.
    const more = within(sheet).getByRole('button', { name: 'One more: Hummus' })
    expect(more.hasAttribute('disabled')).toBe(false)
    fireEvent.click(more)
    await act(async () => {})
    expect(host.of('order.change')).toHaveLength(1)
    expect(
      within(sheet)
        .getByRole('button', { name: /Remove: Hummus/ })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('greys Send again, and sends nothing, once ordering is back (D120)', async () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      ordering: { state: 'paused', notesAndOptions: true },
    })
    const page = drawFace(host)
    const sheet = openBag()
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(true)
    page.update({ ordering: { state: 'on', notesAndOptions: true } })
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(false)
    expect(sheet.textContent).not.toContain(W.orderingPaused)
  })

  it('keeps Send away on a closed night while ordering is paused (D120 covers only the pause)', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      ordering: {
        state: 'paused',
        notesAndOptions: true,
        night: { state: 'closed', at: null },
      },
    })
    drawFace(host)
    expect(maybeSendButton(openBag())).toBeNull()
  })

  it('says a table code is no longer in use, not that the table is closed (RR-58, D121)', () => {
    drawFace(
      orderHost({
        order: orderOf([orderLine(hummus)]),
        ordering: { state: 'closed', retired: true, notesAndOptions: true },
      }),
    )
    const sheet = openBag()
    expect(sheet.textContent).toContain(W.refusals.code_retired)
    expect(sheet.textContent).not.toContain(W.orderingClosed)
  })

  it('shows a waiter the venue’s clock, not what the phone makes of sentAt (RR-58)', () => {
    drawFace(
      orderHost({
        sentOrders: [
          sentOrderOf('so_1', 'unconfirmed', [{ item: hummus, qty: 1 }], {
            // 12:00 UTC: no time zone on earth makes 19:42 of this.
            sentAt: Date.UTC(2026, 9, 30, 12, 0),
            sentClock: '19:42',
          }),
        ],
      }),
    )
    const sheet = openBag()
    fireEvent.click(within(sheet).getByRole('button', { name: W.showWaiter }))
    expect(sheet.querySelector('[data-show-waiter]')?.textContent).toContain('19:42')
  })

  it('says "Last orders at" and still sends; says the night is closed or opens later, with no Send', () => {
    const cases = [
      [{ state: 'last_orders' as const, at: '04:30' }, W.lastOrdersAt('04:30'), true],
      [{ state: 'closed' as const, at: null }, W.orderingClosedTonight, false],
      [{ state: 'opens_later' as const, at: '22:00' }, W.orderingOpensAt('22:00'), false],
    ] as const
    for (const [night, words, sends] of cases) {
      const host = orderHost({
        order: orderOf([orderLine(hummus)]),
        ordering: { state: 'on', notesAndOptions: true, night },
      })
      const { unmount } = drawFace(host)
      const sheet = openBag()
      expect(sheet.textContent, night.state).toContain(words)
      expect(maybeSendButton(sheet) !== null, night.state).toBe(sends)
      unmount()
      cleanup()
      window.history.replaceState(null, '', '/')
    }
  })
})

describe('the duplicate check (D117)', () => {
  it('asks "Same as N minutes ago. Send another?" and Send another is a new Send naming that sent order', async () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      sentOrders: [sentOrderOf('so_1', 'added', [{ item: hummus, qty: 1 }], { minutesAgo: 4 })],
    })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    const first = host.of('order.send')[0]
    await act(async () =>
      first?.answer({ status: 'rejected', code: 'duplicate_order', subjectId: 'so_1' }),
    )
    const ask = sheet.querySelector('[data-duplicate-check]') as HTMLElement
    expect(ask.textContent).toContain(W.duplicateAsk(4))
    // The question is no refusal notice, and Send is not offered beside it.
    expect(within(sheet).queryByRole('alert')).toBeNull()
    expect(maybeSendButton(sheet)).toBeNull()

    fireEvent.click(within(ask).getByRole('button', { name: W.sendAnother }))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(2))
    const second = host.of('order.send')[1]
    expect(second?.command.confirmDuplicateOf).toBe('so_1')
    expect(second?.command.actionId).not.toBe(first?.command.actionId)
    expect(second?.command.lines).toEqual(first?.command.lines)
  })

  it('closes with Cancel, and closes itself after 60 seconds', async () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      sentOrders: [sentOrderOf('so_1', 'added', [{ item: hummus, qty: 1 }], { minutesAgo: 2 })],
    })
    drawFace(host)
    const sheet = openBag()
    const ask = async (index: number) => {
      fireEvent.click(sendButton(sheet))
      await waitFor(() => expect(host.of('order.send')).toHaveLength(index))
      await act(async () =>
        host
          .of('order.send')
          [index - 1]?.answer({ status: 'rejected', code: 'duplicate_order', subjectId: 'so_1' }),
      )
    }
    await ask(1)
    fireEvent.click(within(sheet).getByRole('button', { name: W.duplicateCancel }))
    expect(sheet.querySelector('[data-duplicate-check]')).toBeNull()
    expect(maybeSendButton(sheet)).not.toBeNull()

    vi.useFakeTimers()
    fireEvent.click(sendButton(sheet))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () =>
      host
        .of('order.send')[1]
        ?.answer({ status: 'rejected', code: 'duplicate_order', subjectId: 'so_1' }),
    )
    expect(sheet.querySelector('[data-duplicate-check]')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 10)
    })
    expect(sheet.querySelector('[data-duplicate-check]')).toBeNull()
  })

  it('asks without the minutes when the sent order is not one this phone sees', async () => {
    const host = orderHost({ order: orderOf([orderLine(hummus)]) })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('order.send')).toHaveLength(1))
    await act(async () =>
      host
        .of('order.send')[0]
        ?.answer({ status: 'rejected', code: 'duplicate_order', subjectId: 'so_9' }),
    )
    expect(sheet.querySelector('[data-duplicate-check]')?.textContent).toContain(
      W.refusals.duplicate_order,
    )
  })
})

describe('the table’s sent orders', () => {
  const sent = [
    sentOrderOf('so_1', 'sending', [{ item: hummus, qty: 2 }], { mine: true }),
    sentOrderOf('so_2', 'sending', [{ item: mojito, qty: 1 }], { mine: false }),
    sentOrderOf('so_3', 'added', [{ item: mojito, qty: 1 }]),
    sentOrderOf('so_4', 'added', [{ item: mojito, qty: 1 }], { unpaid: true }),
    sentOrderOf('so_5', 'awaiting_approval', [{ item: hummus, qty: 1 }]),
    sentOrderOf('so_6', 'not_sent', [{ item: hummus, qty: 1 }], { reason: 'ordering_paused' }),
    sentOrderOf('so_7', 'not_sent', [{ item: hummus, qty: 1 }], { reason: 'needs_first_item' }),
    sentOrderOf('so_8', 'not_sent', [{ item: hummus, qty: 1 }]),
    sentOrderOf('so_9', 'unconfirmed', [{ item: hummus, qty: 1 }], { ref: 'K7Q' }),
  ]

  it('shows every state with its words, "Sending…" only on the phone that sent', () => {
    drawFace(orderHost({ sentOrders: sent }))
    const sheet = openBag()
    const wordsOf = (id: string) => sheet.querySelector(`[data-sent-order="${id}"]`)?.textContent
    expect(wordsOf('so_1')).toContain('2 × Hummus')
    expect(wordsOf('so_1')).toContain(W.sendingNow)
    expect(wordsOf('so_2')).toContain(W.beingSent)
    expect(wordsOf('so_3')).toContain(W.sentAdded)
    expect(wordsOf('so_4')).toContain(W.sentUnpaid)
    expect(wordsOf('so_5')).toContain(W.sentAwaitingApproval)
    expect(wordsOf('so_6')).toContain(W.sentNotSentPaused)
    expect(wordsOf('so_7')).toContain(W.sentNotSentFirstItem)
    expect(wordsOf('so_8')).toContain(W.sentNotSent)
    expect(wordsOf('so_9')).toContain(W.sentUnconfirmed('K7Q'))
  })

  it('opens "Show this to your waiter" for a sent order: the reference, the time and the items', () => {
    drawFace(orderHost({ sentOrders: [sent[0] as never, sent[8] as never] }))
    const sheet = openBag()
    const row = sheet.querySelector('[data-sent-order="so_9"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: W.showWaiter }))
    const card = within(sheet).getByRole('dialog', { name: W.showWaiter })
    expect(card.querySelector('.ro-waiter-ref')?.textContent).toBe('K7Q')
    expect(card.textContent).toMatch(/\d\d:\d\d/)
    expect(card.textContent).toContain('1 × Hummus')
    fireEvent.click(within(card).getByRole('button', { name: W.showWaiterClose }))
    expect(within(sheet).queryByRole('dialog', { name: W.showWaiter })).toBeNull()
  })

  it('gives the bag button to a table with a sent order and an empty order, so the guest can find it', () => {
    drawFace(orderHost({ sentOrders: [sent[2] as never] }))
    expect(bagButton()).not.toBeNull()
    const sheet = openBag()
    expect(sheet.querySelector('[data-sent-order="so_3"]')).not.toBeNull()
  })
})

describe('where the phone has no location pass', () => {
  it('says why the order is hidden and gives the guest’s own "Allow location" in the bag', () => {
    const host = orderHost({
      order: null,
      location: {
        state: 'needed',
        prompt: 'none',
        consent: 'declined',
        venueName: 'Club X',
        privacyUrl: null,
      },
    })
    drawFace(host)
    const sheet = openBag()
    expect(sheet.querySelector('[data-location-prompt="none"]')?.textContent).toContain(
      W.locationNeeded,
    )
    fireEvent.click(within(sheet).getByRole('button', { name: W.locationAllowAgain }))
    expect(host.located).toEqual(['reopen'])
    // The host has no order: nothing is said about an empty one.
    expect(within(sheet).queryByText(W.emptyOrder)).toBeNull()
  })

  it('puts the stop control in the bag when the phone holds a pass and no bill is drawn', () => {
    const host = orderHost({
      order: orderOf([orderLine(hummus)]),
      location: { state: 'held', prompt: 'none', consent: 'allowed', venueName: 'Club X' },
    })
    drawFace(host)
    const sheet = openBag()
    fireEvent.click(within(sheet).getByRole('button', { name: W.locationStop }))
    expect(host.located).toEqual(['stop'])
  })
})
