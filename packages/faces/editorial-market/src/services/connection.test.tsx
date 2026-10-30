// @vitest-environment jsdom

// The guest page's consent and connection behaviour on the renderer (RR-48 to RR-52, D118 to D122):
// a location sheet (consent with the Privacy link, checking, the failed check) for the host's
// `location.prompt`, the Stop location check control, a lost Send's line (D120), Send and Pay
// greyed while offline (D121), and the screen the face has open.

import { LOST_SEND_HOLD_MS, type ServiceState, stringsFor } from '@restro/shell'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
  fakeHost,
  itemNamed,
  orderingView,
  orderLine,
  orderOf,
  payingOf,
  resetPage,
  tableBillOf,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const en = stringsFor('en_US').services
const bg = stringsFor('bg_BG').services
const view = orderingView()
const hummus = itemNamed(view, 'Hummus')

const PRIVACY = 'https://club-x.example/privacy'

const location = (
  prompt: 'none' | 'consent' | 'checking' | 'failed',
  state: 'needed' | 'held' = 'needed',
  privacyUrl: string | null = PRIVACY,
) => ({ state, prompt, consent: 'unknown' as const, venueName: 'Club X', privacyUrl })

describe('the location sheet (RR-48, D119, D121, D122)', () => {
  const draw = (host: FakeHost, locale: 'en_US' | 'bg_BG' = 'en_US') =>
    drawFace(host, orderingView(locale))

  it('asks for consent in D122’s words with the Privacy link where paying is off, Allow and Not now', () => {
    // The link comes with the location, whatever paying is (RR-48).
    const host = fakeHost({ location: location('consent'), paying: null })
    draw(host)
    const sheet = screen.getByRole('dialog', { name: en.locationAllowAgain })
    expect(sheet.textContent).toContain('Club X and Restro check your location')
    const link = within(sheet).getByRole('link', { name: en.paying.legalPrivacyLink })
    expect(link.getAttribute('href')).toBe(PRIVACY)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    fireEvent.click(within(sheet).getByRole('button', { name: en.locationAllow }))
    fireEvent.click(within(sheet).getByRole('button', { name: en.locationNotNow }))
    expect(host.located).toEqual(['allow', 'decline'])
  })

  it('says it in Bulgarian', () => {
    const host = fakeHost({ location: location('consent'), paying: null })
    draw(host, 'bg_BG')
    const sheet = screen.getByRole('dialog', { name: bg.locationAllowAgain })
    expect(within(sheet).getByRole('link', { name: bg.paying.legalPrivacyLink })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: bg.locationAllow })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: bg.locationNotNow })).toBeTruthy()
  })

  it('draws no link where the venue has no privacy notice', () => {
    draw(fakeHost({ location: location('consent', 'needed', null), paying: payingOf() }))
    const sheet = screen.getByRole('dialog', { name: en.locationAllowAgain })
    expect(within(sheet).queryByRole('link')).toBeNull()
  })

  it('closing the consent sheet is not an answer: it only goes back', () => {
    const host = fakeHost({ location: location('consent') })
    draw(host)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(host.located).toEqual(['dismiss'])
  })

  it('says it is checking while the host locates the phone', () => {
    draw(fakeHost({ location: location('checking') }))
    const sheet = screen.getByRole('dialog', { name: en.locationChecking })
    expect(within(sheet).getByRole('status').textContent).toContain(en.locationChecking)
  })

  it('offers Call a waiter, Stop location check and Cancel when the check fails, and the still card where the venue takes no calls', async () => {
    const host = fakeHost({ location: location('failed') })
    draw(host)
    const sheet = screen.getByRole('dialog', { name: en.locationFailed })
    expect(sheet.textContent).toContain(en.locationWhy)
    fireEvent.click(within(sheet).getByRole('button', { name: en.locationStop }))
    fireEvent.click(within(sheet).getByRole('button', { name: en.locationCancel }))
    await act(async () =>
      fireEvent.click(within(sheet).getByRole('button', { name: en.locationCallWaiter })),
    )
    expect(host.located).toContain('stop')
    expect(host.located).toContain('dismiss')
    expect(host.of('service.request')).toHaveLength(1)
    cleanup()
    const noCalls = { ...view, features: { ...view.features, callWaiter: null } }
    drawFace(fakeHost({ location: location('failed') }), noCalls)
    const still = screen.getByRole('dialog', { name: en.locationFailed })
    expect(within(still).queryByRole('button', { name: en.locationCallWaiter })).toBeNull()
    expect(still.textContent).toContain(en.locationOrderFromWaiter)
  })

  it('draws the sheet when the pay sheet’s Allow location reopens consent (it had nothing to draw)', () => {
    const host = fakeHost({
      location: location('none'),
      tableBill: null,
      paying: payingOf(),
    })
    const page = drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    const pay = screen.getByRole('dialog', { name: 'Pay' })
    fireEvent.click(within(pay).getByRole('button', { name: en.paying.allowLocation }))
    expect(host.located).toEqual(['reopen'])
    page.update({ location: location('consent') })
    expect(screen.getByRole('dialog', { name: en.locationAllowAgain })).toBeTruthy()
  })
})

describe('the location sheet over another sheet (RR-48)', () => {
  /** The pay sheet open, then the location sheet stacked over it. */
  function stacked() {
    const host = fakeHost({ location: location('none'), tableBill: null, paying: payingOf() })
    const page = drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    page.update({ location: location('consent') })
    return { host, page }
  }

  it('closes only the top sheet on Escape, and hands the focus back to the sheet under it', async () => {
    const { host, page } = stacked()
    expect(screen.getByRole('dialog', { name: en.locationAllowAgain })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(host.located).toContain('dismiss')
    // The pay sheet stays: the host has not yet dropped the prompt, and Escape did not close it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('dialog', { name: 'Pay' })).toBeTruthy()
    expect(window.location.hash).toBe('#pay')
    page.update({ location: location('none') })
    expect(screen.queryByRole('dialog', { name: en.locationAllowAgain })).toBeNull()
    const pay = screen.getByRole('dialog', { name: 'Pay' })
    expect(document.activeElement).toBe(within(pay).getByRole('button', { name: 'Close' }))
  })

  it('leaves the page unlocked when the lower sheet closes first (the back button)', async () => {
    const { page } = stacked()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => {
      window.history.back()
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pay' })).toBeNull())
    // The location sheet is still up: the page stays locked behind it.
    expect(document.body.style.overflow).toBe('hidden')
    page.update({ location: location('none') })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.style.overflow).toBe('')
  })
})

describe('Stop location check (RR-49, D119)', () => {
  it('is on the bill while the phone holds a pass, and one tap stops the check', () => {
    const host = fakeHost({ location: location('none', 'held') })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
    const bill = screen.getByRole('dialog', { name: en.tab })
    fireEvent.click(within(bill).getByRole('button', { name: en.locationStop }))
    expect(host.located).toEqual(['stop'])
  })

  it('is not on the bill before the guest allowed anything', () => {
    drawFace(fakeHost({ location: location('none', 'needed') }))
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
    const bill = screen.getByRole('dialog', { name: en.tab })
    expect(within(bill).queryByRole('button', { name: en.locationStop })).toBeNull()
    // And the bill says why it is empty, with the guest's own Allow location.
    expect(within(bill).getByRole('button', { name: en.paying.allowLocation })).toBeTruthy()
    // And Call a waiter, where the venue takes calls, as the reference template's hidden bill has it.
    expect(within(bill).getByRole('button', { name: en.paying.callWaiter })).toBeTruthy()
  })

  it('says it in Bulgarian', () => {
    drawFace(fakeHost({ location: location('none', 'held') }), orderingView('bg_BG'))
    fireEvent.click(screen.getByRole('button', { name: bg.tab }))
    const bill = screen.getByRole('dialog', { name: bg.tab })
    expect(within(bill).getByRole('button', { name: bg.locationStop })).toBeTruthy()
  })
})

/** A host whose table order holds one Hummus (the host's, not the face's). */
const withHummus = (initial: Partial<ServiceState> = {}) =>
  fakeHost({ order: orderOf([orderLine(hummus)]), ...initial })
const SEND = /^Send 1 item$/

describe('a Send whose answer was lost (RR-50, D120)', () => {
  const sendIt = async (host: FakeHost) => {
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    const sheet = screen.getByRole('dialog', { name: 'Your bag' })
    fireEvent.click(within(sheet).getByRole('button', { name: SEND }))
    return sheet
  }

  it('says D120’s line, never "Try again" and never "Nothing new was sent", and offers no re-send', async () => {
    const host = withHummus()
    const sheet = await sendIt(host)
    await act(async () => host.of('order.send')[0]?.fail())
    const alert = within(sheet).getByRole('alert')
    expect(alert.textContent).toContain(en.sendLost)
    for (const text of [sheet.textContent ?? '']) {
      expect(text).not.toContain('Try again')
      expect(text).not.toContain('Nothing new was sent')
      expect(text).not.toContain('was not confirmed')
    }
    // No Send is offered until the hold is over.
    expect(within(sheet).queryByRole('button', { name: SEND })).toBeNull()
    expect(host.of('order.send')).toHaveLength(1)
  })

  it('says the line for the client’s own lost answer (pending, answer_lost) too', async () => {
    const host = withHummus()
    const sheet = await sendIt(host)
    await act(async () =>
      host.of('order.send')[0]?.answer({ status: 'pending', code: 'answer_lost' }),
    )
    expect(within(sheet).getByRole('alert').textContent).toContain(en.sendLost)
  })

  it('names the reference when the host has one', async () => {
    const host = withHummus()
    const page = drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    const sheet = screen.getByRole('dialog', { name: 'Your bag' })
    page.update({ sendLost: { ref: 'K7Q' } })
    expect(within(sheet).getByRole('alert').textContent).toContain(en.reference('K7Q'))
  })

  it('offers Send again after a few minutes (the hold is over)', async () => {
    const host = withHummus()
    const sheet = await sendIt(host)
    vi.useFakeTimers()
    await act(async () => host.of('order.send')[0]?.fail())
    expect(within(sheet).getByRole('alert').textContent).toContain(en.sendLost)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOST_SEND_HOLD_MS + 10)
    })
    expect(within(sheet).queryByRole('alert')).toBeNull()
    expect(within(sheet).getByRole('button', { name: SEND }).hasAttribute('disabled')).toBe(false)
  })

  it('says it in Bulgarian', () => {
    const host = withHummus({ sendLost: { ref: null } })
    drawFace(host, orderingView('bg_BG'))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(bg.viewBag) }))
    expect(screen.getByRole('dialog').textContent).toContain(bg.sendLost)
  })
})

describe('Send and Pay greyed while offline (RR-51, D120, D121)', () => {
  it('greys Send in the bag with the weak-connection line, and keeps the bag editable', () => {
    const host = withHummus({ offline: true })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    const sheet = screen.getByRole('dialog', { name: 'Your bag' })
    expect(within(sheet).getByRole('button', { name: SEND }).hasAttribute('disabled')).toBe(true)
    expect(sheet.querySelector('[data-slot="send.offline"]')?.textContent).toBe(en.offline)
    expect(
      within(sheet)
        .getByRole('button', { name: /^Remove/ })
        .hasAttribute('disabled'),
    ).toBe(false)
    fireEvent.click(within(sheet).getByRole('button', { name: SEND }))
    expect(host.of('order.send')).toHaveLength(0)
  })

  it('greys Pay with the weak-connection line as its reason', () => {
    const host = fakeHost({
      tableBill: tableBillOf(),
      paying: payingOf(),
      ordering: { state: 'on', tips: true },
      offline: true,
    })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    const sheet = screen.getByRole('dialog', { name: 'Pay' })
    expect(within(sheet).getByRole('button', { name: /^Pay / }).hasAttribute('disabled')).toBe(true)
    expect(sheet.textContent).toContain(en.offline)
  })
})

describe('the screen the face has open (RR-52, D121)', () => {
  it('tells the host the bag, the bill and the menu as the guest moves between them', async () => {
    const host = withHummus({ tableBill: tableBillOf(), paying: payingOf() })
    drawFace(host)
    expect(host.screens.at(-1)).toBe('menu')
    fireEvent.click(screen.getByRole('button', { name: /View bag/ }))
    expect(host.screens.at(-1)).toBe('bag')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(host.screens.at(-1)).toBe('menu'))
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
    expect(host.screens.at(-1)).toBe('bill')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(host.screens.at(-1)).toBe('menu'))
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(host.screens.at(-1)).toBe('bill')
  })
})
