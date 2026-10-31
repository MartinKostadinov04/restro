// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  linkGroupAction,
  linkPersonAction,
  setRecipientsAction,
  testTelegramAction,
  unlinkGroupAction,
  unlinkPersonAction,
} from '@/server/settings/alerts-actions'
import type { AlertPersonView, AlertsView } from '@/server/settings/alerts-view'
import { renderWithIntl } from '@/test-utils'

import { AlertsPanel } from './alerts-panel'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/venues/vn_demo',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/server/settings/alerts-actions', () => ({
  linkGroupAction: vi.fn(),
  linkPersonAction: vi.fn(),
  setRecipientsAction: vi.fn(),
  testTelegramAction: vi.fn(),
  unlinkGroupAction: vi.fn(),
  unlinkPersonAction: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const VENUE = 'vn_0000000000000000000001'
const MARIA = 'sm_0000000000000000000001'
const PAVEL = 'sm_0000000000000000000002'
const OK = { ok: true, details: {} } as const

function person(over: Partial<AlertPersonView> & { id: string; name: string }): AlertPersonView {
  return {
    userId: `u-${over.id}`,
    devices: 0,
    ticked: false,
    telegramLinked: false,
    ...over,
  }
}

function view(over: Partial<AlertsView> = {}): AlertsView {
  return {
    venueId: VENUE,
    people: [
      person({ id: MARIA, name: 'Maria', devices: 2, ticked: true }),
      person({ id: PAVEL, name: 'Pavel', devices: 0 }),
      person({ id: 'sm_0000000000000000000003', name: 'Only a PIN', userId: null }),
    ],
    telegram: { state: 'none' },
    recipientIds: [`u-${MARIA}`],
    canUnlinkPerson: true,
    email: 'owner@example.com',
    ...over,
  }
}

beforeEach(() => {
  for (const action of [
    linkGroupAction,
    linkPersonAction,
    setRecipientsAction,
    testTelegramAction,
    unlinkGroupAction,
    unlinkPersonAction,
  ]) {
    vi.mocked(action).mockReset()
  }
  refresh.mockReset()
  // The server answers its liveness check (a timed refresh waits for it, RR-88).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Settings › Alerts', () => {
  it('lists the people with their own account, devices and a switch; a PIN-only person is not listed', () => {
    renderWithIntl(<AlertsPanel view={view()} />)
    const list = screen.getByTestId('alerts-people')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('2 devices')).toBeTruthy()
    expect(
      within(list).getByText('No device yet: open Tonight on their phone and tap Turn on.'),
    ).toBeTruthy()
    expect(within(list).queryByText('Only a PIN')).toBeNull()
    expect(within(list).getByRole('switch', { name: 'Maria' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  it('says under the switches who payment alerts ring for', () => {
    renderWithIntl(<AlertsPanel view={view()} />)
    expect(screen.getByTestId('alerts-money-line').textContent).toBe(
      'Payment alerts ring only for people who may follow up payments; if none of them is switched on, they ring for all of them.',
    )
  })

  it('ticks a person, keeping the others ticked, with Undo', async () => {
    vi.mocked(setRecipientsAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(<AlertsPanel view={view()} />)
    await user.click(screen.getByRole('switch', { name: 'Pavel' }))
    await waitFor(() =>
      expect(setRecipientsAction).toHaveBeenCalledWith({
        venueId: VENUE,
        userIds: [`u-${MARIA}`, `u-${PAVEL}`],
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    await waitFor(() =>
      expect(setRecipientsAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        userIds: [`u-${MARIA}`],
      }),
    )
  })

  it('says to add people first when nobody works here', () => {
    renderWithIntl(<AlertsPanel view={view({ people: [] })} />)
    expect(screen.getByTestId('alerts-no-staff').textContent).toBe(
      'Add people first, in Staff and roles.',
    )
    expect(screen.getByRole('link', { name: 'Add people first, in Staff and roles.' })).toBeTruthy()
  })

  it('links a group: opens Telegram, waits, and shows "Linked to {group}" once the bot is in', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.mocked(linkGroupAction).mockResolvedValue({
      ok: true,
      url: 'https://t.me/restro_bot?startgroup=abc',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      svg: null,
    })
    const user = userEvent.setup()
    const { rerender } = renderWithIntl(<AlertsPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Link a Telegram group' }))
    expect((await screen.findByTestId('alerts-tg-waiting')).textContent).toContain(
      'Waiting for the bot to join… Pick the group in Telegram and add the bot.',
    )
    expect(open).toHaveBeenCalledWith(
      'https://t.me/restro_bot?startgroup=abc',
      '_blank',
      'noopener,noreferrer',
    )
    // The page asks again by itself; the group shows once linked.
    rerender(
      <AlertsPanel view={view({ telegram: { state: 'linked', group: 'Club Nova staff' } })} />,
    )
    expect((await screen.findByTestId('alerts-tg-linked')).textContent).toBe(
      'Linked to Club Nova staff',
    )
    expect(screen.queryByTestId('alerts-tg-waiting')).toBeNull()
    open.mockRestore()
  })

  it('keeps asking while it waits and says the link ran out after 15 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.mocked(linkGroupAction).mockResolvedValue({
      ok: true,
      url: 'https://t.me/restro_bot?startgroup=abc',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      svg: null,
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithIntl(<AlertsPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Link a Telegram group' }))
    await screen.findByTestId('alerts-tg-waiting')
    await act(async () => {
      vi.advanceTimersByTime(9_000)
    })
    expect(refresh).toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(16 * 60_000)
    })
    expect((await screen.findByTestId('alerts-tg-expired')).textContent).toBe(
      'The link ran out. Make a new one.',
    )
  })

  it('names the group the bot left and offers the link again', () => {
    renderWithIntl(
      <AlertsPanel view={view({ telegram: { state: 'left', group: 'Club Nova staff' } })} />,
    )
    expect(screen.getByTestId('alerts-tg-left').textContent).toBe(
      "Restro's bot left Club Nova staff. Link it again.",
    )
    expect(screen.getByRole('button', { name: 'Link a Telegram group' })).toBeTruthy()
  })

  it('sends a test message, and words a failure', async () => {
    vi.mocked(testTelegramAction).mockResolvedValueOnce(OK)
    const user = userEvent.setup()
    renderWithIntl(
      <AlertsPanel view={view({ telegram: { state: 'linked', group: 'Club Nova staff' } })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Send a test message' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Test message sent', expect.anything()),
    )
    vi.mocked(testTelegramAction).mockResolvedValueOnce({ ok: false, error: 'telegram_failed' })
    await user.click(screen.getByRole('button', { name: 'Send a test message' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't reach the group. Check the bot is still in it.",
        { duration: Number.POSITIVE_INFINITY, closeButton: true },
      ),
    )
  })

  it('unlinks the group after a confirmation that names the consequence', async () => {
    vi.mocked(unlinkGroupAction).mockResolvedValue(OK)
    const user = userEvent.setup()
    renderWithIntl(
      <AlertsPanel view={view({ telegram: { state: 'linked', group: 'Club Nova staff' } })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Telegram group' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unlink the group' }))
    expect(
      await screen.findByText(
        'Alerts stop going to Club Nova staff. The bot stays in the group until you remove it there.',
      ),
    ).toBeTruthy()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink the group' }),
    )
    await waitFor(() => expect(unlinkGroupAction).toHaveBeenCalledWith({ venueId: VENUE }))
  })

  it('shows a QR for a person to scan, and closes it once their Telegram is linked', async () => {
    vi.mocked(linkPersonAction).mockResolvedValue({
      ok: true,
      url: 'https://t.me/restro_bot?start=xyz',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    })
    const user = userEvent.setup()
    const group = { state: 'linked', group: 'Club Nova staff' } as const
    const { rerender } = renderWithIntl(<AlertsPanel view={view({ telegram: group })} />)
    const row = screen.getByTestId('alerts-done-people')
    await user.click(within(row).getAllByRole('button', { name: 'Link' })[0] as HTMLElement)
    expect(await screen.findByTestId('alerts-person-qr')).toBeTruthy()
    expect(linkPersonAction).toHaveBeenCalledWith({ venueId: VENUE, staffMemberId: MARIA })
    expect(
      screen.getByText(
        'Ask Maria to scan this with their phone and press Start in Telegram. The link lasts 15 minutes.',
      ),
    ).toBeTruthy()
    rerender(
      <AlertsPanel
        view={view({
          telegram: group,
          people: [
            person({ id: MARIA, name: 'Maria', devices: 2, ticked: true, telegramLinked: true }),
            person({ id: PAVEL, name: 'Pavel' }),
          ],
        })}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('alerts-person-qr')).toBeNull())
    expect(within(screen.getByTestId('alerts-done-people')).getByText('Linked')).toBeTruthy()
  })

  it('words a Telegram that is not set up', async () => {
    vi.mocked(linkGroupAction).mockResolvedValue({ ok: false, error: 'telegram_off' })
    const user = userEvent.setup()
    renderWithIntl(<AlertsPanel view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Link a Telegram group' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Telegram isn't set up for this installation yet.", {
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      }),
    )
  })
})
