// @vitest-environment jsdom

// Paying from the bill (#45, #114, D127): the lines are the POS's own, the guest ticks them, the tip
// starts at none and is only offered where the POS records one, Pay sends the ticked lines as the
// phone saw them, and the screens that follow are this phone's payment state: the card form is the
// page's (a slot), "Paid" is only a captured payment, and a failure never says it.

import {
  PAID_LINES,
  payingBill,
  payingView,
  payScenarios,
  RECEIPT_LOOK,
  recordSaving,
} from '@restro/shell/testing'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  type FakeHost,
  fakeHost,
  orderingView,
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
      [
        'item_unavailable',
        'Something ran out, so nothing was sent and nothing was charged. Pay for the rest when you’re ready.',
        false,
      ],
      [
        'enter_refused',
        'We couldn’t send this order. Nothing was charged. Please call a waiter.',
        false,
      ],
      ['cancelled', 'Payment cancelled. Nothing was charged.', false],
      ['paying_not_offered', 'Ask your waiter to pay.', false],
      [
        'below_minimum',
        'Card payments start at €0.50. Nothing was charged. Add an item or ask your waiter.',
        false,
      ],
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

  it('words a pay-first round ended "No receipt" as ordered and not charged, and a bill payment as not completed', () => {
    const first = fakeHost({
      ...base(),
      payment: paymentOf({
        state: 'released',
        reason: 'no_receipt',
        mode: 'pay_first',
        form: null,
      }),
    })
    const { sheet } = openPay(first)
    expect(
      within(sheet).getByText(
        'Nothing was charged. Your order went through, and your waiter will take the payment.',
      ),
    ).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: 'Pay again' })).toBeNull()
    cleanup()
    const bill = fakeHost({
      ...base(),
      payment: paymentOf({ state: 'released', reason: 'no_receipt', mode: 'bill', form: null }),
    })
    expect(
      within(openPay(bill).sheet).getByText(
        'The payment wasn’t completed. Nothing was charged. Any amount your bank reserved will be released.',
      ),
    ).toBeTruthy()
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
      'The card form didn’t load. Try again or ask your waiter.',
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

describe('paid in the app (#197, D127 1.2)', () => {
  it('draws the sitting’s paid lines greyed under "Paid in the app" on the pay sheet, naming no payer', () => {
    const host = fakeHost({
      ...base(),
      tableBill: tableBillOf(undefined, { paidLines: PAID_LINES }),
    })
    const { sheet } = openPay(host)
    const section = sheet.querySelector('[data-slot="bill.paid"]')
    expect(section?.querySelector('h4')?.textContent).toBe('Paid in the app')
    const rows = [...(section?.querySelectorAll('li') ?? [])]
    expect(rows.map((row) => row.textContent)).toEqual([
      'Gin & tonic ×2 · €18.00',
      'Nachos · €9.00',
    ])
    for (const row of rows) {
      expect(row.hasAttribute('data-paid-in-app')).toBe(true)
      // Greyed: nothing to tick.
      expect(row.querySelector('input')).toBeNull()
    }
    // The ticks are the open lines' only.
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('draws them on the bill as well, even when nothing is left to pay', () => {
    const host = fakeHost({
      tableBill: tableBillOf([], { paidLines: PAID_LINES }),
      paying: payingOf(),
      ordering: { state: 'on' as const, tips: true },
    })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
    const bill = screen.getByRole('dialog', { name: 'Table order' })
    expect(bill.querySelector('[data-slot="bill.paid"]')?.textContent).toContain('Nachos · €9.00')
  })

  it('names each paid line in the guest’s language, and "Other item" where it has no name', () => {
    const host = fakeHost({
      ...base(),
      tableBill: tableBillOf(undefined, {
        paidLines: [
          { name: { en_US: 'Gin & tonic', bg_BG: 'Джин тоник' }, quantity: '2', amountMinor: 1800 },
          { name: null, quantity: '1', amountMinor: 900 },
        ],
      }),
    })
    drawFace(host, orderingView('bg_BG'))
    fireEvent.click(document.querySelector('[data-slot="menu.pay"]') as HTMLElement)
    const rows = [
      ...(screen.getByRole('dialog').querySelectorAll('[data-slot="bill.paid"] li') ?? []),
    ]
    expect(rows[0]?.textContent).toContain('Джин тоник ×2')
    expect(rows[1]?.textContent).toContain('Друг артикул')
  })

  it('when everything is paid, shows the paid lines alone: no choosing, no totals, no Pay', () => {
    const host = fakeHost({
      ...base(),
      tableBill: tableBillOf([], { paidLines: PAID_LINES, owedMinor: 0, totalMinor: 0 }),
    })
    const { sheet } = openPay(host)
    expect(sheet.querySelector('[data-slot="bill.paid"]')).not.toBeNull()
    expect(sheet.textContent).not.toContain('What are you paying for?')
    expect(sheet.querySelector('[data-slot="pay.start"]')).toBeNull()
    expect(sheet.querySelector('[data-slot="pay.whole"]')).toBeNull()
    expect(sheet.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
    expect(sheet.textContent).not.toContain('Left to pay')
  })

  it('shows the choosing as usual while a line is still free to pay', () => {
    const { sheet } = openPay(
      fakeHost({ ...base(), tableBill: tableBillOf(undefined, { paidLines: PAID_LINES }) }),
    )
    expect(sheet.textContent).toContain('What are you paying for?')
    expect(sheet.querySelector('[data-slot="pay.start"]')).not.toBeNull()
  })

  it('leaves "Nothing has been ordered yet" off the bill once lines were paid in the app', () => {
    const host = fakeHost({
      tableBill: tableBillOf([], { paidLines: PAID_LINES }),
      paying: payingOf(),
      ordering: { state: 'on' as const, tips: true },
    })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Table order' }))
    const bill = screen.getByRole('dialog', { name: 'Table order' })
    expect(bill.querySelector('.ro-empty')).toBeNull()
    expect(bill.querySelector('[data-slot="bill.paid"]')).not.toBeNull()
  })

  it('draws nothing for a bill with no paid lines', () => {
    const { sheet } = openPay(fakeHost(base()))
    expect(sheet.querySelector('[data-slot="bill.paid"]')).toBeNull()
    expect(sheet.textContent).not.toContain('Paid in the app')
  })
})

describe('the Payment confirmation (#197, D127 1.4)', () => {
  const paid = () =>
    fakeHost({
      ...base(),
      payment: paymentOf({
        state: 'captured',
        form: null,
        tipMinor: 250,
        amountMinor: 2500,
        paidAt: '2026-10-29T19:42:00.000Z',
      }),
    })

  it('is offered on the Paid screen, and only there', () => {
    const { sheet } = openPay(paid())
    expect(within(sheet).getByRole('button', { name: 'Payment confirmation' })).toBeTruthy()
    cleanup()
    for (const scenario of payScenarios().filter((s) => s.screen !== 'paid')) {
      const host = fakeHost({ ...base(), payment: scenario.payment })
      const { sheet: other } = openPay(host)
      expect(other.querySelector('[data-slot="pay.confirmation.toggle"]'), scenario.name).toBeNull()
      cleanup()
    }
  })

  it('shows the venue, the time on its clock, the lines, tip, total, "Paid by card" and the number', () => {
    const { sheet } = openPay(paid())
    fireEvent.click(within(sheet).getByRole('button', { name: 'Payment confirmation' }))
    const page = sheet.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    expect(within(page).getByText('Payment confirmation')).toBeTruthy()
    expect(page.querySelector('[data-slot="pay.confirmation.venue"]')?.textContent).toBe('Club X')
    // 19:42 UTC is 21:42 in Sofia.
    expect(page.querySelector('[data-slot="pay.confirmation.when"]')?.textContent).toContain('9:42')
    expect(page.textContent).toContain('House wine · €12.50')
    expect(page.textContent).toContain('Tip€2.50')
    expect(page.textContent).toContain('Total€25.00')
    expect(page.textContent).toContain('Paid by card')
    expect(page.textContent).toContain('Payment number: K7Q4M')
    expect(page.querySelector('[data-slot="pay.confirmation.note"]')?.textContent).toBe(
      'This is not your receipt. Your waiter brings the venue’s receipt.',
    )
    expect(within(page).getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('does not look like a receipt: no tax header, VAT, receipt number, QR code, link or fiscal word', () => {
    const { sheet } = openPay(paid())
    fireEvent.click(within(sheet).getByRole('button', { name: 'Payment confirmation' }))
    const page = sheet.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    for (const pattern of RECEIPT_LOOK) {
      expect(page.textContent ?? '', String(pattern)).not.toMatch(pattern)
    }
    expect(page.querySelector('a, img, canvas, svg, iframe')).toBeNull()
  })

  it('says the same in Bulgarian, with no "бон" and no "фискал"', () => {
    drawFace(paid(), orderingView('bg_BG'))
    fireEvent.click(document.querySelector('[data-slot="menu.pay"]') as HTMLElement)
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Потвърждение за плащане' }))
    const confirmation = sheet.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    expect(confirmation.textContent).toContain('Платено с карта')
    expect(confirmation.textContent).toContain('Номер на плащането: K7Q4M')
    expect(confirmation.textContent).toContain(
      'Това не е касова бележка. Касовата бележка за плащането ви носи сервитьорът.',
    )
    expect(confirmation.textContent).toContain('Запази')
    for (const pattern of RECEIPT_LOOK) expect(confirmation.textContent ?? '').not.toMatch(pattern)
    expect(sheet.textContent).not.toMatch(/(?<!\p{L})бон/u)
  })

  it('saves an image on the phone through a blob file and sends nothing', async () => {
    const record = recordSaving()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const host = paid()
      const { sheet } = openPay(host)
      fireEvent.click(within(sheet).getByRole('button', { name: 'Payment confirmation' }))
      // The image is drawn as the page opens, before any tap on Save.
      expect(record.images).toHaveLength(1)
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(record.downloads).toHaveLength(1))
      expect(record.downloads[0]).toEqual({ href: 'blob:test/1', name: 'payment-K7Q4M.png' })
      expect(record.images).toHaveLength(1)
      // No server link: nothing was fetched and no command went to the host.
      expect(fetch).not.toHaveBeenCalled()
      expect(host.of('pay.start')).toHaveLength(0)
      // The link is revoked soon (the shell's test holds the time), never kept.
      expect(record.made).toEqual(['blob:test/1'])
    } finally {
      record.restore()
      vi.unstubAllGlobals()
    }
  })

  it('says one line when a Save fails, and no success line either way', async () => {
    const record = recordSaving()
    const broken = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    broken.toBlob = (done: (blob: Blob | null) => void) => done(null)
    try {
      const { sheet } = openPay(paid())
      fireEvent.click(within(sheet).getByRole('button', { name: 'Payment confirmation' }))
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(sheet.querySelector('[data-slot="pay.confirmation.failed"]')?.textContent).toBe(
          'Couldn’t save. Try again.',
        ),
      )
      expect(record.downloads).toHaveLength(0)
      expect(sheet.textContent).not.toMatch(/saved/i)
    } finally {
      record.restore()
    }
  })

  it('opens with the focus on its heading, names itself in aria-controls, and closes with "Back"', () => {
    const { sheet } = openPay(paid())
    const toggle = within(sheet).getByRole('button', { name: 'Payment confirmation' })
    expect(toggle.getAttribute('aria-controls')).toBe('ro-pay-confirmation')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const page = sheet.querySelector('#ro-pay-confirmation') as HTMLElement
    expect(page).not.toBeNull()
    expect(document.activeElement).toBe(page.querySelector('h3'))
    // "Back" is the first control of the card; it closes it and the focus returns to the opener.
    const close = page.querySelector('[data-slot="pay.confirmation.close"]') as HTMLElement
    expect(close.textContent).toBe('Back')
    expect(page.firstElementChild).toBe(close)
    fireEvent.click(close)
    expect(sheet.querySelector('#ro-pay-confirmation')).toBeNull()
    expect(document.activeElement).toBe(
      sheet.querySelector('[data-slot="pay.confirmation.toggle"]'),
    )
  })
})

describe('the venue’s electronic receipt (#186, D127)', () => {
  const withReceipt = () => ({ ...base(), paying: payingOf({ electronicReceipt: true }) })
  const field = (sheet: HTMLElement) =>
    sheet.querySelector<HTMLInputElement>('[data-slot="pay.receipt.email"]')

  it('draws the email field only where the host offers it, under the guide’s words', () => {
    const { sheet } = openPay(fakeHost(withReceipt()))
    const input = field(sheet)
    expect(input?.type).toBe('email')
    expect(within(sheet).getByLabelText('Receipt by email (optional)')).toBe(input)
    expect(input?.value).toBe('')
    cleanup()
    const off = openPay(fakeHost(base())).sheet
    expect(field(off)).toBeNull()
    expect(off.textContent).not.toContain('Receipt by email')
  })

  it('sends the typed address with Pay, nothing when it is empty, and greys Pay for a bad one', async () => {
    const host = fakeHost(withReceipt())
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    expect('receiptEmail' in (host.of('pay.start')[0]?.command ?? {})).toBe(false)
    await act(async () =>
      host.of('pay.start')[0]?.answer({ status: 'rejected', code: 'bill_changed' }),
    )

    fireEvent.change(field(sheet) as HTMLElement, { target: { value: 'ana@' } })
    expect(field(sheet)?.getAttribute('aria-invalid')).toBe('true')
    // The reason is on the screen and the field points at it.
    const help = sheet.querySelector('[data-slot="pay.blocked"]')
    expect(help?.textContent).toBe('Check the email address')
    expect(field(sheet)?.getAttribute('aria-describedby')).toBe(help?.id)
    expect(payButton(sheet, 'Pay €22.50').hasAttribute('disabled')).toBe(true)

    fireEvent.change(field(sheet) as HTMLElement, { target: { value: ' ana@example.com ' } })
    expect(field(sheet)?.getAttribute('aria-invalid')).toBe('false')
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    expect(host.of('pay.start')[1]?.command).toMatchObject({ receiptEmail: 'ana@example.com' })
  })

  it('never sends an address where none is offered', async () => {
    const host = fakeHost(base())
    const { sheet } = openPay(host)
    fireEvent.click(within(sheet).getByRole('button', { name: 'The whole bill' }))
    fireEvent.click(payButton(sheet, 'Pay €22.50'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    expect('receiptEmail' in (host.of('pay.start')[0]?.command ?? {})).toBe(false)
  })

  const paid = (receiptEmailed: 'sent' | 'requested' | null, receiptEmail: string | null) => ({
    ...base(),
    payment: paymentOf({
      state: 'captured',
      form: null,
      tipMinor: 250,
      amountMinor: 2500,
      paidAt: '2026-10-29T19:42:00.000Z',
      receiptEmailed,
      receiptEmail,
    }),
  })

  it('says on the Paid screen what went out: sent, requested, or the waiter’s paper', () => {
    const { sheet } = openPay(fakeHost(paid('sent', 'ana@example.com')))
    expect(sheet.querySelector('[data-slot="pay.receipt.line"]')?.textContent).toBe(
      'Show this number to your waiter. Your receipt was sent to ana@example.com.',
    )
    cleanup()
    const requested = openPay(fakeHost(paid('requested', 'ana@example.com'))).sheet
    expect(requested.querySelector('[data-slot="pay.receipt.line"]')?.textContent).toBe(
      'Show this number to your waiter. Your receipt was requested to ana@example.com.',
    )
    cleanup()
    const paper = openPay(fakeHost(paid(null, null))).sheet
    expect(paper.querySelector('[data-slot="pay.receipt.line"]')?.textContent).toBe(
      'Show this number to your waiter. Your waiter brings your receipt.',
    )
  })

  it('says it on the confirmation page too, never looking like a receipt', () => {
    for (const [kind, expected] of [
      ['sent', 'This is not your receipt. Your receipt was sent to ana@example.com.'],
      ['requested', 'This is not your receipt. Your receipt was requested to ana@example.com.'],
    ] as const) {
      const { sheet } = openPay(fakeHost(paid(kind, 'ana@example.com')))
      fireEvent.click(within(sheet).getByRole('button', { name: 'Payment confirmation' }))
      const note = sheet.querySelector('[data-slot="pay.confirmation.note"]')?.textContent ?? ''
      expect(note).toBe(expected)
      for (const pattern of RECEIPT_LOOK) expect(note).not.toMatch(pattern)
      cleanup()
    }
  })
})
