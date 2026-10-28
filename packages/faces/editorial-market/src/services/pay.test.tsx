// @vitest-environment jsdom

// Paying from the bill (#45, #114, D127): the lines are the POS's own, the guest ticks them, the tip
// starts at none and is only offered where the POS records one, Pay sends the ticked lines as the
// phone saw them, and the screens that follow are this phone's payment state: the card form is the
// page's (a slot), "Paid" is only a captured payment, and a failure never says it.

import { payingBill, payingView, payScenarios } from '@restro/shell/testing'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
  fakeHost,
  payingOf,
  paymentOf,
  resetPage,
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

const bn = (n: number) => `bn_${String(n).padStart(22, '0')}`

/** Opens the pay sheet on a table bill of €12.50 and €10.00. */
function openPay(host: FakeHost) {
  const page = drawFace(host)
  fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
  return { page, sheet: screen.getByRole('dialog', { name: 'Pay' }) }
}
const base = () => ({
  tableBill: tableBillOf(),
  paying: payingOf(),
  ordering: { state: 'on' as const, tips: true },
})
const payButton = (sheet: HTMLElement, name: RegExp | string) =>
  within(sheet).getByRole('button', { name })

describe('choosing', () => {
  it('shows the POS lines with nothing ticked, nothing tipped, and Pay greyed with its reason', () => {
    const { sheet } = openPay(fakeHost(base()))
    expect(within(sheet).getByText('What are you paying for?')).toBeTruthy()
    expect(within(sheet).getByText(/House wine · €12\.50/)).toBeTruthy()
    for (const box of within(sheet).getAllByRole('checkbox') as HTMLInputElement[]) {
      expect(box.checked).toBe(false)
    }
    for (const preset of sheet.querySelectorAll('[data-slot="pay.tip.preset"]')) {
      expect(preset.getAttribute('aria-pressed')).toBe('false')
    }
    expect(payButton(sheet, /^Pay /).hasAttribute('disabled')).toBe(true)
    expect(within(sheet).getByText('Choose at least one line.')).toBeTruthy()
  })

  it('ticks lines, adds up the preview and rounds the 5, 10 and 15 % presets half-up', () => {
    const host = fakeHost({
      ...base(),
      tableBill: tableBillOf([tableLine(1, 'Gin', 2450)]),
    })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    expect(within(sheet).getByRole('button', { name: 'Pay €24.50' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '15 %' }))
    expect(within(sheet).getByRole('button', { name: 'Pay €28.18' })).toBeTruthy() // 3,675 → 3,68
    fireEvent.click(within(sheet).getByRole('button', { name: '15 %' })) // tapping it again clears it
    expect(within(sheet).getByRole('button', { name: 'Pay €24.50' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '5 %' }))
    expect(within(sheet).getByRole('button', { name: 'Pay €25.73' })).toBeTruthy() // 1,225 → 1,23
  })

  it('offers no tip where the POS cannot record one', () => {
    const { sheet } = openPay(fakeHost({ ...base(), ordering: { state: 'on', tips: false } }))
    expect(sheet.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
    expect(within(sheet).queryByText('Tip: goes to the venue')).toBeNull()
  })

  it('greys a line in a payment that is not final, without a tick', () => {
    const host = fakeHost({
      ...base(),
      tableBill: tableBillOf([
        tableLine(1, 'Wine', 900),
        tableLine(2, 'Gin', 700, { beingPaid: true }),
      ]),
    })
    const { sheet } = openPay(host)
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(sheet).getByText(/Gin · €7\.00 · Being paid/)).toBeTruthy()
  })

  it('greys Pay below the smallest card payment, measured on the lines plus the tip', () => {
    const host = fakeHost({ ...base(), tableBill: tableBillOf([tableLine(1, 'Sweet', 30)]) })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('checkbox'))
    expect(payButton(sheet, /^Pay /).hasAttribute('disabled')).toBe(true)
    expect(
      within(sheet).getByText('Card payments start at €0.50. Add an item or ask your waiter.'),
    ).toBeTruthy()
  })

  it('has no Pay while paying is off at the venue, and a calm line while it is paused', () => {
    const off = openPay(fakeHost({ ...base(), paying: payingOf({ state: 'off' }) }))
    expect(within(off.sheet).getByText('Ask your waiter to pay.')).toBeTruthy()
    expect(off.sheet.querySelector('[data-slot="pay.start"]')).toBeNull()
    cleanup()
    const paused = openPay(fakeHost({ ...base(), paying: payingOf({ state: 'paused' }) }))
    expect(
      within(paused.sheet).getByText('Card payments are paused right now. Ask your waiter.'),
    ).toBeTruthy()
    expect(payButton(paused.sheet, /^Pay /).hasAttribute('disabled')).toBe(true)
  })

  it('names who processes the payment, and the law lines', () => {
    const { sheet } = openPay(
      fakeHost({
        ...base(),
        location: { state: 'held', prompt: 'none', consent: 'allowed', venueName: 'Club X' },
      }),
    )
    expect(
      within(sheet).getByText('Prices in EUR incl. VAT. Complaints and refunds: the venue.'),
    ).toBeTruthy()
    expect(within(sheet).getByText('Payment processed by The processor for Club X.')).toBeTruthy()
  })
})

describe('Pay', () => {
  it('sends pay.start with each ticked line as the phone saw it, and the tip as a percent', async () => {
    const host = fakeHost(base())
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '10 %' }))
    fireEvent.click(payButton(sheet, 'Pay €24.75'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    expect(host.of('pay.start')[0]?.command).toMatchObject({
      kind: 'pay.start',
      pick: {
        kind: 'lines',
        lines: [
          { lineId: bn(1), quantity: '1' },
          { lineId: bn(2), quantity: '1' },
        ],
      },
      seen: [
        { lineId: bn(1), quantity: '1', amountMinor: 1250 },
        { lineId: bn(2), quantity: '1', amountMinor: 1000 },
      ],
      tipPercent: 10,
      tipMinor: null,
    })
  })

  it('sends an amount tip as an amount, and no tip as neither', async () => {
    const host = fakeHost(base())
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getAllByRole('checkbox')[0] as HTMLElement)
    fireEvent.change(within(sheet).getByLabelText('Other amount'), { target: { value: '1,50' } })
    fireEvent.click(payButton(sheet, 'Pay €14.00'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    expect(host.of('pay.start')[0]?.command).toMatchObject({ tipMinor: 150, tipPercent: null })
  })

  it('words a refusal by its code and shows no success of its own', async () => {
    const host = fakeHost(base())
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    await act(async () =>
      host.of('pay.start')[0]?.answer({ status: 'rejected', code: 'bill_changed' }),
    )
    expect(within(sheet).getByText('Your bill changed since you opened it.')).toBeTruthy()
    expect(sheet.textContent).not.toContain('Paid')
    // The ticks stay: nothing cleared them, the bill did not change under them.
    expect((within(sheet).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
  })

  it('asks first when the same amount was paid in the last 15 minutes', async () => {
    const host = fakeHost({
      ...base(),
      paying: payingOf({ recent: { amountMinor: 2250, agoSeconds: 240 } }),
    })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    expect(within(sheet).getByText('Same amount as 4 minutes ago. Pay again?')).toBeTruthy()
    expect(host.of('pay.start')).toHaveLength(0)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(host.of('pay.start')).toHaveLength(0)
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, pay' }))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
  })

  it("keeps a friend's new round from clearing a tick, and clears one whose line changed", () => {
    const host = fakeHost(base())
    const { page, sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    page.update({
      tableBill: tableBillOf([
        tableLine(1, 'House wine', 1250),
        tableLine(2, 'Mojito', 1000),
        tableLine(3, 'Gin', 800),
      ]),
    })
    const boxes = within(screen.getByRole('dialog', { name: 'Pay' })).getAllByRole(
      'checkbox',
    ) as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false])
    page.update({
      tableBill: tableBillOf([tableLine(1, 'House wine', 1250), tableLine(2, 'Mojito', 1200)]),
    })
    const after = within(screen.getByRole('dialog', { name: 'Pay' })).getAllByRole(
      'checkbox',
    ) as HTMLInputElement[]
    expect(after.map((box) => box.checked)).toEqual([true, false])
  })
})

describe("this phone's payment", () => {
  const screens = (host: FakeHost) => {
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    return screen.getByRole('dialog', { name: 'Pay' })
  }

  it('says "Preparing your bill…" with Pay later until the card form is ready', () => {
    const sheet = screens(
      fakeHost({
        ...base(),
        payment: paymentOf({ state: 'requested', form: null, amountMinor: null }),
      }),
    )
    expect(within(sheet).getByText('Preparing your bill…')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Pay later' })).toBeTruthy()
  })

  it("places the form slot with the face's label while the card is awaited, once", () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    const { page, sheet } = openPay(host)
    expect(within(sheet).getByText(/House wine · €12\.50/)).toBeTruthy()
    expect(host.forms).toHaveLength(1)
    expect(host.forms[0]).toMatchObject({ label: 'Pay €22.50', mounted: true })
    expect(sheet.querySelector('[data-slot="pay.form"]')).toBe(host.forms[0]?.target)
    // The poll brings a new state: the form stays mounted, it is not made again.
    page.update({ payment: paymentOf({ tipMinor: 0 }) })
    expect(host.forms).toHaveLength(1)
    expect(host.forms[0]?.mounted).toBe(true)
  })

  it('takes the form away when the card is held, and shows one waiting state', () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    const { page } = openPay(host)
    page.update({ payment: paymentOf({ state: 'held', form: null }) })
    expect(host.forms[0]?.mounted).toBe(false)
    for (const state of ['held', 'queued', 'isolated', 'checked', 'closed'] as const) {
      page.update({ payment: paymentOf({ state, form: null }) })
      const sheet = screen.getByRole('dialog', { name: 'Pay' })
      expect(within(sheet).getByText('Processing your payment…'), state).toBeTruthy()
      expect(within(sheet).queryByRole('button', { name: 'Pay later' }), state).toBeNull()
    }
  })

  it('sends pay.cancel from Pay later and goes back to the bill when it is accepted', async () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay later' }))
    await waitFor(() => expect(host.of('pay.cancel')).toHaveLength(1))
    await act(async () => host.of('pay.cancel')[0]?.answer())
    expect(host.dismissed()).toBe(1)
  })

  it('stays on the payment when the cancel is too late', async () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay later' }))
    await waitFor(() => expect(host.of('pay.cancel')).toHaveLength(1))
    await act(async () =>
      host.of('pay.cancel')[0]?.answer({ status: 'rejected', code: 'too_late' }),
    )
    expect(
      within(sheet).getByText('Too late to cancel: the payment is being processed.'),
    ).toBeTruthy()
    expect(host.dismissed()).toBe(0)
  })

  it('says Paid only for a captured payment, with the number, the lines and the receipt line', () => {
    const host = fakeHost({ ...base(), payment: paymentOf({ state: 'closed', form: null }) })
    const { page } = openPay(host)
    expect(screen.queryByText('Paid')).toBeNull()
    page.update({
      payment: paymentOf({ state: 'captured', form: null, tipMinor: 250, amountMinor: 2500 }),
    })
    const sheet = screen.getByRole('dialog', { name: 'Pay' })
    expect(within(sheet).getByText('Paid')).toBeTruthy()
    expect(sheet.querySelector('[data-slot="pay.number"]')?.textContent).toBe('K7Q4M')
    expect(
      within(sheet).getByText('Show this number to your waiter. Your waiter brings your receipt.'),
    ).toBeTruthy()
    expect(sheet.textContent).toContain('Tip€2.50')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back to the bill' }))
    expect(host.dismissed()).toBe(1)
  })

  it('shows one calm screen when the venue is checking the payment, never asking to pay twice', () => {
    for (const state of ['unconfirmed', 'stranded', 'capture_failed'] as const) {
      const host = fakeHost({ ...base(), payment: paymentOf({ state, form: null }) })
      const { sheet } = openPay(host)
      expect(within(sheet).getByText('The venue is checking the payment'), state).toBeTruthy()
      expect(
        within(sheet).getByText(
          'You don’t need to do anything. If you have a question, call a waiter.',
        ),
        state,
      ).toBeTruthy()
      expect(within(sheet).queryByRole('button', { name: 'Pay again' }), state).toBeNull()
      expect(sheet.textContent).not.toMatch(/captured|stranded|unconfirmed/)
      cleanup()
    }
  })

  it('words each end with nothing charged, offering Pay again only where it is safe', () => {
    const cases: [string | null, string, boolean][] = [
      ['busy', 'Paying in the app is busy, try again in a minute or call a waiter.', true],
      [
        'check_failed',
        'Your bill changed just before paying. Nothing was charged. Check the bill and try again.',
        true,
      ],
      [
        'bill_changed',
        'Your bill changed just before paying. Nothing was charged. Check the bill and try again.',
        true,
      ],
      ['expired', 'Your time ran out. Nothing was charged.', true],
      [
        'paying_paused',
        'Card payments are paused right now. Nothing was charged. Ask your waiter.',
        false,
      ],
      [
        'isolate_refused',
        'We couldn’t prepare this payment. Nothing was charged. Ask your waiter.',
        false,
      ],
      [
        'not_on_till',
        'The payment wasn’t completed. Nothing was charged. Any amount your bank reserved will be released.',
        false,
      ],
      ['item_unavailable', 'Something ran out. Nothing was charged. Ask your waiter.', false],
    ]
    for (const [reason, words, again] of cases) {
      const host = fakeHost({
        ...base(),
        payment: paymentOf({ state: 'released', reason, form: null }),
      })
      const { sheet } = openPay(host)
      expect(within(sheet).getByText(words), String(reason)).toBeTruthy()
      expect(
        within(sheet).queryByRole('button', { name: 'Pay again' }) !== null,
        String(reason),
      ).toBe(again)
      expect(within(sheet).getByRole('button', { name: 'Back to the bill' })).toBeTruthy()
      cleanup()
    }
  })

  it('offers Call a waiter on the failure screens where the venue takes calls', async () => {
    const host = fakeHost({
      ...base(),
      payment: paymentOf({ state: 'released', reason: 'busy', form: null }),
    })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Call a waiter' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
    expect(host.of('service.request')[0]?.command).toMatchObject({ request: 'waiter' })
  })
})

describe('the review of #195 (D127)', () => {
  const greyed = (n: number) =>
    tableBillOf([
      tableLine(1, 'House wine', 1250, { beingPaid: n >= 1 }),
      tableLine(2, 'Mojito', 1000, { beingPaid: n >= 1 }),
    ])

  it('"Pay again" goes back to choosing with the ticks kept, and Pay takes the guarded path', async () => {
    const host = fakeHost(base())
    const { page, sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    await act(async () => host.of('pay.start')[0]?.answer())
    // The payment runs: the server marks its own lines being paid (it must not empty the ticks).
    page.update({ tableBill: greyed(1), payment: paymentOf({ state: 'held', form: null }) })
    page.update({ payment: paymentOf({ state: 'released', reason: 'busy', form: null }) })
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Pay' })).getByRole('button', {
        name: 'Pay again',
      }),
    )
    expect(host.dismissed()).toBe(1)
    // It sent nothing itself.
    expect(host.of('pay.start')).toHaveLength(1)
    // The host drops the payment and the lines are free again.
    page.update({ tableBill: greyed(0), payment: null })
    const back = screen.getByRole('dialog', { name: 'Pay' })
    const boxes = within(back).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, true])
    fireEvent.click(payButton(back, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    expect(host.of('pay.start')[1]?.command.pick).toEqual({
      kind: 'lines',
      lines: [
        { lineId: bn(1), quantity: '1' },
        { lineId: bn(2), quantity: '1' },
      ],
    })
  })

  it('never sends a tip where none is offered, however it was chosen before', async () => {
    const host = fakeHost(base())
    const { page, sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '10 %' }))
    page.update({ ordering: { state: 'on', tips: false } })
    const after = screen.getByRole('dialog', { name: 'Pay' })
    expect(after.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
    fireEvent.click(payButton(after, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    expect(host.of('pay.start')[0]?.command).toMatchObject({ tipPercent: null, tipMinor: null })
  })

  it('words the venue\'s smallest payment and "too many tries" from the shell\'s one helper', async () => {
    const host = fakeHost({ ...base(), paying: payingOf({ minCardMinor: 100 }) })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    await act(async () =>
      host.of('pay.start')[0]?.answer({ status: 'rejected', code: 'below_minimum' }),
    )
    expect(
      within(sheet).getByText('Card payments start at €1.00. Add an item or ask your waiter.'),
    ).toBeTruthy()
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    await act(async () =>
      host.of('pay.start')[1]?.answer({ status: 'rejected', code: 'rate_limited' }),
    )
    expect(within(sheet).getByText('Too many tries. Wait a moment and try again.')).toBeTruthy()
  })

  it('names the venue on the processor line from the paying state, never "for ."', () => {
    const { sheet } = openPay(fakeHost({ ...base(), paying: payingOf({ venueName: 'Club X' }) }))
    expect(within(sheet).getByText('Payment processed by The processor for Club X.')).toBeTruthy()
  })

  it('says why the bill is hidden without a location pass, with Allow location and Call a waiter', () => {
    const host = fakeHost({
      location: { state: 'needed', prompt: 'none', consent: 'unknown', venueName: 'Club X' },
      tableBill: null,
      paying: payingOf(),
    })
    const { sheet } = openPay(host)
    expect(within(sheet).getByText('The bill shows only at the table')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Call a waiter' })).toBeTruthy()
    expect(sheet.querySelector('[data-slot="pay.start"]')).toBeNull()
  })

  it('draws the table on the Paid screen', () => {
    const host = fakeHost({ ...base(), payment: paymentOf({ state: 'captured', form: null }) })
    drawFace(host, undefined, { tableLabel: '12' })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    const sheet = screen.getByRole('dialog', { name: 'Pay' })
    expect(sheet.querySelector('[data-slot="pay.table"]')?.textContent).toBe('Table 12')
  })

  it('offers Call a waiter on the card screen too', async () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Call a waiter' }))
    await waitFor(() => expect(host.of('service.request')).toHaveLength(1))
  })

  it("gives the card form the guest's language and the failure words", () => {
    const host = fakeHost({ ...base(), payment: paymentOf() })
    openPay(host)
    expect(host.forms[0]).toMatchObject({ locale: 'en' })
    expect(host.forms[0]?.failedText).toBe(
      'The card form could not load. Nothing was charged. Ask your waiter.',
    )
  })
})

describe('every stage of a payment (the contract every face passes)', () => {
  for (const scenario of payScenarios()) {
    it(`draws ${scenario.name}: the slot ${scenario.slot ? 'is' : 'is not'} mounted, Paid ${scenario.paid ? 'shows' : 'does not show'}`, () => {
      const host = fakeHost({
        tableBill: payingBill(),
        paying: payingView(),
        payment: scenario.payment,
      })
      drawFace(host)
      fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
      const sheet = screen.getByRole('dialog', { name: 'Pay' })
      expect(sheet.querySelector('[data-pay-screen]')?.getAttribute('data-pay-screen')).toBe(
        scenario.screen,
      )
      expect(host.forms.length).toBe(scenario.slot ? 1 : 0)
      expect(sheet.querySelector('[data-slot="pay.number"]') !== null).toBe(scenario.paid)
      expect(sheet.textContent).not.toMatch(
        /\b(isolated|queued|stranded|capture_failed|unconfirmed|entered)\b/,
      )
    })
  }
})
