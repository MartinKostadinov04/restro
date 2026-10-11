import { describe, expect, it } from 'vitest'

import {
  autoPublishPaused,
  INCREMENTAL_MINUTES,
  parseSyncSettings,
  SYNC_DEFAULTS,
  SYNC_TIME_ZONE_DEFAULT,
  SyncSettingsInputSchema,
  syncTimeZone,
  VenuePublishRulesSchema,
  venueHoldsNewItems,
  venueOwnPublishRules,
  venuePublishesAfterSync,
  venuePublishRules,
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

  describe('the flat key of S3-01b, publish_after_sync (what a venue without rules inherits)', () => {
    const afterSync = (config: unknown) => venuePublishesAfterSync({}, config)

    it('false still means manual when publish.after_sync is not set', () => {
      expect(afterSync({ publish_after_sync: false })).toBe(false)
      expect(parseSyncSettings({ publish_after_sync: false }).publish.after_sync).toBe('manual')
      expect(afterSync({ publish_after_sync: true })).toBe(true)
      expect(afterSync({ publish_after_sync: 'no' })).toBe(true)
    })

    it('publish.after_sync wins over it, in both directions', () => {
      expect(afterSync({ publish_after_sync: false, publish: { after_sync: 'auto' } })).toBe(true)
      expect(afterSync({ publish_after_sync: true, publish: { after_sync: 'manual' } })).toBe(false)
    })

    it('an unknown publish.after_sync falls back to the flat key', () => {
      expect(afterSync({ publish_after_sync: false, publish: { after_sync: 'x' } })).toBe(false)
    })
  })

  it('knows when automatic publishing is paused (only a literal true pauses)', () => {
    expect(autoPublishPaused({})).toBe(false)
    expect(autoPublishPaused(null)).toBe(false)
    expect(autoPublishPaused({ publish: { after_sync: 'auto' } })).toBe(false)
    expect(autoPublishPaused({ publish: { auto_paused: true } })).toBe(true)
    expect(autoPublishPaused({ publish: { after_sync: 'manual', auto_paused: true } })).toBe(true)
    for (const value of [false, 'true', 1, null]) {
      expect(autoPublishPaused({ publish: { auto_paused: value } })).toBe(false)
    }
    expect(autoPublishPaused({ auto_paused: true })).toBe(false)
    expect(autoPublishPaused({ publish: 'paused' })).toBe(false)
    // It is not a setting: the parsed settings do not carry it.
    expect(parseSyncSettings({ publish: { auto_paused: true } })).toEqual(parseSyncSettings({}))
  })

  it('answers the two questions the worker asks, for a venue with no rules of its own', () => {
    expect(venuePublishesAfterSync({}, {})).toBe(true)
    expect(venuePublishesAfterSync({}, { publish: { after_sync: 'manual' } })).toBe(false)
    expect(venueHoldsNewItems({}, {})).toBe(false)
    expect(venueHoldsNewItems({}, { publish: { new_items: 'show' } })).toBe(false)
    expect(venueHoldsNewItems({}, { publish: { new_items: 'hold' } })).toBe(true)
  })
})

describe('the publishing rules of a venue (CF-09b, CF-04, D73)', () => {
  const venue = (publish: unknown) => ({ theme: { logo_asset_id: null }, publish })

  it('a venue with no rules of its own reads the integration’s, and the defaults below it', () => {
    expect(venuePublishRules({}, {})).toEqual({ after_sync: 'auto', new_items: 'show' })
    expect(venuePublishRules(undefined, undefined)).toEqual({
      after_sync: 'auto',
      new_items: 'show',
    })
    expect(venuePublishRules({}, { publish: { after_sync: 'manual', new_items: 'hold' } })).toEqual(
      { after_sync: 'manual', new_items: 'hold' },
    )
    expect(venueOwnPublishRules({})).toEqual({ after_sync: null, new_items: null })
  })

  it('its own value wins over the integration’s, for each rule on its own', () => {
    const integration = { publish: { after_sync: 'manual', new_items: 'hold' } }
    expect(
      venuePublishRules(venue({ after_sync: 'auto', new_items: 'show' }), integration),
    ).toEqual({ after_sync: 'auto', new_items: 'show' })
    // Only one rule saved: the other is still the integration’s.
    expect(venuePublishRules(venue({ after_sync: 'auto' }), integration)).toEqual({
      after_sync: 'auto',
      new_items: 'hold',
    })
    expect(venuePublishRules(venue({ new_items: 'show' }), integration)).toEqual({
      after_sync: 'manual',
      new_items: 'show',
    })
    expect(venueOwnPublishRules(venue({ after_sync: 'manual', new_items: 'hold' }))).toEqual({
      after_sync: 'manual',
      new_items: 'hold',
    })
  })

  it('answers the two questions the worker asks for the venue, not for the integration', () => {
    const manualIntegration = { publish: { after_sync: 'manual', new_items: 'hold' } }
    expect(venuePublishesAfterSync(venue({ after_sync: 'auto' }), manualIntegration)).toBe(true)
    expect(venuePublishesAfterSync({}, manualIntegration)).toBe(false)
    expect(venueHoldsNewItems(venue({ new_items: 'show' }), manualIntegration)).toBe(false)
    expect(venueHoldsNewItems({}, manualIntegration)).toBe(true)
    expect(venuePublishesAfterSync(venue({ after_sync: 'manual' }), {})).toBe(false)
    expect(venueHoldsNewItems(venue({ new_items: 'hold' }), {})).toBe(true)
  })

  it('ignores an unknown or mistyped own value and never throws on junk', () => {
    const integration = { publish: { after_sync: 'manual', new_items: 'hold' } }
    const junkRules = [
      { after_sync: 'later', new_items: 5 },
      'text',
      12,
      null,
      [],
      { after_sync: null },
    ]
    for (const junk of junkRules) {
      expect(venuePublishRules(venue(junk), integration), JSON.stringify(junk)).toEqual({
        after_sync: 'manual',
        new_items: 'hold',
      })
    }
    for (const settings of [null, undefined, 'x', 7, [], { publish: 'x' }]) {
      expect(venueOwnPublishRules(settings)).toEqual({ after_sync: null, new_items: null })
    }
  })

  it('the Rules card sends both rules from their lists, nothing else', () => {
    expect(VenuePublishRulesSchema.parse({ after_sync: 'manual', new_items: 'hold' })).toEqual({
      after_sync: 'manual',
      new_items: 'hold',
    })
    for (const bad of [
      { after_sync: 'later', new_items: 'hold' },
      { after_sync: 'auto' },
      { after_sync: 'auto', new_items: 'show', auto_paused: true },
      {},
    ]) {
      expect(VenuePublishRulesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('SyncSettingsInputSchema (what the automatic-sync form sends)', () => {
  const valid = {
    schedule: {
      incremental_enabled: true,
      incremental_minutes: 10,
      full_pull_enabled: true,
      full_pull_time: '04:30',
    },
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
    // The publishing rules are per venue now: the schedule form refuses them.
    expect(bad((input) => ({ ...input, publish: { after_sync: 'auto', new_items: 'show' } }))).toBe(
      false,
    )
    expect(bad(() => ({}))).toBe(false)
    expect(bad((input) => ({ ...input, extra: 1 }))).toBe(false)
    expect(bad((input) => ({ ...input, schedule: { ...input.schedule, other: 1 } }))).toBe(false)
  })
})

describe('syncTimeZone (CF-16, D73: one schedule per integration)', () => {
  it('is Europe/Sofia unless the integration names a zone this runtime knows', () => {
    expect(SYNC_TIME_ZONE_DEFAULT).toBe('Europe/Sofia')
    expect(syncTimeZone(undefined)).toBe('Europe/Sofia')
    expect(syncTimeZone({})).toBe('Europe/Sofia')
    expect(syncTimeZone({ schedule: { full_pull_time: '12:00' } })).toBe('Europe/Sofia')
    expect(syncTimeZone({ schedule: { time_zone: 'Europe/London' } })).toBe('Europe/London')
    for (const junk of ['Mars/Olympus', '', 12, null, 'x'.repeat(65)]) {
      expect(syncTimeZone({ schedule: { time_zone: junk } }), String(junk)).toBe('Europe/Sofia')
    }
    expect(syncTimeZone({ schedule: 'junk' })).toBe('Europe/Sofia')
  })
})
