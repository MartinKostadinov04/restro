// @vitest-environment jsdom
// The New venue dialog in two steps (D85, D87): step 1 the source (an active POS instance or "By
// hand"), step 2 either the instance's venues (nothing typed; one already linked cannot be picked)
// or, by hand, the name, the address (it follows the name until it is edited, with a preview of
// `/m/<organisation>/<venue>`), the languages and what happens with the server's answers.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVenueAction, loadNewVenueSourcesAction } from '@/server/venues-actions'
import type { NewVenueSources } from '@/server/venues-result'
import { renderWithIntl } from '@/test-utils'

import { NewVenueDialog } from './new-venue-dialog'

vi.mock('@/server/venues-actions', () => ({
  createVenueAction: vi.fn(),
  loadNewVenueSourcesAction: vi.fn(),
}))
// The button needs the router; the dialog itself does not.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const SOFIA = 'in_sofiaaaaaaaaaaaaaaaaa'
const VARNA = 'in_varnaaaaaaaaaaaaaaaaa'
const SOURCES: NewVenueSources = {
  organizationSlug: 'night-group',
  instances: [
    {
      id: SOFIA,
      name: 'Till Sofia',
      tillVenues: [
        { bid: 11, name: 'Club Neon', linkedVenueName: null },
        { bid: 12, name: 'Neon Roof', linkedVenueName: 'Roof Bar' },
        { bid: 13, name: 'Neon Garden', linkedVenueName: null },
      ],
    },
    { id: VARNA, name: 'Till Varna', tillVenues: [] },
  ],
}
const NO_INSTANCES: NewVenueSources = { organizationSlug: 'night-group', instances: [] }

function dialog(locale?: 'bg') {
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  renderWithIntl(
    <NewVenueDialog open onOpenChange={onOpenChange} onCreated={onCreated} />,
    locale ? { locale } : {},
  )
  return { onOpenChange, onCreated, user: userEvent.setup({ delay: null }) }
}

type User = ReturnType<typeof userEvent.setup>
const next = () => screen.getByTestId('new-venue-next') as HTMLButtonElement
const submit = () => screen.getByTestId('new-venue-submit') as HTMLButtonElement
const name = () => screen.getByTestId('new-venue-name') as HTMLInputElement
const slug = () => screen.getByTestId('new-venue-slug') as HTMLInputElement
const language = (label: string) => screen.getByRole('checkbox', { name: label })
const tillVenue = (bid: number) =>
  screen.getByTestId(`new-venue-till-venue-${bid}`) as HTMLInputElement

/** Step 1 is shown once the sources are in; picks a source and goes on to step 2. */
async function goOn(user: User, source: string) {
  await user.click(await screen.findByTestId(`new-venue-source-${source}`))
  await user.click(next())
}
const byHand = (user: User) => goOn(user, 'hand')

beforeEach(() => {
  vi.mocked(createVenueAction).mockReset()
  vi.mocked(createVenueAction).mockResolvedValue({ ok: true, venueId: 'vn_abcdefghijklmnopqrstuv' })
  vi.mocked(loadNewVenueSourcesAction).mockReset()
  vi.mocked(loadNewVenueSourcesAction).mockResolvedValue({ ok: true, sources: SOURCES })
})

describe('step 1: the source', () => {
  it('lists the active instances by the name the owner gave them, and By hand last', async () => {
    dialog()
    expect(screen.getByTestId('new-venue-sources-loading')).toBeTruthy()
    const group = await screen.findByTestId('new-venue-sources')
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('data-testid'))).toEqual([
      `new-venue-source-${SOFIA}`,
      `new-venue-source-${VARNA}`,
      'new-venue-source-hand',
    ])
    expect(group.textContent).toContain('Till Sofia')
    expect(group.textContent).toContain('3 venues')
    expect(group.textContent).toContain('Till Varna')
    expect(group.textContent).toContain('0 venues')
    expect(group.textContent).toContain('By hand')
    expect(loadNewVenueSourcesAction).toHaveBeenCalledTimes(1)
  })

  it('says that the source cannot be changed afterwards', async () => {
    dialog()
    await screen.findByTestId('new-venue-sources')
    expect(screen.getByRole('dialog').textContent).toContain(
      'This cannot be changed after the venue is created.',
    )
  })

  it('goes on only once a source is chosen', async () => {
    const { user } = dialog()
    await screen.findByTestId('new-venue-sources')
    expect(next().disabled).toBe(true)
    await user.click(screen.getByTestId('new-venue-source-hand'))
    expect(next().disabled).toBe(false)
  })

  it('with no instance connected has By hand chosen, and points to Integrations', async () => {
    vi.mocked(loadNewVenueSourcesAction).mockResolvedValue({ ok: true, sources: NO_INSTANCES })
    dialog()
    await screen.findByTestId('new-venue-sources')
    expect((screen.getByTestId('new-venue-source-hand') as HTMLInputElement).checked).toBe(true)
    expect(next().disabled).toBe(false)
    const hint = screen.getByTestId('new-venue-no-instances')
    expect(hint.textContent).toContain('No point-of-sale system is connected yet.')
    expect(within(hint).getByRole('link').getAttribute('href')).toBe('/settings/integrations')
  })

  it('says when the sources could not be loaded, and loads them again on request', async () => {
    vi.mocked(loadNewVenueSourcesAction).mockResolvedValueOnce({ ok: false, error: 'failed' })
    const { user } = dialog()
    expect((await screen.findByTestId('new-venue-sources-error')).textContent).toBe(
      'The sources could not be loaded. Try again.',
    )
    expect(next().disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('new-venue-sources')).toBeTruthy()
    expect(loadNewVenueSourcesAction).toHaveBeenCalledTimes(2)
  })

  it('treats a server action that throws as a failure to load', async () => {
    vi.mocked(loadNewVenueSourcesAction).mockRejectedValue(new Error('network'))
    dialog()
    expect(await screen.findByTestId('new-venue-sources-error')).toBeTruthy()
  })
})

describe('step 2, from a POS: nothing is typed', () => {
  it('names the instance and lists its venues, with no field to fill in', async () => {
    const { user } = dialog()
    await goOn(user, SOFIA)
    expect(screen.getByRole('dialog', { name: 'New venue from Till Sofia' })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain(
      'Nothing to type: the name, the address and the languages come from Till Sofia.',
    )
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('data-testid'))).toEqual([
      'new-venue-till-venue-11',
      'new-venue-till-venue-12',
      'new-venue-till-venue-13',
    ])
    expect(screen.queryByTestId('new-venue-name')).toBeNull()
    expect(screen.queryByTestId('new-venue-slug')).toBeNull()
    expect(submit().disabled).toBe(true)
  })

  it('shows a venue that is linked already as “linked to …” and does not let it be picked', async () => {
    const { user } = dialog()
    await goOn(user, SOFIA)
    expect(tillVenue(11).disabled).toBe(false)
    expect(tillVenue(12).disabled).toBe(true)
    const row = screen.getByTestId('new-venue-till-venue-12').closest('label')
    expect(row?.textContent).toContain('Neon Roof')
    expect(row?.textContent).toContain('linked to Roof Bar')
    await user.click(tillVenue(12))
    expect(tillVenue(12).checked).toBe(false)
    expect(submit().disabled).toBe(true)
  })

  it('creates from the picked venue with the source alone, then opens the new venue', async () => {
    const { user, onCreated, onOpenChange } = dialog()
    await goOn(user, SOFIA)
    await user.click(tillVenue(13))
    expect(submit().disabled).toBe(false)
    await user.click(submit())
    await waitFor(() =>
      expect(createVenueAction).toHaveBeenCalledWith({
        source: { kind: 'instance', integrationId: SOFIA, bid: 13 },
      }),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('vn_abcdefghijklmnopqrstuv'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says when the venue was linked to another one meanwhile, and takes it off the list', async () => {
    vi.mocked(createVenueAction).mockResolvedValue({ ok: false, error: 'link_taken' })
    const { user, onCreated } = dialog()
    await goOn(user, SOFIA)
    await user.click(tillVenue(11))
    await user.click(submit())
    expect((await screen.findByTestId('new-venue-error')).textContent).toBe(
      'This venue of Till Sofia was linked to another venue in the meantime. Pick another one.',
    )
    expect(tillVenue(11).disabled).toBe(true)
    expect(tillVenue(11).checked).toBe(false)
    expect(submit().disabled).toBe(true)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('says what went wrong for the other refusals, and for a server action that throws', async () => {
    for (const [error, text] of [
      ['not_allowed', 'Only an owner or admin can create a venue.'],
      ['invalid', 'Check the name, the address and the languages, then try again.'],
      ['failed', 'Something went wrong. The venue was not created, try again.'],
    ] as const) {
      vi.mocked(createVenueAction).mockResolvedValue({ ok: false, error })
      const { user } = dialog()
      await goOn(user, SOFIA)
      await user.click(tillVenue(11))
      await user.click(submit())
      expect((await screen.findByTestId('new-venue-error')).textContent, error).toBe(text)
      cleanup()
    }
    vi.mocked(createVenueAction).mockRejectedValue(new Error('network'))
    const { user } = dialog()
    await goOn(user, SOFIA)
    await user.click(tillVenue(11))
    await user.click(submit())
    expect((await screen.findByTestId('new-venue-error')).textContent).toContain(
      'Something went wrong',
    )
  })

  it('says so when the instance reports no venue, and when all of them are linked', async () => {
    const { user } = dialog()
    await goOn(user, VARNA)
    expect(screen.getByTestId('new-venue-no-till-venues').textContent).toContain(
      'Till Varna has not reported any venues yet.',
    )
    cleanup()

    vi.mocked(loadNewVenueSourcesAction).mockResolvedValue({
      ok: true,
      sources: {
        organizationSlug: 'night-group',
        instances: [
          {
            id: SOFIA,
            name: 'Till Sofia',
            tillVenues: [{ bid: 1, name: 'Only one', linkedVenueName: 'Mine' }],
          },
        ],
      },
    })
    const second = dialog()
    await goOn(second.user, SOFIA)
    expect(screen.getByTestId('new-venue-all-linked').textContent).toBe(
      'Every venue in Till Sofia is linked to a venue already.',
    )
  })

  it('goes back to step 1 with the choice kept', async () => {
    const { user } = dialog()
    await goOn(user, SOFIA)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('new-venue-sources')).toBeTruthy()
    expect((screen.getByTestId(`new-venue-source-${SOFIA}`) as HTMLInputElement).checked).toBe(true)
  })

  it('is in Bulgarian when the interface is', async () => {
    const { user } = dialog('bg')
    await goOn(user, SOFIA)
    expect(screen.getByRole('dialog', { name: 'Ново заведение от Till Sofia' })).toBeTruthy()
    expect(screen.getByTestId('new-venue-till-venue-12').closest('label')?.textContent).toContain(
      'свързано с Roof Bar',
    )
  })
})

describe('step 2, by hand: the address', () => {
  it('is suggested from the name as it is typed, Bulgarian letters turned into Latin', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.type(name(), 'Демо Клуб Sofia')
    expect(slug().value).toBe('demo-klub-sofia')
  })

  it('is previewed as /m/<organisation>/<venue>, and the preview follows the address', async () => {
    const { user } = dialog()
    await byHand(user)
    expect(screen.getByTestId('new-venue-address').textContent).toBe('/m/night-group/…')
    await user.type(name(), 'Sea Bar')
    expect(screen.getByTestId('new-venue-address').textContent).toBe('/m/night-group/sea-bar')
    // No code, and no promise that the name is fixed.
    expect(screen.getByTestId('new-venue-slug-help').textContent).not.toMatch(/code/i)
    await user.clear(slug())
    await user.type(slug(), 'my-own')
    expect(screen.getByTestId('new-venue-address').textContent).toBe('/m/night-group/my-own')
  })

  it('stops following the name once the person edits it', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.type(name(), 'Sea Bar')
    await user.clear(slug())
    await user.type(slug(), 'My Own')
    // Lower-cased as typed, a space becomes a hyphen; the name no longer changes it.
    expect(slug().value).toBe('my-own')
    await user.type(name(), ' Two')
    expect(slug().value).toBe('my-own')
  })

  it('names what is wrong with it, and does not call the server', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.type(name(), 'Sea Bar')
    await user.clear(slug())
    await user.type(slug(), 'Not_a_slug!')
    await user.click(submit())
    expect((await screen.findByTestId('new-venue-slug-error')).textContent).toBe(
      'Use lower-case Latin letters, digits and single hyphens, for example demo-club.',
    )
    expect(createVenueAction).not.toHaveBeenCalled()
  })

  it('is empty, and an error, when the name has no letters it can use', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.type(name(), '!!!')
    expect(slug().value).toBe('')
    await user.click(submit())
    expect(await screen.findByTestId('new-venue-slug-error')).toBeTruthy()
    expect(createVenueAction).not.toHaveBeenCalled()
  })
})

describe('step 2, by hand: the form', () => {
  it('needs a name', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.click(submit())
    expect((await screen.findAllByRole('alert')).map((node) => node.textContent)).toContain(
      'Enter a name.',
    )
    expect(createVenueAction).not.toHaveBeenCalled()
  })

  it('shows the time zone and the currency as one read-only line, and asks for neither', async () => {
    const { user } = dialog()
    await byHand(user)
    expect(screen.getByTestId('new-venue-defaults').textContent).toBe(
      'Time zone: Europe/Sofia · Currency: EUR',
    )
    expect(screen.queryByLabelText(/time zone/i)).toBeNull()
  })

  it('starts with Bulgarian and English, Bulgarian as the main language', async () => {
    const { user } = dialog()
    await byHand(user)
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('true')
    expect(language('English').getAttribute('aria-checked')).toBe('true')
    expect(language('German').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('new-venue-default-language').textContent).toBe('Bulgarian')
  })

  it('offers every language core knows, not a hard-coded pair', async () => {
    const { user } = dialog()
    await byHand(user)
    expect(screen.getAllByRole('checkbox')).toHaveLength(11)
  })

  it('moves the main language to a chosen one when its own language is taken away', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.click(language('Bulgarian'))
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('new-venue-default-language').textContent).toBe('English')
  })

  it('limits the main-language choice to the chosen languages', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.click(language('German'))
    await user.click(screen.getByTestId('new-venue-default-language'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Bulgarian', 'English', 'German'])
  })

  it('keeps at least one language: the last one cannot be unchecked', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.click(language('English'))
    expect((language('Bulgarian') as HTMLButtonElement).disabled).toBe(true)
    await user.click(language('Bulgarian'))
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('true')
  })

  it('goes back to step 1 with By hand still chosen', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(((await screen.findByTestId('new-venue-source-hand')) as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it('is in Bulgarian when the interface is', async () => {
    const { user } = dialog('bg')
    await byHand(user)
    expect(screen.getByText('Име в адреса')).toBeTruthy()
    expect(screen.getByTestId('new-venue-slug-help').textContent).toBe(
      'Частта на заведението в уеб адреса на менюто. Никое друго ваше заведение не може да я ползва.',
    )
    expect(screen.getByTestId('new-venue-defaults').textContent).toBe(
      'Часова зона: Europe/Sofia · Валута: EUR',
    )
  })
})

describe('creating by hand', () => {
  async function fill(user: User) {
    await byHand(user)
    await user.type(name(), '  Sea Bar ')
    await user.click(submit())
  }

  it('sends the source, the trimmed name, the address and the languages, then opens the venue', async () => {
    const { user, onCreated, onOpenChange } = dialog()
    await fill(user)
    await waitFor(() =>
      expect(createVenueAction).toHaveBeenCalledWith({
        source: { kind: 'hand' },
        name: 'Sea Bar',
        slug: 'sea-bar',
        languages: { main: 'bg_BG', enabled: ['bg_BG', 'en_US'] },
      }),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('vn_abcdefghijklmnopqrstuv'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sends the chosen languages in the order core lists them', async () => {
    const { user } = dialog()
    await byHand(user)
    await user.type(name(), 'Sea Bar')
    await user.click(language('German'))
    await user.click(language('Bulgarian'))
    await user.click(submit())
    await waitFor(() =>
      expect(createVenueAction).toHaveBeenCalledWith(
        expect.objectContaining({ languages: { main: 'en_US', enabled: ['en_US', 'de_DE'] } }),
      ),
    )
  })

  it('says that the address is taken', async () => {
    vi.mocked(createVenueAction).mockResolvedValue({ ok: false, error: 'taken' })
    const { user } = dialog()
    await fill(user)
    expect((await screen.findByTestId('new-venue-error')).textContent).toBe(
      'Another venue of yours already has this address. Choose another one.',
    )
  })

  it('says what went wrong for the other refusals', async () => {
    for (const [error, text] of [
      ['not_allowed', 'Only an owner or admin can create a venue.'],
      ['invalid', 'Check the name, the address and the languages, then try again.'],
      ['failed', 'Something went wrong. The venue was not created, try again.'],
    ] as const) {
      vi.mocked(createVenueAction).mockResolvedValue({ ok: false, error })
      const { user } = dialog()
      await fill(user)
      expect((await screen.findByTestId('new-venue-error')).textContent, error).toBe(text)
      cleanup()
    }
  })

  it('treats a server action that throws as a failure', async () => {
    vi.mocked(createVenueAction).mockRejectedValue(new Error('network'))
    const { user, onCreated } = dialog()
    await fill(user)
    expect((await screen.findByTestId('new-venue-error')).textContent).toContain(
      'Something went wrong',
    )
    expect(onCreated).not.toHaveBeenCalled()
  })
})
