// @vitest-environment jsdom
// The menu address in the venue's Settings tab (CF-14, D68): the address with its public code, the
// field that renames the readable part (owners and admins), the suggestion from the venue's name,
// the validation while typing, and what happens with the server's answers.
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renameVenueSlugAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { VenueAddress } from './venue-address'

vi.mock('@/server/venues-actions', () => ({ renameVenueSlugAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const VENUE_ID = 'vn_abcdefghijklmnopqrstuv'
const CODE = 'k3x9p2m7qa1z'

function address(overrides: Partial<Parameters<typeof VenueAddress>[0]> = {}) {
  renderWithIntl(
    <VenueAddress
      venueId={VENUE_ID}
      venueName="Демо Клуб Sofia"
      slug="demo-club"
      publicId={CODE}
      canEdit
      {...overrides}
    />,
  )
  return userEvent.setup({ delay: null })
}

const input = () => screen.getByTestId('venue-slug-input') as HTMLInputElement
const save = () => screen.getByTestId('venue-slug-save') as HTMLButtonElement

beforeEach(() => {
  vi.mocked(renameVenueSlugAction).mockReset()
  toasts.success.mockReset()
  toasts.warning.mockReset()
})

describe('the venue address', () => {
  it('shows the menu path, the slug and the permanent code, as a link to the guest page', () => {
    address()
    const link = screen.getByTestId('venue-address') as HTMLAnchorElement
    expect(link.textContent).toBe(`/m/demo-club-${CODE}`)
    expect(link.getAttribute('href')).toBe(`/m/demo-club-${CODE}`)
    expect(link.target).toBe('_blank')
    expect(input().value).toBe('demo-club')
    // It says the old links keep working.
    expect(screen.getByText(/never changes/)).toBeTruthy()
  })

  it('is only shown, without a field, to someone who may not rename it', () => {
    address({ canEdit: false })
    expect(screen.getByTestId('venue-address').textContent).toBe(`/m/demo-club-${CODE}`)
    expect(screen.queryByTestId('venue-slug-input')).toBeNull()
    expect(screen.queryByTestId('venue-slug-save')).toBeNull()
  })

  it('cannot be saved while nothing is changed, and suggests the slug of the name', async () => {
    const user = address()
    expect(save().disabled).toBe(true)
    const suggest = screen.getByTestId('venue-slug-suggest') as HTMLButtonElement
    expect(suggest.disabled).toBe(false)
    await user.click(suggest)
    expect(input().value).toBe('demo-klub-sofia')
    expect(save().disabled).toBe(false)
    // Nothing more to suggest once the field holds it.
    expect(suggest.disabled).toBe(true)
  })

  it('lower-cases as typed, turns a space into a hyphen and refuses what is not a slug', async () => {
    const user = address()
    await user.clear(input())
    await user.type(input(), 'My Own')
    expect(input().value).toBe('my-own')
    expect(save().disabled).toBe(false)

    await user.clear(input())
    await user.type(input(), 'Not_a_slug!')
    expect(await screen.findByTestId('venue-slug-invalid')).toBeTruthy()
    expect(save().disabled).toBe(true)

    await user.clear(input())
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('venue-slug-invalid')).toBeTruthy()
    expect(renameVenueSlugAction).not.toHaveBeenCalled()
  })

  it('sends the venue and the slug, then shows the new path with the same code', async () => {
    vi.mocked(renameVenueSlugAction).mockResolvedValue({
      ok: true,
      slug: 'sea-bar',
      path: `/m/sea-bar-${CODE}`,
      filesQueued: true,
    })
    const user = address()
    await user.clear(input())
    await user.type(input(), 'sea-bar')
    await user.click(save())

    await waitFor(() =>
      expect(screen.getByTestId('venue-address').textContent).toBe(`/m/sea-bar-${CODE}`),
    )
    expect(renameVenueSlugAction).toHaveBeenCalledWith({ venueId: VENUE_ID, slug: 'sea-bar' })
    expect(toasts.success).toHaveBeenCalledWith(
      'Address saved. Guests see the new name within a minute.',
    )
    expect(toasts.warning).not.toHaveBeenCalled()
    // Saved: nothing left to save.
    expect(save().disabled).toBe(true)
  })

  it('says so when the saved address could not be carried to the published files yet', async () => {
    vi.mocked(renameVenueSlugAction).mockResolvedValue({
      ok: true,
      slug: 'sea-bar',
      path: `/m/sea-bar-${CODE}`,
      filesQueued: false,
    })
    const user = address()
    await user.clear(input())
    await user.type(input(), 'sea-bar')
    await user.click(save())
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled())
    expect(String(toasts.warning.mock.calls[0]?.[0])).toMatch(/publish the menu/)
    expect(toasts.success).not.toHaveBeenCalled()
    // The new address is shown all the same: it is saved.
    expect(screen.getByTestId('venue-address').textContent).toBe(`/m/sea-bar-${CODE}`)
  })

  it('says what went wrong for each refusal, and keeps the address it had', async () => {
    for (const [error, text] of [
      ['not_allowed', 'Only an owner or admin can change the address.'],
      ['invalid', 'This address cannot be used. Check it and try again.'],
      ['failed', 'Something went wrong. The address was not changed, try again.'],
    ] as const) {
      vi.mocked(renameVenueSlugAction).mockResolvedValue({ ok: false, error })
      const user = address()
      await user.clear(input())
      await user.type(input(), 'sea-bar')
      await user.click(save())
      expect((await screen.findByTestId('venue-slug-error')).textContent, error).toBe(text)
      expect(screen.getByTestId('venue-address').textContent).toBe(`/m/demo-club-${CODE}`)
      // Typing again clears the message.
      await user.type(input(), '2')
      expect(screen.queryByTestId('venue-slug-error')).toBeNull()
      cleanup()
    }
  })

  it('treats a failing call like a failed save', async () => {
    vi.mocked(renameVenueSlugAction).mockRejectedValue(new Error('network'))
    const user = address()
    await user.clear(input())
    await user.type(input(), 'sea-bar')
    await user.click(save())
    expect((await screen.findByTestId('venue-slug-error')).textContent).toBe(
      'Something went wrong. The address was not changed, try again.',
    )
  })
})
