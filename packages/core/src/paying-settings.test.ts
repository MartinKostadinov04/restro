import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PAYING_SETTINGS,
  PayingSettingsSchema,
  readPayingSettings,
  smallestCardMinor,
} from './paying-settings'

describe('paying settings', () => {
  it("defaults to the provider's minimum and passes its own schema", () => {
    expect(PayingSettingsSchema.parse(DEFAULT_PAYING_SETTINGS)).toEqual(DEFAULT_PAYING_SETTINGS)
    expect(readPayingSettings({})).toEqual(DEFAULT_PAYING_SETTINGS)
    expect(readPayingSettings({ paying: { minCardMinor: 0 } })).toEqual(DEFAULT_PAYING_SETTINGS)
    expect(readPayingSettings({ paying: { minCardMinor: 500 } })).toEqual({ minCardMinor: 500 })
  })

  it('keeps whole minor units', () => {
    expect(PayingSettingsSchema.safeParse({ minCardMinor: 1.5 }).success).toBe(false)
    expect(PayingSettingsSchema.safeParse({ minCardMinor: 100_001 }).success).toBe(false)
  })

  it("never goes below the provider's minimum", () => {
    expect(smallestCardMinor({ minCardMinor: null }, 50)).toBe(50)
    expect(smallestCardMinor({ minCardMinor: 20 }, 50)).toBe(50)
    expect(smallestCardMinor({ minCardMinor: 500 }, 50)).toBe(500)
  })
})
