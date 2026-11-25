// @vitest-environment jsdom

// A group payment of the table, "Split the amount" (#544, D160 §3): the button beside Pay starts a
// share of the ticked lines, and from then on every phone of the table sees the same screen — what
// is held of the shared amount, what is left, how long it has, the QR code and the link for the
// others, and this phone's own part. The contract is the shell's: each state of the share and of
// this phone's part draws exactly one screen (`shareScenarios`), the card form is the page's slot,
// and nothing reads as paid before the server says `captured` (D72).

import { stringsFor } from '@restro/shell'
import { shareHold, shareScenarios, shareView } from '@restro/shell/testing'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
  fakeHost,
  orderingView,
  payingOf,
  resetPage,
  SHARE_INVITE,
  tableBillOf,
  tableLine,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const enWords = stringsFor('en_US').services
const bgWords = stringsFor('bg_BG').services
const bg = bgWords.paying

/** A table where paying is on, the POS closes one bill with several cards, and tips are recorded. */
const base = () => ({
  tableBill: tableBillOf(),
  paying: payingOf(),
  ordering: { state: 'on' as const, tips: true, sharing: true },
})

/** Opens the pay sheet; with a share on the host, that is the share's own screen. */
function openPay(host: FakeHost, locale: 'en_US' | 'bg_BG' = 'en_US') {
  const page = drawFace(host, orderingView(locale))
  const title = (locale === 'bg_BG' ? bgWords : enWords).payTitle
  fireEvent.click(screen.getByRole('button', { name: title }))
  return { page, sheet: screen.getByRole('dialog', { name: title }) }
}

const screenOf = (sheet: HTMLElement) =>
  sheet.querySelector('[data-share-screen]')?.getAttribute('data-share-screen') ?? null

describe('starting a share', () => {
  it('offers "Split the amount" beside Pay once lines are ticked, and sends the lines as seen', async () => {
    const host = fakeHost({ ...base(), tableBill: tableBillOf([tableLine(1, 'Gin', 2450)]) })
    const { sheet } = openPay(host)
    const split = within(sheet).getByRole('button', { name: 'Split the amount' })
    expect(split.hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(sheet).getByRole('checkbox'))
    expect(split.hasAttribute('disabled')).toBe(false)
    fireEvent.click(split)
    await waitFor(() => expect(host.of('share.start')).toHaveLength(1))
    const started = host.of('share.start')
    const lineId = `bn_${String(1).padStart(22, '0')}`
    expect(started[0]?.command.pick).toEqual({
      kind: 'lines',
      lines: [{ lineId, quantity: '1' }],
    })
    // Each line as this phone saw it travels with it, as a Pay's does (D111).
    expect(started[0]?.command.seen).toEqual([{ lineId, quantity: '1', amountMinor: 2450 }])
  })

  it('offers nothing to split where the POS cannot close one bill with several cards (D160 2.8)', () => {
    const { sheet } = openPay(fakeHost({ ...base(), ordering: { state: 'on', tips: true } }))
    expect(within(sheet).queryByRole('button', { name: 'Split the amount' })).toBeNull()
    expect(sheet.querySelector('[data-slot="pay.share"]')).toBeNull()
  })

  it('greys the split with the same reason as Pay while the phone is offline', () => {
    const { sheet } = openPay(fakeHost({ ...base(), offline: true }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    expect(
      within(sheet).getByRole('button', { name: 'Split the amount' }).hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('the share every phone sees', () => {
  it('shows what is held of the shared amount, what is left and how long it has', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-25T23:21:00.000Z'))
    const { sheet } = openPay(fakeHost({ ...base(), share: shareView() }))
    expect(screenOf(sheet)).toBe('open')
    expect(within(sheet).getByText('Paying together')).toBeTruthy()
    expect(sheet.querySelector('[data-slot="share.progress"]')?.textContent).toContain(
      '€27.50 of €109.00 paid',
    )
    expect(sheet.querySelector('[data-slot="share.time"]')?.textContent).toBe('9 min left')
    // The shared lines are the POS's own, marked as being paid, and no payer is ever named.
    const lines = sheet.querySelector('[data-slot="share.lines"]')?.textContent ?? ''
    expect(lines).toContain('House wine ×2 · €25.00 · Being paid')
    expect(lines).toContain('Mojito · €10.00 · Being paid')
  })

  it('shows the QR code and the link for the others, and nothing where the host has none', () => {
    const { sheet } = openPay(fakeHost({ ...base(), share: shareView() }))
    const invite = sheet.querySelector('[data-slot="share.invite"]')
    expect(invite?.textContent).toContain('Show the others')
    expect(sheet.querySelector('[data-slot="share.invite.qr"]')?.getAttribute('src')).toBe(
      SHARE_INVITE.qrImage,
    )
    expect(sheet.querySelector('[data-slot="share.invite.link"]')?.textContent).toBe(
      SHARE_INVITE.url,
    )
    cleanup()
    const bare = openPay(fakeHost({ ...base(), share: shareView() }, { invite: null }))
    expect(bare.sheet.querySelector('[data-slot="share.invite"]')).toBeNull()
  })

  it('counts the minutes down from the share’s own deadline, never by itself (D72)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-25T23:21:00.000Z'))
    const { sheet } = openPay(fakeHost({ ...base(), share: shareView() }))
    expect(sheet.querySelector('[data-slot="share.time"]')?.textContent).toBe('9 min left')
    vi.setSystemTime(Date.parse('2026-11-25T23:28:30.000Z'))
    act(() => void vi.advanceTimersByTime(16_000))
    expect(sheet.querySelector('[data-slot="share.time"]')?.textContent).toBe('2 min left')
    // Once the time is gone the line goes, and the share stays as the server last sent it.
    vi.setSystemTime(Date.parse('2026-11-25T23:31:00.000Z'))
    act(() => void vi.advanceTimersByTime(16_000))
    expect(sheet.querySelector('[data-slot="share.time"]')).toBeNull()
    expect(screenOf(sheet)).toBe('open')
  })
})

describe('taking a part', () => {
  it('takes the amount the guest types, with its tip, and sends it as the part', async () => {
    const host = fakeHost({ ...base(), share: shareView() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Your part' }))
    const field = sheet.querySelector('[data-slot="share.amount"]') as HTMLInputElement
    fireEvent.change(field, { target: { value: '40' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '10 %' }))
    const pay = within(sheet).getByRole('button', { name: 'Pay €44.00' })
    expect(pay.hasAttribute('disabled')).toBe(false)
    fireEvent.click(pay)
    await waitFor(() => expect(host.of('share.hold')).toHaveLength(1))
    expect(host.of('share.hold')[0]?.command).toMatchObject({
      paymentId: shareView().id,
      part: { kind: 'amount', minor: 4_000 },
      tipPercent: 10,
      tipMinor: null,
    })
  })

  it('"The rest" is a tap, not a number: the field stays empty and the part is the rest', async () => {
    const host = fakeHost({ ...base(), share: shareView() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Your part' }))
    const rest = sheet.querySelector('[data-slot="share.rest"]') as HTMLElement
    expect(rest.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(rest)
    expect(rest.getAttribute('aria-pressed')).toBe('true')
    expect((sheet.querySelector('[data-slot="share.amount"]') as HTMLInputElement).value).toBe('')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay €81.50' }))
    await waitFor(() => expect(host.of('share.hold')).toHaveLength(1))
    expect(host.of('share.hold')[0]?.command.part).toEqual({ kind: 'rest' })
  })

  it('greys Pay with the ticket’s words for a part the limits refuse (D160 2.12)', () => {
    const host = fakeHost({ ...base(), share: shareView() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Your part' }))
    const field = sheet.querySelector('[data-slot="share.amount"]') as HTMLInputElement
    const blocked = () => sheet.querySelector('[data-slot="share.blocked"]')?.textContent ?? null
    const payDisabled = () =>
      (sheet.querySelector('[data-slot="share.hold"]') as HTMLButtonElement).disabled
    expect(payDisabled()).toBe(true)
    expect(blocked()).toBe(null) // nothing typed: the field says it, not a line of words
    fireEvent.change(field, { target: { value: '90' } })
    expect(blocked()).toBe('Only €81.50 is left to pay.')
    fireEvent.change(field, { target: { value: '0,20' } })
    expect(blocked()).toBe('The smallest card payment is €0.50.')
    fireEvent.change(field, { target: { value: '81,30' } })
    expect(blocked()).toBe('That would leave less than €0.50 for the others.')
    expect(payDisabled()).toBe(true)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(host.of('share.hold')).toHaveLength(0)
  })

  it('words a refusal the server sent with the amount the server knows', async () => {
    const host = fakeHost({ ...base(), share: shareView() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Your part' }))
    fireEvent.change(sheet.querySelector('[data-slot="share.amount"]') as HTMLInputElement, {
      target: { value: '40' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay €40.00' }))
    await waitFor(() => expect(host.of('share.hold')).toHaveLength(1))
    host.of('share.hold')[0]?.answer({ status: 'rejected', code: 'above_share' })
    await waitFor(() =>
      expect(sheet.querySelector('[data-slot="share.refusal"]')?.textContent).toBe(
        'Only €81.50 is left to pay.',
      ),
    )
  })

  it('offers no tip row where the POS records no tip', () => {
    const host = fakeHost({
      ...base(),
      ordering: { state: 'on', tips: false, sharing: true },
      share: shareView(),
    })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Your part' }))
    expect(sheet.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
  })

  it('gives a part back while the share still gathers, and not once it is covered', async () => {
    const host = fakeHost({
      ...base(),
      share: shareView({ mine: shareHold({ state: 'held', form: null }) }),
    })
    const { sheet, page } = openPay(host)
    expect(screenOf(sheet)).toBe('waiting')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Take my part back' }))
    await waitFor(() => expect(host.of('share.withdraw')).toHaveLength(1))
    host.of('share.withdraw')[0]?.answer()
    page.update({
      share: shareView({ state: 'closed', mine: shareHold({ state: 'held', form: null }) }),
    })
    expect(screenOf(sheet)).toBe('closing')
    expect(within(sheet).queryByRole('button', { name: 'Take my part back' })).toBeNull()
  })
})

describe('every state of the share', () => {
  it('draws the one screen the ticket names, with the card form only while the card is awaited', () => {
    for (const scenario of shareScenarios()) {
      resetPage()
      const host = fakeHost({ ...base(), share: scenario.share })
      const { sheet } = openPay(host)
      expect(screenOf(sheet), scenario.name).toBe(scenario.screen)
      expect(
        host.forms.filter((form) => form.mounted),
        scenario.name,
      ).toHaveLength(scenario.slot ? 1 : 0)
      // "Paid" and the payment number: a captured part of this phone's, never anything else.
      const number = sheet.querySelector('[data-slot="share.number"]')?.textContent ?? null
      expect(number, scenario.name).toBe(scenario.paid ? shareView().number : null)
      if (scenario.end !== undefined) {
        expect(
          sheet.querySelector('[data-share-screen]')?.getAttribute('data-share-end'),
          scenario.name,
        ).toBe(scenario.end)
        expect(sheet.querySelector('[data-slot="share.again"]') !== null, scenario.name).toBe(
          scenario.again === true,
        )
      }
      cleanup()
    }
  })

  it('says nothing was charged on every ending, and offers a fresh start only after a bill change', () => {
    const ended = (reason: string) =>
      fakeHost({ ...base(), share: shareView({ state: 'released', reason }) })
    for (const reason of ['expired', 'cancelled', 'withdrawn', 'bad_weather']) {
      resetPage()
      const { sheet } = openPay(ended(reason))
      expect(within(sheet).getByText('Nothing was charged.'), reason).toBeTruthy()
      cleanup()
    }
    resetPage()
    const host = ended('bill_changed')
    const { sheet } = openPay(host)
    expect(within(sheet).getByText('The bill changed. Nothing was charged.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start again' }))
    expect(host.shareDismissed()).toBe(1)
  })

  it('"Back to the bill" asks the host to forget the share, never the face alone (D72)', () => {
    const host = fakeHost({
      ...base(),
      share: shareView({
        state: 'captured',
        mine: shareHold({ state: 'captured', form: null, tipMinor: 250 }),
      }),
    })
    const { sheet } = openPay(host)
    expect(screenOf(sheet)).toBe('paid')
    expect(within(sheet).getByText('Paid')).toBeTruthy()
    expect(sheet.querySelector('[data-slot="share.number"]')?.textContent).toBe(shareView().number)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back to the bill' }))
    expect(host.shareDismissed()).toBe(1)
    // The share is still the host's: the face did not close the screen by itself.
    expect(screenOf(sheet)).toBe('paid')
  })
})

describe('in Bulgarian', () => {
  it('says every screen in Bulgarian, with nothing left in English', () => {
    const said: Record<string, string> = {
      open: bg.share.title,
      preparing: bg.preparing,
      card: bg.total,
      waiting: bg.share.waiting,
      releasing: bg.share.releasing,
      closing: bg.share.closing,
      paid: bg.paid,
      settled: bg.share.settled,
      checking: bg.checkingTitle,
      ended: bg.share.nothingCharged,
    }
    for (const scenario of shareScenarios()) {
      resetPage()
      const host = fakeHost({ ...base(), share: scenario.share })
      const { sheet } = openPay(host, 'bg_BG')
      const text = sheet.textContent ?? ''
      const want = scenario.end === 'bill_changed' ? bg.share.billChanged : said[scenario.screen]
      expect(text, `${scenario.name}: ${want}`).toContain(want)
      // The share's own words are Bulgarian throughout: no English screen slipped in.
      expect(text, scenario.name).not.toContain('Paying together')
      expect(text, scenario.name).not.toContain('Nothing was charged')
      cleanup()
    }
  })

  it('fits the longest Bulgarian words of the taking screen, the invite and every refusal', () => {
    const host = fakeHost({ ...base(), share: shareView() })
    const { sheet } = openPay(host, 'bg_BG')
    expect(within(sheet).getByRole('button', { name: 'Твоята част' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Твоята част' }))
    expect(within(sheet).getByRole('button', { name: 'Останалото' })).toBeTruthy()
    expect(sheet.querySelector('[data-slot="share.invite"]')?.textContent).toContain(
      bg.share.invite,
    )
    const field = sheet.querySelector('[data-slot="share.amount"]') as HTMLInputElement
    const blocked = () => sheet.querySelector('[data-slot="share.blocked"]')?.textContent ?? ''
    fireEvent.change(field, { target: { value: '90' } })
    expect(blocked()).toContain('Остават само')
    fireEvent.change(field, { target: { value: '0,20' } })
    expect(blocked()).toContain('Най-малкото плащане с карта е')
    fireEvent.change(field, { target: { value: '81,30' } })
    expect(blocked()).toContain('Така ще остане по-малко от')
    // Nothing is cut: every drawn line of the share has its words.
    for (const slot of ['share.progress', 'share.time', 'share.lines', 'share.hold']) {
      expect(
        (sheet.querySelector(`[data-slot="${slot}"]`)?.textContent ?? '').length,
        slot,
      ).toBeGreaterThan(0)
    }
  })
})
