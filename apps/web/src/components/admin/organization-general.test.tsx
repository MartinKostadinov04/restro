// @vitest-environment jsdom
// Settings › General (S3, D84, D91): the organisation's name and address name. An owner gets a
// field with Save for each; anyone else sees the values as text. The preview of the address, the
// shape check while typed, the suggestion from the name, and what happens with the server's
// answers (the rules are the action's, tested in server/organization-actions.test.ts).
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateOrganizationAction } from '@/server/organization-actions'
import { renderWithIntl } from '@/test-utils'

import { OrganizationGeneral } from './organization-general'

vi.mock('@/server/organization-actions', () => ({ updateOrganizationAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

function general(
  overrides: Partial<Parameters<typeof OrganizationGeneral>[0]> = {},
  locale?: 'bg',
) {
  renderWithIntl(
    <OrganizationGeneral name="Нощна група" slug="night-group" canEdit {...overrides} />,
    locale ? { locale } : {},
  )
  return userEvent.setup({ delay: null })
}

const nameInput = () => screen.getByTestId('general-name-input') as HTMLInputElement
const nameSave = () => screen.getByTestId('general-name-save') as HTMLButtonElement
const slugInput = () => screen.getByTestId('general-slug-input') as HTMLInputElement
const slugSave = () => screen.getByTestId('general-slug-save') as HTMLButtonElement
const preview = () => screen.getByTestId('general-slug-preview').textContent

beforeEach(() => {
  vi.mocked(updateOrganizationAction).mockReset()
  toasts.success.mockReset()
  toasts.warning.mockReset()
})

describe('Settings › General for an owner', () => {
  it('renders every message of the page in both languages without a formatting error', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      for (const locale of [undefined, 'bg'] as const) {
        general({}, locale)
        expect(screen.getByText(/after \/m\/|след \/m\//)).toBeTruthy()
        cleanup()
      }
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('shows the name and the address name in a field each, with a Save that waits for a change', () => {
    general()
    expect(nameInput().value).toBe('Нощна група')
    expect(slugInput().value).toBe('night-group')
    expect(nameSave().disabled).toBe(true)
    expect(slugSave().disabled).toBe(true)
    expect(screen.queryByTestId('general-read-only')).toBeNull()
  })

  it('previews the whole address, follows what is typed, and says the old address keeps working', async () => {
    const user = general()
    expect(preview()).toBe('/m/night-group/your-venue')
    expect(screen.getByTestId('general-slug-keep').textContent).toContain(
      'The old address keeps working',
    )
    await user.clear(slugInput())
    await user.type(slugInput(), 'day-group')
    expect(preview()).toBe('/m/day-group/your-venue')
  })

  it('checks the shape of the address name as it is typed: lower-case, spaces become hyphens, nothing else', async () => {
    const user = general()
    await user.clear(slugInput())
    await user.type(slugInput(), 'My Own')
    expect(slugInput().value).toBe('my-own')
    expect(slugSave().disabled).toBe(false)
    expect(screen.queryByTestId('general-slug-invalid')).toBeNull()

    await user.clear(slugInput())
    await user.type(slugInput(), 'Not_a_slug!')
    expect(await screen.findByTestId('general-slug-invalid')).toBeTruthy()
    expect(slugSave().disabled).toBe(true)
    // The preview does not show an address nobody could use.
    expect(preview()).toBe('/m/night-group/your-venue')

    await user.clear(slugInput())
    expect(screen.getByTestId('general-slug-invalid')).toBeTruthy()
    expect(slugSave().disabled).toBe(true)
    expect(updateOrganizationAction).not.toHaveBeenCalled()
  })

  it('suggests an address name from the typed name, in Latin letters', async () => {
    const user = general()
    const suggest = screen.getByTestId('general-slug-suggest') as HTMLButtonElement
    // "Нощна група" is transliterated.
    expect(suggest.disabled).toBe(false)
    await user.click(suggest)
    expect(slugInput().value).toBe('noshtna-grupa')
    expect(slugSave().disabled).toBe(false)
    expect(suggest.disabled).toBe(true)

    await user.clear(nameInput())
    await user.type(nameInput(), 'Day Group')
    expect(suggest.disabled).toBe(false)
    await user.click(suggest)
    expect(slugInput().value).toBe('day-group')
  })

  it('refuses an empty or blank name before anything is sent', async () => {
    const user = general()
    await user.clear(nameInput())
    expect(await screen.findByTestId('general-name-invalid')).toBeTruthy()
    expect(nameSave().disabled).toBe(true)
    await user.type(nameInput(), '   ')
    expect(nameSave().disabled).toBe(true)
    expect(updateOrganizationAction).not.toHaveBeenCalled()
  })

  it('saves the name alone, trimmed, and says so', async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({
      ok: true,
      name: 'Day Group',
      slug: 'night-group',
      filesQueued: true,
    })
    const user = general()
    await user.clear(nameInput())
    await user.type(nameInput(), '  Day Group  ')
    await user.click(nameSave())

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Name saved.'))
    expect(updateOrganizationAction).toHaveBeenCalledWith({ name: 'Day Group' })
    expect(nameInput().value).toBe('Day Group')
    // Saved: nothing left to save; the address name was not touched.
    expect(nameSave().disabled).toBe(true)
    expect(slugInput().value).toBe('night-group')
  })

  it('saves the address name alone, and shows the new address', async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({
      ok: true,
      name: 'Нощна група',
      slug: 'day-group',
      filesQueued: true,
    })
    const user = general()
    await user.clear(slugInput())
    await user.type(slugInput(), 'day-group')
    await user.click(slugSave())

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1))
    expect(updateOrganizationAction).toHaveBeenCalledWith({ slug: 'day-group' })
    expect(String(toasts.success.mock.calls[0]?.[0])).toContain(
      'Guests who open the old address are taken to the new one',
    )
    expect(toasts.warning).not.toHaveBeenCalled()
    expect(preview()).toBe('/m/day-group/your-venue')
    expect(slugSave().disabled).toBe(true)
    expect(nameInput().value).toBe('Нощна група')
  })

  it('warns when the saved address name could not be carried to the guest files yet', async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({
      ok: true,
      name: 'Нощна група',
      slug: 'day-group',
      filesQueued: false,
    })
    const user = general()
    await user.clear(slugInput())
    await user.type(slugInput(), 'day-group')
    await user.click(slugSave())

    await waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1))
    expect(String(toasts.warning.mock.calls[0]?.[0])).toContain('publish a menu')
    expect(toasts.success).not.toHaveBeenCalled()
    // It is saved all the same.
    expect(preview()).toBe('/m/day-group/your-venue')
  })

  it('says what went wrong for each refusal of the address name, and keeps what was typed', async () => {
    for (const [error, text] of [
      ['not_allowed', "Only an owner can change the organisation's name or address name."],
      ['invalid', 'This cannot be used. Check it and try again.'],
      [
        'taken',
        'Another organisation has this address name, or had it before. Choose another one.',
      ],
      ['failed', 'Something went wrong. Nothing was changed, try again.'],
    ] as const) {
      vi.mocked(updateOrganizationAction).mockResolvedValue({ ok: false, error })
      const user = general()
      await user.clear(slugInput())
      await user.type(slugInput(), 'day-group')
      await user.click(slugSave())
      expect((await screen.findByTestId('general-slug-error')).textContent, error).toBe(text)
      expect(slugInput().value).toBe('day-group')
      // The address shown is still the saved one's; typing clears the message.
      await user.type(slugInput(), '2')
      expect(screen.queryByTestId('general-slug-error')).toBeNull()
      cleanup()
    }
  })

  it('says what went wrong when the name is refused', async () => {
    vi.mocked(updateOrganizationAction).mockResolvedValue({ ok: false, error: 'not_allowed' })
    const user = general()
    await user.type(nameInput(), '2')
    await user.click(nameSave())
    expect((await screen.findByTestId('general-name-error')).textContent).toContain('Only an owner')
    expect(toasts.success).not.toHaveBeenCalled()
    // The other field has no message of its own.
    expect(screen.queryByTestId('general-slug-error')).toBeNull()
  })

  it('treats a failing call like a failed save', async () => {
    vi.mocked(updateOrganizationAction).mockRejectedValue(new Error('network'))
    const user = general()
    await user.clear(slugInput())
    await user.type(slugInput(), 'day-group')
    await user.click(slugSave())
    expect((await screen.findByTestId('general-slug-error')).textContent).toBe(
      'Something went wrong. Nothing was changed, try again.',
    )
  })
})

describe('Settings › General for an admin or a member', () => {
  it('shows the name and the address name as text, with no field and no Save', () => {
    general({ canEdit: false })
    expect(screen.getByTestId('general-name-text').textContent).toBe('Нощна група')
    expect(screen.getByTestId('general-slug-text').textContent).toBe('night-group')
    expect(preview()).toBe('/m/night-group/your-venue')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByTestId('general-name-save')).toBeNull()
    expect(screen.queryByTestId('general-slug-save')).toBeNull()
    expect(screen.queryByTestId('general-slug-suggest')).toBeNull()
    expect(
      within(screen.getByTestId('general-name-form')).getByText('Only an owner can change this.'),
    ).toBeTruthy()
    expect(updateOrganizationAction).not.toHaveBeenCalled()
  })
})

describe('Settings › General in Bulgarian', () => {
  it('is in Bulgarian when the interface is', () => {
    general({}, 'bg')
    expect(screen.getByLabelText('Име')).toBe(nameInput())
    expect(screen.getByLabelText('Име в адреса')).toBe(slugInput())
    expect(nameSave().textContent).toBe('Запиши името')
    expect(slugSave().textContent).toBe('Запиши името в адреса')
  })
})
