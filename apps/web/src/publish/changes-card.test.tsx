// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { ChangesCard } from './changes-card'
import { NO_CHANGES, ONE_PRICE_CHANGE, publishView, readyDraft, VENUE_ID } from './test-view'

vi.mock('@/server/publish/actions', () => ({ previewDraftAction: vi.fn() }))

const render = (view = publishView(), busy = false, onPublish = vi.fn()) =>
  renderWithIntl(<ChangesCard view={view} busy={busy} onPublish={onPublish} />)

describe('the Changes card', () => {
  it('says "Up to date" when the draft is the live menu, and the button says nothing to publish', () => {
    render(publishView({ draft: readyDraft(NO_CHANGES) }))
    expect(screen.getByText('Up to date')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Nothing to publish' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('counts one price change as "1 change waiting", with a badge and an expandable list', async () => {
    const user = userEvent.setup()
    render()
    expect(screen.getByTestId('changes-count').textContent).toBe('1 change waiting')
    expect(screen.getByTestId('change-summary').textContent).toBe('1 with a new price')
    expect(screen.queryByTestId('change-lists')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show the changes' }))
    const prices = within(screen.getByTestId('change-list-prices'))
    expect(prices.getByText('New prices')).toBeTruthy()
    // The interface language is English, so the English name and the English number style.
    expect(prices.getByText('Negroni: €12.50 → €14.00')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Hide the changes' }))
    expect(screen.queryByTestId('change-lists')).toBeNull()
  })

  it('writes the same change in Bulgarian, with the Bulgarian name and number style', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ChangesCard view={publishView()} busy={false} onPublish={vi.fn()} />, {
      locale: 'bg',
    })
    expect(screen.getByTestId('changes-count').textContent).toBe('1 промяна чака')
    await user.click(screen.getByRole('button', { name: 'Покажи промените' }))
    expect(screen.getByText(/Негрони: 12,50\s?€ → 14,00\s?€/)).toBeTruthy()
  })

  it('lists every kind of change under its own heading', async () => {
    const user = userEvent.setup()
    render(
      publishView({
        draft: readyDraft({
          total: 6,
          identical: false,
          added: [{ id: 'nd_a', name: { en_US: 'Mojito' } }],
          hidden: [{ id: 'nd_h', name: { en_US: 'Spritz' } }],
          priceChanged: [],
          renamed: [{ id: 'nd_r', from: { en_US: 'Beer' }, to: { en_US: 'Lager' } }],
          otherChanged: [{ id: 'nd_o', name: { en_US: 'Wine' } }],
          areas: ['look', 'sections'],
        }),
      }),
    )
    expect(screen.getByTestId('changes-count').textContent).toBe('6 changes waiting')
    expect(screen.getByTestId('change-summary').textContent).toBe(
      '1 added1 hidden or removed1 renamed1 changed in other ways',
    )
    await user.click(screen.getByRole('button', { name: 'Show the changes' }))
    expect(within(screen.getByTestId('change-list-added')).getByText('Mojito')).toBeTruthy()
    expect(within(screen.getByTestId('change-list-hidden')).getByText('Spritz')).toBeTruthy()
    expect(within(screen.getByTestId('change-list-renamed')).getByText('Beer → Lager')).toBeTruthy()
    expect(within(screen.getByTestId('change-list-other')).getByText('Wine')).toBeTruthy()
    const areas = within(screen.getByTestId('change-list-areas'))
    expect(areas.getByText('The look of the menu (colours, logo)')).toBeTruthy()
    expect(areas.getByText('Sections and their order')).toBeTruthy()
  })

  it('says the menu differs in small details when the lists name nothing', () => {
    render(publishView({ draft: readyDraft({ ...NO_CHANGES, identical: false }) }))
    expect(screen.getByTestId('changes-minor')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('before the first publish says everything is new instead of listing it', () => {
    const added = [1, 2].map((n) => ({ id: `nd_${n}`, name: { en_US: `Drink ${n}` } }))
    render(
      publishView({
        live: null,
        draft: readyDraft({ ...NO_CHANGES, identical: false, total: 2, added }),
      }),
    )
    expect(screen.getByTestId('changes-all-new').textContent).toMatch(/2 items will go live/)
    // The Publish button of this state is on the Live card.
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('"Nothing visible to publish" when every item is hidden (V10), and the buttons are off', () => {
    render(publishView({ draft: { state: 'nothing_visible' } }))
    expect(screen.getByText('Nothing visible to publish')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it.each([
    ['blocked', 'The menu cannot be published yet'],
    ['unavailable', 'The draft could not be prepared'],
  ] as const)('says what is wrong when the draft is "%s"', (state, text) => {
    render(publishView({ draft: { state } }))
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('presses Publish once, and shows "Publishing…" and stops while busy', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn()
    const { unmount } = render(publishView(), false, onPublish)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalledTimes(1)
    unmount()

    render(publishView(), true, onPublish)
    const busy = screen.getByRole('button', { name: 'Publishing…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
  })

  it('is off for anyone who may not publish, but the preview stays', () => {
    render(publishView({ canPublish: false }))
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('stays on when the menu is up to date but paused: a publish is what resumes it', () => {
    render(publishView({ draft: readyDraft(NO_CHANGES), paused: true }))
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('lists stale overrides (V12) with a link to the item in the composer', () => {
    render(
      publishView({
        draft: {
          state: 'ready',
          changes: ONE_PRICE_CHANGE,
          currency: 'EUR',
          staleOverrides: [
            {
              nodeId: 'nd_negroni',
              fieldKey: 'portion',
              name: { bg_BG: 'Негрони', en_US: 'Negroni' },
              isItem: true,
            },
            // The same field twice is one line.
            {
              nodeId: 'nd_negroni',
              fieldKey: 'portion',
              name: { bg_BG: 'Негрони', en_US: 'Negroni' },
              isItem: true,
            },
            { nodeId: 'nd_section', fieldKey: 'title', name: null, isItem: false },
          ],
        },
      }),
    )
    const box = within(screen.getByTestId('stale-overrides'))
    expect(box.getByText('Overrides to review')).toBeTruthy()
    const links = box.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe(`/venues/${VENUE_ID}?tab=composer&item=nd_negroni`)
    expect(links[0]?.textContent).toBe('Negroni')
    expect(box.getAllByRole('listitem')).toHaveLength(2)
  })
})
