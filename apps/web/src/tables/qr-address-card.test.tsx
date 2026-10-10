// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveQrSettingsAction } from '@/server/tables/actions'
import { renderWithIntl } from '@/test-utils'

import { QrAddressCard } from './qr-address-card'
import { TOKEN_A, VENUE_ID, view } from './test-view'

vi.mock('@/server/tables/actions', () => ({ saveQrSettingsAction: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const save = () => screen.getByRole('button', { name: 'Save address' }) as HTMLButtonElement

beforeEach(() => {
  vi.mocked(saveQrSettingsAction).mockReset()
  vi.mocked(saveQrSettingsAction).mockResolvedValue({ ok: true, queued: true })
})

describe('the address card, "our link"', () => {
  it('starts on the saved mode with the default base address and a preview from a real table', () => {
    renderWithIntl(<QrAddressCard view={view()} />)
    expect((screen.getByTestId('mode-ours') as HTMLInputElement).checked).toBe(true)
    const base = screen.getByTestId('base-url') as HTMLInputElement
    expect(base.value).toBe('')
    expect(base.placeholder).toBe('http://localhost:3000')
    expect(screen.getByText('Using the default address of this installation.')).toBeTruthy()
    expect(screen.getByText('Address in the code of table 2')).toBeTruthy()
    expect(screen.getByTestId('qr-preview').textContent).toBe(`http://localhost:3000/t/${TOKEN_A}`)
    expect(save().disabled).toBe(true)
  })

  it('previews the typed base address and saves it, leaving the own pattern as it was', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<QrAddressCard view={view()} />)
    await user.type(screen.getByTestId('base-url'), 'http://192.168.1.20:3000/')
    expect(screen.getByTestId('qr-preview').textContent).toBe(
      `http://192.168.1.20:3000/t/${TOKEN_A}`,
    )
    expect(screen.getByTestId('address-unsaved')).toBeTruthy()
    await user.click(save())
    await waitFor(() =>
      expect(saveQrSettingsAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        mode: 'ours',
        baseUrl: 'http://192.168.1.20:3000/',
        ownPattern: null,
      }),
    )
  })

  it('names what is wrong with a base address while it is typed, and keeps Save off', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<QrAddressCard view={view()} />)
    await user.type(screen.getByTestId('base-url'), 'club.bg')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This is not an address. Start it with https://',
    )
    expect(save().disabled).toBe(true)
    await user.clear(screen.getByTestId('base-url'))
    await user.type(screen.getByTestId('base-url'), 'http://club.bg')
    expect((await screen.findByRole('alert')).textContent).toContain('Plain http://')
    expect(save().disabled).toBe(true)
  })

  it('goes back to the default with one click', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(
      <QrAddressCard
        view={view({
          qr: {
            mode: 'ours',
            baseUrl: 'http://192.168.1.20:3000',
            baseIsDefault: false,
            defaultBaseUrl: 'http://localhost:3000',
            ownPattern: null,
          },
        })}
      />,
    )
    expect((screen.getByTestId('base-url') as HTMLInputElement).value).toBe(
      'http://192.168.1.20:3000',
    )
    await user.click(
      screen.getByRole('button', { name: 'Use the default (http://localhost:3000)' }),
    )
    expect((screen.getByTestId('base-url') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('qr-preview').textContent).toBe(`http://localhost:3000/t/${TOKEN_A}`)
  })

  it('asks for an address when the installation has no default', () => {
    renderWithIntl(
      <QrAddressCard
        view={view({
          qr: {
            mode: 'ours',
            baseUrl: null,
            baseIsDefault: true,
            defaultBaseUrl: null,
            ownPattern: null,
          },
        })}
      />,
    )
    expect(
      screen.getByText('This installation has no default address. Type the address of this app.'),
    ).toBeTruthy()
    expect(screen.getByTestId('qr-preview').textContent).toBe('—')
  })
})

describe('the address card, "the venue\'s own link"', () => {
  async function openOwn(user: ReturnType<typeof userEvent.setup>, v = view()) {
    renderWithIntl(<QrAddressCard view={v} />)
    await user.click(screen.getByTestId('mode-own'))
  }

  it('checks the pattern as it is typed with the same rules as the server', async () => {
    const user = userEvent.setup({ delay: null })
    await openOwn(user)
    const field = screen.getByTestId('own-pattern')
    expect(save().disabled).toBe(true)

    await user.type(field, 'https://menu.club.bg/t/')
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The pattern needs {token} where the table's code goes.",
    )
    expect(save().disabled).toBe(true)

    await user.clear(field)
    await user.type(field, 'http://menu.club.bg/t/{{token}')
    expect((await screen.findByRole('alert')).textContent).toContain('Plain http://')

    await user.clear(field)
    await user.type(field, 'https://menu.club.bg/t/{{Token}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only {token} can be written in curly brackets.',
    )
    expect(screen.getByTestId('qr-preview').textContent).toBe('—')
    expect(save().disabled).toBe(true)
  })

  it('previews the final address with a real table’s code and opens it in a new tab, fetching nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup({ delay: null })
    await openOwn(user)
    await user.type(screen.getByTestId('own-pattern'), 'https://menu.club.bg/t/{{token}')
    expect(screen.getByTestId('qr-preview').textContent).toBe(`https://menu.club.bg/t/${TOKEN_A}`)
    const link = screen.getByTestId('open-test-link') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(`https://menu.club.bg/t/${TOKEN_A}`)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('has no test link until a table has a code, and says why', async () => {
    const user = userEvent.setup({ delay: null })
    await openOwn(user, view({ sample: null, coded: 0 }))
    await user.type(screen.getByTestId('own-pattern'), 'https://menu.club.bg/t/{{token}')
    expect(screen.getByText('Example of an address (no table has a code yet)')).toBeTruthy()
    expect(screen.getByTestId('qr-preview').textContent).toBe(
      `https://menu.club.bg/t/${'x'.repeat(22)}`,
    )
    const button = screen.getByTestId('open-test-link') as HTMLButtonElement
    expect(button.tagName).toBe('BUTTON')
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Create a code for a table first, then test the link.')).toBeTruthy()
  })

  it('saves the pattern with the saved base address untouched', async () => {
    const user = userEvent.setup({ delay: null })
    await openOwn(user)
    await user.type(screen.getByTestId('own-pattern'), 'https://menu.club.bg/t/{{token}')
    await user.click(save())
    await waitFor(() =>
      expect(saveQrSettingsAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        mode: 'own',
        baseUrl: null,
        ownPattern: 'https://menu.club.bg/t/{token}',
      }),
    )
  })

  it('shows what the server refused under the field', async () => {
    vi.mocked(saveQrSettingsAction).mockResolvedValue({
      ok: false,
      error: 'invalid',
      field: 'ownPattern',
      problem: 'not_https',
    })
    const user = userEvent.setup({ delay: null })
    await openOwn(user)
    await user.type(screen.getByTestId('own-pattern'), 'https://menu.club.bg/t/{{token}')
    await user.click(save())
    expect((await screen.findByTestId('pattern-help')).textContent).toContain('Plain http://')
  })

  it('links to the guide, with the venue so that "back" returns to the tab', async () => {
    const user = userEvent.setup({ delay: null })
    await openOwn(user)
    const link = screen.getByTestId('guide-link')
    expect(link.textContent).toBe('How do I use my own link?')
    expect(link.getAttribute('href')).toBe(`/guides/qr-links?venue=${VENUE_ID}`)
  })

  it('reads in Bulgarian', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<QrAddressCard view={view()} />, { locale: 'bg' })
    await user.click(screen.getByTestId('mode-own'))
    expect(screen.getByText('Адрес в кодовете')).toBeTruthy()
    expect(screen.getByText('Шаблон на линка')).toBeTruthy()
    expect(screen.getByText('Как да използвам собствен линк?')).toBeTruthy()
  })
})

describe('a member who may not change the address', () => {
  it('sees the settings and the preview, but cannot edit or save', () => {
    renderWithIntl(<QrAddressCard view={view({ canManage: false })} />)
    expect((screen.getByTestId('base-url') as HTMLInputElement).disabled).toBe(true)
    // The radios sit in a disabled fieldset.
    expect(screen.getByTestId('mode-own').matches(':disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save address' })).toBeNull()
    expect(screen.getByTestId('qr-preview').textContent).toContain(TOKEN_A)
  })
})
