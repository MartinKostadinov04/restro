// @vitest-environment jsdom
// "Delete venue" (CF-18, D76): the danger zone, the dialog that says in plain words what happens,
// the typed name that opens the button, and what happens with the server's answers.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteVenueAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { VenueDangerZone } from './venue-danger-zone'

vi.mock('@/server/venues-actions', () => ({ deleteVenueAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))
const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const VENUE_ID = 'vn_abcdefghijklmnopqrstuv'
const NAME = 'Neon Cellar'

function zone(locale?: 'bg') {
  renderWithIntl(<VenueDangerZone venueId={VENUE_ID} venueName={NAME} />, locale ? { locale } : {})
  return userEvent.setup({ delay: null })
}

const open = () => screen.getByTestId('delete-venue-open')
const typed = () => screen.getByTestId('delete-venue-confirm-input') as HTMLInputElement
const confirm = () => screen.getByTestId('delete-venue-confirm') as HTMLButtonElement

beforeEach(() => {
  vi.mocked(deleteVenueAction).mockReset()
  vi.mocked(deleteVenueAction).mockResolvedValue({ ok: true, filesQueued: true })
  toasts.success.mockReset()
  toasts.warning.mockReset()
  router.push.mockReset()
})

describe('the danger zone', () => {
  it('is a section with a Delete venue button, and no dialog until it is pressed', () => {
    zone()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy()
    expect(open().textContent).toBe('Delete venue…')
    expect(screen.queryByTestId('delete-venue-dialog')).toBeNull()
  })
})

describe('the delete dialog', () => {
  it('says what happens, in plain words, and names the venue', async () => {
    const user = zone()
    await user.click(open())
    expect(screen.getByRole('dialog', { name: `Delete ${NAME}?` })).toBeTruthy()
    const effects = screen.getByTestId('delete-venue-effects').textContent ?? ''
    expect(effects).toContain('disappears from the admin')
    expect(effects).toContain('guest page and its table QR codes stop working')
    expect(effects).toContain('not available')
    expect(effects).toContain('link to the till is released')
    expect(effects).toContain('Nothing is erased')
    expect(effects).toContain('Settings › Deleted venues')
  })

  it('keeps the button shut until the venue’s name is typed (spaces around it do not count)', async () => {
    const user = zone()
    await user.click(open())
    expect(confirm().disabled).toBe(true)
    await user.type(typed(), 'Neon')
    expect(confirm().disabled).toBe(true)
    await user.clear(typed())
    await user.type(typed(), 'neon cellar')
    expect(confirm().disabled).toBe(true)
    await user.clear(typed())
    await user.type(typed(), `  ${NAME}  `)
    expect(confirm().disabled).toBe(false)
    expect(deleteVenueAction).not.toHaveBeenCalled()
  })

  it('deletes with the typed name, goes to the venue list, and the toast links to the restore list', async () => {
    const user = zone()
    await user.click(open())
    await user.type(typed(), NAME)
    await user.click(confirm())

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/venues'))
    expect(deleteVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, confirmName: NAME })
    expect(toasts.success).toHaveBeenCalledTimes(1)
    const [message, options] = toasts.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(message).toBe(`${NAME} was deleted.`)
    expect(options.action.label).toBe('Deleted venues')
    router.push.mockReset()
    options.action.onClick()
    expect(router.push).toHaveBeenCalledWith('/settings/deleted-venues')
    // The dialog is closed.
    await waitFor(() => expect(screen.queryByTestId('delete-venue-dialog')).toBeNull())
  })

  it('says so when the guest page could not be switched off, but still goes to the list', async () => {
    vi.mocked(deleteVenueAction).mockResolvedValue({ ok: true, filesQueued: false })
    const user = zone()
    await user.click(open())
    await user.type(typed(), NAME)
    await user.click(confirm())
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/venues'))
    expect(toasts.success).not.toHaveBeenCalled()
    expect(toasts.warning.mock.calls[0]?.[0]).toContain('could not be switched off')
  })

  it.each([
    ['not_allowed', 'Only an owner can delete a venue.'],
    ['name_mismatch', 'The name does not match. Type it exactly as shown.'],
    ['venue_archived', 'This venue was deleted.'],
    ['invalid', 'This venue could not be found.'],
    ['failed', 'Something went wrong. The venue was not deleted, try again.'],
  ] as const)('shows the answer %s and stays open', async (error, text) => {
    vi.mocked(deleteVenueAction).mockResolvedValue({ ok: false, error })
    const user = zone()
    await user.click(open())
    await user.type(typed(), NAME)
    await user.click(confirm())
    expect((await screen.findByTestId('delete-venue-error')).textContent).toBe(text)
    expect(router.push).not.toHaveBeenCalled()
    expect(toasts.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('delete-venue-dialog')).toBeTruthy()
  })

  it('shows "failed" when the call itself breaks', async () => {
    vi.mocked(deleteVenueAction).mockRejectedValue(new Error('network'))
    const user = zone()
    await user.click(open())
    await user.type(typed(), NAME)
    await user.click(confirm())
    expect((await screen.findByTestId('delete-venue-error')).textContent).toContain(
      'Something went wrong',
    )
  })

  it('starts empty each time it is opened, and Cancel closes it without a call', async () => {
    const user = zone()
    await user.click(open())
    await user.type(typed(), 'Neon')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('delete-venue-dialog')).toBeNull())
    await user.click(open())
    expect(typed().value).toBe('')
    expect(deleteVenueAction).not.toHaveBeenCalled()
  })

  it('is in Bulgarian when the interface is', async () => {
    const user = zone('bg')
    expect(screen.getByRole('heading', { name: 'Опасна зона' })).toBeTruthy()
    await user.click(open())
    expect(screen.getByRole('dialog', { name: `Да изтрием ли ${NAME}?` })).toBeTruthy()
    expect(screen.getByTestId('delete-venue-effects').textContent).toContain(
      'Настройки › Изтрити заведения',
    )
    expect(confirm().textContent).toBe('Изтрий заведението')
  })
})
