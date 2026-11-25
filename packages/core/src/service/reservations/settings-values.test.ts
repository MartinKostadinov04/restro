// The pure side of ticket #325: part 2's stored values and their defaults, the closed dates' shape,
// and what the three new commands are (settings-class, a fresh sign-in, built). The writes
// themselves are the integration tests' (`apply.test.ts`), save one: two closed dates added at
// once both stay (C7 of the 11-18 screen round), which only a database can show and is skipped
// without one.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
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

describe.skipIf(!hasDatabase)('closed dates written at once (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  const staff = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const run = async (command: ServiceCommand) =>
    (await applyService(world.app, command, staff())).result

  beforeAll(async () => {
    world = await openServiceWorld('closed-dates')
    ownerId = await world.addUser('owner')
    expect(
      await run({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand),
    ).toMatchObject({ status: 'accepted' })
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  const storedDates = async () =>
    closedDatesOf(
      (
        await world.owner.query<{ closed_dates: unknown }>(
          'select closed_dates from restro.reservation_settings where venue_id = $1',
          [world.venueId],
        )
      ).rows[0]?.closed_dates,
    )

  /**
   * Runs `command` while another transaction holds the settings row and, once the command waits
   * for it, writes `change` and commits. A command that read the list before the row was free
   * would save over that change; one that locks the row first (`lockSettings`) reads it after.
   */
  const behindAnotherWrite = async (command: ServiceCommand, change: string) => {
    const holder = await world.owner.connect()
    try {
      await holder.query('begin')
      await holder.query(
        'select 1 from restro.reservation_settings where venue_id = $1 for update',
        [world.venueId],
      )
      const answer = run(command)
      const deadline = Date.now() + 10_000
      for (;;) {
        const { rows } = await world.owner.query<{ waiting: string }>(
          `select count(*) as waiting from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and application_name = 'restro-core-closed-dates-tests'`,
        )
        if (Number(rows[0]?.waiting) >= 1) break
        if (Date.now() > deadline) throw new Error('the command never waited for the settings row')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await holder.query(
        `update restro.reservation_settings set closed_dates = ${change} where venue_id = $1`,
        [world.venueId],
      )
      await holder.query('commit')
      return await answer
    } finally {
      holder.release()
    }
  }

  it('keeps both dates when two are added together: the list is locked before it is read (C7)', async () => {
    const add = (date: string) => () =>
      run({ type: 'reservation_closed_date.add', date } as ServiceCommand)
    const answers = await world.saveTogether([add('2027-01-01'), add('2027-01-02')])
    expect(answers.map((answer) => answer.status)).toEqual(['accepted', 'accepted'])
    expect(await storedDates()).toEqual(['2027-01-01', '2027-01-02'])
  })

  it('adds a date to the list as it is after a write it waited for, not as it was (C7)', async () => {
    const answer = await behindAnotherWrite(
      { type: 'reservation_closed_date.add', date: '2027-02-02' } as ServiceCommand,
      `closed_dates || '["2027-02-01"]'::jsonb`,
    )
    expect(answer).toMatchObject({ status: 'accepted' })
    expect(await storedDates()).toEqual(expect.arrayContaining(['2027-02-01', '2027-02-02']))
  })

  it('removes a date from the list as it is after a write it waited for, not as it was (C7)', async () => {
    const answer = await behindAnotherWrite(
      { type: 'reservation_closed_date.remove', date: '2027-01-01' } as ServiceCommand,
      `closed_dates || '["2027-03-01"]'::jsonb`,
    )
    expect(answer).toMatchObject({ status: 'accepted' })
    const dates = await storedDates()
    expect(dates).toContain('2027-03-01')
    expect(dates).not.toContain('2027-01-01')
  })
})
