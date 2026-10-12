// @vitest-environment jsdom
// The list of Settings > Deleted venues (CF-18, D76): each deleted venue with the day it was
// deleted in Sofia time and a Restore button, and what happens with the server's answers.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { restoreVenueAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { DeletedVenuesList } from './deleted-venues-list'

vi.mock('@/server/venues-actions', () => ({ restoreVenueAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const VENUES = [
  // 22:30 UTC on 10 October is 01:30 on 11 October in Sofia (UTC+3 in October 2026 summer time).
  { id: 'vn_aaaaaaaaaaaaaaaaaaaaaa', name: 'Neon Cellar', deletedAt: '2026-10-10T22:30:00.000Z' },
  { id: 'vn_bbbbbbbbbbbbbbbbbbbbbb', name: 'Roof Terrace', deletedAt: '2026-03-01T10:00:00.000Z' },
]

function list(locale?: 'bg') {
  renderWithIntl(<DeletedVenuesList venues={VENUES} />, locale ? { locale } : {})
  return userEvent.setup({ delay: null })
}

const items = () => screen.getAllByTestId('deleted-venue')

beforeEach(() => {
  vi.mocked(restoreVenueAction).mockReset()
  vi.mocked(restoreVenueAction).mockResolvedValue({
    ok: true,
    name: 'Neon Cellar',
    relinked: false,
  })
  toasts.success.mockReset()
})

describe('the deleted venues', () => {
  it('lists each with its name, the day it was deleted in Sofia time, and a Restore button', () => {
    list()
    expect(items()).toHaveLength(2)
    const first = items()[0] as HTMLElement
    expect(within(first).getByTestId('deleted-venue-name').textContent).toBe('Neon Cellar')
    // The day after in Sofia: 1:30 in the night of the 11th, not the 10th.
    const date = within(first).getByTestId('deleted-venue-date').textContent ?? ''
    expect(date).toContain('Oct 11, 2026')
    expect(date).toContain('1:30')
    expect(within(first).getByTestId('restore-venue').textContent).toBe('Restore')
  })

  it('restores one, tells what is left to do, and takes it off the list', async () => {
    const user = list()
    await user.click(within(items()[0] as HTMLElement).getByTestId('restore-venue'))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(restoreVenueAction).toHaveBeenCalledWith({ venueId: VENUES[0]?.id })
    expect(toasts.success).toHaveBeenCalledTimes(1)
    const message = toasts.success.mock.calls[0]?.[0] as string
    expect(message).toContain('Neon Cellar is back')
    expect(message).not.toContain('till')
    expect(message).toContain('Publish its menu')
    expect(within(items()[0] as HTMLElement).getByTestId('deleted-venue-name').textContent).toBe(
      'Roof Terrace',
    )
  })

  it('says the till is linked again when the restore linked it (adjustments V1)', async () => {
    vi.mocked(restoreVenueAction).mockResolvedValue({
      ok: true,
      name: 'Neon Cellar',
      relinked: true,
    })
    const user = list()
    await user.click(within(items()[0] as HTMLElement).getByTestId('restore-venue'))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
    expect(toasts.success.mock.calls[0]?.[0]).toContain('with its till linked again')
  })

  it('names the venue that holds the till when the restore is refused for it', async () => {
    vi.mocked(restoreVenueAction).mockResolvedValue({
      ok: false,
      error: 'till_taken',
      holder: 'Roof Terrace',
    })
    const user = list()
    await user.click(within(items()[0] as HTMLElement).getByTestId('restore-venue'))
    expect((await screen.findByTestId('restore-error')).textContent).toBe(
      'Not restored: the till venue it served is linked to “Roof Terrace” now.',
    )
    expect(items()).toHaveLength(2)
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it.each([
    ['not_allowed', 'Only an owner can restore a venue.'],
    ['invalid', 'This venue could not be found.'],
    ['failed', 'Something went wrong. The venue was not restored, try again.'],
  ] as const)('shows the answer %s and keeps the venue in the list', async (error, text) => {
    vi.mocked(restoreVenueAction).mockResolvedValue({ ok: false, error })
    const user = list()
    await user.click(within(items()[0] as HTMLElement).getByTestId('restore-venue'))
    expect((await screen.findByTestId('restore-error')).textContent).toBe(text)
    expect(items()).toHaveLength(2)
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('shows "failed" when the call itself breaks', async () => {
    vi.mocked(restoreVenueAction).mockRejectedValue(new Error('network'))
    const user = list()
    await user.click(within(items()[0] as HTMLElement).getByTestId('restore-venue'))
    expect((await screen.findByTestId('restore-error')).textContent).toContain(
      'Something went wrong',
    )
  })

  it('is in Bulgarian when the interface is', () => {
    list('bg')
    const first = items()[0] as HTMLElement
    expect(within(first).getByTestId('restore-venue').textContent).toBe('Върни')
    expect(within(first).getByTestId('deleted-venue-date').textContent).toContain('Изтрито на')
  })
})
