// @vitest-environment jsdom
// Tonight's section switch on a phone (S2): a section that draws no heading of its own (a failed
// read, no access, the skeleton) still gets the switch, so the phone is never stuck in it.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { FailedBlock, TabHeading } from './tab-parts'
import { TonightTabs } from './tonight-tabs'
import type { TonightViewName } from './tonight-views'

const url = vi.hoisted(() => ({ current: 'log' as string, select: vi.fn() }))

vi.mock('@/components/admin/workspace-tabs', () => ({
  useUrlTab: () => [url.current, url.select] as const,
}))

const VIEWS: readonly TonightViewName[] = ['actions', 'sent', 'log', 'night']

beforeEach(() => {
  url.select.mockReset()
})

describe('the section switch where a section has no heading', () => {
  it('stands on its own row above a failed Log, and choosing a section selects it', async () => {
    url.current = 'log'
    renderWithIntl(
      <TonightTabs
        views={VIEWS}
        contents={{ log: <FailedBlock text="The Log did not load." /> }}
      />,
    )
    expect(screen.getByText('The Log did not load.')).toBeTruthy()
    expect(screen.getByTestId('tonight-switch-row')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tonight-section-switch'))
    await user.click(await screen.findByRole('option', { name: 'Sent orders' }))
    expect(url.select).toHaveBeenCalledWith('sent')
  })

  it('takes the Log from a section that failed to load', async () => {
    url.current = 'actions'
    renderWithIntl(
      <TonightTabs views={VIEWS} contents={{ actions: <FailedBlock text="Nothing loaded." /> }} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tonight-section-switch'))
    await user.click(await screen.findByRole('option', { name: 'Log' }))
    expect(url.select).toHaveBeenCalledWith('log')
  })

  it('marks a section that draws its heading, so the row above it hides (by CSS)', () => {
    url.current = 'sent'
    renderWithIntl(<TonightTabs views={VIEWS} contents={{ sent: <TabHeading name="Sent" /> }} />)
    const panel = screen.getByRole('tabpanel')
    expect(panel.className).toContain('group/section')
    expect(panel.querySelector('[data-tonight-heading]')).not.toBeNull()
    expect(screen.getByTestId('tonight-switch-row').className).toContain(
      'group-has-[[data-tonight-heading]]/section:hidden',
    )
  })

  it('draws no switch at all where there is one section', () => {
    url.current = 'actions'
    renderWithIntl(
      <TonightTabs views={['actions']} contents={{ actions: <FailedBlock text="x" /> }} />,
    )
    expect(screen.queryByTestId('tonight-section-switch')).toBeNull()
    expect(screen.queryByTestId('tonight-switch-row')).toBeNull()
  })
})
