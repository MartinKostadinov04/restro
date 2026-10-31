// @vitest-environment jsdom

// Calling a waiter (brief SH-06 test 5): only the kinds the venue allows, "on the way" only when
// the host's request says so, and cancel sends `service.cancel`.

import type { ServiceKind, ViewModel } from '@restro/shell'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SERVICE_TIMEOUT_MS } from './command'
import {
  drawFace,
  fakeHost,
  itemNamed,
  orderingView,
  orderLine,
  orderOf,
  request,
  resetPage,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const view = orderingView()

const openCall = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Call a server' }))
  return screen.getByRole('dialog', { name: 'Call a server' })
}
const pick = (sheet: HTMLElement, name: string) =>
  fireEvent.click(within(sheet).getByRole('radio', { name }))
const sendButton = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Send' })

const withKinds = (kinds: ServiceKind[]): ViewModel => ({
  ...view,
  features: { ...view.features, callWaiter: { kinds } },
})

describe('the waiter button', () => {
  it('is the menu.call_waiter slot, drawn only when the venue has it on and the host bound services', () => {
    drawFace(fakeHost())
    const slots = document.querySelectorAll('[data-slot="menu.call_waiter"]')
    expect(slots).toHaveLength(1)
    expect(slots[0]).toBe(screen.getByRole('button', { name: 'Call a server' }))
    cleanup()
    drawFace(fakeHost(), { ...view, features: { ...view.features, callWaiter: null } })
    expect(screen.queryByRole('button', { name: 'Call a server' })).toBeNull()
  })

  it('shrinks to a round bell, with the word kept for a screen reader, once the bag has something in it', () => {
    const page = drawFace(fakeHost())
    const bar = document.querySelector('.ro-bagbar')
    expect(bar?.getAttribute('data-bag')).toBe('false')
    page.update({ order: orderOf([orderLine(itemNamed(view, 'Hummus'))]) })
    expect(bar?.getAttribute('data-bag')).toBe('true')
    expect(screen.getByRole('button', { name: 'Call a server' })).toBeTruthy()
  })
})

describe('the kinds', () => {
  it("shows every kind the venue allows, in the venue's order, and no other", () => {
    drawFace(fakeHost(), withKinds(['water', 'waiter', 'glasses']))
    const sheet = openCall()
    expect(
      within(sheet)
        .getAllByRole('radio')
        .map((button) => button.textContent),
    ).toEqual(['Water', 'Call waiter', 'Glasses'])
    for (const name of ['Bring the bill', 'Ice', 'Card terminal']) {
      expect(within(sheet).queryByRole('radio', { name })).toBeNull()
    }
  })

  it('shows all seven when the venue allows all seven', () => {
    drawFace(fakeHost())
    expect(within(openCall()).getAllByRole('radio')).toHaveLength(7)
  })

  it('sends the chosen kind, and no note', async () => {
    const host = fakeHost()
    drawFace(host)
    const sheet = openCall()
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(true)
    pick(sheet, 'Ice')
    expect(within(sheet).queryByRole('textbox')).toBeNull()
    expect(sendButton(sheet).hasAttribute('disabled')).toBe(false)
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    const { command } = host.of('service.request')[0] ?? {}
    expect(command).toMatchObject({ kind: 'service.request', request: 'ice', note: '' })
    expect(command?.actionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('moves the choice with the arrow keys, like a radio group', () => {
    drawFace(fakeHost())
    const sheet = openCall()
    const [first] = within(sheet).getAllByRole('radio')
    first?.focus()
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' })
    expect(
      within(sheet).getByRole('radio', { name: 'Bring the bill' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(document.activeElement).toBe(
      within(sheet).getByRole('radio', { name: 'Bring the bill' }),
    )
  })
})

describe('after sending: only what the host says', () => {
  async function sent(host = fakeHost()) {
    const page = drawFace(host)
    const sheet = openCall()
    pick(sheet, 'Call waiter')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    return { host, page, sheet, call: host.of('service.request')[0] }
  }

  it('shows "sending" until the host answers, and never "on the way" before the state says so', async () => {
    const { page, sheet, call } = await sent()
    expect(within(sheet).getByText('Sending your request')).toBeTruthy()
    await act(async () => call?.answer())
    // Accepted, but the host's state does not list the request yet: it was sent, nothing more.
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    expect(sheet.textContent).not.toContain('on the way')
    // The host lists it as sent, then accepted: still not on the way.
    page.update({ requests: [request('rq-1', call?.command.actionId ?? '', 'waiter', 'sent')] })
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    page.update({ requests: [request('rq-1', call?.command.actionId ?? '', 'waiter', 'accepted')] })
    expect(within(sheet).getByText('The team has your request')).toBeTruthy()
    expect(sheet.textContent).not.toContain('on the way')
    // Only now.
    page.update({
      requests: [request('rq-1', call?.command.actionId ?? '', 'waiter', 'on_the_way')],
    })
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    expect(within(sheet).getByText('Call waiter')).toBeTruthy()
  })

  it("cancels with service.cancel and the request's own id, and shows the cancellation the host reports", async () => {
    const { host, page, sheet, call } = await sent()
    await act(async () => call?.answer())
    page.update({
      requests: [request('rq-7', call?.command.actionId ?? '', 'waiter', 'on_the_way')],
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(host.of('service.cancel')).toHaveLength(1))
    const cancel = host.of('service.cancel')[0]
    expect(cancel?.command).toMatchObject({ kind: 'service.cancel', requestId: 'rq-7' })
    await act(async () => cancel?.answer())
    // Accepted, but the request is on the way until the host says otherwise.
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    page.update({
      requests: [request('rq-7', call?.command.actionId ?? '', 'waiter', 'cancelled')],
    })
    expect(within(sheet).getByText('Request cancelled')).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: 'Cancel request' })).toBeNull()
    // Then the guest can ask again.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send another request' }))
    expect(within(sheet).getAllByRole('radio')).toHaveLength(7)
  })

  it('says so when the cancel is refused or fails, and keeps the request as it is', async () => {
    const { host, page, sheet, call } = await sent()
    await act(async () => call?.answer())
    page.update({ requests: [request('rq-7', call?.command.actionId ?? '', 'waiter', 'accepted')] })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(host.of('service.cancel')).toHaveLength(1))
    await act(async () =>
      host
        .of('service.cancel')[0]
        ?.answer({ status: 'rejected', message: text('Too late, sorry.') }),
    )
    expect(within(sheet).getByRole('alert').textContent).toContain('Too late, sorry.')
    expect(within(sheet).getByText('The team has your request')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(host.of('service.cancel')).toHaveLength(2))
    await act(async () => host.of('service.cancel')[1]?.fail())
    expect(within(sheet).getByRole('alert').textContent).toContain('did not go through')
  })

  it('shows what the host reports even for a request the sheet did not send (after a reload)', () => {
    drawFace(
      fakeHost({
        requests: [request('rq-3', '22222222-2222-4222-8222-222222222222', 'water', 'on_the_way')],
      }),
    )
    const sheet = openCall()
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    expect(within(sheet).getByText('Water')).toBeTruthy()
  })

  it('does not show an old finished request as a current one', () => {
    drawFace(
      fakeHost({
        requests: [request('rq-3', '22222222-2222-4222-8222-222222222222', 'water', 'done')],
      }),
    )
    const sheet = openCall()
    expect(within(sheet).getAllByRole('radio')).toHaveLength(7)
  })

  it("says a rejected request was not taken, with the host's reason, and lets the guest ask again", async () => {
    const { sheet, call } = await sent()
    await act(async () => call?.answer({ status: 'rejected', message: text('The bar is closed.') }))
    expect(within(sheet).getByText('The team could not take this request')).toBeTruthy()
    expect(sheet.textContent).toContain('The bar is closed.')
    expect(sheet.textContent).not.toContain('on the way')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send another request' }))
    expect(within(sheet).getAllByRole('radio')).toHaveLength(7)
  })

  it('keeps the choice after a thrown error and retries with the same actionId', async () => {
    const { host, sheet, call } = await sent()
    await act(async () => call?.fail())
    expect(within(sheet).getByRole('alert').textContent).toContain('did not go through')
    expect(sheet.textContent).not.toContain('on the way')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(2))
    expect(host.of('service.request')[1]?.command).toEqual(call?.command)
  })

  it('treats no answer in time as a failure, not as a request that went', async () => {
    const host = fakeHost()
    drawFace(host)
    const sheet = openCall()
    pick(sheet, 'Water')
    vi.useFakeTimers()
    fireEvent.click(sendButton(sheet))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS + 10)
    })
    expect(within(sheet).getByRole('alert').textContent).toContain('did not go through')
    expect(sheet.textContent).not.toContain('on the way')
  })

  it("is the host's word in Bulgarian too", async () => {
    const host = fakeHost()
    const page = drawFace(host, orderingView('bg_BG'))
    fireEvent.click(screen.getByRole('button', { name: 'Повикай сервитьор' }))
    const sheet = screen.getByRole('dialog', { name: 'Повикай сервитьор' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Вода' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Изпрати' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    const call = host.of('service.request')[0]
    await act(async () => call?.answer())
    page.update({
      requests: [request('rq-1', call?.command.actionId ?? '', 'water', 'on_the_way')],
    })
    expect(sheet.textContent).toContain('Сервитьор идва')
  })
})

describe('only `waiter` ticked: the single step (D127)', () => {
  const single = withKinds(['waiter'])

  it('calls at once on the tap: no picker, no Send to find, one request', async () => {
    const host = fakeHost()
    drawFace(host, single)
    const sheet = openCall()
    expect(within(sheet).queryByRole('radio')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Send' })).toBeNull()
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    expect(host.of('service.request')[0]?.command).toMatchObject({
      kind: 'service.request',
      request: 'waiter',
      note: '',
    })
    expect(within(sheet).getByText('Sending your request')).toBeTruthy()
    await act(async () => host.of('service.request')[0]?.answer())
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    expect(host.of('service.request')).toHaveLength(1)
  })

  it('reads the venue’s kinds as they stand: the waiter and one more is the picker again', () => {
    const host = fakeHost()
    drawFace(host, withKinds(['waiter', 'ice']))
    const sheet = openCall()
    expect(within(sheet).getAllByRole('radio')).toHaveLength(2)
    expect(host.of('service.request')).toHaveLength(0)
  })

  it('sends nothing when the sheet opens from the address (a reload), and calls on its one button', async () => {
    window.history.replaceState(null, '', '/#call')
    const host = fakeHost()
    drawFace(host, single)
    const sheet = screen.getByRole('dialog', { name: 'Call a server' })
    expect(host.of('service.request')).toHaveLength(0)
    expect(within(sheet).queryByRole('radio')).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Call a server' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
  })

  it('shows the open call and sends no second one', () => {
    const host = fakeHost({
      requests: [request('rq-3', '22222222-2222-4222-8222-222222222222', 'waiter', 'on_the_way')],
    })
    drawFace(host, single)
    const sheet = openCall()
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    expect(host.of('service.request')).toHaveLength(0)
  })

  it('retries a failed call with the same actionId', async () => {
    const host = fakeHost()
    drawFace(host, single)
    const sheet = openCall()
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    const first = host.of('service.request')[0]
    await act(async () => first?.fail())
    expect(within(sheet).getByRole('alert').textContent).toContain('did not go through')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(2))
    expect(host.of('service.request')[1]?.command).toEqual(first?.command)
  })
})
