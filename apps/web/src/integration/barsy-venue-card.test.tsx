// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { BarsyVenueCard } from './barsy-venue-card'
import { emptyView, integrationView, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ chooseBarsyVenueAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.chooseBarsyVenueAction.mockReset()
})

describe('the barsy venue picker', () => {
  it('lists the venues by name, marks the chosen one, and never shows an id', () => {
    renderWithIntl(<BarsyVenueCard venueId={VENUE_ID} view={integrationView()} />)
    const options = screen.getAllByTestId('barsy-venue-option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Main bar',
      'Roof terrace',
      'GardenUsed by Venue B',
    ])
    expect((screen.getByRole('radio', { name: 'Main bar' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Roof terrace' }) as HTMLInputElement).checked).toBe(
      false,
    )
    // The barsy venues' ids (1, 2, 3) appear nowhere in the page.
    expect(
      screen.getAllByTestId('barsy-venue-option')[0]?.closest('fieldset')?.textContent,
    ).not.toMatch(/\b[123]\b/)
  })

  it('maps the venue the manager picks', async () => {
    const user = userEvent.setup()
    actions.chooseBarsyVenueAction.mockResolvedValue({ ok: true })
    renderWithIntl(<BarsyVenueCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: 'Roof terrace' }))
    expect(actions.chooseBarsyVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, bid: 2 })
  })

  it('cannot pick a barsy venue that belongs to another venue', async () => {
    const user = userEvent.setup()
    renderWithIntl(<BarsyVenueCard venueId={VENUE_ID} view={integrationView()} />)
    const garden = screen.getByRole('radio', { name: /Garden/ }) as HTMLInputElement
    expect(garden.disabled).toBe(true)
    await user.click(garden)
    expect(actions.chooseBarsyVenueAction).not.toHaveBeenCalled()
  })

  it('shows a conflict the server reports as a clear error', async () => {
    const user = userEvent.setup()
    actions.chooseBarsyVenueAction.mockResolvedValue({ ok: false, error: 'barsy_venue_taken' })
    renderWithIntl(<BarsyVenueCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: 'Roof terrace' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That barsy venue already belongs to another venue.',
    )
    // The choice goes back to what the server has.
    await waitFor(() =>
      expect((screen.getByRole('radio', { name: 'Main bar' }) as HTMLInputElement).checked).toBe(
        true,
      ),
    )
  })

  it('is read-only for someone who cannot manage', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <BarsyVenueCard venueId={VENUE_ID} view={integrationView({ canManage: false })} />,
    )
    const roof = screen.getByRole('radio', { name: 'Roof terrace' }) as HTMLInputElement
    expect(roof.disabled).toBe(true)
    await user.click(roof)
    expect(actions.chooseBarsyVenueAction).not.toHaveBeenCalled()
  })

  it('invites the manager to connect first when there are no barsy venues yet', () => {
    renderWithIntl(<BarsyVenueCard venueId={VENUE_ID} view={emptyView()} />)
    expect(screen.getByTestId('barsy-venues-empty').textContent).toContain('No barsy venues yet')
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('shows each venue’s public address and a "Public menu set up" hint when its record has them', () => {
    renderWithIntl(
      <BarsyVenueCard
        venueId={VENUE_ID}
        view={integrationView({
          barsyVenues: [
            {
              key: 1,
              name: 'Main bar',
              mappedHere: true,
              usedBy: null,
              address: 'Sofia, 108 Vitosha Blvd',
              publicMenuSetUp: true,
            },
            { key: 2, name: 'Roof terrace', mappedHere: false, usedBy: null },
          ],
        })}
      />,
    )
    const [main, roof] = screen.getAllByTestId('barsy-venue-option') as HTMLElement[]
    expect(within(main as HTMLElement).getByTestId('venue-address').textContent).toBe(
      'Sofia, 108 Vitosha Blvd',
    )
    expect(within(main as HTMLElement).getByTestId('venue-public-menu').textContent).toBe(
      'Public menu set up in the till',
    )
    expect(within(roof as HTMLElement).queryByTestId('venue-address')).toBeNull()
    expect(within(roof as HTMLElement).queryByTestId('venue-public-menu')).toBeNull()
    // Hints only: the venue stays chosen as it was, and the other one is still just an option.
    expect((screen.getByRole('radio', { name: /Main bar/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /Roof terrace/ }) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('says it in Bulgarian', () => {
    renderWithIntl(
      <BarsyVenueCard
        venueId={VENUE_ID}
        view={integrationView({
          barsyVenues: [
            { key: 1, name: 'Main bar', mappedHere: true, usedBy: null, publicMenuSetUp: true },
          ],
        })}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('venue-public-menu').textContent).toBe(
      'Публично меню, настроено в касата',
    )
  })
})
