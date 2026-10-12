// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { AddInstanceCard } from './add-instance-card'

const actions = vi.hoisted(() => ({ addInstanceAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

const PASSWORD = 'p4ssw0rd-never-shown-again'
const SYSTEM = { kind: 'barsy', label: 'barsy', instances: 0 }

beforeEach(() => {
  actions.addInstanceAction.mockReset()
})

async function fill(user: ReturnType<typeof userEvent.setup>, name = '') {
  if (name !== '') await user.type(screen.getByLabelText('Name'), name)
  await user.type(screen.getByLabelText('barsy address'), 'https://club.barsyonline.com')
  await user.type(screen.getByLabelText('API user'), 'api-user')
  await user.type(screen.getByLabelText('Password'), PASSWORD)
}

describe('"Add barsy"', () => {
  it('asks for a name, the address, the API user and the password', () => {
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady />)
    expect(screen.getByRole('heading', { name: 'Add barsy' })).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('barsy address')).toBeTruthy()
    expect(screen.getByLabelText('API user')).toBeTruthy()
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password')
    expect(screen.getByRole('button', { name: 'Save and check' })).toHaveProperty('disabled', true)
  })

  it('sends the system with the values once, empties the password at once, and closes when saved', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let finish: (value: unknown) => void = () => undefined
    actions.addInstanceAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady onClose={onClose} />)

    await fill(user, 'barsy – Sofia')
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    expect(actions.addInstanceAction).toHaveBeenCalledTimes(1)
    expect(actions.addInstanceAction).toHaveBeenCalledWith({
      kind: 'barsy',
      name: 'barsy – Sofia',
      host: 'https://club.barsyonline.com',
      user: 'api-user',
      password: PASSWORD,
    })
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')

    finish({ ok: true, integrationId: 'in_new', queued: true })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('may leave the name empty (the default is the system and the address)', async () => {
    const user = userEvent.setup()
    actions.addInstanceAction.mockResolvedValue({ ok: true })
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady />)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    expect(actions.addInstanceAction).toHaveBeenCalledWith(expect.objectContaining({ name: '' }))
  })

  it.each([
    ['host_in_use', 'Another barsy connection of this organisation already uses that address.'],
    [
      'invalid_host',
      'Enter the https address of the barsy installation, without a port or a path.',
    ],
    ['system_not_chosen', 'Choose barsy in the systems above first.'],
  ] as const)('keeps the form and says why when it is refused (%s)', async (error, text) => {
    const user = userEvent.setup()
    actions.addInstanceAction.mockResolvedValue({ ok: false, error })
    const onClose = vi.fn()
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady onClose={onClose} />)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Save and check' }))
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(onClose).not.toHaveBeenCalled()
    // The password was cleared even though the save failed.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('cancel closes it and sends nothing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(actions.addInstanceAction).not.toHaveBeenCalled()
  })

  it('explains that the operator has to set up the sync keys, without a form', () => {
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady={false} />)
    expect(screen.getByTestId('seal-keys-missing').textContent).toContain('operator')
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('names the system by the label it is given', () => {
    renderWithIntl(
      <AddInstanceCard system={{ kind: 'barsy', label: 'Another POS', instances: 0 }} sealReady />,
    )
    expect(screen.getByRole('heading', { name: 'Add Another POS' })).toBeTruthy()
    expect(screen.getByLabelText('Another POS address')).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<AddInstanceCard system={SYSTEM} sealReady />, { locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Добави barsy' })).toBeTruthy()
    expect(screen.getByLabelText('Адрес на barsy')).toBeTruthy()
  })
})
