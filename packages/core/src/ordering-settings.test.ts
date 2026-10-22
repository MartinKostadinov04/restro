import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ORDERING_SETTINGS,
  OrderingSettingsSchema,
  readOrderingSettings,
  serviceHoursProblem,
} from './ordering-settings'

describe('ordering settings', () => {
  it('defaults to the cautious values and passes its own schema', () => {
    expect(OrderingSettingsSchema.parse(DEFAULT_ORDERING_SETTINGS)).toEqual(
      DEFAULT_ORDERING_SETTINGS,
    )
    expect(readOrderingSettings({})).toEqual(DEFAULT_ORDERING_SETTINGS)
    expect(DEFAULT_ORDERING_SETTINGS.capMinor).toBe(15_000)
    expect(DEFAULT_ORDERING_SETTINGS.locationCheck).toBe(true)
    expect(Object.values(DEFAULT_ORDERING_SETTINGS.serviceHours).every((day) => day === null)).toBe(
      true,
    )
  })

  it('falls back to the defaults when the stored value does not pass', () => {
    expect(readOrderingSettings({ ordering: { capMinor: -1 } })).toEqual(DEFAULT_ORDERING_SETTINGS)
  })

  it('keeps the limits D118 sets', () => {
    const at = (patch: Partial<typeof DEFAULT_ORDERING_SETTINGS>) =>
      OrderingSettingsSchema.safeParse({ ...DEFAULT_ORDERING_SETTINGS, ...patch }).success
    expect(at({ radiusMetres: 99 })).toBe(false)
    expect(at({ radiusMetres: 501 })).toBe(false)
    expect(at({ pacePer15Minutes: 2 })).toBe(false)
    expect(at({ pacePer15Minutes: null })).toBe(true)
    expect(at({ capMinor: null })).toBe(true)
    expect(at({ passMinutes: 29 })).toBe(false)
    expect(at({ telegramChatId: '-1001234567890' })).toBe(true)
    expect(at({ telegramChatId: 'group' })).toBe(false)
  })

  it('accepts hours past midnight inside the service day', () => {
    expect(
      serviceHoursProblem({ opens: '22:00', lastOrders: '05:30', closes: '06:00' }, '07:00:00'),
    ).toBeNull()
  })

  it('refuses last orders closer than 15 minutes to the end of the service day', () => {
    expect(
      serviceHoursProblem({ opens: '22:00', lastOrders: '06:50', closes: '06:55' }, '07:00'),
    ).toMatch(/15 minutes/)
    expect(
      serviceHoursProblem({ opens: '22:00', lastOrders: '06:45', closes: '06:55' }, '07:00'),
    ).toBeNull()
  })

  it('refuses hours out of order', () => {
    expect(
      serviceHoursProblem({ opens: '23:00', lastOrders: '22:00', closes: '04:00' }, '07:00'),
    ).toMatch(/after opening/)
    expect(
      serviceHoursProblem({ opens: '22:00', lastOrders: '04:00', closes: '03:00' }, '07:00'),
    ).toMatch(/closing/)
  })
})
