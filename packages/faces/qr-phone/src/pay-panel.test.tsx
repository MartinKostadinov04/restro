// @vitest-environment jsdom

// Paying from the bill on the reference face (#45, #114, D127): the contract tests every face has
// for the paying states and the form slot. The host's state is built by `@restro/shell/testing`
// (`payScenarios`), the same for every face.

import {
  buildViewModel,
  type GuestCommand,
  imageSlotsFor,
  type PayFormSlot,
  type ServiceBinding,
  type ServiceState,
  stringsFor,
} from '@restro/shell'
import {
  fixture,
  PAID_LINES,
  payingBill,
  payingState,
  payScenarioPayment,
  payScenarios,
  RECEIPT_LOOK,
  recordSaving,
} from '@restro/shell/testing'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { QrPhoneFace } from './face'
import { QR_PHONE_MANIFEST } from './manifest'
import { sentWords } from './table-order'

// `act` needs this flag in a test that is not run by Testing Library.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const f = fixture('features-on')
const view = buildViewModel(f.snapshot, f.overlay, {
  ...f.context,
  images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
})
const words = stringsFor('en_US').services.paying

const pending = (actionId: string) =>
  Promise.resolve({ actionId, status: 'pending' as const, message: null, ref: null })

interface Mounted {
  readonly target: object
  readonly label: string
  unmounted: boolean
}

/** A form slot that records what the face asks of it. */
function recordingSlot(): { slot: PayFormSlot; mounts: Mounted[] } {
  const mounts: Mounted[] = []
  return {
    mounts,
    slot: {
      mount(target, props) {
        const record: Mounted = { target, label: props.label, unmounted: false }
        mounts.push(record)
        return {
          update: () => undefined,
          unmount: () => {
            record.unmounted = true
          },
        }
      },
    },
  }
}

let root: Root | null = null
let host: HTMLElement | null = null

/** Takes the drawn page down (a test that draws twice). */
function unmount() {
  if (root !== null) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
}
afterEach(unmount)

async function draw(state: ServiceState, slot?: PayFormSlot, dismissed: { n: number } = { n: 0 }) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const services: ServiceBinding = {
    state,
    dispatch: (command) => pending(command.actionId),
    ...(slot === undefined ? {} : { payForm: slot }),
    payControls: {
      dismiss: () => {
        dismissed.n += 1
      },
    },
  }
  await act(async () => root?.render(<QrPhoneFace view={view} services={services} />))
  return host
}

describe('the bill and choosing', () => {
  it('shows the POS lines with nothing ticked and nothing tipped, and Pay greyed with its reason', async () => {
    const page = await draw(payingState())
    expect(page.textContent).toContain('Your table’s bill')
    expect(page.textContent).toContain('House wine')
    expect(page.textContent).toContain('Left to pay: €22.50')
    const boxes = [...page.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    expect(boxes.some((box) => box.checked)).toBe(false)
    expect(
      [...page.querySelectorAll('[data-slot="pay.tip.preset"]')].map((b) => b.textContent),
    ).toEqual(['5 %', '10 %', '15 %'])
    for (const preset of page.querySelectorAll('[data-slot="pay.tip.preset"]')) {
      expect(preset.getAttribute('aria-pressed')).toBe('false')
    }
    expect(page.querySelector<HTMLButtonElement>('[data-slot="pay.start"]')?.disabled).toBe(true)
    expect(page.textContent).toContain(words.nothingPicked)
  })

  it('offers no tip where the POS cannot record one, and no Pay where paying is off', async () => {
    const noTip = await draw(payingState({ ordering: { state: 'on', tips: false } }))
    expect(noTip.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
    act(() => root?.unmount())
    root = null
    noTip.remove()
    const off = await draw(payingState({ paying: { ...payingState().paying!, state: 'off' } }))
    expect(off.textContent).toContain(words.askWaiterToPay)
    expect(off.querySelector('[data-slot="pay.start"]')).toBeNull()
  })

  it('greys a line being paid, with no tick', async () => {
    const bill = payingBill()
    const part = bill.parts[0]
    if (part === undefined) throw new Error('no part')
    const lines = part.lines.map((line, index) =>
      index === 1 ? { ...line, beingPaid: true } : line,
    )
    const page = await draw(payingState({ tableBill: { ...bill, parts: [{ ...part, lines }] } }))
    expect(page.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(page.textContent).toContain(`Mojito · €10.00 · ${words.beingPaid}`)
  })
})

describe("this phone's payment, every state (contract)", () => {
  for (const scenario of payScenarios()) {
    it(`draws ${scenario.name}: the slot ${scenario.slot ? 'is' : 'is not'} mounted, Paid ${scenario.paid ? 'shows' : 'does not show'}`, async () => {
      const { slot, mounts } = recordingSlot()
      const page = await draw(payingState({ payment: scenario.payment }), slot)
      const screen = page.querySelector('[data-pay-screen]')?.getAttribute('data-pay-screen')
      expect(screen).toBe(scenario.screen)
      expect(mounts.length).toBe(scenario.slot ? 1 : 0)
      if (scenario.slot) {
        expect(page.querySelector('[data-slot="pay.form"]')).toBe(mounts[0]?.target)
        expect(mounts[0]?.label).toBe('Pay €22.50')
      }
      // "Paid" and the number only for a captured payment; never a step of the till.
      expect(page.querySelector('[data-slot="pay.number"]') !== null).toBe(scenario.paid)
      expect(page.textContent?.includes(words.paid) && scenario.paid).toBe(scenario.paid)
      if (!scenario.paid) expect(page.querySelector('h2')?.textContent).not.toBe(words.paid)
      expect(page.textContent).not.toMatch(
        /\b(isolated|queued|stranded|capture_failed|unconfirmed|entered)\b/,
      )
    })
  }

  it('mounts the form once and keeps it across a new state, and takes it away at the hold', async () => {
    const { slot, mounts } = recordingSlot()
    const state = payingState({ payment: payScenarioPayment() })
    const page = await draw(state, slot)
    expect(mounts).toHaveLength(1)
    await act(async () =>
      root?.render(
        <QrPhoneFace
          view={view}
          services={{
            state: { ...state, revision: 2 },
            dispatch: (c) => pending(c.actionId),
            payForm: slot,
          }}
        />,
      ),
    )
    expect(mounts).toHaveLength(1)
    expect(mounts[0]?.unmounted).toBe(false)
    await act(async () =>
      root?.render(
        <QrPhoneFace
          view={view}
          services={{
            state: { ...state, payment: payScenarioPayment({ state: 'held', form: null }) },
            dispatch: (c) => pending(c.actionId),
            payForm: slot,
          }}
        />,
      ),
    )
    expect(mounts[0]?.unmounted).toBe(true)
    expect(page.querySelector('[data-pay-screen="waiting"]')).not.toBeNull()
  })

  it('goes back to the bill from a last screen', async () => {
    const dismissed = { n: 0 }
    const page = await draw(
      payingState({ payment: payScenarioPayment({ state: 'captured', form: null }) }),
      undefined,
      dismissed,
    )
    const back = page.querySelector<HTMLButtonElement>('[data-slot="pay.back"]')
    await act(async () => back?.click())
    expect(dismissed.n).toBe(1)
  })
})

describe('the review of #195 (D127)', () => {
  const sent: GuestCommand[] = []

  /** Draws with a dispatch that records every command and answers `answer`. */
  async function drawRecording(
    state: ServiceState,
    answer: { status: 'accepted' | 'rejected'; code?: string } = { status: 'accepted' },
    slot?: PayFormSlot,
    dismissed: { n: number } = { n: 0 },
  ) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const services = (next: ServiceState): ServiceBinding => ({
      state: next,
      dispatch: (command) => {
        sent.push(command)
        return Promise.resolve({
          actionId: command.actionId,
          message: null,
          ref: null,
          ...answer,
        })
      },
      ...(slot === undefined ? {} : { payForm: slot }),
      payControls: {
        dismiss: () => {
          dismissed.n += 1
        },
      },
    })
    const show = (next: ServiceState) =>
      act(async () =>
        root?.render(<QrPhoneFace view={view} services={services(next)} tableLabel="12" />),
      )
    await show(state)
    return { page: host, show }
  }
  const greyed = (on: boolean) => {
    const bill = payingBill()
    const part = bill.parts[0]
    if (part === undefined) throw new Error('no part')
    return {
      ...bill,
      parts: [{ ...part, lines: part.lines.map((l) => ({ ...l, beingPaid: on })) }],
    }
  }
  const click = (page: HTMLElement, selector: string) =>
    act(async () => page.querySelector<HTMLElement>(selector)?.click())

  it('"Pay again" goes back to choosing with the ticks kept, and Pay takes the guarded path', async () => {
    sent.length = 0
    const dismissed = { n: 0 }
    const { page, show } = await drawRecording(
      payingState(),
      { status: 'accepted' },
      undefined,
      dismissed,
    )
    await click(page, '[data-slot="pay.whole"]')
    await click(page, '[data-slot="pay.start"]')
    expect(sent.map((c) => c.kind)).toEqual(['pay.start'])
    // The payment runs and the server greys its own lines: the ticks must survive it.
    await show(
      payingState({
        tableBill: greyed(true),
        payment: payScenarioPayment({ state: 'held', form: null }),
      }),
    )
    await show(
      payingState({
        tableBill: greyed(true),
        payment: payScenarioPayment({ state: 'released', reason: 'busy', form: null }),
      }),
    )
    await click(page, '[data-slot="pay.again"]')
    expect(dismissed.n).toBe(1)
    expect(sent).toHaveLength(1)
    await show(payingState({ tableBill: greyed(false), payment: null }))
    const boxes = [...page.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes.map((box) => box.checked)).toEqual([true, true])
    await click(page, '[data-slot="pay.start"]')
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      kind: 'pay.start',
      pick: { kind: 'lines' },
      seen: [{ amountMinor: 1250 }, { amountMinor: 1000 }],
    })
  })

  it('never sends a tip where none is offered, however it was chosen before', async () => {
    sent.length = 0
    const { page, show } = await drawRecording(payingState())
    await click(page, '[data-slot="pay.whole"]')
    await click(page, '[data-slot="pay.tip.preset"]:nth-of-type(2)')
    await show(payingState({ ordering: { state: 'on', tips: false } }))
    expect(page.querySelector('[data-slot="pay.tip.row"]')).toBeNull()
    await click(page, '[data-slot="pay.start"]')
    expect(sent.at(-1)).toMatchObject({ kind: 'pay.start', tipPercent: null, tipMinor: null })
  })

  it("words a refusal at Pay by the shell's helper, with the venue's smallest payment", async () => {
    sent.length = 0
    const state = payingState({ paying: { ...payingState().paying!, minCardMinor: 100 } })
    const { page } = await drawRecording(state, { status: 'rejected', code: 'below_minimum' })
    await click(page, '[data-slot="pay.whole"]')
    await click(page, '[data-slot="pay.start"]')
    expect(page.querySelector('[data-slot="pay.refused"]')?.textContent).toBe(
      'Card payments start at €1.00. Add an item or ask your waiter.',
    )
    const limited = await drawRecording(state, { status: 'rejected', code: 'rate_limited' })
    await click(limited.page, '[data-slot="pay.whole"]')
    await click(limited.page, '[data-slot="pay.start"]')
    expect(limited.page.querySelector('[data-slot="pay.refused"]')?.textContent).toBe(
      'Too many tries. Wait a moment and try again.',
    )
  })

  it('names the venue on the processor line from the paying state', async () => {
    const { page } = await drawRecording(payingState())
    expect(page.textContent).toContain('Payment processed by Stripe for Club X.')
  })

  it('says why the bill is hidden without a location pass, with Allow location and Call a waiter', async () => {
    const state = payingState({
      tableBill: null,
      location: { state: 'needed', prompt: 'none', consent: 'unknown', venueName: 'Club X' },
    })
    const { page } = await drawRecording(state)
    const hidden = page.querySelector('[data-bill-hidden]')
    expect(hidden?.textContent).toContain('The bill shows only at the table')
    expect(hidden?.textContent).toContain('Call a waiter')
    expect(page.querySelector('[data-slot="pay.start"]')).toBeNull()
  })

  it('draws the table on the Paid screen, and Call a waiter on the card screen', async () => {
    const paid = await drawRecording(
      payingState({ payment: payScenarioPayment({ state: 'captured', form: null }) }),
    )
    expect(paid.page.querySelector('[data-slot="pay.table"]')?.textContent).toBe('Table 12')
    act(() => root?.unmount())
    host?.remove()
    const card = await drawRecording(
      payingState({ payment: payScenarioPayment() }),
      undefined,
      recordingSlot().slot,
    )
    expect(
      card.page.querySelector('[data-pay-screen="card"] [data-slot="pay.call"]'),
    ).not.toBeNull()
  })

  it("gives the card form the guest's language and the failure words", async () => {
    const recorded: { locale: string; failedText: string }[] = []
    const slot: PayFormSlot = {
      mount(_target, props) {
        recorded.push({ locale: props.locale, failedText: props.failedText })
        return { update: () => undefined, unmount: () => undefined }
      },
    }
    await drawRecording(payingState({ payment: payScenarioPayment() }), undefined, slot)
    expect(recorded).toEqual([
      {
        locale: 'en',
        failedText: 'The card form didn’t load. Try again or ask your waiter.',
      },
    ])
  })

  it('shows a pay-first round ended "No receipt" as ordered and unpaid, on the screen and in the sent orders', async () => {
    const { page } = await drawRecording(
      payingState({
        payment: payScenarioPayment({
          state: 'released',
          reason: 'no_receipt',
          mode: 'pay_first',
          form: null,
        }),
      }),
    )
    expect(page.querySelector('[data-pay-end="pay_first_unpaid"]')?.textContent).toContain(
      'Nothing was charged. Your order went through, and your waiter will take the payment.',
    )
    expect(page.querySelector('[data-slot="pay.again"]')).toBeNull()
    const words = stringsFor('en_US').services
    const sent = {
      id: 'so_00000000000000000000a' as never,
      state: 'added' as const,
      reason: null,
      ref: 'K7Q',
      lines: [],
      sentAt: 0,
      mine: false,
    }
    expect(sentWords(sent, words)).toBe('Added to your bill')
    expect(sentWords({ ...sent, unpaid: true }, words)).toBe('Ordered, not paid: pay your waiter')
  })
})

describe('paid in the app (#197, D127 1.2)', () => {
  it('draws the sitting’s paid lines greyed under "Paid in the app", naming no payer', async () => {
    const page = await draw(payingState({ tableBill: payingBill({ paidLines: PAID_LINES }) }))
    const section = page.querySelector('[data-slot="bill.paid"]')
    expect(section?.querySelector('h3')?.textContent).toBe(words.paidInApp)
    const rows = [...(section?.querySelectorAll('li') ?? [])]
    expect(rows.map((row) => row.textContent)).toEqual([
      'Gin & tonic ×2 · €18.00',
      'Nachos · €9.00',
    ])
    for (const row of rows) {
      expect(row.getAttribute('aria-disabled')).toBe('true')
      expect(row.hasAttribute('data-paid-in-app')).toBe(true)
      expect(row.querySelector('input')).toBeNull()
    }
    // Only the open lines can be ticked.
    expect(page.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('draws them even when nothing is left to pay, and nothing when there are none', async () => {
    const full = payingBill({ paidLines: PAID_LINES })
    const part = full.parts[0]
    if (part === undefined) throw new Error('no part')
    const settled = await draw(
      payingState({
        tableBill: {
          ...full,
          owedMinor: 0,
          totalMinor: 0,
          parts: [{ ...part, lines: [], totalMinor: 0 }],
        },
      }),
    )
    expect(settled.querySelector('[data-slot="bill.paid"]')?.textContent).toContain('Nachos')
    unmount()
    const empty = await draw(payingState())
    expect(empty.querySelector('[data-slot="bill.paid"]')).toBeNull()
    expect(empty.textContent).not.toContain(words.paidInApp)
  })
})

describe('the Payment confirmation (#197, D127 1.4)', () => {
  const captured = () =>
    payingState({
      payment: payScenarioPayment({
        state: 'captured',
        form: null,
        tipMinor: 250,
        amountMinor: 2500,
        paidAt: '2026-10-29T19:42:00.000Z',
      }),
    })
  const tap = async (target: Element | null | undefined) => {
    await act(async () => {
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }
  const open = async (state: ServiceState = captured()) => {
    const page = await draw(state)
    await tap(page.querySelector('[data-slot="pay.confirmation.toggle"]'))
    return page
  }

  it('is offered on the Paid screen only', async () => {
    const page = await draw(captured())
    expect(page.querySelector('[data-slot="pay.confirmation.toggle"]')?.textContent).toBe(
      words.confirmTitle,
    )
    unmount()
    for (const scenario of payScenarios().filter((s) => s.screen !== 'paid')) {
      const other = await draw(payingState({ payment: scenario.payment }))
      expect(other.querySelector('[data-slot="pay.confirmation.toggle"]'), scenario.name).toBeNull()
      unmount()
    }
  })

  it('shows the venue, the time on its clock, the lines, tip, total, "Paid by card" and the number', async () => {
    const page = await open()
    const card = page.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    expect(card.querySelector('h3')?.textContent).toBe('Payment confirmation')
    expect(card.querySelector('[data-slot="pay.confirmation.venue"]')?.textContent).toBe('Club X')
    expect(card.querySelector('[data-slot="pay.confirmation.when"]')?.textContent).toContain('9:42')
    expect(card.textContent).toContain('House wine · €12.50')
    expect(card.textContent).toContain('Tip: €2.50')
    expect(card.textContent).toContain('Total: €25.00')
    expect(card.textContent).toContain('Paid by card')
    expect(card.textContent).toContain('Payment number: K7Q4M')
    expect(card.querySelector('[data-slot="pay.confirmation.note"]')?.textContent).toBe(
      words.confirmNotReceipt,
    )
    expect(card.querySelector('[data-slot="pay.confirmation.save"]')?.textContent).toBe('Save')
  })

  it('does not look like a receipt: no tax header, VAT, receipt number, QR code, link or fiscal word', async () => {
    const page = await open()
    const card = page.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    for (const pattern of RECEIPT_LOOK) {
      expect(card.textContent ?? '', String(pattern)).not.toMatch(pattern)
    }
    expect(card.querySelector('a, img, canvas, svg, iframe')).toBeNull()
  })

  it('says the same in Bulgarian, with no "бон" and no "фискал"', async () => {
    const bg = stringsFor('bg_BG').services.paying
    const bgView = buildViewModel(f.snapshot, f.overlay, {
      ...f.context,
      locale: 'bg_BG',
      images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const services: ServiceBinding = {
      state: captured(),
      dispatch: (command) => pending(command.actionId),
      payControls: { dismiss: () => undefined },
    }
    await act(async () => root?.render(<QrPhoneFace view={bgView} services={services} />))
    await tap(host.querySelector('[data-slot="pay.confirmation.toggle"]'))
    const card = host.querySelector('[data-slot="pay.confirmation"]') as HTMLElement
    expect(card.querySelector('h3')?.textContent).toBe(bg.confirmTitle)
    expect(card.textContent).toContain(bg.paidByCard)
    expect(card.textContent).toContain(`${bg.paidNumber}: K7Q4M`)
    expect(card.textContent).toContain(bg.confirmNotReceipt)
    expect(card.textContent).toContain(bg.confirmSave)
    for (const pattern of RECEIPT_LOOK) expect(card.textContent ?? '').not.toMatch(pattern)
    expect(host.textContent).not.toMatch(/(?<!\p{L})бон/u)
  })

  it('saves an image on the phone through a blob file, drops its link, and sends nothing', async () => {
    const record = recordSaving()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const page = await open()
      await tap(page.querySelector('[data-slot="pay.confirmation.save"]'))
      await vi.waitFor(() => expect(record.downloads).toHaveLength(1))
      expect(record.downloads[0]).toEqual({ href: 'blob:test/1', name: 'payment-K7Q4M.png' })
      expect(record.images).toHaveLength(1)
      expect(fetch).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(record.revoked).toEqual(['blob:test/1']), { timeout: 3_000 })
    } finally {
      record.restore()
      vi.unstubAllGlobals()
    }
  })
})
