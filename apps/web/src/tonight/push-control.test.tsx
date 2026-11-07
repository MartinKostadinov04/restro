// @vitest-environment jsdom
// Tonight's push control (RR-86), with the browser's push APIs and the server actions faked: every
// state, what each tap sends, and that a shared device has no Off. A real subscribe is the Postgres
// test's on the server side, and a real buzz needs a real phone.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import messages from '../../messages/en.json'
import { PushControl } from './push-control'
import { RunProvider } from './run'

const subscribePushAction = vi.hoisted(() => vi.fn())
const revokePushAction = vi.hoisted(() => vi.fn())
vi.mock('@/server/tonight/actions', () => ({ subscribePushAction, revokePushAction }))
vi.mock('./pin-sheet', () => ({ PinSheet: () => null }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const KEY = `B${'p'.repeat(86)}`
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const DEVICE = { endpoint: ENDPOINT, p256dh: `B${'q'.repeat(86)}`, auth: 'a'.repeat(22) }
const ACCEPTED = { ok: true, details: {} }

interface Fake {
  permission: NotificationPermission
  answer: NotificationPermission
  held: Record<string, unknown> | null
  subscribe: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeBrowser(options: { held?: boolean; permission?: NotificationPermission } = {}): Fake {
  const unsubscribe = vi.fn(async () => {
    fake.held = null
    return true
  })
  const made = () => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: null },
    unsubscribe,
    toJSON: () => ({
      endpoint: DEVICE.endpoint,
      expirationTime: null,
      keys: { p256dh: DEVICE.p256dh, auth: DEVICE.auth },
    }),
  })
  const subscribe = vi.fn(async () => {
    fake.held = made()
    return fake.held
  })
  const register = vi.fn(async () => registration)
  const registration = {
    pushManager: { subscribe, getSubscription: async () => fake.held },
  }
  const fake: Fake = {
    permission: options.permission ?? 'default',
    answer: 'granted',
    held: null,
    subscribe,
    register,
    unsubscribe,
  }
  if (options.held === true) fake.held = made()
  vi.stubGlobal('Notification', {
    get permission() {
      return fake.permission
    },
    requestPermission: async () => {
      fake.permission = fake.answer
      return fake.answer
    },
  })
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register,
      getRegistration: async () => registration,
      ready: Promise.resolve(registration),
    },
  })
  return fake
}

function draw(sharedDevice = false) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RunProvider>
        <PushControl venueId={VENUE} pushKey={KEY} sharedDevice={sharedDevice} />
      </RunProvider>
    </NextIntlClientProvider>,
  )
}
const control = () => screen.getByTestId('push-control')
const inState = (state: string) =>
  waitFor(() => expect(control().getAttribute('data-state')).toBe(state))

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  subscribePushAction.mockResolvedValue(ACCEPTED)
  revokePushAction.mockResolvedValue(ACCEPTED)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  subscribePushAction.mockReset()
  toast.error.mockReset()
  revokePushAction.mockReset()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(navigator, 'maxTouchPoints')
})

describe('on a person’s own device', () => {
  it('goes off, on, off: each one tap, and each tells the server', async () => {
    const fake = fakeBrowser()
    draw()
    await inState('off')
    expect(control().textContent).toContain('Alerts on this device: off')
    expect(subscribePushAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await inState('on')
    expect(fake.register).toHaveBeenCalledWith('/sw.js', { scope: '/venues/' })
    expect(fake.subscribe.mock.calls[0]?.[0]).toMatchObject({ userVisibleOnly: true })
    expect(subscribePushAction).toHaveBeenCalledWith({ venueId: VENUE, ...DEVICE })

    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await inState('off')
    expect(revokePushAction).toHaveBeenCalledWith({ venueId: VENUE, endpoint: ENDPOINT })
    expect(fake.unsubscribe).toHaveBeenCalledOnce()
  })

  it('stays on when the server did not end it, so the screen never lies', async () => {
    const fake = fakeBrowser({ held: true, permission: 'granted' })
    revokePushAction.mockResolvedValue({ ok: false, error: 'failed' })
    draw()
    await inState('on')
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(revokePushAction).toHaveBeenCalled())
    expect(control().getAttribute('data-state')).toBe('on')
    expect(fake.unsubscribe).not.toHaveBeenCalled()
  })

  it('shows off when Turn on is refused, and leaves the browser its subscription', async () => {
    const fake = fakeBrowser()
    subscribePushAction.mockResolvedValue({ ok: false, error: 'permission_denied' })
    draw()
    await inState('off')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(subscribePushAction).toHaveBeenCalledOnce())
    await inState('off')
    expect(fake.unsubscribe).not.toHaveBeenCalled()
  })

  it('a refused re-send at another venue shows off, and leaves the first venue’s alerts alone', async () => {
    const fake = fakeBrowser({ held: true, permission: 'granted' })
    subscribePushAction.mockResolvedValue({ ok: false, error: 'permission_denied' })
    draw()
    await waitFor(() => expect(subscribePushAction).toHaveBeenCalledOnce())
    await inState('off')
    expect(fake.unsubscribe).not.toHaveBeenCalled()
    // Coming back to the page doesn't claim on again, or ask again.
    document.dispatchEvent(new Event('visibilitychange'))
    await inState('off')
    expect(subscribePushAction).toHaveBeenCalledOnce()
    expect(fake.unsubscribe).not.toHaveBeenCalled()
  })

  it('stays on for a re-send that never got an answer: no connection is not a refusal', async () => {
    const fake = fakeBrowser({ held: true, permission: 'granted' })
    subscribePushAction.mockRejectedValue(new Error('offline'))
    draw()
    await waitFor(() => expect(subscribePushAction).toHaveBeenCalled())
    await inState('on')
    expect(fake.unsubscribe).not.toHaveBeenCalled()
  })

  it('an endpoint Restro doesn’t take reads as the service failing, not a crash', async () => {
    fakeBrowser()
    subscribePushAction.mockResolvedValue({ ok: false, error: 'invalid' })
    draw()
    await inState('off')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await waitFor(() =>
      expect(toast.error.mock.calls[0]?.[0]).toBe(messages.tonight.errors.push_no_service),
    )
    await inState('off')
  })

  it('says a held subscription again when Tonight opens, so a rotated endpoint carries on', async () => {
    fakeBrowser({ held: true, permission: 'granted' })
    draw()
    await inState('on')
    await waitFor(() =>
      expect(subscribePushAction).toHaveBeenCalledWith({ venueId: VENUE, ...DEVICE }),
    )
    // Coming back to the page doesn't say the same endpoint a second time.
    document.dispatchEvent(new Event('visibilitychange'))
    await inState('on')
    expect(subscribePushAction).toHaveBeenCalledOnce()
  })

  it('shows off again when the browser’s question is dismissed', async () => {
    const fake = fakeBrowser()
    fake.answer = 'default'
    draw()
    await inState('off')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await inState('off')
    expect(fake.subscribe).not.toHaveBeenCalled()
    expect(subscribePushAction).not.toHaveBeenCalled()
  })
})

describe('the states with nothing to tap', () => {
  it('blocked: says how to allow it', async () => {
    fakeBrowser({ permission: 'denied' })
    draw()
    await inState('blocked')
    expect(control().textContent).toContain('Allow notifications for this site')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('goes to blocked when the browser’s question is answered no', async () => {
    const fake = fakeBrowser()
    fake.answer = 'denied'
    draw()
    await inState('off')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await inState('blocked')
  })

  it('not supported', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    draw()
    await inState('unsupported')
    expect(control().textContent).toContain("This browser can't show alerts")
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('on an iPhone in the browser: add to Home Screen first', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    )
    draw()
    await inState('install_first')
    expect(control().textContent).toContain('add Restro to the Home Screen first')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('on an iPad that says it is a Mac: the same', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    draw()
    await inState('install_first')
  })

  it('on an iPhone from the Home Screen: it can turn on', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)')
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    fakeBrowser()
    draw()
    await inState('off')
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })
})

describe('on a shared device', () => {
  it('turns on, then shows it is on for this tablet with no Off', async () => {
    fakeBrowser()
    draw(true)
    await inState('off')
    expect(control().textContent).toContain('Alerts on this tablet: off')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await inState('on')
    expect(subscribePushAction).toHaveBeenCalledWith({ venueId: VENUE, ...DEVICE })
    expect(control().textContent).toContain('Alerts on this tablet: on')
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull()
    expect(revokePushAction).not.toHaveBeenCalled()
  })

  it('still says a held subscription again when Tonight opens', async () => {
    fakeBrowser({ held: true, permission: 'granted' })
    draw(true)
    await inState('on')
    await waitFor(() => expect(subscribePushAction).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button')).toBeNull()
  })
})
