import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  canMove,
  countsAsNoShow,
  END_STATUSES,
  holdsSpots,
  isEndStatus,
  moveStatus,
  putBack,
  putBackStatus,
  RESERVATION_KINDS,
  RESERVATION_STATUS_MOVES,
  RESERVATION_STATUSES,
  type ReservationStatus,
  UNDONE_ARRIVAL_REASON,
  undoArrival,
} from './status'

const anyStatus = fc.constantFrom(...RESERVATION_STATUSES)

describe('the eight statuses', () => {
  it('are D135 seven and D138 Not seated', () => {
    expect([...RESERVATION_STATUSES]).toEqual([
      'requested',
      'reserved',
      'waiting',
      'seated',
      'finished',
      'no_show',
      'cancelled',
      'not_seated',
    ])
  })

  it('each have a row in the table of moves', () => {
    expect(Object.keys(RESERVATION_STATUS_MOVES).sort()).toEqual([...RESERVATION_STATUSES].sort())
  })

  it('allow exactly the moves the spec names', () => {
    expect(RESERVATION_STATUS_MOVES).toEqual({
      requested: ['reserved', 'cancelled'],
      reserved: ['seated', 'no_show', 'cancelled'],
      waiting: ['seated', 'not_seated', 'cancelled'],
      seated: ['finished'],
      finished: [],
      no_show: [],
      cancelled: [],
      not_seated: [],
    })
  })

  it('let nothing out of an end state', () => {
    for (const status of END_STATUSES) {
      expect(isEndStatus(status)).toBe(true)
      expect(RESERVATION_STATUS_MOVES[status]).toEqual([])
    }
  })

  it('hold a spot while requested, reserved or seated, and never otherwise', () => {
    const holding = RESERVATION_STATUSES.filter(holdsSpots)
    expect([...holding]).toEqual(['requested', 'reserved', 'seated'])
  })
})

describe('moveStatus', () => {
  it('accepts a move the table allows', () => {
    expect(moveStatus('reserved', 'seated')).toEqual({ ok: true, status: 'seated' })
    expect(moveStatus('waiting', 'not_seated')).toEqual({ ok: true, status: 'not_seated' })
  })

  it('refuses one it does not, by name', () => {
    expect(moveStatus('finished', 'seated')).toEqual({
      ok: false,
      code: 'status_move_not_allowed',
    })
    expect(moveStatus('waiting', 'no_show')).toEqual({
      ok: false,
      code: 'status_move_not_allowed',
    })
  })

  it('never moves a status to itself', () => {
    fc.assert(
      fc.property(anyStatus, (status) => {
        expect(canMove(status, status)).toBe(false)
      }),
    )
  })

  it('names a known status in every move it allows, and never leaves the eight', () => {
    fc.assert(
      fc.property(anyStatus, anyStatus, (from, to) => {
        const move = moveStatus(from, to)
        if (move.ok) {
          expect(RESERVATION_STATUSES).toContain(move.status)
          expect(move.status).toBe(to)
        } else {
          expect(move.code).toBe('status_move_not_allowed')
        }
      }),
    )
  })

  it('refuses every move out of an end state, so only Put back returns one', () => {
    fc.assert(
      fc.property(anyStatus, anyStatus, (from, to) => {
        if (!isEndStatus(from)) return
        expect(moveStatus(from, to).ok).toBe(false)
      }),
    )
  })
})

describe('putBack', () => {
  it('returns a no-show to Reserved and a Not seated party to Waiting', () => {
    expect(putBack('no_show')).toEqual({ ok: true, status: 'reserved' })
    expect(putBack('not_seated')).toEqual({ ok: true, status: 'waiting' })
  })

  it('returns nothing else', () => {
    fc.assert(
      fc.property(anyStatus, (status) => {
        const back = putBackStatus(status)
        if (status === 'no_show' || status === 'not_seated') {
          expect(back).not.toBeNull()
        } else {
          expect(back).toBeNull()
          expect(putBack(status)).toEqual({ ok: false, code: 'put_back_not_allowed' })
        }
      }),
    )
  })
})

describe('countsAsNoShow', () => {
  it('counts a no-show', () => {
    expect(countsAsNoShow('no_show')).toBe(true)
  })

  it('never counts Not seated: nobody had a table for him (D140)', () => {
    expect(countsAsNoShow('not_seated')).toBe(false)
  })

  it('counts nothing else', () => {
    const counted: ReservationStatus[] = RESERVATION_STATUSES.filter(countsAsNoShow)
    expect(counted).toEqual(['no_show'])
  })
})

describe('undoArrival', () => {
  it('puts a booking back to Reserved', () => {
    expect(undoArrival('seated', 'booking', 'reserved')).toEqual({ ok: true, status: 'reserved' })
  })

  it('puts a walk-in taken off the queue back on it', () => {
    expect(undoArrival('seated', 'walk_in', 'waiting')).toEqual({ ok: true, status: 'waiting' })
  })

  it('cancels a walk-in the seat tap created, rather than inventing a queue row', () => {
    // The two routes to Seated must not collapse into one answer: this party was never on the
    // waiting list, and the hostess of ticket #330 works that list by hand.
    expect(undoArrival('seated', 'walk_in', null)).toEqual({ ok: true, status: 'cancelled' })
    expect(countsAsNoShow('cancelled')).toBe(false)
    expect(UNDONE_ARRIVAL_REASON).toBe('arrival_undone')
  })

  it('refuses a pair that does not make sense instead of guessing', () => {
    expect(undoArrival('seated', 'booking', null)).toEqual({
      ok: false,
      code: 'undo_arrival_not_allowed',
    })
    expect(undoArrival('seated', 'walk_in', 'reserved')).toEqual({
      ok: false,
      code: 'undo_arrival_not_allowed',
    })
    expect(undoArrival('seated', 'booking', 'waiting')).toEqual({
      ok: false,
      code: 'undo_arrival_not_allowed',
    })
  })

  it('refuses a block, which is never seated', () => {
    for (const previous of ['reserved', 'waiting', null] as const) {
      expect(undoArrival('seated', 'block', previous)).toEqual({
        ok: false,
        code: 'undo_arrival_not_allowed',
      })
    }
  })

  it('refuses every status but Seated: there is no arrival to undo', () => {
    fc.assert(
      fc.property(
        anyStatus,
        fc.constantFrom(...RESERVATION_KINDS),
        fc.constantFrom<ReservationStatus | null>('reserved', 'waiting', null),
        (status, kind, previous) => {
          if (status === 'seated') return
          expect(undoArrival(status, kind, previous)).toEqual({
            ok: false,
            code: 'undo_arrival_not_allowed',
          })
        },
      ),
    )
  })

  it('never answers Waiting for a party that has no earlier status', () => {
    fc.assert(
      fc.property(anyStatus, fc.constantFrom(...RESERVATION_KINDS), (status, kind) => {
        const move = undoArrival(status, kind, null)
        if (move.ok) expect(move.status).toBe('cancelled')
      }),
    )
  })

  it('is not an edge in the table of moves: nothing leaves Seated but Finished', () => {
    expect(RESERVATION_STATUS_MOVES.seated).toEqual(['finished'])
    expect(canMove('seated', 'reserved')).toBe(false)
    expect(canMove('seated', 'waiting')).toBe(false)
    expect(canMove('seated', 'cancelled')).toBe(false)
  })
})
