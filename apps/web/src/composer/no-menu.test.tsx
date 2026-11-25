// @vitest-environment jsdom
// A venue with no menu yet: "Create the menu", and the refusals said in words, with the POS named
// where the refusal names it (`{source}`, D82). The server action and the toast are mocked.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { NoMenu } from './no-menu'

const actions = vi.hoisted(() => ({ createMenuAction: vi.fn() }))
vi.mock('@/server/menus-actions', () => actions)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VENUE = 'vn_demoVenueForNoMenuTests'

beforeEach(() => {
  actions.createMenuAction.mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('a venue with no menu yet', () => {
  it('names the POS when the menus come from it', async () => {
    actions.createMenuAction.mockResolvedValue({ ok: false, error: 'till_venue' })
    const user = userEvent.setup()
    renderWithIntl(<NoMenu venueId={VENUE} canCreate source="test POS" />)
    await user.click(screen.getByTestId('create-menu'))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This venue’s menus come from test POS: they cannot be added, deleted or imported here.',
      ),
    )
    expect(actions.createMenuAction).toHaveBeenCalledWith({ venueId: VENUE })
  })

  it('says the menu was not made when the action throws', async () => {
    actions.createMenuAction.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    renderWithIntl(<NoMenu venueId={VENUE} canCreate source="" />)
    await user.click(screen.getByTestId('create-menu'))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Restro couldn't save this. Nothing changed; try again.",
      ),
    )
  })

  it('offers nothing to press to someone who cannot create it', () => {
    renderWithIntl(<NoMenu venueId={VENUE} canCreate={false} source="" />)
    expect(screen.queryByTestId('create-menu')).toBeNull()
  })
})
