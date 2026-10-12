// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemOption } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'

import { SystemsPicker } from './systems-picker'

const actions = vi.hoisted(() => ({ saveSystemsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.saveSystemsAction.mockReset()
})

const SYSTEMS: SystemOption[] = [
  { kind: 'barsy', label: 'barsy', instances: 0 },
  { kind: 'other_pos', label: 'Other POS', instances: 2 },
]

const picker = (
  props: { systems?: SystemOption[]; chosen?: string[]; canManage?: boolean } = {},
  locale: 'en' | 'bg' = 'en',
) =>
  renderWithIntl(
    <SystemsPicker
      systems={props.systems ?? SYSTEMS}
      chosen={props.chosen ?? []}
      canManage={props.canManage ?? true}
    />,
    { locale },
  )

describe('the systems picker', () => {
  it('lists every system we support, with how many connections it has, and none chosen yet', () => {
    picker()
    const options = screen.getAllByTestId('system-option')
    expect(options.map((option) => option.getAttribute('data-kind'))).toEqual([
      'barsy',
      'other_pos',
    ])
    expect(within(options[0] as HTMLElement).getByTestId('system-instances').textContent).toBe(
      'no connections',
    )
    expect(within(options[1] as HTMLElement).getByTestId('system-instances').textContent).toBe(
      '2 connections',
    )
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-checked')).toBe('false')
    }
  })

  it('shows the chosen systems ticked, and saves only after a change', async () => {
    const user = userEvent.setup()
    actions.saveSystemsAction.mockResolvedValue({ ok: true })
    picker({ chosen: ['barsy'] })
    expect(screen.getByRole('checkbox', { name: /barsy/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    const save = screen.getByRole('button', { name: 'Save systems' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: /Other POS/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)
    // The systems in the picker's order, whatever the order of the clicks.
    expect(actions.saveSystemsAction).toHaveBeenCalledWith({ systems: ['barsy', 'other_pos'] })
    expect(await screen.findByText('Systems saved.')).toBeTruthy()
  })

  it('does not offer to save when a change is undone', async () => {
    const user = userEvent.setup()
    picker({ chosen: ['barsy'] })
    await user.click(screen.getByRole('checkbox', { name: /Other POS/ }))
    await user.click(screen.getByRole('checkbox', { name: /Other POS/ }))
    expect(
      (screen.getByRole('button', { name: 'Save systems' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('refuses, with a sentence that names it, to unselect a system that still has connections', async () => {
    const user = userEvent.setup()
    actions.saveSystemsAction.mockResolvedValue({ ok: false, error: 'has_instances' })
    picker({ chosen: ['barsy', 'other_pos'] })
    await user.click(screen.getByRole('checkbox', { name: /Other POS/ }))
    // Before saving, the hint says what the server will refuse.
    expect(screen.getByTestId('systems-blocking').textContent).toBe(
      'Other POS still has connections. Remove them before you unselect it.',
    )
    await user.click(screen.getByRole('button', { name: 'Save systems' }))
    expect(actions.saveSystemsAction).toHaveBeenCalledWith({ systems: ['barsy'] })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Other POS still has connections. Remove them before you unselect it.',
    )
    expect(screen.queryByText('Systems saved.')).toBeNull()
  })

  it('lets a system without connections be unselected without a hint', async () => {
    const user = userEvent.setup()
    actions.saveSystemsAction.mockResolvedValue({ ok: true })
    picker({ chosen: ['barsy'] })
    await user.click(screen.getByRole('checkbox', { name: /barsy/ }))
    expect(screen.queryByTestId('systems-blocking')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save systems' }))
    expect(actions.saveSystemsAction).toHaveBeenCalledWith({ systems: [] })
  })

  it('shows another refusal from the server', async () => {
    const user = userEvent.setup()
    actions.saveSystemsAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    picker()
    await user.click(screen.getByRole('checkbox', { name: /barsy/ }))
    await user.click(screen.getByRole('button', { name: 'Save systems' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only owners and admins can do this.',
    )
  })

  it('is read-only for someone who cannot manage', () => {
    picker({ chosen: ['barsy'], canManage: false })
    expect(screen.queryByRole('button', { name: 'Save systems' })).toBeNull()
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.matches(':disabled')).toBe(true)
    }
  })

  it('speaks Bulgarian', () => {
    picker({ chosen: ['barsy'] }, 'bg')
    expect(screen.getByRole('heading', { name: 'Системи' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Запази системите' })).toBeTruthy()
    expect(screen.getAllByTestId('system-instances')[1]?.textContent).toBe('2 връзки')
  })
})
