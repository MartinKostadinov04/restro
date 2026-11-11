// @vitest-environment jsdom
// The plan editor (#397): the states the screen has — no plan, an empty plan, a plan being edited,
// a refusal, a spot a booking holds, read-only — and the writes each gesture sends. The actions
// are mocked: what reaches the database is `plan-editor.test.ts`'s (core) and the e2e spec's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  removeSpotAction,
  removeSpotKindAction,
  savePlanAction,
  saveSpotAction,
  saveSpotKindAction,
  startPlanAction,
} from '@/server/settings/plan-actions'
import type { ReservationsView } from '@/server/settings/reservations-view'
import { useSettingsRun } from '@/settings/use-settings-run'
import { renderWithIntl } from '@/test-utils'

import { PlanCard } from './plan-card'

vi.mock('@/server/settings/plan-actions', () => ({
  startPlanAction: vi.fn(),
  savePlanAction: vi.fn(),
  saveSpotAction: vi.fn(),
  removeSpotAction: vi.fn(),
  saveSpotKindAction: vi.fn(),
  removeSpotKindAction: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const VENUE = 'vn_0000000000000000000001'
const PLAN = 'fp_0000000000000000000001'
const SPOT = 'sp_0000000000000000000001'
const BOOTH = 'sp_0000000000000000000002'

type Plan = ReservationsView['plan']

const KINDS: Plan['kinds'] = [
  { key: 'table', label: 'Table', symbol: 'table', defaultSeats: 4, sortKey: 'a', spots: 1 },
  { key: 'booth', label: 'Booth', symbol: 'booth', defaultSeats: 6, sortKey: 'b', spots: 1 },
]

const SPOTS: Plan['spots'] = [
  {
    id: SPOT,
    planId: PLAN,
    name: 'Table 1',
    kind: 'table',
    place: { shape: 'rect', x: 10, y: 10, width: 10, height: 10, rotation: 0 },
    seats: null,
    tableId: null,
    bookings: 0,
  },
  {
    id: BOOTH,
    planId: PLAN,
    name: 'Sofa',
    kind: 'booth',
    place: { shape: 'booth', x: 30, y: 10, width: 16, height: 10, rotation: 0 },
    seats: 8,
    tableId: null,
    bookings: 2,
  },
]

const WITH_PLAN: Plan = {
  plans: [{ id: PLAN, name: 'Main floor', current: true }],
  spots: SPOTS,
  kinds: KINDS,
  tables: [],
  unreadable: 0,
}

const NO_PLAN: Plan = { plans: [], spots: [], kinds: [], tables: [], unreadable: 0 }

function view(plan: Plan, canChange = true): ReservationsView {
  return {
    venueId: VENUE,
    canChange,
    email: 'owner@example.com',
    settings: {
      saved: true,
      turnMinutes: 120,
      phoneRequired: true,
      editPastNights: false,
      privateNotesOn: true,
      closedDates: [],
      spots: [],
    },
    plan,
  }
}

/** The card with the runner the section gives it. */
function Card({ of }: { of: ReservationsView }) {
  const runner = useSettingsRun(of.email)
  return (
    <>
      <PlanCard view={of} runner={runner} />
      {runner.dialog}
    </>
  )
}

const OK = { ok: true, details: {} } as const

/** The Undo of the latest success toast. */
function undoOfLast() {
  const calls = vi.mocked(toast.success).mock.calls
  const options = calls[calls.length - 1]?.[1] as unknown as { action: { onClick: () => void } }
  return options.action.onClick
}

beforeEach(() => {
  for (const action of [
    startPlanAction,
    savePlanAction,
    saveSpotAction,
    removeSpotAction,
    saveSpotKindAction,
    removeSpotKindAction,
  ]) {
    vi.mocked(action).mockReset()
    vi.mocked(action).mockResolvedValue(OK)
  }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('no plan yet', () => {
  it('says so in one block with one button that starts the plan and its first kinds', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(NO_PLAN)} />)
    const empty = screen.getByTestId('pe-empty')
    expect(empty.textContent).toContain('No floor plan yet')
    expect(within(empty).getAllByRole('button')).toHaveLength(1)
    await user.click(screen.getByTestId('pe-start'))
    await waitFor(() => expect(startPlanAction).toHaveBeenCalledTimes(1))
    expect(startPlanAction).toHaveBeenCalledWith({
      venueId: VENUE,
      name: 'Main floor',
      kinds: [
        { key: 'table', label: 'Table', symbol: 'table', defaultSeats: 4 },
        { key: 'booth', label: 'Booth', symbol: 'booth', defaultSeats: 6 },
        { key: 'stool', label: 'Bar stool', symbol: 'stool', defaultSeats: 1 },
        { key: 'standing', label: 'Standing', symbol: 'standing', defaultSeats: null },
      ],
    })
  })

  it('keeps the kinds a venue already has instead of adding the starters', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view({ ...NO_PLAN, kinds: KINDS })} />)
    await user.click(screen.getByTestId('pe-start'))
    await waitFor(() =>
      expect(startPlanAction).toHaveBeenCalledWith({
        venueId: VENUE,
        name: 'Main floor',
        kinds: [],
      }),
    )
  })

  it('tells a role without the right who draws it, with no button', () => {
    renderWithIntl(<Card of={view(NO_PLAN, false)} />)
    expect(screen.queryByTestId('pe-start')).toBeNull()
    expect(screen.getByTestId('pe-empty').textContent).toContain(
      'Someone who may change the reservation settings draws it here.',
    )
  })
})

describe('a plan with no spots', () => {
  it('asks for the first spot, with New spot as the one primary action', () => {
    renderWithIntl(<Card of={view({ ...WITH_PLAN, spots: [] })} />)
    expect(screen.getByTestId('pe-canvas').textContent).toContain(
      'Add the first spot with “New spot”.',
    )
    expect(screen.getByTestId('pe-add-spot')).toBeTruthy()
    expect(screen.queryByTestId('pe-spot-list')).toBeNull()
  })

  it('adds a spot with the first free name, clear of the others, with Undo that removes it', async () => {
    vi.mocked(saveSpotAction).mockResolvedValue({
      ok: true,
      details: { spotId: 'sp_0000000000000000000009', planId: PLAN },
    })
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(screen.getByTestId('pe-add-spot'))
    const name = screen.getByTestId('pe-new-spot-name') as HTMLInputElement
    expect(name.value).toBe('Table 2')
    await user.click(screen.getByTestId('pe-new-spot-save'))
    await waitFor(() => expect(saveSpotAction).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(saveSpotAction).mock.calls[0]?.[0] as Record<string, unknown>
    expect(sent).toMatchObject({
      venueId: VENUE,
      planId: PLAN,
      name: 'Table 2',
      kind: 'table',
      shape: 'rect',
      width: 10,
      height: 10,
      rotation: 0,
      seats: null,
      tableId: null,
    })
    expect(sent).not.toHaveProperty('spotId')
    // Clear of Table 1 (10–20 × 10–20) and the sofa (30–46 × 10–20).
    const x = sent.x as number
    const y = sent.y as number
    const clear = (a: { x: number; y: number; width: number; height: number }) =>
      x + 10 <= a.x || a.x + a.width <= x || y + 10 <= a.y || a.y + a.height <= y
    expect(SPOTS.every((spot) => clear(spot.place))).toBe(true)
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    undoOfLast()()
    await waitFor(() =>
      expect(removeSpotAction).toHaveBeenCalledWith({
        venueId: VENUE,
        spotId: 'sp_0000000000000000000009',
      }),
    )
  })
})

describe('a plan being edited', () => {
  it('draws every spot on the canvas and in the list', () => {
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    expect(screen.getAllByTestId('pe-spot')).toHaveLength(2)
    const rows = screen.getAllByTestId('pe-spot-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      'SofaBooth · 8 seats',
      'Table 1Table · 4 seats',
    ])
  })

  it('saves a spot moved by the keys once they rest, with the whole spot and Undo', async () => {
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    const tile = screen
      .getAllByTestId('pe-spot')
      .find((one) => one.getAttribute('data-spot') === SPOT) as HTMLElement
    fireEvent.keyDown(tile, { key: 'ArrowRight' })
    fireEvent.keyDown(tile, { key: 'ArrowRight' })
    fireEvent.keyDown(tile, { key: 'ArrowDown', shiftKey: true })
    expect(tile.getAttribute('data-x')).toBe('12')
    expect(tile.getAttribute('data-h')).toBe('11')
    await waitFor(() => expect(saveSpotAction).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(saveSpotAction).toHaveBeenCalledWith({
      venueId: VENUE,
      spotId: SPOT,
      planId: PLAN,
      name: 'Table 1',
      kind: 'table',
      shape: 'rect',
      x: 12,
      y: 10,
      width: 10,
      height: 11,
      rotation: 0,
      seats: null,
      tableId: null,
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Moved Table 1', expect.anything()),
    )
    undoOfLast()()
    await waitFor(() =>
      expect(saveSpotAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ spotId: SPOT, x: 10, y: 10, width: 10, height: 10 }),
      ),
    )
  })

  it('puts the spot back and names the rule when the database refuses the place', async () => {
    vi.mocked(saveSpotAction).mockResolvedValue({ ok: false, error: 'plan_refused' })
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    const tile = screen
      .getAllByTestId('pe-spot')
      .find((one) => one.getAttribute('data-spot') === SPOT) as HTMLElement
    fireEvent.keyDown(tile, { key: 'ArrowLeft' })
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      "The database refused this placement: it breaks one of the plan's rules. The spot is back where it was — try other numbers.",
    )
    expect(tile.getAttribute('data-x')).toBe('10')
  })

  it.each([
    ['shape_off_plan', 'The spot runs off the plan. Move it in or make it smaller.'],
    ['spot_name_taken', 'Another spot already has that name. Pick another.'],
  ])('words the refusal %s so the owner can act on it', async (code, sentence) => {
    vi.mocked(saveSpotAction).mockResolvedValue({ ok: false, error: code })
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(
      within(screen.getAllByTestId('pe-spot-row')[1] as HTMLElement).getByRole('button'),
    )
    const name = screen.getByTestId('pe-spot-name')
    await user.clear(name)
    await user.type(name, 'Sofa{Enter}')
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(sentence)
  })

  it('saves a spot’s seats from its sheet with Undo to the number it had', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(
      within(screen.getAllByTestId('pe-spot-row')[0] as HTMLElement).getByRole('button'),
    )
    const seats = screen.getByTestId('pe-spot-seats') as HTMLInputElement
    expect(seats.value).toBe('8')
    await user.clear(seats)
    await user.type(seats, '10{Enter}')
    await waitFor(() =>
      expect(saveSpotAction).toHaveBeenCalledWith(
        expect.objectContaining({ spotId: BOOTH, seats: 10, shape: 'booth', x: 30 }),
      ),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    undoOfLast()()
    await waitFor(() =>
      expect(saveSpotAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ spotId: BOOTH, seats: 8 }),
      ),
    )
  })

  it('refuses seats outside 1 to 100 in place and sends nothing', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(
      within(screen.getAllByTestId('pe-spot-row')[0] as HTMLElement).getByRole('button'),
    )
    const seats = screen.getByTestId('pe-spot-seats')
    await user.clear(seats)
    await user.type(seats, '101{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter a whole number of seats, from 1 to 100.',
    )
    expect(saveSpotAction).not.toHaveBeenCalled()
  })

  it('makes a spot round by its larger side when Round is picked', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(
      within(screen.getAllByTestId('pe-spot-row')[0] as HTMLElement).getByRole('button'),
    )
    await user.click(screen.getByTestId('pe-shape-circle'))
    await waitFor(() =>
      expect(saveSpotAction).toHaveBeenCalledWith(
        expect.objectContaining({ spotId: BOOTH, shape: 'circle', width: 16, height: 16 }),
      ),
    )
  })
})

describe('a spot a booking holds', () => {
  it('says so in its sheet, and removing it names how many bookings are affected', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(
      within(screen.getAllByTestId('pe-spot-row')[0] as HTMLElement).getByRole('button'),
    )
    expect(screen.getByTestId('pe-spot-booked').textContent).toBe(
      '2 bookings from today on hold this spot. Your changes show there too.',
    )
    await user.click(screen.getByTestId('pe-spot-remove'))
    const dialog = screen.getByTestId('pe-remove-spot')
    expect(dialog.textContent).toContain('Remove Sofa?')
    expect(dialog.textContent).toContain(
      "2 bookings from today on hold this spot. They keep it, but it leaves the plan and can't be brought back",
    )
    await user.click(screen.getByTestId('pe-remove-spot-do'))
    await waitFor(() =>
      expect(removeSpotAction).toHaveBeenCalledWith({ venueId: VENUE, spotId: BOOTH }),
    )
  })
})

describe('spot kinds', () => {
  it('adds a kind under a key made from its symbol, with Undo that removes it', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view(WITH_PLAN)} />)
    await user.click(screen.getByTestId('pe-kind-add'))
    await user.type(screen.getByTestId('pe-kind-label'), 'VIP table')
    await user.type(screen.getByTestId('pe-kind-seats'), '8')
    await user.click(screen.getByTestId('pe-kind-save'))
    await waitFor(() =>
      expect(saveSpotKindAction).toHaveBeenCalledWith({
        venueId: VENUE,
        key: 'table_2',
        label: 'VIP table',
        symbol: 'table',
        defaultSeats: 8,
      }),
    )
    undoOfLast()()
    await waitFor(() =>
      expect(removeSpotKindAction).toHaveBeenCalledWith({ venueId: VENUE, key: 'table_2' }),
    )
  })

  it('opens the kind dialog first when the venue has no kinds to add a spot of', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Card of={view({ ...WITH_PLAN, spots: [], kinds: [] })} />)
    expect(screen.getByTestId('pe-kinds-empty')).toBeTruthy()
    await user.click(screen.getByTestId('pe-add-spot'))
    expect(screen.getByTestId('pe-kind')).toBeTruthy()
  })
})

describe('read-only', () => {
  it('draws the plan and the list with nothing to move, add or remove', () => {
    renderWithIntl(<Card of={view(WITH_PLAN, false)} />)
    expect(screen.getAllByTestId('pe-spot')).toHaveLength(2)
    expect(within(screen.getByTestId('pe-canvas')).queryAllByRole('button')).toHaveLength(0)
    expect(within(screen.getByTestId('pe-spot-list')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByTestId('pe-add-spot')).toBeNull()
    expect(screen.queryByTestId('pe-kind-add')).toBeNull()
    expect(screen.queryByTestId('pe-plan-more')).toBeNull()
  })
})
