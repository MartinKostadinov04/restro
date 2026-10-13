// @vitest-environment jsdom
// The menu address in the venue's Settings tab (CF-14, S3, D84): `/m/<organisation>/<venue>` with
// the organisation's address name as a fixed prefix and the venue's own as the field (owners and
// admins), the live preview, the "Open" link, the suggestion from the venue's name, the validation
// while typing, and what happens with the server's answers.
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

function address(overrides: Partial<Parameters<typeof VenueAddress>[0]> = {}) {
  renderWithIntl(
    <VenueAddress
      venueId={VENUE_ID}
      venueName="Демо Клуб Sofia"
      slug="demo-club"
      organizationSlug="night-group"
      canEdit
      {...overrides}
    />,
  )
  return userEvent.setup({ delay: null })
}

const input = () => screen.getByTestId('venue-slug-input') as HTMLInputElement
const save = () => screen.getByTestId('venue-slug-save') as HTMLButtonElement
const shown = () => screen.getByTestId('venue-address').textContent
const openLink = () => screen.queryByTestId('venue-address-open') as HTMLAnchorElement | null

beforeEach(() => {
  vi.mocked(renameVenueSlugAction).mockReset()
  toasts.success.mockReset()
  toasts.warning.mockReset()
})

describe('the venue address', () => {
  it('shows the organisation’s name as the fixed start, the venue’s as the field, and the whole address', () => {
    address()
    expect(screen.getByTestId('venue-slug-prefix').textContent).toBe('/m/night-group/')
    expect(input().value).toBe('demo-club')
    expect(shown()).toBe('/m/night-group/demo-club')
    // The start is text, not part of the field: there is one field.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    // It says the old links keep working.
    expect(screen.getByText(/taken to the new one/)).toBeTruthy()
  })

  it('opens the guest address in a new tab', () => {
    address()
    const link = openLink()
    expect(link?.textContent).toBe('Open')
    expect(link?.getAttribute('href')).toBe('/m/night-group/demo-club')
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toContain('noopener')
  })

  it('is only shown, without a field, to someone who may not rename it, and still opens', () => {
    address({ canEdit: false })
    expect(shown()).toBe('/m/night-group/demo-club')
    expect(openLink()?.getAttribute('href')).toBe('/m/night-group/demo-club')
    expect(screen.queryByTestId('venue-slug-input')).toBeNull()
    expect(screen.queryByTestId('venue-slug-prefix')).toBeNull()
    expect(screen.queryByTestId('venue-slug-save')).toBeNull()
  })

  it('previews the address as it is typed, and opens only what is saved', async () => {
    const user = address()
    await user.clear(input())
    await user.type(input(), 'sea-bar')
    expect(shown()).toBe('/m/night-group/sea-bar')
    // Not saved yet: there is nothing at that address to open.
    expect(openLink()).toBeNull()

    await user.clear(input())
    await user.type(input(), 'demo-club')
    expect(shown()).toBe('/m/night-group/demo-club')
    expect(openLink()).not.toBeNull()
  })

  it('shows dots for an organisation it cannot read, and offers no link', () => {
    address({ organizationSlug: null })
    expect(screen.getByTestId('venue-slug-prefix').textContent).toBe('/m/…/')
    expect(shown()).toBe('/m/…/demo-club')
    expect(openLink()).toBeNull()
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

  it('lower-cases as typed, turns a space into a hyphen and refuses what is not an address name', async () => {
    const user = address()
    await user.clear(input())
    await user.type(input(), 'My Own')
    expect(input().value).toBe('my-own')
    expect(save().disabled).toBe(false)

    await user.clear(input())
    await user.type(input(), 'Not_a_slug!')
    expect(await screen.findByTestId('venue-slug-invalid')).toBeTruthy()
    expect(save().disabled).toBe(true)
    expect(openLink()).toBeNull()

    await user.clear(input())
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('venue-slug-invalid')).toBeTruthy()
    expect(renameVenueSlugAction).not.toHaveBeenCalled()
  })

  it('sends the venue and the name, then shows the new address under the same organisation', async () => {
    vi.mocked(renameVenueSlugAction).mockResolvedValue({
      ok: true,
      slug: 'sea-bar',
      path: '/m/sea-bar-k3x9p2m7qa1z',
      filesQueued: true,
    })
    const user = address()
    await user.clear(input())
    await user.type(input(), 'sea-bar')
    await user.click(save())

    await waitFor(() => expect(shown()).toBe('/m/night-group/sea-bar'))
    expect(renameVenueSlugAction).toHaveBeenCalledWith({ venueId: VENUE_ID, slug: 'sea-bar' })
    expect(toasts.success).toHaveBeenCalledWith(
      'Address saved. Guests see the new name within a minute.',
    )
    expect(toasts.warning).not.toHaveBeenCalled()
    // Saved: nothing left to save, and the link opens the new address.
    expect(save().disabled).toBe(true)
    expect(openLink()?.getAttribute('href')).toBe('/m/night-group/sea-bar')
  })

  it('says so when the saved address could not be carried to the published files yet', async () => {
    vi.mocked(renameVenueSlugAction).mockResolvedValue({
      ok: true,
      slug: 'sea-bar',
      path: '/m/sea-bar-k3x9p2m7qa1z',
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
    expect(shown()).toBe('/m/night-group/sea-bar')
  })

  it('says what went wrong for each refusal, and keeps the address it had', async () => {
    for (const [error, text] of [
      ['not_allowed', 'Only an owner or admin can change the address.'],
      ['invalid', 'This address cannot be used. Check it and try again.'],
      ['taken', 'Another venue of yours already has this address name. Choose another one.'],
      ['failed', 'Something went wrong. The address was not changed, try again.'],
    ] as const) {
      vi.mocked(renameVenueSlugAction).mockResolvedValue({ ok: false, error })
      const user = address()
      await user.clear(input())
      await user.type(input(), 'sea-bar')
      await user.click(save())
      expect((await screen.findByTestId('venue-slug-error')).textContent, error).toBe(text)
      // The field still holds what was typed; the saved address was not changed.
      expect(input().value).toBe('sea-bar')
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

  it('is in Bulgarian when the interface is', () => {
    renderWithIntl(
      <VenueAddress
        venueId={VENUE_ID}
        venueName="Демо Клуб"
        slug="demo-club"
        organizationSlug="night-group"
        canEdit
      />,
      { locale: 'bg' },
    )
    expect(screen.getByLabelText('Име в адреса')).toBe(input())
    expect(openLink()?.textContent).toBe('Отвори')
  })
})
