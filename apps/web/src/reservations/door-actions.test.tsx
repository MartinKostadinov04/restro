// @vitest-environment jsdom
// The door's toast says only what the write was certain of (#396). The seating toast used to claim
// "The table is open for phones" before the write was even sent, so a party with no spot — the
// normal case for a booking taken without a table — was told a table had opened when none had.
// Now the toast says the party is seated, and the line about the table comes from what the write
// reported (`tablesOpen`), beside the line for a role that may not open tables.
//
// One toast per door write, naming the party, with its Undo (the screen round's S21): the table's
// line is part of the seating's own sentence, never a second toast, and a walk-in seated from the
// plan gets an Undo too.
//
// Drawn with the real messages in both languages: Bulgarian is the one a hostess reads.
import { act, renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { undoArrivalAction } from '@/server/reservations/actions'
import type { RvFrame } from '@/server/reservations/view'
import { MESSAGES } from '@/test-utils'

import { type DoorParty, tablesOpenFor, useDoorActions } from './door-actions'
import type { RvAgain, RvDoneDetails, RvRunSpec } from './use-reservation-run'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { message: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/server/reservations/actions', () => ({
  // No advice to ask a question about: the door goes straight to the write.
  arrivalChecksAction: vi.fn(async () => ({
    ok: true,
    checks: { tables: [], spotIds: [], payRule: null, onTheSpot: null },
  })),
  arriveAction: vi.fn(),
  freeSpotsAction: vi.fn(),
  holdSpotsAction: vi.fn(),
  seatWalkInAction: vi.fn(),
  setGuestsAction: vi.fn(),
  undoArrivalAction: vi.fn(),
}))

const frame = { venueId: 'vn_demo' } as RvFrame

const party = (over: Partial<DoorParty> = {}): DoorParty => ({
  reservationId: 'rv_one',
  day: '2026-11-09',
  name: 'Ivanova',
  spotIds: [],
  ...over,
})

/** Taps "Arrived" (or seats a walk-in, or "Free the table") and hands back the write the door ran. */
async function arrive(locale: 'bg' | 'en', who: DoorParty, tap: 'arrive' | 'free' = 'arrive') {
  const run = vi.fn<(spec: RvRunSpec) => void>()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  )
  const { result } = renderHook(() => useDoorActions({ frame, run, onChanged: vi.fn() }), {
    wrapper,
  })
  await act(async () => {
    if (tap === 'free') result.current.free(who)
    else if (who.reservationId === null)
      result.current.walkIn({ ...who, partySize: who.partySize ?? 2 })
    else result.current.arrive(who)
    // The advice is read first, then the write is handed to `run`.
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })
  const spec = run.mock.calls[0]?.[0]
  if (spec === undefined) throw new Error('the door never asked for a write')
  return spec
}

/** The one toast the write says, after it answered with these details. */
function told(spec: RvRunSpec, details: Record<string, string | number | boolean | null>) {
  toast.message.mockClear()
  const text = typeof spec.done === 'string' ? spec.done : spec.done(details)
  spec.onDone?.(details)
  // Never a second toast beside it.
  expect(toast.message).not.toHaveBeenCalled()
  return text
}

/** The Undo the toast offers once the write reported these details; undefined where it offers none. */
function undoOf(spec: RvRunSpec, details: RvDoneDetails): RvAgain | undefined {
  return typeof spec.again === 'function' ? spec.again(details) : spec.again
}

beforeEach(() => {
  toast.message.mockReset()
  vi.mocked(undoArrivalAction).mockReset()
})

describe('the door, after an arrival', () => {
  it('seats a party with no spot without saying a table opened', async () => {
    const spec = await arrive('en', party())
    // The write answered: it opened no table, because the party holds no spot.
    const text = told(spec, { status: 'seated', spots: '', opened: '', tablesOpen: 0 })
    expect(text).toBe('Seated: Ivanova.')
    expect(text).not.toMatch(/open for phones/i)
  })

  it('says the same in Bulgarian, which is the language the hostess reads', async () => {
    const spec = await arrive('bg', party())
    const text = told(spec, { status: 'seated', opened: '', tablesOpen: 0 })
    expect(text).toBe('Настанени: Ivanova.')
    expect(text).not.toContain('отворена')
  })

  it('adds the table line only when a code really opened, in the same toast', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { status: 'seated', opened: 'tb_7', tablesOpen: 1 })).toBe(
      'Seated: Ivanova. The table is open for phones.',
    )
  })

  it('adds it in Bulgarian, and names the spot the hostess chose', async () => {
    const spec = await arrive('bg', party({ onSpot: 'Маса 7', spotIds: ['sp_7'] }))
    expect(told(spec, { opened: 'tb_7', tablesOpen: 1 })).toBe(
      'Настанени: Ivanova на Маса 7. Масата е отворена за телефони.',
    )
  })

  it('names a spot that is only a number as a spot, never a bare count', async () => {
    const spec = await arrive('bg', party({ onSpot: '9', spotIds: ['sp_9'] }))
    expect(told(spec, { tablesOpen: 0 })).toBe('Настанени: Ivanova на място 9.')
  })

  it('counts a table found open and kept ("the same guests") as open for phones', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { opened: '', kept: 'tb_7', tablesOpen: 1 })).toBe(
      'Seated: Ivanova. The table is open for phones.',
    )
  })

  it('says the table stayed closed for a role that may not open tables', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { opened: '', tablesOpen: 0, tableClosed: true })).toBe(
      'Seated: Ivanova. The table stayed closed for phones. Ask someone who may open it.',
    )
  })

  it('says nothing about a table when the write did not report one at all', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { status: 'seated' })).toBe('Seated: Ivanova.')
  })

  it('offers the Undo of the arrival on its toast', async () => {
    const spec = await arrive('en', party())
    const undo = undoOf(spec, {})
    expect(undo?.label).toBe('Undo')
    expect(undo?.done).toBe('The arrival is undone and the table is closed again.')
    await undo?.act()
    expect(undoArrivalAction).toHaveBeenCalledWith({ venueId: 'vn_demo', reservationId: 'rv_one' })
  })

  it('seats a party nobody named as a party, never as "No name"', async () => {
    const spec = await arrive('en', party({ name: null, onSpot: 'Маса 7', spotIds: ['sp_7'] }))
    expect(told(spec, { tablesOpen: 0 })).toBe('Party seated at Маса 7.')
  })
})

describe('the door, after "Free the table"', () => {
  it('names the party whose table is free', async () => {
    const spec = await arrive('en', party(), 'free')
    expect(spec.done).toBe("Ivanova's table is free again.")
  })

  it('says it without a name for a party nobody named', async () => {
    expect((await arrive('en', party({ name: null }), 'free')).done).toBe(
      'The table is free again.',
    )
    expect((await arrive('bg', party({ name: null }), 'free')).done).toBe(
      'Масата е свободна отново.',
    )
  })
})

describe('the door, after a walk-in', () => {
  const walkIn = (over: Partial<DoorParty> = {}) =>
    party({ reservationId: null, name: null, spotIds: ['sp_7'], ...over })

  it('says where the party sits, in one toast with the table line', async () => {
    const spec = await arrive('en', walkIn({ onSpot: 'Маса 7' }))
    expect(told(spec, { reservationId: 'rv_new', tablesOpen: 1 })).toBe(
      'Party seated at Маса 7. The table is open for phones.',
    )
  })

  it('says it in Bulgarian, and without a spot name when none was given', async () => {
    expect(told(await arrive('bg', walkIn({ onSpot: 'Маса 7' })), { tablesOpen: 0 })).toBe(
      'Настанена компания на Маса 7.',
    )
    expect(told(await arrive('bg', walkIn()), { tablesOpen: 0 })).toBe('Настанена компания.')
  })

  it('offers an Undo that takes back the line the seating made', async () => {
    const spec = await arrive('en', walkIn({ onSpot: 'Маса 7' }))
    const undo = undoOf(spec, { reservationId: 'rv_new' })
    expect(undo?.label).toBe('Undo')
    // Its own sentence: a walk-in had no booking to go back to.
    expect(undo?.done).toBe('The seating is undone and the spot is free again.')
    await undo?.act('1234')
    expect(undoArrivalAction).toHaveBeenCalledWith({
      venueId: 'vn_demo',
      reservationId: 'rv_new',
      pin: '1234',
    })
  })

  it('offers no Undo rather than guess when the write reported no line', async () => {
    const spec = await arrive('en', walkIn())
    expect(undoOf(spec, {})).toBeUndefined()
    expect(undoOf(spec, { reservationId: null })).toBeUndefined()
    expect(undoArrivalAction).not.toHaveBeenCalled()
  })
})

describe('tablesOpenFor', () => {
  it('reads only a positive number as tables open', () => {
    expect(tablesOpenFor({ tablesOpen: 2 })).toBe(2)
    expect(tablesOpenFor({ tablesOpen: 0 })).toBe(0)
    expect(tablesOpenFor({ tablesOpen: '1' })).toBe(0)
    expect(tablesOpenFor({})).toBe(0)
  })
})
