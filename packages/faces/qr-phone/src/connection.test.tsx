// @vitest-environment jsdom

// The guest page's consent and connection behaviour on the reference face (RR-48 to RR-52, D118 to
// D122): the Privacy link on the consent screen, the Stop location check control, the lost Send's
// line (D120), Send and Pay greyed while offline (D121), and the screen the face tells the host it
// has open. The host's state is built by hand, as the host would give it.

import {
  buildViewModel,
  EMPTY_SERVICE_STATE,
  type GuestScreen,
  imageSlotsFor,
  type LocationControls,
  type ServiceBinding,
  type ServiceState,
  stringsFor,
  type ViewModel,
} from '@restro/shell'
import { fixture, payingState } from '@restro/shell/testing'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { QrPhoneFace } from './face'
import { QR_PHONE_MANIFEST } from './manifest'

// `act` needs this flag in a test that is not run by Testing Library.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function viewOf(name: string, locale?: 'bg_BG'): ViewModel {
  const f = fixture(name)
  return buildViewModel(f.snapshot, f.overlay, {
    ...f.context,
    ...(locale === undefined ? {} : { locale }),
    images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
  })
}

const view = viewOf('features-on')
const negroni = view.sections.flatMap((section) => section.items)[0]
if (negroni === undefined) throw new Error('the fixture has no items')

const en = stringsFor('en_US').services
const bg = stringsFor('bg_BG').services

const ORDER = {
  lines: [
    {
      id: `ol_${'0'.repeat(22)}` as const,
      itemId: negroni.id,
      optionIds: [],
      qty: 1,
      note: '',
      mode: 'on_bill' as const,
      held: false,
      pending: false,
    },
  ],
  removed: [],
  earlier: null,
}

const PRIVACY = 'https://club-nova.example/privacy'

const location = (
  prompt: 'none' | 'consent' | 'checking' | 'failed',
  state: 'needed' | 'held' = 'needed',
  privacyUrl: string | null = PRIVACY,
) => ({ state, prompt, consent: 'unknown' as const, venueName: 'Club Nova', privacyUrl })

interface Calls {
  readonly stopped: { n: number }
  readonly screens: GuestScreen[]
}

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

/** Draws the face on a host state, with the controls and the screen signal recorded. */
async function draw(
  state: ServiceState,
  options: { stop?: boolean; shown?: ViewModel; calls?: Calls } = {},
) {
  const calls = options.calls ?? { stopped: { n: 0 }, screens: [] }
  const controls: LocationControls = {
    allow: async () => null,
    decline() {},
    reopen() {},
    dismiss() {},
    ...(options.stop === false
      ? {}
      : {
          stop() {
            calls.stopped.n += 1
          },
        }),
  }
  const services: ServiceBinding = {
    state,
    dispatch: (command) =>
      Promise.resolve({ actionId: command.actionId, status: 'pending', message: null, ref: null }),
    location: controls,
    setScreen: (screen) => {
      calls.screens.push(screen)
    },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root?.render(<QrPhoneFace view={options.shown ?? view} services={services} />),
  )
  return host
}

const base = (changes: Partial<ServiceState> = {}): ServiceState => ({
  ...EMPTY_SERVICE_STATE,
  ordering: { state: 'on' },
  order: null,
  ...changes,
})

describe('the consent screen carries the Privacy link (RR-48, D119, D121)', () => {
  // The link comes with the location, whatever paying is: paying is off here (RR-48).
  const consent = () => base({ paying: null, location: location('consent') })

  it('ends D122’s text with the Privacy link where the venue checks and paying is off', async () => {
    const page = await draw(consent())
    const panel = page.querySelector('[data-location-prompt="consent"]')
    const link = panel?.querySelector('a')
    expect(link?.textContent).toBe(en.paying.legalPrivacyLink)
    expect(link?.getAttribute('href')).toBe(PRIVACY)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
    // The wording stays D122's: the link follows the text and the buttons stay.
    expect(panel?.textContent).toContain('Club Nova and Restro check your location')
    expect(panel?.textContent).toContain(en.locationAllow)
    expect(panel?.textContent).toContain(en.locationNotNow)
  })

  it('says it in Bulgarian too', async () => {
    const page = await draw(consent(), { shown: viewOf('features-on', 'bg_BG') })
    expect(page.querySelector('[data-location-prompt="consent"] a')?.textContent).toBe(
      bg.paying.legalPrivacyLink,
    )
  })

  it('draws no link where the venue has no privacy notice', async () => {
    const page = await draw(base({ location: location('consent', 'needed', null) }))
    expect(page.querySelector('[data-location-prompt="consent"] a')).toBeNull()
  })
})

describe('Stop location check (RR-49, D119)', () => {
  const stopButton = (page: HTMLElement) =>
    page.querySelector<HTMLButtonElement>('[data-slot="location.stop"]')

  it('is on the bill while the phone holds a pass, and one tap stops the check', async () => {
    const calls: Calls = { stopped: { n: 0 }, screens: [] }
    const page = await draw(payingState({ location: location('none', 'held') }), { calls })
    const bill = page.querySelector('[data-slot="menu.bill"]')
    const button = bill === null ? null : stopButton(bill as HTMLElement)
    expect(button?.textContent).toBe(en.locationStop)
    await act(async () => button?.click())
    expect(calls.stopped.n).toBe(1)
    // One control, not two: the bag's location panel does not draw its own beside the bill's.
    expect(page.querySelectorAll('[data-slot="location.stop"]')).toHaveLength(1)
  })

  it('is in the location panel while there is no bill to put it on', async () => {
    const page = await draw(base({ location: location('none', 'held') }))
    expect(page.querySelectorAll('[data-slot="location.stop"]')).toHaveLength(1)
    expect(stopButton(page)?.textContent).toBe(en.locationStop)
  })

  it('is in the failed check, beside Call a waiter and Cancel', async () => {
    const calls: Calls = { stopped: { n: 0 }, screens: [] }
    const page = await draw(base({ location: location('failed') }), { calls })
    const panel = page.querySelector('[data-location-prompt="failed"]')
    const button = panel === null ? null : stopButton(panel as HTMLElement)
    expect(button?.textContent).toBe(en.locationStop)
    await act(async () => button?.click())
    expect(calls.stopped.n).toBe(1)
  })

  it('is not drawn before the guest allowed anything, or where the host cannot stop', async () => {
    expect(stopButton(await draw(base({ location: location('consent') })))).toBeNull()
    act(() => root?.unmount())
    host?.remove()
    const noStop = await draw(base({ location: location('none', 'held') }), { stop: false })
    expect(stopButton(noStop)).toBeNull()
  })

  it('says it in Bulgarian', async () => {
    const page = await draw(base({ location: location('none', 'held') }), {
      shown: viewOf('features-on', 'bg_BG'),
    })
    expect(stopButton(page)?.textContent).toBe(bg.locationStop)
  })
})

describe('a Send whose answer was lost (RR-50, D120)', () => {
  const sendButton = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('[data-send]')

  it('says D120’s line, never "Try again" and never "Nothing new was sent", and offers no re-send', async () => {
    const page = await draw(base({ order: ORDER, offline: true, sendLost: { ref: null } }))
    const text = page.textContent ?? ''
    expect(text).toContain(en.sendLost)
    expect(text).not.toContain('Try again')
    expect(text).not.toContain('Nothing new was sent')
    expect(sendButton(page)).toBeNull()
  })

  it('names the reference when the host has one', async () => {
    const page = await draw(base({ order: ORDER, sendLost: { ref: 'K7Q' } }))
    expect(page.textContent).toContain(en.sendLost)
    expect(page.textContent).toContain(en.reference('K7Q'))
  })

  it('says it in Bulgarian', async () => {
    const page = await draw(base({ order: ORDER, sendLost: { ref: null } }), {
      shown: viewOf('features-on', 'bg_BG'),
    })
    expect(page.textContent).toContain(bg.sendLost)
  })

  it('shows the line from the command’s own answer before the host’s state has it, and drops it with the host', async () => {
    const state = base({ order: ORDER })
    const lostAnswer = (command: { actionId: string }) =>
      Promise.resolve({
        actionId: command.actionId,
        status: 'pending' as const,
        message: null,
        ref: null,
        code: 'answer_lost',
      })
    const services: ServiceBinding = { state, dispatch: lostAnswer, setScreen: () => {} }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = (next: ServiceState) =>
      act(async () =>
        root?.render(<QrPhoneFace view={view} services={{ ...services, state: next }} />),
      )
    await render(state)
    await act(async () => host?.querySelector<HTMLButtonElement>('[data-send]')?.click())
    // The host has not rendered the loss yet: the face still says the line, once, as no notice.
    expect(host.textContent).toContain(en.sendLost)
    expect(host.querySelectorAll('[data-order-notice]')).toHaveLength(0)
    // The host's state says it, then lets go: the line goes with it, and no stale notice appears.
    await render({ ...state, sendLost: { ref: null } })
    expect(host.textContent).toContain(en.sendLost)
    await render(state)
    expect(host.textContent).not.toContain(en.sendLost)
    expect(host.querySelectorAll('[data-order-notice]')).toHaveLength(0)
  })

  it('keeps D122’s weak-connection line for the general weak signal', async () => {
    const page = await draw(base({ order: ORDER, offline: true }))
    expect(page.textContent).toContain(en.offline)
    expect(page.textContent).not.toContain(en.sendLost)
  })
})

describe('Send and Pay greyed while offline (RR-51, D120, D121)', () => {
  it('greys Send, keeps the bag editable, and says the weak-connection line', async () => {
    const page = await draw(base({ order: ORDER, offline: true }))
    expect(page.querySelector<HTMLButtonElement>('[data-send]')?.disabled).toBe(true)
    expect(page.textContent).toContain(en.offline)
    // The bag stays editable: − + Remove are live.
    for (const control of page.querySelectorAll<HTMLButtonElement>('.rq-order-controls button')) {
      expect(control.disabled).toBe(false)
    }
  })

  it('leaves Send live while online', async () => {
    const page = await draw(base({ order: ORDER }))
    expect(page.querySelector<HTMLButtonElement>('[data-send]')?.disabled).toBe(false)
  })

  it('greys Pay with the weak-connection line as its reason', async () => {
    const page = await draw(payingState({ offline: true }))
    expect(page.querySelector<HTMLButtonElement>('[data-slot="pay.start"]')?.disabled).toBe(true)
    expect(page.querySelector('[data-slot="pay.blocked"]')?.textContent).toBe(en.offline)
  })
})

describe('the screen the face has open (RR-52, D121)', () => {
  it('tells the host the bag while ordering is on and there is no bill, the bill once there is one', async () => {
    const calls: Calls = { stopped: { n: 0 }, screens: [] }
    await draw(base({ order: ORDER }), { calls })
    expect(calls.screens.at(-1)).toBe('bag')
    act(() => root?.unmount())
    host?.remove()
    const billed: Calls = { stopped: { n: 0 }, screens: [] }
    await draw(payingState({ order: ORDER }), { calls: billed })
    expect(billed.screens.at(-1)).toBe('bill')
  })

  it('tells the host the menu where the venue takes no orders from phones', async () => {
    const calls: Calls = { stopped: { n: 0 }, screens: [] }
    const off = { ...view, features: { ...view.features, ordering: false } }
    await draw(base(), { calls, shown: off })
    expect(calls.screens.at(-1)).toBe('menu')
  })

  it('tells the host the bill when the bill panel is drawn, ordering on or off', async () => {
    const calls: Calls = { stopped: { n: 0 }, screens: [] }
    const off = { ...view, features: { ...view.features, ordering: false } }
    await draw(payingState(), { calls, shown: off })
    expect(calls.screens.at(-1)).toBe('bill')
  })
})
