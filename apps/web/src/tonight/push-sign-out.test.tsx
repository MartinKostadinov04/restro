// @vitest-environment jsdom
// Signing out stops this phone's buzz (RR-86), from both places a person can sign out, and nothing
// the browser does can hold the sign-out back. The server's row then ends through the push service's
// answer and the worker's `push.expire` (apps/worker/tests/alerts.test.ts).
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UserMenu } from '@/components/admin/user-menu'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { SidebarProvider } from '@/components/ui/sidebar'

import messages from '../../messages/en.json'
import { stopPushOnThisBrowser } from './push-device'

const signOut = vi.hoisted(() => vi.fn(async () => undefined))
const replace = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut } }))
vi.mock('@/i18n/actions', () => ({ setAdminLocale: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}))

function fakeWorker(getRegistration: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration },
  })
}

function holding() {
  const unsubscribe = vi.fn(async () => true)
  const getRegistration = vi.fn(async () => ({
    pushManager: { getSubscription: async () => ({ unsubscribe }) },
  }))
  fakeWorker(getRegistration)
  return { unsubscribe, getRegistration }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  signOut.mockClear()
  replace.mockClear()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

function drawButton() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SignOutButton />
    </NextIntlClientProvider>,
  )
}
const tapSignOut = () =>
  userEvent.click(screen.getByRole('button', { name: messages.user.signOut }))

describe('the sign-out button', () => {
  it('ends this browser’s subscription for the staff scope, then signs out', async () => {
    const { unsubscribe, getRegistration } = holding()
    drawButton()
    await tapSignOut()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(getRegistration).toHaveBeenCalledWith('/venues/')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('still signs out when the browser throws', async () => {
    fakeWorker(async () => {
      throw new Error('push is broken')
    })
    drawButton()
    await tapSignOut()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('still signs out when unsubscribing fails', async () => {
    const unsubscribe = vi.fn(async () => {
      throw new Error('no connection')
    })
    fakeWorker(async () => ({
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
    }))
    drawButton()
    await tapSignOut()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('still signs out in a browser with no push API, or with nothing held', async () => {
    drawButton()
    await tapSignOut()
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())

    fakeWorker(async () => undefined)
    await tapSignOut()
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2))
  })
})

describe('the user menu in the sidebar', () => {
  it('ends this browser’s subscription as it signs out', async () => {
    const { unsubscribe } = holding()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SidebarProvider>
          <UserMenu name="Maria" email="maria@demo-club.test" />
        </SidebarProvider>
      </NextIntlClientProvider>,
    )
    await userEvent.click(screen.getByTestId('user-menu'))
    await userEvent.click(await screen.findByTestId('sign-out'))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})

describe('a browser that never answers', () => {
  it('holds the sign-out for two seconds at most', async () => {
    vi.useFakeTimers()
    fakeWorker(() => new Promise(() => undefined))
    let finished = false
    void stopPushOnThisBrowser().then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
  })
})
