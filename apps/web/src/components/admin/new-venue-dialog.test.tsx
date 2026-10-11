// @vitest-environment jsdom
// The New venue dialog (CF-01, D68): the address follows the name until it is edited, the line that
// explains it, the validation, the languages, and what happens with the server's answers.
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVenueAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { NewVenueDialog } from './new-venue-dialog'

vi.mock('@/server/venues-actions', () => ({ createVenueAction: vi.fn() }))
// The button needs the router; the dialog itself does not.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function dialog(locale?: 'bg') {
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  renderWithIntl(
    <NewVenueDialog open onOpenChange={onOpenChange} onCreated={onCreated} />,
    locale ? { locale } : {},
  )
  return { onOpenChange, onCreated, user: userEvent.setup({ delay: null }) }
}

const name = () => screen.getByTestId('new-venue-name') as HTMLInputElement
const slug = () => screen.getByTestId('new-venue-slug') as HTMLInputElement
const submit = () => screen.getByTestId('new-venue-submit')
const language = (label: string) => screen.getByRole('checkbox', { name: label })

beforeEach(() => {
  vi.mocked(createVenueAction).mockReset()
  vi.mocked(createVenueAction).mockResolvedValue({ ok: true, venueId: 'vn_abcdefghijklmnopqrstuv' })
})

describe('the public address', () => {
  it('is suggested from the name as it is typed, Bulgarian letters turned into Latin', async () => {
    const { user } = dialog()
    await user.type(name(), 'Демо Клуб Sofia')
    expect(slug().value).toBe('demo-klub-sofia')
  })

  it('explains that it is the readable part of the web address, with a code added to it', async () => {
    const { user } = dialog()
    await user.type(name(), 'Sea Bar')
    const line = screen.getByTestId('new-venue-address')
    expect(line.textContent).toBe(
      'The readable part of the menu’s web address. A short unique code is added to it automatically.',
    )
    // No full example address (the code is not known yet), and no promise that it is fixed.
    expect(line.textContent).not.toMatch(/http|\/m\//)
    expect(line.textContent).not.toMatch(/can.t be changed/i)
    expect(slug().value).toBe('sea-bar')
  })

  it('stops following the name once the person edits it', async () => {
    const { user } = dialog()
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
    await user.type(name(), '!!!')
    expect(slug().value).toBe('')
    await user.click(submit())
    expect(await screen.findByTestId('new-venue-slug-error')).toBeTruthy()
    expect(createVenueAction).not.toHaveBeenCalled()
  })
})

describe('the form', () => {
  it('needs a name', async () => {
    const { user } = dialog()
    await user.click(submit())
    expect((await screen.findAllByRole('alert')).map((node) => node.textContent)).toContain(
      'Enter a name.',
    )
    expect(createVenueAction).not.toHaveBeenCalled()
  })

  it('shows the time zone and the currency as one read-only line, and asks for neither', () => {
    dialog()
    expect(screen.getByTestId('new-venue-defaults').textContent).toBe(
      'Time zone: Europe/Sofia · Currency: EUR',
    )
    expect(screen.queryByLabelText(/time zone/i)).toBeNull()
  })

  it('starts with Bulgarian and English, Bulgarian as the main language', () => {
    dialog()
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('true')
    expect(language('English').getAttribute('aria-checked')).toBe('true')
    expect(language('German').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('new-venue-default-language').textContent).toBe('Bulgarian')
  })

  it('offers every language core knows, not a hard-coded pair', () => {
    dialog()
    expect(screen.getAllByRole('checkbox')).toHaveLength(11)
  })

  it('moves the main language to a chosen one when its own language is taken away', async () => {
    const { user } = dialog()
    await user.click(language('Bulgarian'))
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('new-venue-default-language').textContent).toBe('English')
  })

  it('limits the main-language choice to the chosen languages', async () => {
    const { user } = dialog()
    await user.click(language('German'))
    await user.click(screen.getByTestId('new-venue-default-language'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Bulgarian', 'English', 'German'])
  })

  it('keeps at least one language: the last one cannot be unchecked', async () => {
    const { user } = dialog()
    await user.click(language('English'))
    expect((language('Bulgarian') as HTMLButtonElement).disabled).toBe(true)
    await user.click(language('Bulgarian'))
    expect(language('Bulgarian').getAttribute('aria-checked')).toBe('true')
  })

  it('is in Bulgarian when the interface is', () => {
    dialog('bg')
    expect(screen.getByText('Публичен адрес')).toBeTruthy()
    expect(screen.getByTestId('new-venue-address').textContent).toBe(
      'Четимата част от уеб адреса на менюто. Към нея автоматично се добавя кратък уникален код.',
    )
    expect(screen.getByTestId('new-venue-defaults').textContent).toBe(
      'Часова зона: Europe/Sofia · Валута: EUR',
    )
  })
})

describe('creating', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(name(), '  Sea Bar ')
    await user.click(submit())
  }

  it('sends the trimmed name, the address, the languages and the main language, then opens the venue', async () => {
    const { user, onCreated, onOpenChange } = dialog()
    await fill(user)
    await waitFor(() =>
      expect(createVenueAction).toHaveBeenCalledWith({
        name: 'Sea Bar',
        slug: 'sea-bar',
        defaultLocale: 'bg_BG',
        enabledLocales: ['bg_BG', 'en_US'],
      }),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('vn_abcdefghijklmnopqrstuv'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sends the chosen languages in the order core lists them', async () => {
    const { user } = dialog()
    await user.click(language('German'))
    await user.click(language('Bulgarian'))
    await fill(user)
    await waitFor(() =>
      expect(createVenueAction).toHaveBeenCalledWith(
        expect.objectContaining({ defaultLocale: 'en_US', enabledLocales: ['en_US', 'de_DE'] }),
      ),
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
