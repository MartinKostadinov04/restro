// @vitest-environment jsdom
// A linked group's outline on the plan (D160 §1, decision log 1.7; #540): one outline per cluster
// of the party's spots, the party's name on each, and two parties told apart by their names, not
// by colour (WCAG 1.4.1). The geometry is `outline-geometry.test.ts`'s.
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RvPlanView, RvSpotView } from '@/server/reservations/view'
import { renderWithIntl } from '@/test-utils'

import { GroupOutlines } from './plan-outline'

const spot = (id: string, x: number, y: number): RvSpotView => ({
  id,
  name: id,
  kind: 'table',
  place: { shape: 'rect', x, y, width: 80, height: 80, rotation: 0 },
  seats: 4,
  state: 'sitting',
  table: null,
  holds: [],
  leading: null,
})

const SPOTS = [
  spot('sp_1', 40, 40),
  spot('sp_2', 140, 40),
  spot('sp_3', 40, 400),
  spot('sp_4', 400, 40),
  spot('sp_5', 500, 40),
]

function plan(groups: RvPlanView['groups']): RvPlanView {
  return {
    day: '2026-11-25',
    today: true,
    passed: false,
    tooOld: false,
    settingsMissing: false,
    plans: [],
    planId: 'fp_1',
    planName: null,
    kinds: [],
    spots: SPOTS,
    extent: { x: 0, y: 0, width: 640, height: 520 },
    unreadable: 0,
    groups,
    outlinePad: 20,
    waiting: [],
  }
}

const A = { id: 'rv_a', name: 'Иванова', spotIds: ['sp_1', 'sp_2', 'sp_3'] }
const B = { id: 'rv_b', name: 'Петров', spotIds: ['sp_4', 'sp_5'] }

describe('GroupOutlines', () => {
  it('draws one outline round adjoining tables and the same outline on the one apart', () => {
    renderWithIntl(<GroupOutlines plan={plan([A])} shown={SPOTS} />)
    const outlines = screen.getAllByTestId('rv-group-outline')
    expect(outlines.map((one) => one.getAttribute('data-spots'))).toEqual(['2', '1'])
    // Each cluster carries the party's name, so the lone table is not missed.
    expect(screen.getAllByTestId('rv-group-name').map((one) => one.textContent)).toEqual([
      'Иванова',
      'Иванова',
    ])
  })

  it('tells two neighbouring parties apart by their names, and not by colour alone', () => {
    renderWithIntl(<GroupOutlines plan={plan([A, B])} shown={SPOTS} />)
    expect(screen.getAllByTestId('rv-group-outline')).toHaveLength(3)
    const names = screen.getAllByTestId('rv-group-name')
    expect(names.map((one) => one.getAttribute('data-party'))).toEqual(['rv_a', 'rv_a', 'rv_b'])
    expect(names.map((one) => one.textContent)).toEqual(['Иванова', 'Иванова', 'Петров'])
    // The tab says the party's size as well, for a name that clips.
    expect(names[2]?.getAttribute('title')).toBe('Петров · Party · 2 tables')
  })

  it('draws nothing for a party in no group, or one a filter has left one spot of', () => {
    const { container } = renderWithIntl(<GroupOutlines plan={plan([])} shown={SPOTS} />)
    expect(container.querySelector('svg')).toBeNull()
    const filtered = renderWithIntl(
      <GroupOutlines plan={plan([B])} shown={[SPOTS[3] as RvSpotView]} />,
    )
    expect(within(filtered.container).queryAllByTestId('rv-group-outline')).toHaveLength(0)
  })

  it('names a party nobody named, and never takes a pointer from the spots under it', () => {
    renderWithIntl(<GroupOutlines plan={plan([{ ...B, name: null }])} shown={SPOTS} />)
    expect(screen.getByTestId('rv-group-name').textContent).toBe('No name')
    expect(screen.getByTestId('rv-group-outlines').getAttribute('class')).toContain(
      'pointer-events-none',
    )
  })
})
