// `guestEmailJobOf` (#576): the job a reservation command's answer asks for, or none. Pure; the
// handlers that write the details are tested on the database in booking.test.ts.

import { describe, expect, it } from 'vitest'

import { newId } from '../../ids'
import { accepted, refused } from '../results'
import { GUEST_EMAIL_LOG_KINDS, guestEmailJobOf } from './guest-email'

const scope = { tenantId: newId('tn'), venueId: newId('vn') }
const reservationId = newId('rv')

describe('guestEmailJobOf', () => {
  it('turns an answer that owes an email into its job, with ids and the Log entry only', () => {
    const answer = accepted(null, {
      details: { reservationId, guestEmail: 'reservation_cancelled', guestEmailEntry: 17 },
    })
    expect(guestEmailJobOf(answer, scope)).toEqual({
      ...scope,
      reservationId,
      kind: 'reservation_cancelled',
      entry: 17,
    })
  })

  it('asks for nothing when the answer owes nothing, is refused, or its details are not a job', () => {
    expect(guestEmailJobOf(accepted(null, { details: { reservationId } }), scope)).toBeNull()
    expect(
      guestEmailJobOf(
        refused(null, 'reservation_gone', {
          reservationId,
          guestEmail: 'reservation_cancelled',
          guestEmailEntry: 17,
        }),
        scope,
      ),
    ).toBeNull()
    const owed = { reservationId, guestEmail: 'reservation_cancelled', guestEmailEntry: 17 }
    // An unknown kind, a missing entry, a wrong id: never thrown, the command is done regardless.
    for (const details of [
      { ...owed, guestEmail: 'receipt' },
      { ...owed, guestEmailEntry: null },
      { ...owed, guestEmailEntry: 0 },
      { ...owed, reservationId: newId('tb') },
      { guestEmail: 'reservation_cancelled', guestEmailEntry: 17 },
    ]) {
      expect(
        guestEmailJobOf(accepted(null, { details }), scope),
        JSON.stringify(details),
      ).toBeNull()
    }
  })

  it('checks a cancellation against the Log’s reservation.status entries', () => {
    expect(GUEST_EMAIL_LOG_KINDS.reservation_cancelled).toBe('reservation.status')
  })
})
