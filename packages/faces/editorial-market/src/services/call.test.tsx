// @vitest-environment jsdom

// Calling a waiter (brief SH-06 test 5): only the kinds the venue allows, and "on the way" only
// when the host's request says so. One open call per table (D127, DA-10): another kind joins it and
// there is no withdrawing it, so the sheet has no Cancel. A lost answer is never "Request sent"
// (D72, DA-2), and a call nobody answered still speaks when the sheet is opened again (DA-27).

import { ANSWER_LOST_CODE, type ServiceKind, type ViewModel } from '@restro/shell'
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

  it('offers no Cancel on an open call: the guide says there is no withdrawing one (DA-10)', async () => {
    const { host, page, sheet, call } = await sent()
    await act(async () => call?.answer())
    page.update({ requests: [request('wc-7:waiter', 'wc-7', 'waiter', 'on_the_way')] })
    expect(within(sheet).getByText('A waiter is on the way')).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: 'Cancel request' })).toBeNull()
    expect(sheet.textContent).not.toContain('Cancel')
    expect(host.of('service.cancel')).toHaveLength(0)
  })

  it('draws the open call as one thing and sends a second kind onto it (D127, DA-10)', async () => {
    const { host, page, sheet, call } = await sent()
    await act(async () => call?.answer())
    // The host lists one request per kind of the table's one call, all carrying the call's own id.
    page.update({ requests: [request('wc-7:ice', 'wc-7', 'ice', 'sent')] })
    expect(within(sheet).getByText('Request sent')).toBeTruthy()
    expect(within(sheet).getByText('Ice')).toBeTruthy()
    // "Something else" brings the picker back over the open call: the kind joins it, server side.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send another request' }))
    pick(sheet, 'Water')
    fireEvent.click(sendButton(sheet))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(2))
    expect(host.of('service.request')[1]?.command).toMatchObject({ request: 'water' })
    // A new action, not the first one's retry.
    expect(host.of('service.request')[1]?.command.actionId).not.toBe(call?.command.actionId)
    expect(within(sheet).getByText('Sending your request')).toBeTruthy()
    await act(async () => host.of('service.request')[1]?.answer())
    page.update({
      requests: [
        request('wc-7:ice', 'wc-7', 'ice', 'sent'),
        request('wc-7:water', 'wc-7', 'water', 'sent'),
      ],
    })
    expect(within(sheet).getByText('Ice, Water')).toBeTruthy()
  })

  it('offers nothing else to ask for where only the waiter is ticked', async () => {
    drawFace(
      fakeHost({ requests: [request('wc-9:waiter', 'wc-9', 'waiter', 'sent')] }),
      withKinds(['waiter']),
    )
    const sheet = openCall()
    expect(within(sheet).queryByRole('button', { name: 'Send another request' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Cancel request' })).toBeNull()
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

  it('never says a lost answer was sent, and retries it with the same actionId (D72, DA-2)', async () => {
    const { host, sheet, call } = await sent()
    // What the page's host answers when a request threw, timed out or came back unusable.
    await act(async () => call?.answer({ status: 'pending', code: ANSWER_LOST_CODE }))
    expect(within(sheet).queryByText('Request sent')).toBeNull()
    // D120's line: the request may be with the staff, so nothing is claimed either way.
    expect(within(sheet).getByRole('alert').textContent).toContain('reach Restro right now')
    expect(sheet.textContent).not.toContain('did not go through')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(2))
    expect(host.of('service.request')[1]?.command).toEqual(call?.command)
  })

  it('still speaks about a call nobody answered when the sheet is opened again (DA-27)', () => {
    // The host keeps a lapsed call for a few minutes, so the guest who comes back reads what became
    // of it instead of a picker as though nothing had happened.
    drawFace(fakeHost({ requests: [request('wc-4:water', 'wc-4', 'water', 'rejected')] }))
    const sheet = openCall()
    expect(within(sheet).getByText('The team could not take this request')).toBeTruthy()
    expect(within(sheet).getByText('Ask your waiter.')).toBeTruthy()
    expect(within(sheet).getByText('Water')).toBeTruthy()
    expect(within(sheet).queryByRole('radio')).toBeNull()
    // And the way on is a fresh request, not another kind on a call that has ended.
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

  it('calls on the tap when the last call lapsed: only an open one holds it back (DA-27)', async () => {
    const host = fakeHost({ requests: [request('wc-5:waiter', 'wc-5', 'waiter', 'rejected')] })
    drawFace(host, single)
    const sheet = openCall()
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    expect(within(sheet).getByText('Sending your request')).toBeTruthy()
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
