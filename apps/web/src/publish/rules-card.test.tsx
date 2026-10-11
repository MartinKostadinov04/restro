// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { RulesCard } from './rules-card'
import { VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ savePublishRulesAction: vi.fn() }))
vi.mock('@/server/publish/actions', () => actions)

beforeEach(() => {
  actions.savePublishRulesAction.mockReset()
})

const own = { afterSync: 'auto', newItems: 'show', inherited: false } as const

describe('the venue’s publishing rules', () => {
  it('shows the two rules with a line of help each, as saved', () => {
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish rules={own} />)
    expect(screen.getByRole('radio', { name: /Publish automatically/ })).toHaveProperty(
      'checked',
      true,
    )
    expect(screen.getByRole('radio', { name: /Show them on the menu/ })).toHaveProperty(
      'checked',
      true,
    )
    for (const help of [
      'Guests see changes from barsy within about a minute.',
      'Changes from barsy wait until you publish them here.',
      'A new item is on the menu with the next publish.',
      'New items stay hidden in the composer until you show them.',
    ]) {
      expect(screen.getByText(help), help).toBeTruthy()
    }
    expect(screen.queryByTestId('rules-inherited')).toBeNull()
  })

  it('saves nothing until something changes, then sends both rules', async () => {
    const user = userEvent.setup()
    actions.savePublishRulesAction.mockResolvedValue({ ok: true, queued: true })
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish rules={own} />)
    const save = screen.getByRole('button', { name: 'Save rules' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(screen.getByRole('radio', { name: /Keep them hidden until I review them/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)

    expect(actions.savePublishRulesAction).toHaveBeenCalledWith(VENUE_ID, {
      afterSync: 'manual',
      newItems: 'hold',
    })
    expect(
      await screen.findByText('Saved. The rules apply from the next sync of this venue.'),
    ).toBeTruthy()
  })

  it('a venue that follows the connection’s old setting says so, and can save it as its own', async () => {
    const user = userEvent.setup()
    actions.savePublishRulesAction.mockResolvedValue({ ok: true, queued: true })
    renderWithIntl(
      <RulesCard
        venueId={VENUE_ID}
        canPublish
        rules={{ afterSync: 'manual', newItems: 'hold', inherited: true }}
      />,
    )
    expect(screen.getByTestId('rules-inherited').textContent).toContain(
      'before the rules moved to the venue',
    )
    expect(screen.getByRole('radio', { name: /Wait until I press Publish/ })).toHaveProperty(
      'checked',
      true,
    )
    // Nothing was changed, but saving makes the rules the venue's own.
    const save = screen.getByRole('button', { name: 'Save rules' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await user.click(save)
    expect(actions.savePublishRulesAction).toHaveBeenCalledWith(VENUE_ID, {
      afterSync: 'manual',
      newItems: 'hold',
    })
  })

  it('shows why a save was refused', async () => {
    const user = userEvent.setup()
    actions.savePublishRulesAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish rules={own} />)
    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(screen.getByRole('button', { name: 'Save rules' }))
    expect((await screen.findByTestId('rules-error')).textContent).toBe(
      'Only an owner or admin can do that.',
    )
    expect(screen.queryByTestId('rules-saved')).toBeNull()
  })

  it('takes the "saved" notice away at the next change', async () => {
    const user = userEvent.setup()
    actions.savePublishRulesAction.mockResolvedValue({ ok: true, queued: true })
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish rules={own} />)
    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(screen.getByRole('button', { name: 'Save rules' }))
    expect(await screen.findByTestId('rules-saved')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /Publish automatically/ }))
    expect(screen.queryByTestId('rules-saved')).toBeNull()
  })

  it('is read-only for someone who may not publish', () => {
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish={false} rules={own} />)
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull()
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
    }
    expect(screen.getByRole('radio', { name: /Publish automatically/ })).toHaveProperty(
      'checked',
      true,
    )
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<RulesCard venueId={VENUE_ID} canPublish rules={own} />, { locale: 'bg' })
    expect(screen.getByRole('radio', { name: /Публикувай автоматично/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Дръж ги скрити, докато ги прегледам/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Запази правилата' })).toBeTruthy()
  })
})
