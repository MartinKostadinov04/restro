// @vitest-environment jsdom

// What every service sheet shares (brief SH-06 tests 7 and 8): the "Preview" marker, Escape, the
// phone's back button, focus going in and coming back, and the address a sheet lives at.

import type { ServiceState, ViewModel } from '@restro/shell'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  billLine,
  billOf,
  billRound,
  drawFace,
  fakeHost,
  orderingView,
  payingOf,
  receiptOf,
  resetPage,
  tableBillOf,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const view = orderingView()
const bill = billOf([billRound('s1', 'staff', [billLine('w1', 'Wine', 1, 900, 'served')])], 900)
const withBill: Partial<ServiceState> = {
  bill,
  tableBill: tableBillOf(),
  paying: payingOf(),
  receipt: receiptOf(),
}

/** Every sheet: the name of the button that opens it, the title of the dialog, and a way to open it. */
const SHEETS: { name: string; title: string; open: () => HTMLElement }[] = [
  {
    name: 'bag',
    title: 'Your bag',
    open: () => {
      // The first time Hummus is added; the bag keeps it after that.
      const add = screen.queryByRole('button', { name: 'Add Hummus' })
      if (add !== null) fireEvent.click(add)
      const opener = screen.getByRole('button', { name: /View bag/ })
      fireEvent.click(opener)
      return opener
    },
  },
  { name: 'bill', title: 'Table order', open: () => click('Table order') },
  { name: 'waiter', title: 'Call a server', open: () => click('Call a server') },
  { name: 'pay', title: 'Pay', open: () => click('Pay') },
]
function click(name: string) {
  const opener = screen.getByRole('button', { name })
  fireEvent.click(opener)
  return opener
}

describe('the "Preview" marker (test 7)', () => {
  const shown = (
    host: ReturnType<typeof fakeHost>,
    address: string,
    title: string,
    v: ViewModel = view,
  ) => {
    window.history.replaceState(null, '', address)
    drawFace(host, v)
    return screen.findByRole('dialog', { name: title })
  }

  it.each([
    ['#bag', 'Your bag'],
    ['#tab', 'Table order'],
    ['#call', 'Call a server'],
    ['#pay', 'Pay'],
    ['#receipt', 'Receipt'],
  ])('is on the %s sheet while the state is demo data', async (address, title) => {
    const sheet = await shown(fakeHost({ ...withBill, preview: true }), `/${address}`, title)
    const marker = sheet.querySelector('.ro-preview')
    expect(marker?.textContent).toBe('Preview')
    expect(sheet.querySelectorAll('.ro-preview')).toHaveLength(1)
  })

  it.each([
    ['#bag', 'Your bag'],
    ['#tab', 'Table order'],
    ['#call', 'Call a server'],
    ['#pay', 'Pay'],
    ['#receipt', 'Receipt'],
  ])('is not on the %s sheet for real state', async (address, title) => {
    const sheet = await shown(fakeHost({ ...withBill, preview: false }), `/${address}`, title)
    expect(sheet.querySelector('.ro-preview')).toBeNull()
    expect(sheet.textContent).not.toContain('Preview')
  })

  it('says "Преглед" in Bulgarian', async () => {
    const sheet = await shown(
      fakeHost({ ...withBill, preview: true }),
      '/#tab',
      'Поръчка на масата',
      orderingView('bg_BG'),
    )
    expect(sheet.querySelector('.ro-preview')?.textContent).toBe('Преглед')
  })
})

describe('Escape, the back button and focus (test 8)', () => {
  it.each(SHEETS)(
    'moves the focus into the $name sheet, and Escape closes it and returns the focus',
    async (sheet) => {
      drawFace(fakeHost(withBill))
      const opener = sheet.open()
      const dialog = screen.getByRole('dialog', { name: sheet.title })
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))
      expect(document.body.style.overflow).toBe('hidden')

      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(opener)
      expect(window.location.hash).toBe('')
      await waitFor(() => expect(document.body.style.overflow).toBe(''))
    },
  )

  it.each(SHEETS)(
    "closes the $name sheet with its close button and with the phone's back button",
    async (sheet) => {
      drawFace(fakeHost(withBill))
      const opener = sheet.open()
      fireEvent.click(
        within(screen.getByRole('dialog', { name: sheet.title })).getByRole('button', {
          name: 'Close',
        }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(opener)

      sheet.open()
      expect(screen.getByRole('dialog', { name: sheet.title })).toBeTruthy()
      await act(async () => {
        window.history.back()
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    },
  )

  it('closes the receipt page with Escape and its back button, which says so', async () => {
    window.history.replaceState(null, '', '/#receipt')
    drawFace(fakeHost(withBill))
    const page = await screen.findByRole('dialog', { name: 'Receipt' })
    expect(within(page).getByRole('button', { name: 'Back to menu' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('')
  })

  it('keeps the Tab key inside the sheet, from the last control to the first and back', () => {
    drawFace(fakeHost(withBill))
    click('Call a server')
    const dialog = screen.getByRole('dialog', { name: 'Call a server' })
    const close = within(dialog).getByRole('button', { name: 'Close' })
    const send = within(dialog).getByRole('button', { name: 'Send' })
    // "Send" is disabled until a kind is chosen, so the last control is the one chosen kind.
    fireEvent.click(within(dialog).getAllByRole('radio')[0] as HTMLElement)
    expect(send.hasAttribute('disabled')).toBe(false)
    send.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(send)
  })

  it('goes from the bill to the pay sheet without adding a step, and Escape then leaves for the menu', async () => {
    drawFace(fakeHost(withBill))
    const opener = click('Table order')
    const steps = window.history.length
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Table order' })).getByRole('button', {
        name: /^Pay/,
      }),
    )
    expect(screen.getByRole('dialog', { name: 'Pay' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Table order' })).toBeNull()
    expect(window.history.length).toBe(steps)
    expect(window.location.hash).toBe('#pay')
    // The focus went into the new sheet.
    expect(document.activeElement).toBe(
      within(screen.getByRole('dialog', { name: 'Pay' })).getByRole('button', { name: 'Close' }),
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('')
    expect(document.activeElement).toBe(opener) // where the guest started
  })

  it('opens a sheet from a shared link and cleans the address when it closes', async () => {
    window.history.replaceState(null, '', '/#call')
    drawFace(fakeHost())
    await screen.findByRole('dialog', { name: 'Call a server' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('')
  })
})

describe('a sheet the venue has not switched on has no address (R15)', () => {
  const cases: [string, string, Partial<ViewModel['features']>][] = [
    ['#bag', 'ordering', { ordering: false }],
    ['#tab', 'bill', { bill: false }],
    ['#call', 'the waiter', { callWaiter: null }],
    ['#pay', 'pay', { pay: false }],
    ['#receipt', 'pay', { pay: false }],
  ]
  it.each(cases)('%s is not drawn with %s off', (address, _name, off) => {
    window.history.replaceState(null, '', `/${address}`)
    drawFace(fakeHost(withBill), { ...view, features: { ...view.features, ...off } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['#bag', '#tab', '#call', '#pay', '#receipt', '#nonsense'])(
    '%s is not drawn when the host binds no services',
    (address) => {
      window.history.replaceState(null, '', `/${address}`)
      drawFace(fakeHost(withBill), view, { services: undefined })
      expect(screen.queryByRole('dialog')).toBeNull()
    },
  )

  it('takes a sheet away when the venue switches its service off under the guest', () => {
    const page = drawFace(fakeHost(withBill))
    click('Table order')
    expect(screen.getByRole('dialog', { name: 'Table order' })).toBeTruthy()
    page.update({}, { ...view, features: { ...view.features, bill: false } })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
