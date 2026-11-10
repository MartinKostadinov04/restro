import { describe, expect, it } from 'vitest'

import type { RvDetailView } from '@/server/reservations/view'

import {
  blankValues,
  fieldErrors,
  isDirty,
  nextDay,
  nextQuarter,
  phoneLooksRight,
  valuesOf,
} from './booking-values'

const detail = (over: Partial<RvDetailView> = {}): RvDetailView => ({
  row: {
    id: 'rv_a',
    kind: 'booking',
    status: 'reserved',
    time: '22:00',
    until: null,
    name: 'Мария',
    partySize: 4,
    spots: ['T1', 'T2'],
    note: null,
    reason: 'birthday',
    late: false,
    byVenue: false,
    seatedAt: null,
    endedAt: null,
  },
  day: '2026-11-10',
  made: null,
  phone: '+359888123456',
  email: null,
  guestId: null,
  spotIds: ['sp_1', 'sp_2'],
  version: '2026-11-10T10:00:00.000Z',
  mine: false,
  payRule: { rule: null, beaten: [] },
  history: [],
  endedByNightEnd: false,
  ...over,
})

describe('the booking form’s values', () => {
  it('starts blank with the night, the hour and a spot chosen on the plan', () => {
    const blank = blankValues({ day: '2026-11-10', time: '22:00', spotIds: ['sp_1'] })
    expect(blank).toMatchObject({ name: '', phone: '', day: '2026-11-10', spotIds: ['sp_1'] })
  })

  it('is filled from a booking, with a reason we do not offer left out', () => {
    expect(valuesOf(detail())).toMatchObject({
      name: 'Мария',
      phone: '+359888123456',
      partySize: '4',
      time: '22:00',
      until: '',
      reason: 'birthday',
      spotIds: ['sp_1', 'sp_2'],
    })
    expect(valuesOf(detail({ row: { ...detail().row, reason: 'old_code' } })).reason).toBeNull()
  })

  it('is changed by any field, and the order of the spots is not a change', () => {
    const start = valuesOf(detail())
    expect(isDirty(start, start)).toBe(false)
    expect(isDirty({ ...start, spotIds: ['sp_2', 'sp_1'] }, start)).toBe(false)
    expect(isDirty({ ...start, spotIds: ['sp_1'] }, start)).toBe(true)
    expect(isDirty({ ...start, note: 'x' }, start)).toBe(true)
  })
})

describe('what is wrong while typing', () => {
  const ok = {
    ...blankValues({ day: '2026-11-10', time: '22:00' }),
    name: 'Ана',
    phone: '0888 123 456',
    partySize: '2',
  }

  it('needs a name, a number of guests, and a phone where the venue requires one', () => {
    expect(fieldErrors(ok, { phoneRequired: true })).toEqual({})
    expect(fieldErrors({ ...ok, name: '  ' }, { phoneRequired: true }).name).toBe('name')
    expect(fieldErrors({ ...ok, partySize: '0' }, { phoneRequired: true }).partySize).toBe('guests')
    expect(fieldErrors({ ...ok, partySize: '' }, { phoneRequired: true }).partySize).toBe('guests')
    expect(fieldErrors({ ...ok, phone: '' }, { phoneRequired: true }).phone).toBe('phone_needed')
    expect(fieldErrors({ ...ok, phone: '' }, { phoneRequired: false })).toEqual({})
  })

  it('reads a number by its digits, whatever it is written with', () => {
    expect(phoneLooksRight('+359 (888) 123-456')).toBe(true)
    expect(phoneLooksRight('00359888123456')).toBe(true)
    expect(phoneLooksRight('12345')).toBe(false)
    expect(fieldErrors({ ...ok, phone: 'abc' }, { phoneRequired: false }).phone).toBe(
      'phone_digits',
    )
  })

  it('refuses an end hour equal to the start', () => {
    expect(fieldErrors({ ...ok, until: '22:00' }, { phoneRequired: true }).until).toBe('end_hour')
    expect(fieldErrors({ ...ok, until: '01:00' }, { phoneRequired: true }).until).toBeUndefined()
  })
})

describe('the hours the form starts on', () => {
  it('is the next quarter hour on the venue’s clock', () => {
    // 20:07 in Sofia in November is 18:07 UTC.
    expect(nextQuarter(new Date('2026-11-10T18:07:00Z'), 'Europe/Sofia')).toBe('20:15')
    expect(nextQuarter(new Date('2026-11-10T18:15:00Z'), 'Europe/Sofia')).toBe('20:30')
    expect(nextQuarter(new Date('2026-11-10T21:55:00Z'), 'Europe/Sofia')).toBe('00:00')
  })

  it('steps a night forward by calendar days', () => {
    expect(nextDay('2026-11-30')).toBe('2026-12-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
