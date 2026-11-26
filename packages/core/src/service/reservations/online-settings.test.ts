// The booking page's stored values (`reservation_settings.online`), read over their defaults
// (#577, #580). Pure: no database.
import { describe, expect, it } from 'vitest'

import { DEFAULT_ONLINE_SETTINGS, readOnlineSettings } from './online-settings'

describe('what the booking page reads from the stored values', () => {
  it('reads a stored value over the defaults', () => {
    expect(readOnlineSettings({ bookingPage: true, guestMay: 'spot', autoConfirm: true })).toEqual({
      ...DEFAULT_ONLINE_SETTINGS,
      bookingPage: true,
      guestMay: 'spot',
      autoConfirm: true,
    })
    expect(readOnlineSettings(null)).toEqual(DEFAULT_ONLINE_SETTINGS)
  })

  it('reads a stored `zone` (the spec’s word before Martin 11-25’s "use Area") as the defaults', () => {
    const stored = { bookingPage: true, guestMay: 'zone', autoConfirm: false }
    expect(() => readOnlineSettings(stored)).not.toThrow()
    expect(readOnlineSettings(stored)).toEqual(DEFAULT_ONLINE_SETTINGS)
    expect(readOnlineSettings({ guestMay: 'zone' }).guestMay).toBe('night')
  })
})
