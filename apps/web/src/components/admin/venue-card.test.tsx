// @vitest-environment jsdom
// The All venues card (D86): the name, the state badge (Draft or Live), the guest address, where
// the menu comes from (the POS instance, or By hand) and the venue's name in that POS, Open,
// Preview menu (a new tab; off with the reason for a Draft), and Unpublish with its confirmation,
// for owners and admins, on a live venue only.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { unpublishVenueAction } from '@/server/venues-actions'
import type { VenueCard as VenueCardData } from '@/server/venues-result'
import { renderWithIntl } from '@/test-utils'

import { VenueCard } from './venue-card'

vi.mock('@/server/venues-actions', () => ({ unpublishVenueAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const VENUE_ID = 'vn_abcdefghijklmnopqrstuv'
const LIVE: VenueCardData = {
  id: VENUE_ID,
  name: 'Club Neon',
  state: 'live',
  instanceName: null,
  tillVenueName: null,
  guestPath: '/m/night-group/club-neon',
}
const DRAFT: VenueCardData = { ...LIVE, state: 'draft' }
const LINKED: VenueCardData = {
  ...LIVE,
  instanceName: 'Till Sofia',
  tillVenueName: 'Neon (centre)',
}

function card(venue: VenueCardData, options: { canManage?: boolean; locale?: 'bg' } = {}) {
  renderWithIntl(
    <VenueCard venue={venue} canManage={options.canManage ?? true} />,
    options.locale ? { locale: options.locale } : {},
  )
  return userEvent.setup({ delay: null })
}

const state = () => screen.getByTestId('venue-card-state')
const preview = () => screen.getByTestId('venue-card-preview')

beforeEach(() => {
  vi.mocked(unpublishVenueAction).mockReset()
  vi.mocked(unpublishVenueAction).mockResolvedValue({
    ok: true,
    name: 'Club Neon',
    filesQueued: true,
  })
  toasts.success.mockReset()
  toasts.warning.mockReset()
})

describe('a live venue', () => {
  it('shows its name, the Live badge and its guest address', () => {
    card(LIVE)
    expect(screen.getByText('Club Neon')).toBeTruthy()
    expect(state().textContent).toBe('Live')
    expect(screen.getByTestId('venue-card-address').textContent).toBe('/m/night-group/club-neon')
  })

  it('has Open for the admin and Preview menu for guests, in a new tab', () => {
    card(LIVE)
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe(
      `/venues/${VENUE_ID}`,
    )
    const link = screen.getByRole('link', { name: /Preview menu/ })
    expect(link.getAttribute('href')).toBe('/m/night-group/club-neon')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(screen.queryByTestId('venue-card-preview-hint')).toBeNull()
  })
})

describe('a draft', () => {
  it('shows the Draft badge, and a Preview menu that is off, with the reason', () => {
    card(DRAFT)
    expect(state().textContent).toBe('Draft')
    expect(screen.queryByRole('link', { name: /Preview menu/ })).toBeNull()
    const button = preview() as HTMLButtonElement
    expect(button.tagName).toBe('BUTTON')
    expect(button.disabled).toBe(true)
    const hint = screen.getByTestId('venue-card-preview-hint')
    expect(hint.textContent).toBe(
      'A draft has no guest page yet. Publish the venue to preview its menu.',
    )
    expect(button.getAttribute('aria-describedby')).toBe(hint.id)
    // The admin is still one click away.
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe(
      `/venues/${VENUE_ID}`,
    )
  })

  it('has no Unpublish: there is nothing to take down', () => {
    card(DRAFT)
    expect(screen.queryByTestId('unpublish-venue-open')).toBeNull()
  })
})

describe('where the menu comes from', () => {
  it('says By hand for a venue with no POS instance, and shows no POS venue', () => {
    card(LIVE)
    expect(screen.getByTestId('venue-card-source').textContent).toBe('By hand')
    expect(screen.queryByTestId('venue-card-till-venue')).toBeNull()
  })

  it('names the instance and the venue in it for a linked venue', () => {
    card(LINKED)
    expect(screen.getByTestId('venue-card-source').textContent).toBe('Till Sofia')
    expect(screen.getByTestId('venue-card-till-venue').textContent).toBe('Neon (centre)')
    expect(screen.getByText('Venue in Till Sofia')).toBeTruthy()
    expect(screen.queryByText('By hand')).toBeNull()
  })
})

describe('in Bulgarian', () => {
  it('has the states, the source and the buttons in Bulgarian', () => {
    card(LINKED, { locale: 'bg' })
    expect(state().textContent).toBe('На живо')
    expect(screen.getByText('Заведение в Till Sofia')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Преглед на менюто/ })).toBeTruthy()
    expect(screen.getByTestId('unpublish-venue-open').textContent).toBe('Свали от публикация…')
  })
})

describe('Unpublish', () => {
  it('is offered to owners and admins on a live venue, with no dialog until it is pressed', () => {
    card(LIVE)
    expect(screen.getByTestId('unpublish-venue-open').textContent).toBe('Unpublish…')
    expect(screen.queryByTestId('unpublish-venue-dialog')).toBeNull()
  })

  it('is not offered to a member', () => {
    card(LIVE, { canManage: false })
    expect(screen.queryByTestId('unpublish-venue-open')).toBeNull()
  })

  it('says what guests will see, and what stays', async () => {
    const user = card(LIVE)
    await user.click(screen.getByTestId('unpublish-venue-open'))
    expect(screen.getByRole('dialog', { name: 'Unpublish Club Neon?' })).toBeTruthy()
    const effects = screen.getByTestId('unpublish-venue-effects').textContent ?? ''
    expect(effects).toContain('guests see that the menu is not available')
    expect(effects).toContain('back to Draft')
    expect(effects).toContain('Nothing is deleted')
    expect(effects).toContain('Publish a menu of the venue again')
    expect(unpublishVenueAction).not.toHaveBeenCalled()
  })

  it('does nothing when it is cancelled', async () => {
    const user = card(LIVE)
    await user.click(screen.getByTestId('unpublish-venue-open'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('unpublish-venue-dialog')).toBeNull())
    expect(unpublishVenueAction).not.toHaveBeenCalled()
  })

  it('unpublishes the venue, closes, and says so', async () => {
    const user = card(LIVE)
    await user.click(screen.getByTestId('unpublish-venue-open'))
    await user.click(screen.getByTestId('unpublish-venue-confirm'))
    await waitFor(() => expect(unpublishVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Club Neon was unpublished.'))
    await waitFor(() => expect(screen.queryByTestId('unpublish-venue-dialog')).toBeNull())
    expect(toasts.warning).not.toHaveBeenCalled()
  })

  it('warns when the guest files could not be withdrawn just now', async () => {
    vi.mocked(unpublishVenueAction).mockResolvedValue({
      ok: true,
      name: 'Club Neon',
      filesQueued: false,
    })
    const user = card(LIVE)
    await user.click(screen.getByTestId('unpublish-venue-open'))
    await user.click(screen.getByTestId('unpublish-venue-confirm'))
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled())
    expect(String(toasts.warning.mock.calls[0]?.[0])).toContain('could not be withdrawn just now')
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('says what went wrong, and keeps the dialog open', async () => {
    for (const [error, text] of [
      ['not_allowed', 'Only an owner or admin can unpublish a venue.'],
      ['invalid', 'This venue could not be found.'],
      ['venue_archived', 'This venue was deleted.'],
      ['failed', 'Something went wrong. The venue was not unpublished, try again.'],
    ] as const) {
      vi.mocked(unpublishVenueAction).mockResolvedValue({ ok: false, error })
      const user = card(LIVE)
      await user.click(screen.getByTestId('unpublish-venue-open'))
      await user.click(screen.getByTestId('unpublish-venue-confirm'))
      const dialog = await screen.findByTestId('unpublish-venue-dialog')
      expect(within(dialog).getByTestId('unpublish-venue-error').textContent, error).toBe(text)
      expect(toasts.success).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('treats a server action that throws as a failure', async () => {
    vi.mocked(unpublishVenueAction).mockRejectedValue(new Error('network'))
    const user = card(LIVE)
    await user.click(screen.getByTestId('unpublish-venue-open'))
    await user.click(screen.getByTestId('unpublish-venue-confirm'))
    expect((await screen.findByTestId('unpublish-venue-error')).textContent).toContain(
      'Something went wrong',
    )
  })
})
