// @vitest-environment jsdom

// Paying from the bill on the reference face (#45, #114, D127): the contract tests every face has
// for the paying states and the form slot. The host's state is built by `@restro/shell/testing`
// (`payScenarios`), the same for every face.

import {
  buildViewModel,
  imageSlotsFor,
  type PayFormSlot,
  type ServiceBinding,
  type ServiceState,
  stringsFor,
} from '@restro/shell'
import {
  fixture,
  payingBill,
  payingState,
  payScenarioPayment,
  payScenarios,
} from '@restro/shell/testing'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { QrPhoneFace } from './face'
import { QR_PHONE_MANIFEST } from './manifest'

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
afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

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
