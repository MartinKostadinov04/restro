import { describe, expect, it } from 'vitest'

import { absenceHeldOf, type FullPullRunRow, heldSyncsOf, venueHintOf } from './sync-reads'

describe('absenceHeldOf (details.absence_held of a run)', () => {
  it('reads the held conclusion of a run', () => {
    expect(
      absenceHeldOf({
        notes: [],
        refused: [],
        absence_held: { reason: 'too_many_missing', would_hide: 61, active: 65 },
      }),
    ).toEqual({ reason: 'too_many_missing', wouldHide: 61, active: 65 })
    expect(
      absenceHeldOf({ absence_held: { reason: 'empty_read', would_hide: 65, active: 65 } }),
    ).toEqual({ reason: 'empty_read', wouldHide: 65, active: 65 })
  })

  it('is null for a run without it, or with something that does not look right', () => {
    expect(absenceHeldOf(null)).toBeNull()
    expect(absenceHeldOf({ notes: [], refused: [] })).toBeNull()
    expect(absenceHeldOf({ absence_held: null })).toBeNull()
    expect(
      absenceHeldOf({ absence_held: { reason: 'other', would_hide: 1, active: 2 } }),
    ).toBeNull()
    expect(
      absenceHeldOf({ absence_held: { reason: 'empty_read', would_hide: -1, active: 2 } }),
    ).toBeNull()
    expect(
      absenceHeldOf({ absence_held: { reason: 'empty_read', would_hide: '3', active: 2 } }),
    ).toBeNull()
  })
})

describe('venueHintOf (the stored record of a venue)', () => {
  it('takes the public address and the public category', () => {
    expect(
      venueHintOf({ public_address: '  Sofia, 108 Vitosha Blvd ', public_cat_id: 1171 }),
    ).toEqual({
      address: 'Sofia, 108 Vitosha Blvd',
      publicCatId: 1171,
    })
  })

  it('has no address for a missing or blank one, and no category for null or a non-number', () => {
    expect(venueHintOf({ public_address: null, public_cat_id: null })).toEqual({
      address: null,
      publicCatId: null,
    })
    expect(venueHintOf({ public_address: '   ', public_cat_id: '1171' })).toEqual({
      address: null,
      publicCatId: null,
    })
    expect(venueHintOf({})).toEqual({ address: null, publicCatId: null })
  })

  it('cuts a very long address, and ignores a record that is not an object', () => {
    const hint = venueHintOf({ public_address: 'x'.repeat(500) })
    expect(hint?.address).toHaveLength(200)
    expect(venueHintOf(null)).toBeNull()
    expect(venueHintOf('text')).toBeNull()
    expect(venueHintOf([])).toBeNull()
  })
})

describe('heldSyncsOf (the held full pulls, per venue)', () => {
  const held = (venue: string | null, over: Partial<FullPullRunRow> = {}): FullPullRunRow => ({
    counters: { failed_pages: 0 },
    details: {
      notes: [],
      refused: [],
      absence_held: { reason: 'too_many_missing', would_hide: 60, active: 65 },
      ...(venue === null ? {} : { venue_id: venue }),
    },
    finishedAt: new Date('2026-10-11T09:00:00Z'),
    ...over,
  })
  const clean = (venue: string | null): FullPullRunRow => ({
    counters: { failed_pages: 0 },
    details: { notes: [], refused: [], ...(venue === null ? {} : { venue_id: venue }) },
    finishedAt: new Date('2026-10-11T10:00:00Z'),
  })

  it('names each venue whose newest complete full pull was held', () => {
    const entries = heldSyncsOf([held('vn_a'), held('vn_b'), clean('vn_c')])
    expect(entries.map((entry) => entry.venueId)).toEqual(['vn_a', 'vn_b'])
    expect(entries[0]?.held).toMatchObject({
      reason: 'too_many_missing',
      wouldHide: 60,
      active: 65,
      finishedAt: '2026-10-11T09:00:00.000Z',
    })
  })

  it('a venue’s newer clean pull clears its hold; an older hold under it does not come back', () => {
    expect(heldSyncsOf([clean('vn_a'), held('vn_a')])).toEqual([])
    expect(heldSyncsOf([held('vn_a'), clean('vn_a')]).map((entry) => entry.venueId)).toEqual([
      'vn_a',
    ])
  })

  it('passes over a pull that failed a page: it concluded nothing', () => {
    const failed = held('vn_a', { counters: { failed_pages: 1 } })
    expect(heldSyncsOf([failed])).toEqual([])
    expect(heldSyncsOf([failed, held('vn_a')]).map((entry) => entry.venueId)).toEqual(['vn_a'])
  })

  it('a run recorded before runs named a venue stands for no venue, until a named pull completed', () => {
    expect(heldSyncsOf([held(null)]).map((entry) => entry.venueId)).toEqual([null])
    // A venue's own complete pull came after it: the old one is old news.
    expect(heldSyncsOf([clean('vn_a'), held(null)])).toEqual([])
    expect(heldSyncsOf([held('vn_a'), held(null)]).map((entry) => entry.venueId)).toEqual(['vn_a'])
  })

  it('is empty without runs', () => {
    expect(heldSyncsOf([])).toEqual([])
  })
})
