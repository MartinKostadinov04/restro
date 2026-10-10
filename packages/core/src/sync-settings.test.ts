import { describe, expect, it } from 'vitest'

import {
  holdsNewItems,
  INCREMENTAL_MINUTES,
  parseSyncSettings,
  publishesAfterSync,
  SYNC_DEFAULTS,
  SyncSettingsInputSchema,
} from './sync-settings'

describe('parseSyncSettings', () => {
  it('returns the defaults, which are what ran before the settings existed', () => {
    const expected = {
      schedule: {
        incremental_enabled: true,
        incremental_minutes: 5,
        full_pull_enabled: true,
        full_pull_time: '12:00',
      },
      publish: { after_sync: 'auto', new_items: 'show' },
    }
    expect(SYNC_DEFAULTS).toEqual(expected)
    for (const config of [{}, null, undefined, 'text', 42, [], { schedule: 1, publish: [] }]) {
      expect(parseSyncSettings(config), JSON.stringify(config)).toEqual(expected)
    }
  })

  it('reads every stored value', () => {
    const settings = parseSyncSettings({
      schedule: {
        incremental_enabled: false,
        incremental_minutes: 30,
        full_pull_enabled: false,
        full_pull_time: '03:45',
      },
      publish: { after_sync: 'manual', new_items: 'hold' },
    })
    expect(settings).toEqual({
      schedule: {
        incremental_enabled: false,
        incremental_minutes: 30,
        full_pull_enabled: false,
        full_pull_time: '03:45',
      },
      publish: { after_sync: 'manual', new_items: 'hold' },
    })
  })

  it('falls back to the default for each unknown value, and keeps the others', () => {
    const settings = parseSyncSettings({
      schedule: {
        incremental_enabled: 'yes',
        incremental_minutes: 7,
        full_pull_enabled: false,
        full_pull_time: '24:00',
      },
      publish: { after_sync: 'sometimes', new_items: 'hold' },
    })
    expect(settings.schedule).toEqual({
      incremental_enabled: true,
      incremental_minutes: 5,
      full_pull_enabled: false,
      full_pull_time: '12:00',
    })
    expect(settings.publish).toEqual({ after_sync: 'auto', new_items: 'hold' })
  })

  it('accepts exactly the listed intervals and well-formed times', () => {
    for (const minutes of INCREMENTAL_MINUTES) {
      expect(
        parseSyncSettings({ schedule: { incremental_minutes: minutes } }).schedule,
      ).toMatchObject({ incremental_minutes: minutes })
    }
    for (const minutes of [0, 2, 3, 60, '5', null, 5.5]) {
      expect(
        parseSyncSettings({ schedule: { incremental_minutes: minutes } }).schedule
          .incremental_minutes,
        String(minutes),
      ).toBe(5)
    }
    for (const time of ['00:00', '09:05', '12:00', '23:59']) {
      expect(
        parseSyncSettings({ schedule: { full_pull_time: time } }).schedule.full_pull_time,
      ).toBe(time)
    }
    for (const time of ['9:05', '12:60', '24:00', '12:00:00', '', 1200, null]) {
      expect(
        parseSyncSettings({ schedule: { full_pull_time: time } }).schedule.full_pull_time,
        String(time),
      ).toBe('12:00')
    }
  })

  describe('the flat key of S3-01b, publish_after_sync', () => {
    it('false still means manual when publish.after_sync is not set', () => {
      expect(publishesAfterSync({ publish_after_sync: false })).toBe(false)
      expect(parseSyncSettings({ publish_after_sync: false }).publish.after_sync).toBe('manual')
      expect(publishesAfterSync({ publish_after_sync: true })).toBe(true)
      expect(publishesAfterSync({ publish_after_sync: 'no' })).toBe(true)
    })

    it('publish.after_sync wins over it, in both directions', () => {
      expect(
        publishesAfterSync({ publish_after_sync: false, publish: { after_sync: 'auto' } }),
      ).toBe(true)
      expect(
        publishesAfterSync({ publish_after_sync: true, publish: { after_sync: 'manual' } }),
      ).toBe(false)
    })

    it('an unknown publish.after_sync falls back to the flat key', () => {
      expect(publishesAfterSync({ publish_after_sync: false, publish: { after_sync: 'x' } })).toBe(
        false,
      )
    })
  })

  it('answers the two questions the worker asks', () => {
    expect(publishesAfterSync({})).toBe(true)
    expect(publishesAfterSync({ publish: { after_sync: 'manual' } })).toBe(false)
    expect(holdsNewItems({})).toBe(false)
    expect(holdsNewItems({ publish: { new_items: 'show' } })).toBe(false)
    expect(holdsNewItems({ publish: { new_items: 'hold' } })).toBe(true)
  })
})

describe('SyncSettingsInputSchema (what the form sends)', () => {
  const valid = {
    schedule: {
      incremental_enabled: true,
      incremental_minutes: 10,
      full_pull_enabled: true,
      full_pull_time: '04:30',
    },
    publish: { after_sync: 'manual', new_items: 'hold' },
  }

  it('accepts a complete, well-formed input', () => {
    expect(SyncSettingsInputSchema.parse(valid)).toEqual(valid)
  })

  it('refuses a value outside the lists, a missing setting and an unknown key', () => {
    const bad = (patch: (input: typeof valid) => unknown) =>
      SyncSettingsInputSchema.safeParse(patch(structuredClone(valid))).success
    expect(
      bad((input) => ({ ...input, schedule: { ...input.schedule, incremental_minutes: 7 } })),
    ).toBe(false)
    expect(
      bad((input) => ({ ...input, schedule: { ...input.schedule, full_pull_time: '4:30' } })),
    ).toBe(false)
    expect(bad((input) => ({ ...input, publish: { ...input.publish, after_sync: 'later' } }))).toBe(
      false,
    )
    expect(bad((input) => ({ ...input, publish: { after_sync: 'auto' } }))).toBe(false)
    expect(bad((input) => ({ ...input, extra: 1 }))).toBe(false)
    expect(bad((input) => ({ ...input, schedule: { ...input.schedule, other: 1 } }))).toBe(false)
  })
})
