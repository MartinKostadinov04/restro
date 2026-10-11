import { describe, expect, it } from 'vitest'

import { absenceHeldOf, venueHintOf } from './sync-reads'

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
