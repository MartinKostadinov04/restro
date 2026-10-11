// @vitest-environment jsdom
// The venue's name in its Settings tab (CF-18, D76): a field for owners and admins, the name as
// text for everyone else, the validation while typing, and what happens with the server's answers.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renameVenueAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { VenueName } from './venue-name'

vi.mock('@/server/venues-actions', () => ({ renameVenueAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const VENUE_ID = 'vn_abcdefghijklmnopqrstuv'

function name(canEdit = true, locale?: 'bg') {
  renderWithIntl(
    <VenueName venueId={VENUE_ID} name="Demo Club" canEdit={canEdit} />,
    locale ? { locale } : {},
  )
  return userEvent.setup({ delay: null })
}

const input = () => screen.getByTestId('venue-name-input') as HTMLInputElement
const save = () => screen.getByTestId('venue-name-save') as HTMLButtonElement

beforeEach(() => {
  vi.mocked(renameVenueAction).mockReset()
  vi.mocked(renameVenueAction).mockImplementation(async (raw) => ({
    ok: true,
    name: (raw as { name: string }).name.trim(),
    changed: true,
  }))
  toasts.success.mockReset()
})

describe('the venue name', () => {
  it('is only text, without a field, for someone who may not rename', () => {
    name(false)
    expect(screen.getByTestId('venue-name').textContent).toBe('Demo Club')
    expect(screen.queryByTestId('venue-name-input')).toBeNull()
    expect(screen.queryByTestId('venue-name-save')).toBeNull()
  })

  it('is a field with the name for an owner or admin, saved only once it is changed', async () => {
    const user = name()
    expect(input().value).toBe('Demo Club')
    expect(save().disabled).toBe(true)
    await user.type(input(), ' Two')
    expect(save().disabled).toBe(false)
    await user.clear(input())
    await user.type(input(), '  Demo Club ')
    // The same name with spaces around it is not a change.
    expect(save().disabled).toBe(true)
  })

  it('cannot be empty, and says so', async () => {
    const user = name()
    await user.clear(input())
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('venue-name-invalid').textContent).toBe(
      'Enter a name of 1 to 120 characters.',
    )
    expect(renameVenueAction).not.toHaveBeenCalled()
  })

  it('stops at 120 characters', () => {
    name()
    expect(input().maxLength).toBe(120)
  })

  it('saves the trimmed name, and the toast says it reaches guests with the next publish', async () => {
    const user = name()
    await user.clear(input())
    await user.type(input(), '  Neon Cellar  ')
    await user.click(save())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
    expect(renameVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, name: 'Neon Cellar' })
    expect(toasts.success.mock.calls[0]?.[0]).toBe(
      'Saved. Guests see the new name after the next publish.',
    )
    expect(input().value).toBe('Neon Cellar')
    expect(save().disabled).toBe(true)
  })

  it.each([
    ['not_allowed', 'Only an owner or admin can rename a venue.'],
    ['invalid', 'This name cannot be used. Check it and try again.'],
    ['venue_archived', 'This venue was deleted.'],
    ['failed', 'Something went wrong. The name was not changed, try again.'],
  ] as const)('shows the answer %s and keeps what was typed', async (error, text) => {
    vi.mocked(renameVenueAction).mockResolvedValue({ ok: false, error })
    const user = name()
    await user.type(input(), '!')
    await user.click(save())
    expect((await screen.findByTestId('venue-name-error')).textContent).toBe(text)
    expect(input().value).toBe('Demo Club!')
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('shows "failed" when the call itself breaks', async () => {
    vi.mocked(renameVenueAction).mockRejectedValue(new Error('network'))
    const user = name()
    await user.type(input(), '!')
    await user.click(save())
    expect((await screen.findByTestId('venue-name-error')).textContent).toContain(
      'Something went wrong',
    )
  })

  it('is in Bulgarian when the interface is', () => {
    name(true, 'bg')
    expect(save().textContent).toBe('Запиши името')
  })
})
