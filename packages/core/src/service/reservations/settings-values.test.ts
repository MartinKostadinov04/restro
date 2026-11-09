// The pure side of ticket #325: part 2's stored values and their defaults, the closed dates' shape,
// and what the three new commands are (settings-class, a fresh sign-in, built). The writes
// themselves are the integration tests' (`apply.test.ts`); nothing here needs a database.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { ClosedDateSchema, closedDatesOf } from './closed-dates'
import { RESERVATION_COMMANDS } from './commands'
import {
  DEFAULT_ONLINE_SETTINGS,
  OnlineSettingsSchema,
  PREPAYMENT_MAX_MINOR,
  readOnlineSettings,
} from './online-settings'

describe("part 2's values", () => {
  it('start cautious: a night only, nothing confirms itself, no prepayment, no wording', () => {
    expect(DEFAULT_ONLINE_SETTINGS).toEqual({
      guestMay: 'night',
      autoConfirm: false,
      prepayment: false,
      prepaymentMinor: null,
      prepaymentWording: {},
      refundWording: {},
    })
  })

  it('keep the prepayment as a whole number of minor units, never a float (rule 8)', () => {
    expect(OnlineSettingsSchema.safeParse({ prepaymentMinor: 2500 }).success).toBe(true)
    expect(OnlineSettingsSchema.safeParse({ prepaymentMinor: 25.5 }).success).toBe(false)
    expect(OnlineSettingsSchema.safeParse({ prepaymentMinor: 0 }).success).toBe(false)
    expect(
      OnlineSettingsSchema.safeParse({ prepaymentMinor: PREPAYMENT_MAX_MINOR + 1 }).success,
    ).toBe(false)
  })

  it('keep the wording per language and refuse an unknown key', () => {
    const wording = {
      en: 'Refundable up to 48 hours before.',
      bg: 'Възстановява се до 48 часа преди.',
    }
    expect(OnlineSettingsSchema.parse({ refundWording: wording }).refundWording).toEqual(wording)
    expect(OnlineSettingsSchema.safeParse({ refundWording: { english: 'x' } }).success).toBe(false)
    expect(OnlineSettingsSchema.safeParse({ somethingElse: true }).success).toBe(false)
  })

  it('read as the defaults when what is stored is not what the schema accepts', () => {
    expect(readOnlineSettings({})).toEqual(DEFAULT_ONLINE_SETTINGS)
    expect(readOnlineSettings({ guestMay: 'everything' })).toEqual(DEFAULT_ONLINE_SETTINGS)
    expect(readOnlineSettings({ guestMay: 'spot' }).guestMay).toBe('spot')
  })

  it("are the column's own default in the database, so a row made any other way agrees", () => {
    const folder = join(__dirname, '../../../../db/migrations')
    const migration = readdirSync(folder).find((file) => file.endsWith('_reservation_rules.sql'))
    expect(migration, 'the migration of ticket #325').toBeDefined()
    const sql = readFileSync(join(folder, migration as string), 'utf8')
    const literal = /ALTER COLUMN "online" SET DEFAULT '(\{.*?\})'::jsonb/.exec(sql)?.[1]
    expect(literal, 'the migration sets the default of `online`').toBeDefined()
    expect(JSON.parse(literal as string)).toEqual(DEFAULT_ONLINE_SETTINGS)
  })
})

describe('closed dates', () => {
  it('are real service days, as YYYY-MM-DD', () => {
    expect(ClosedDateSchema.safeParse('2026-12-24').success).toBe(true)
    expect(ClosedDateSchema.safeParse('2028-02-29').success).toBe(true)
    expect(ClosedDateSchema.safeParse('2027-02-29').success).toBe(false)
    expect(ClosedDateSchema.safeParse('2026-13-01').success).toBe(false)
    expect(ClosedDateSchema.safeParse('24/12/2026').success).toBe(false)
  })

  it('read as the days that are real, each once, oldest first', () => {
    expect(closedDatesOf(['2026-12-31', '2026-12-24', '2026-12-31', 'nonsense', 7])).toEqual([
      '2026-12-24',
      '2026-12-31',
    ])
    expect(closedDatesOf(['2026-12-31', '2026-12-24', '2026-12-31'])).toEqual([
      '2026-12-24',
      '2026-12-31',
    ])
    expect(closedDatesOf(null)).toEqual([])
  })
})

describe("ticket #325's commands", () => {
  const SETTINGS_CLASS = [
    'reservation_settings.set',
    'reservation_closed_date.add',
    'reservation_closed_date.remove',
    'spot.set_seats',
  ] as const

  it('need the reservation settings and the password again, from a person only', () => {
    for (const type of SETTINGS_CLASS) {
      const definition = RESERVATION_COMMANDS[type]
      expect(definition.permission, type).toBe('settings.reservations')
      expect(definition.freshSignIn, type).toBe(true)
      expect(definition.origins, type).toEqual(['staff'])
      expect(definition.handle, type).not.toBeNull()
    }
  })

  it('take only the values they name', () => {
    const add = RESERVATION_COMMANDS['reservation_closed_date.add'].schema
    expect(add.safeParse({ type: 'reservation_closed_date.add', date: '2026-12-24' }).success).toBe(
      true,
    )
    expect(add.safeParse({ type: 'reservation_closed_date.add', date: '2026-02-30' }).success).toBe(
      false,
    )
    const seats = RESERVATION_COMMANDS['spot.set_seats'].schema
    const spotId = 'sp_0000000000000000000001'
    expect(seats.safeParse({ type: 'spot.set_seats', spotId, seats: 6 }).success).toBe(true)
    expect(seats.safeParse({ type: 'spot.set_seats', spotId, seats: null }).success).toBe(true)
    expect(seats.safeParse({ type: 'spot.set_seats', spotId, seats: 0 }).success).toBe(false)
    expect(seats.safeParse({ type: 'spot.set_seats', spotId, seats: 101 }).success).toBe(false)
    // Part 2's values have no command: nothing writes them from part 1.
    const set = RESERVATION_COMMANDS['reservation_settings.set'].schema
    expect(
      set.safeParse({ type: 'reservation_settings.set', online: { autoConfirm: true } }).success,
    ).toBe(false)
  })
})
