import { describe, expect, it } from 'vitest'

import {
  deletionCheckSkipped,
  isKnownRefusalCode,
  isKnownRunKind,
  listedCounters,
  runDurationMs,
  splitDuration,
} from './format'

describe('listedCounters', () => {
  it('lists the known counters in display order and skips the rest', () => {
    expect(
      listedCounters({ refused_writes: 2, created: 5, items_mapped: 9, articles_seen: 58 }),
    ).toEqual([
      { key: 'articles_seen', value: 58 },
      { key: 'created', value: 5 },
      { key: 'refused_writes', value: 2 },
    ])
  })

  it('keeps zeros (a run that created nothing says so)', () => {
    expect(listedCounters({ created: 0 })).toEqual([{ key: 'created', value: 0 }])
  })
})

describe('durations', () => {
  it('is the time between start and finish, null while running', () => {
    expect(
      runDurationMs({
        startedAt: '2026-10-09T10:00:00.000Z',
        finishedAt: '2026-10-09T10:01:12.400Z',
      }),
    ).toBe(72_400)
    expect(runDurationMs({ startedAt: '2026-10-09T10:00:00.000Z', finishedAt: null })).toBeNull()
    expect(runDurationMs({ startedAt: null, finishedAt: null })).toBeNull()
  })

  it('splits into minutes and seconds', () => {
    expect(splitDuration(72_400)).toEqual({ minutes: 1, seconds: 12 })
    expect(splitDuration(400)).toEqual({ minutes: 0, seconds: 0 })
    expect(splitDuration(59_600)).toEqual({ minutes: 1, seconds: 0 })
  })
})

describe('deletionCheckSkipped', () => {
  it('reads the notes of a run with details', () => {
    expect(
      deletionCheckSkipped({
        details: { notes: ['Deletion check skipped: 1 of 3 pages failed'], refused: [] },
        errorSummary: null,
      }),
    ).toBe(true)
    expect(deletionCheckSkipped({ details: { notes: [], refused: [] }, errorSummary: 'x' })).toBe(
      false,
    )
  })

  it('reads the flag of a run whose details have it, whatever the notes say', () => {
    expect(
      deletionCheckSkipped({
        details: { notes: [], refused: [], deletionCheckSkipped: true },
        errorSummary: null,
      }),
    ).toBe(true)
    expect(
      deletionCheckSkipped({
        details: {
          notes: ['deletion check skipped: 1 of 3 pages failed'],
          refused: [],
          deletionCheckSkipped: false,
        },
        errorSummary: null,
      }),
    ).toBe(false)
  })

  it('reads the text of a run recorded before details existed', () => {
    expect(
      deletionCheckSkipped({
        details: null,
        errorSummary: 'deletion check skipped: 1 page failed',
      }),
    ).toBe(true)
    expect(deletionCheckSkipped({ details: null, errorSummary: null })).toBe(false)
  })
})

describe('known kinds and codes', () => {
  it('knows what it can label', () => {
    expect(isKnownRunKind('barsy_full_pull')).toBe(true)
    expect(isKnownRunKind('asset_fetch')).toBe(false)
    expect(isKnownRefusalCode('less_cautious')).toBe(true)
    expect(isKnownRefusalCode('something_new')).toBe(false)
  })
})
