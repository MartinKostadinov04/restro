// @vitest-environment jsdom
// The door's toast says only what the write was certain of (#396). The seating toast used to claim
// "The table is open for phones" before the write was even sent, so a party with no spot — the
// normal case for a booking taken without a table — was told a table had opened when none had.
// Now the toast says the party is seated, and the line about the table comes from what the write
// reported (`tablesOpen`), beside the line for a role that may not open tables.
//
// Drawn with the real messages in both languages: Bulgarian is the one a hostess reads.
import { act, renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RvFrame } from '@/server/reservations/view'
import { MESSAGES } from '@/test-utils'

import { type DoorParty, tablesOpenFor, useDoorActions } from './door-actions'
import type { RvRunSpec } from './use-reservation-run'

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

/** Taps "Arrived" for a party and hands back the write the door asked to run. */
async function arrive(locale: 'bg' | 'en', who: DoorParty) {
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
    result.current.arrive(who)
    // The advice is read first, then the write is handed to `run`.
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })
  const spec = run.mock.calls[0]?.[0]
  if (spec === undefined) throw new Error('the door never asked for a write')
  return spec
}

/** Every line the toast said about a table, after the write answered with these details. */
function told(spec: RvRunSpec, details: Record<string, string | number | boolean | null>) {
  toast.message.mockClear()
  spec.onDone?.(details)
  return toast.message.mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
  toast.message.mockReset()
})

describe('the door, after an arrival', () => {
  it('seats a party with no spot without saying a table opened', async () => {
    const spec = await arrive('en', party())
    // What the write is certain of, said before it answers: nobody is told about a table yet.
    expect(spec.done).toBe('Ivanova is seated.')
    // The write answered: it opened no table, because the party holds no spot.
    const lines = told(spec, { status: 'seated', spots: '', opened: '', tablesOpen: 0 })
    expect(lines).toEqual([])
    expect(`${spec.done} ${lines.join(' ')}`).not.toMatch(/open for phones/i)
  })

  it('says the same in Bulgarian, which is the language the hostess reads', async () => {
    const spec = await arrive('bg', party())
    expect(spec.done).toBe('Ivanova е настанена.')
    expect(told(spec, { status: 'seated', opened: '', tablesOpen: 0 })).toEqual([])
    expect(spec.done).not.toContain('отворена')
  })

  it('adds the table line only when a code really opened', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(spec.done).toBe('Ivanova is seated.')
    expect(told(spec, { status: 'seated', opened: 'tb_7', tablesOpen: 1 })).toEqual([
      'The table is open for phones.',
    ])
  })

  it('adds it in Bulgarian, and names the spot the hostess chose in the main toast', async () => {
    const spec = await arrive('bg', party({ onSpot: 'Маса 7', spotIds: ['sp_7'] }))
    expect(spec.done).toBe('Ivanova е настанена на Маса 7.')
    expect(told(spec, { opened: 'tb_7', tablesOpen: 1 })).toEqual([
      'Масата е отворена за телефони.',
    ])
  })

  it('counts a table found open and kept ("the same guests") as open for phones', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { opened: '', kept: 'tb_7', tablesOpen: 1 })).toEqual([
      'The table is open for phones.',
    ])
  })

  it('leaves only the closed-table line for a role that may not open tables', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { opened: '', tablesOpen: 0, tableClosed: true })).toEqual([
      'The table stayed closed for phones. Ask someone who may open it.',
    ])
  })

  it('says nothing about a table when the write did not report one at all', async () => {
    const spec = await arrive('en', party({ spotIds: ['sp_7'] }))
    expect(told(spec, { status: 'seated' })).toEqual([])
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
