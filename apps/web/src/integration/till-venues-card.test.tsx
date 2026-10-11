// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { emptyView, integrationView, TILL_VENUES, VENUE_ID } from './test-view'
import { TillVenuesCard } from './till-venues-card'

const actions = vi.hoisted(() => ({
  addTillVenueAsVenueAction: vi.fn(),
  linkTillVenueAction: vi.fn(),
  markTillVenueAction: vi.fn(),
}))
vi.mock('@/server/integration/actions', () => actions)
const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  navigation.push.mockReset()
})

const rowOf = (name: string) =>
  screen
    .getAllByTestId('till-venue')
    .find(
      (row) => within(row).queryByTestId('till-venue-name')?.textContent === name,
    ) as HTMLElement

describe('the list of venues in barsy', () => {
  it('shows every venue with its state: linked, to do, not used', () => {
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    expect(
      screen.getAllByTestId('till-venue').map((row) => row.getAttribute('data-state')),
    ).toEqual(['linked', 'linked', 'unlinked', 'not_used'])
    // Linked to «venue»: a link to that venue's Settings tab, at its Menu source card.
    const linked = within(rowOf('Main bar')).getByTestId('till-venue-linked')
    expect(linked.textContent).toBe('Linked to «Demo Club Sofia»')
    expect(linked.getAttribute('href')).toBe(`/venues/${VENUE_ID}?tab=settings#menu-source`)
    expect(within(rowOf('Garden')).getByText('Not set up yet')).toBeTruthy()
    expect(within(rowOf('Shop')).getByTestId('till-venue-not-used').textContent).toBe('Not used')
  })

  it('says which linked venue still has to choose its menu category', () => {
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    expect(within(rowOf('Main bar')).queryByTestId('till-venue-needs-category')).toBeNull()
    expect(within(rowOf('Roof terrace')).getByTestId('till-venue-needs-category').textContent).toBe(
      'Choose its menu category',
    )
  })

  it('counts what is left to set up; a venue set aside does not count', () => {
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    expect(screen.getByTestId('till-venues-todo').textContent).toBe('1 venue to set up')
  })

  it('says when nothing is left to set up', () => {
    renderWithIntl(
      <TillVenuesCard
        view={integrationView({
          tillVenues: TILL_VENUES.filter((row) => row.state !== 'unlinked'),
        })}
      />,
    )
    expect(screen.getByTestId('till-venues-todo').textContent).toBe('Nothing left to set up.')
  })

  it('offers three things for a venue that is not set up, and "Use again" for one set aside', () => {
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    const garden = within(rowOf('Garden'))
    expect(garden.getByRole('button', { name: 'Add as venue' })).toBeTruthy()
    expect(garden.getByRole('button', { name: 'Link to an existing venue' })).toBeTruthy()
    expect(garden.getByRole('button', { name: 'Not used' })).toBeTruthy()
    expect(within(rowOf('Shop')).getByRole('button', { name: 'Use again' })).toBeTruthy()
    // A linked venue has no button: changing its link is its own Menu source card's deliberate step.
    expect(within(rowOf('Main bar')).queryByRole('button')).toBeNull()
  })

  it('"Add as venue" makes the venue and sends the person to its Menu source card', async () => {
    const user = userEvent.setup()
    actions.addTillVenueAsVenueAction.mockResolvedValue({ ok: true, venueId: 'vn_newVenue' })
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    await user.click(within(rowOf('Garden')).getByRole('button', { name: 'Add as venue' }))
    expect(actions.addTillVenueAsVenueAction).toHaveBeenCalledWith({ bid: 3 })
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith('/venues/vn_newVenue?tab=settings#menu-source'),
    )
  })

  it('shows why "Add as venue" was refused, and goes nowhere', async () => {
    const user = userEvent.setup()
    actions.addTillVenueAsVenueAction.mockResolvedValue({ ok: false, error: 'till_venue_taken' })
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    await user.click(within(rowOf('Garden')).getByRole('button', { name: 'Add as venue' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That venue in the till already belongs to another venue.',
    )
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('"Not used" and "Use again" round-trip through the same action', async () => {
    const user = userEvent.setup()
    actions.markTillVenueAction.mockResolvedValue({ ok: true })
    renderWithIntl(<TillVenuesCard view={integrationView()} />)
    await user.click(within(rowOf('Garden')).getByRole('button', { name: 'Not used' }))
    expect(actions.markTillVenueAction).toHaveBeenLastCalledWith({ bid: 3, notUsed: true })
    await user.click(within(rowOf('Shop')).getByRole('button', { name: 'Use again' }))
    expect(actions.markTillVenueAction).toHaveBeenLastCalledWith({ bid: 4, notUsed: false })
  })

  describe('"Link to an existing venue"', () => {
    it('warns first, offers only the venues that have no link, and links the one chosen', async () => {
      const user = userEvent.setup()
      actions.linkTillVenueAction.mockResolvedValue({ ok: true })
      renderWithIntl(<TillVenuesCard view={integrationView()} />)
      await user.click(
        within(rowOf('Garden')).getByRole('button', { name: 'Link to an existing venue' }),
      )

      const dialog = await screen.findByTestId('link-dialog')
      expect(within(dialog).getByText(/Link “Garden” to an existing venue/)).toBeTruthy()
      // The warning is the T62 one: items stay, the next full sync decides.
      expect(within(dialog).getByTestId('link-warning').textContent).toContain(
        'the next full sync decides which of them still exist',
      )
      expect(
        within(dialog)
          .getAllByRole('radio')
          .map((radio) => radio.closest('label')?.textContent),
      ).toEqual(['Spare venue', 'Other venue'])
      const confirm = within(dialog).getByRole('button', { name: 'Link' }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)

      await user.click(within(dialog).getByRole('radio', { name: 'Other venue' }))
      await user.click(confirm)
      expect(actions.linkTillVenueAction).toHaveBeenCalledWith({
        bid: 3,
        venueId: 'vn_otherVenue000000000001',
      })
      await waitFor(() => expect(screen.queryByTestId('link-dialog')).toBeNull())
    })

    it('shows the refusal in the list after the dialog closes (a venue that has a link is refused)', async () => {
      const user = userEvent.setup()
      actions.linkTillVenueAction.mockResolvedValue({ ok: false, error: 'venue_already_linked' })
      renderWithIntl(<TillVenuesCard view={integrationView()} />)
      await user.click(
        within(rowOf('Garden')).getByRole('button', { name: 'Link to an existing venue' }),
      )
      const dialog = await screen.findByTestId('link-dialog')
      await user.click(within(dialog).getByRole('radio', { name: 'Spare venue' }))
      await user.click(within(dialog).getByRole('button', { name: 'Link' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        'That venue is already linked to a venue in the till.',
      )
    })

    it('is switched off when every venue has a link already', () => {
      renderWithIntl(<TillVenuesCard view={integrationView({ linkableVenues: [] })} />)
      expect(
        (
          within(rowOf('Garden')).getByRole('button', {
            name: 'Link to an existing venue',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)
    })

    it('cancel closes it and links nothing', async () => {
      const user = userEvent.setup()
      renderWithIntl(<TillVenuesCard view={integrationView()} />)
      await user.click(
        within(rowOf('Garden')).getByRole('button', { name: 'Link to an existing venue' }),
      )
      const dialog = await screen.findByTestId('link-dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByTestId('link-dialog')).toBeNull())
      expect(actions.linkTillVenueAction).not.toHaveBeenCalled()
    })
  })

  it('shows the hints from the stored record, and no number of the till', () => {
    renderWithIntl(
      <TillVenuesCard
        view={integrationView({
          tillVenues: [
            {
              key: 7731,
              name: 'Main bar',
              state: 'unlinked',
              venue: null,
              hasMenuCategory: false,
              address: 'Sofia, 108 Vitosha Blvd',
              publicMenuSetUp: true,
            },
          ],
        })}
      />,
    )
    expect(screen.getByTestId('venue-address').textContent).toBe('Sofia, 108 Vitosha Blvd')
    expect(screen.getByTestId('venue-public-menu').textContent).toBe(
      'Public menu set up in the till',
    )
    expect(screen.getByTestId('till-venues').textContent).not.toContain('7731')
  })

  it('is read-only for someone who cannot manage: the list, no buttons', () => {
    renderWithIntl(<TillVenuesCard view={integrationView({ canManage: false })} />)
    expect(screen.getAllByTestId('till-venue')).toHaveLength(4)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('has an empty state until a connection check has listed the venues', () => {
    renderWithIntl(<TillVenuesCard view={emptyView()} />)
    expect(screen.getByTestId('till-venues-empty').textContent).toContain(
      'No venues from barsy yet',
    )
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<TillVenuesCard view={integrationView()} />, { locale: 'bg' })
    expect(within(rowOf('Main bar')).getByTestId('till-venue-linked').textContent).toBe(
      'Свързано със „Demo Club Sofia“',
    )
    expect(
      within(rowOf('Garden')).getByRole('button', { name: 'Добави като заведение' }),
    ).toBeTruthy()
    expect(
      within(rowOf('Garden')).getByRole('button', { name: 'Свържи със съществуващо заведение' }),
    ).toBeTruthy()
    expect(within(rowOf('Shop')).getByRole('button', { name: 'Използвай отново' })).toBeTruthy()
  })
})
