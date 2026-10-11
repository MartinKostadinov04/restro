// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { ConnectCard } from './connect-card'
import { emptyView, integrationView } from './test-view'

const actions = vi.hoisted(() => ({ saveConnectionAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

const PASSWORD = 'p4ssw0rd-never-shown-again'

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  host = 'https://club.barsyonline.com',
) {
  await user.clear(screen.getByLabelText('barsy address'))
  await user.type(screen.getByLabelText('barsy address'), host)
  await user.type(screen.getByLabelText('API user'), 'api-user')
  await user.type(screen.getByLabelText('Password'), PASSWORD)
}

beforeEach(() => {
  actions.saveConnectionAction.mockReset()
})

describe('the Connection card', () => {
  it('asks for the address, the API user and the password', () => {
    renderWithIntl(<ConnectCard view={emptyView()} />)
    expect(screen.getByLabelText('barsy address')).toBeTruthy()
    expect(screen.getByLabelText('API user')).toBeTruthy()
    const password = screen.getByLabelText('Password') as HTMLInputElement
    expect(password.type).toBe('password')
    expect(password.autocomplete).toBe('new-password')
    expect(screen.getByRole('button', { name: 'Save and check' })).toHaveProperty('disabled', true)
  })

  it('sends the three values once, empties the password at once, and shows "Credentials saved"', async () => {
    const user = userEvent.setup()
    let finish: (value: unknown) => void = () => undefined
    actions.saveConnectionAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderWithIntl(<ConnectCard view={emptyView()} />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Save and check' }))

    expect(actions.saveConnectionAction).toHaveBeenCalledTimes(1)
    expect(actions.saveConnectionAction).toHaveBeenCalledWith({
      host: 'https://club.barsyonline.com',
      user: 'api-user',
      password: PASSWORD,
    })
    // While the answer is on its way the password is already gone from the form.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')

    finish({ ok: true, queued: true })
    await waitFor(() => expect(screen.getByTestId('credentials-saved')).toBeTruthy())
    expect(screen.getByText('Credentials saved')).toBeTruthy()
    expect(screen.getByText('The connection check is queued.')).toBeTruthy()
    // The password is nowhere in the page.
    expect(document.body.innerHTML).not.toContain(PASSWORD)
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('says when the credentials were saved but the check could not be queued', async () => {
    const user = userEvent.setup()
    actions.saveConnectionAction.mockResolvedValue({ ok: true, queued: false })
    renderWithIntl(<ConnectCard view={emptyView()} />)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    expect(await screen.findByText(/could not be queued/)).toBeTruthy()
  })

  it('shows the reason an address or a save was refused, and keeps the form', async () => {
    const user = userEvent.setup()
    actions.saveConnectionAction.mockResolvedValue({ ok: false, error: 'invalid_host' })
    renderWithIntl(<ConnectCard view={emptyView()} />)
    await fill(user, 'http://club.barsyonline.com')
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('https address')
    expect(screen.getByLabelText('API user')).toBeTruthy()
    // The password was cleared even though the save failed.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('says why a new address was refused while the connection holds a menu (host_change_blocked)', async () => {
    const user = userEvent.setup()
    actions.saveConnectionAction.mockResolvedValue({ ok: false, error: 'host_change_blocked' })
    renderWithIntl(<ConnectCard view={integrationView()} />)
    await user.click(screen.getByRole('button', { name: 'Change credentials' }))
    await fill(user, 'https://other.barsyonline.com')
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'This connection already holds a menu from another barsy installation. Changing the address would mix the two menus.',
    )
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('shows saved credentials as a fact, with a way to change them that asks for both again', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ConnectCard view={integrationView()} />)
    expect(screen.getByText('Credentials saved')).toBeTruthy()
    expect(screen.getByText('Address: demo.barsyonline.com')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Change credentials' }))
    expect((screen.getByLabelText('barsy address') as HTMLInputElement).value).toBe(
      'demo.barsyonline.com',
    )
    expect((screen.getByLabelText('API user') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/Enter the API user and the password again/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Credentials saved')).toBeTruthy()
  })

  it('explains that the operator has to set up the sync keys, without a form', () => {
    renderWithIntl(<ConnectCard view={emptyView({ sealReady: false })} />)
    const note = screen.getByTestId('seal-keys-missing')
    expect(note.textContent).toContain('The sync keys are not set up')
    expect(note.textContent).toContain('operator')
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save and check' })).toBeNull()
    expect(note.textContent).not.toMatch(/SEAL_|stack|Error:/)
  })

  it('is read-only for someone who cannot manage', () => {
    renderWithIntl(<ConnectCard view={integrationView({ canManage: false })} />)
    expect(screen.getByText('Credentials saved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change credentials' })).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()

    renderWithIntl(<ConnectCard view={emptyView({ canManage: false })} />)
    expect(screen.getByText('No credentials yet.')).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<ConnectCard view={integrationView()} />, { locale: 'bg' })
    expect(screen.getByText('Данните за достъп са запазени')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Смени данните за достъп' })).toBeTruthy()
  })
})
