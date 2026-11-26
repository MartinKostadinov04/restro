// The booking page's full address on Settings › Reservations (#581, D178): what a web designer links
// or frames from the club's own site, so it is absolute or nothing.
import { describe, expect, it } from 'vitest'

import { bookingAddressOf } from './reservations-view'

describe("the booking page's address", () => {
  it("is the guest pages' origin and the booking path", () => {
    expect(bookingAddressOf('night-group', 'club-night', 'https://restro.example')).toBe(
      'https://restro.example/book/night-group/club-night',
    )
  })

  it('keeps only the origin of a base address with a path, a trailing slash or a port', () => {
    expect(bookingAddressOf('night-group', 'club-night', 'https://restro.example/menu/')).toBe(
      'https://restro.example/book/night-group/club-night',
    )
    expect(bookingAddressOf('night-group', 'club-night', 'http://localhost:3000')).toBe(
      'http://localhost:3000/book/night-group/club-night',
    )
  })

  it('is nothing without an absolute origin: a bare path framed elsewhere loads that site’s 404', () => {
    expect(bookingAddressOf('night-group', 'club-night', null)).toBeNull()
    expect(bookingAddressOf('night-group', 'club-night', '')).toBeNull()
    expect(bookingAddressOf('night-group', 'club-night', '/cdn')).toBeNull()
    expect(bookingAddressOf('night-group', 'club-night', 'ftp://restro.example')).toBeNull()
  })

  it('is nothing when the organisation has no address, or the names are not slugs', () => {
    expect(bookingAddressOf(null, 'club-night', 'https://restro.example')).toBeNull()
    expect(bookingAddressOf('Night Group', 'club-night', 'https://restro.example')).toBeNull()
  })
})
