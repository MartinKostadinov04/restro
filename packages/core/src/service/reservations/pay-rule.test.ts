// The pure side of the pay rule a reservation carries (#334): the sitting boundary, the rule that
// wins where two parties sit at one table, and what the Log and the schema make of a rule. The
// resolution over the levels is tested in `pay-first-settings.test.ts`, where it lives.
//
// The handler itself is at the bottom of this file, on a real Postgres and skipped without one:
// the Log entry each change leaves, the refusals, and the sitting boundary end to end.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { readTonight } from '../read'
import {
  PayRuleSchema,
  payRuleCode,
  payRuleInForce,
  SetPayRuleSchema,
  storedPayRule,
  strictestPayRule,
} from './pay-rule'
import { readReservationDetail } from './read'

const at = (iso: string) => new Date(iso)

describe('the sitting boundary (#334)', () => {
  it('holds while the sitting opened no later than the party took its spot', () => {
    expect(payRuleInForce(at('2026-11-10T20:00:00Z'), at('2026-11-10T20:30:00Z'))).toBe(true)
    // The table was opened in the very transaction that seated the party: both are `now()`.
    expect(payRuleInForce(at('2026-11-10T20:00:00Z'), at('2026-11-10T20:00:00Z'))).toBe(true)
  })

  it('stops at a sitting that began after the party took its spot', () => {
    // "No, new guests" ends the sitting and opens another: the rule does not reach the new one.
    expect(payRuleInForce(at('2026-11-10T23:00:00Z'), at('2026-11-10T20:30:00Z'))).toBe(false)
    expect(payRuleInForce(at('2026-11-10T20:00:00.001Z'), at('2026-11-10T20:00:00Z'))).toBe(false)
  })
})

describe('two parties at one table (#334, rule 5)', () => {
  it('takes the more cautious rule, never the newer one', () => {
    expect(strictestPayRule(['on_bill', 'pay_first'])).toBe('pay_first')
    expect(strictestPayRule(['pay_first', 'on_bill'])).toBe('pay_first')
    expect(strictestPayRule([null, 'on_bill'])).toBe('on_bill')
    expect(strictestPayRule(['on_bill', null])).toBe('on_bill')
    expect(strictestPayRule([null, null])).toBe(null)
    expect(strictestPayRule([])).toBe(null)
    expect(strictestPayRule(['pay_first'])).toBe('pay_first')
  })

  it('gives the same answer whichever order it reads them in', () => {
    const rules = [null, 'on_bill', 'pay_first'] as const
    for (const one of rules) {
      for (const other of rules) {
        expect(strictestPayRule([one, other])).toBe(strictestPayRule([other, one]))
      }
    }
  })
})

describe("a stored rule and the Log's word for it (#334)", () => {
  it('reads only the two rules there are, and anything else as none', () => {
    expect(storedPayRule('on_bill')).toBe('on_bill')
    expect(storedPayRule('pay_first')).toBe('pay_first')
    expect(storedPayRule(null)).toBe(null)
    expect(storedPayRule('')).toBe(null)
    expect(storedPayRule('venue')).toBe(null)
    expect(storedPayRule('prepay')).toBe(null)
  })

  it("writes the club's own rule as `venue`, as the other levels' Log does", () => {
    expect(payRuleCode(null)).toBe('venue')
    expect(payRuleCode('on_bill')).toBe('on_bill')
    expect(payRuleCode('pay_first')).toBe('pay_first')
  })

  it('takes the two rules and null at its boundary, and nothing else', () => {
    expect(PayRuleSchema.parse('on_bill')).toBe('on_bill')
    expect(PayRuleSchema.parse(null)).toBe(null)
    expect(PayRuleSchema.safeParse('venue').success).toBe(false)
    expect(PayRuleSchema.safeParse(undefined).success).toBe(false)
    expect(
      SetPayRuleSchema.safeParse({
        type: 'reservation.set_pay_rule',
        reservationId: 'rv_1',
        rule: 'pay_first',
        expectedVersion: '2026-11-10T20:00:00.000Z',
      }).success,
    ).toBe(true)
    // A version that is not a moment, and a field nobody asked for, are both refused.
    expect(
      SetPayRuleSchema.safeParse({
        type: 'reservation.set_pay_rule',
        reservationId: 'rv_1',
        rule: null,
        expectedVersion: 'tonight',
      }).success,
    ).toBe(false)
    expect(
      SetPayRuleSchema.safeParse({
        type: 'reservation.set_pay_rule',
        reservationId: 'rv_1',
        rule: null,
        amount: 1000,
      }).success,
    ).toBe(false)
  })
})

describe.skipIf(!hasDatabase)('the pay rule a party carries (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  /** A hostess who works tonight's floor and takes bookings, and nothing more. */
  let hostessId: string
  /** The same role with the one right this ticket adds, so a venue may give it to a hostess. */
  let rulerId: string
  let planId: string
  let today: string
  const spots = new Map<string, string>()
  const spotId = (name: string) => spots.get(name) as Id<'sp'>
  const tableOf = (name: string) => world.tables[Number(name.slice(1)) - 1] as Id<'tb'>

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result
  async function accept(
    command: ServiceCommand,
    context: ServiceContext = staff(ownerId),
  ): Promise<Record<string, unknown>> {
    const result = await run(command, context)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  const book = async (spotNames: readonly string[], over: Record<string, unknown> = {}) =>
    (
      await accept({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'reserved',
        partySize: 4,
        partyLabel: `Party ${randomUUID().slice(0, 6)}`,
        phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        spotIds: spotNames.map(spotId),
        ...over,
      } as ServiceCommand)
    ).reservationId as Id<'rv'>

  const setRule = (
    reservationId: string,
    rule: 'on_bill' | 'pay_first' | null,
    over: Record<string, unknown> = {},
    context?: ServiceContext,
  ) =>
    run(
      { type: 'reservation.set_pay_rule', reservationId, rule, ...over } as ServiceCommand,
      context,
    )

  const storedRuleOf = async (reservationId: string) =>
    (
      await world.owner.query<{ pay_rule: string | null }>(
        'select pay_rule from restro.reservations where id = $1',
        [reservationId],
      )
    ).rows[0]?.pay_rule ?? null

  /** Every pay-rule line of one party's Log, oldest first. */
  const logOf = async (reservationId: string) =>
    (
      await world.owner.query<{
        from_state: string | null
        to_state: string | null
        actor: string
        at: Date
        retention: string
        details: Record<string, unknown>
      }>(
        `select from_state, to_state, actor, at, retention, details from restro.log_entries
          where reservation_id = $1 and kind = 'reservation.pay_rule' order by seq`,
        [reservationId],
      )
    ).rows

  const detailOf = async (reservationId: string, userId: string = ownerId) => {
    const read = await readReservationDetail(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: staff(userId).actor,
      reservationId,
    })
    if (!read.ok || read.detail === null) throw new Error('detail not read')
    return read.detail
  }

  /** What Tonight draws for one table: the rule in force there and the level that decided it. */
  const tileOf = async (tableId: string) => {
    const read = await readTonight(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: staff(ownerId).actor,
    })
    if (!read.ok) throw new Error(`tonight refused: ${read.code}`)
    const table = read.tonight.tables.find((one) => one.id === tableId)
    if (table === undefined) throw new Error(`no table ${tableId}`)
    return table.payRule
  }

  beforeAll(async () => {
    world = await openServiceWorld('reservation-pay-rule')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight', 'reservations.manage'], hostessId)
    rulerId = await world.addUser('member')
    await world.addStaff(
      ['reservations.tonight', 'reservations.manage', 'reservations.pay_rule'],
      rulerId,
    )
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    // The house rule a club actually runs on: everything on the bill. Then a party's own rule is
    // visible as a rule rather than as the same answer the venue was giving anyway.
    await accept({ type: 'pay_first.set', change: { applies: false } } as ServiceCommand)
    await accept({ type: 'reservation_settings.set', turnMinutes: 90 } as ServiceCommand)
    planId = (await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['D1', 'D2', 'D3', 'D4', 'D5'].entries()) {
      const details = await accept({
        type: 'spot.save',
        planId,
        name,
        kind: 'table',
        shape: 'rect',
        x: index * 100,
        y: 0,
        width: 80,
        height: 80,
        tableId: world.tables[index],
      } as ServiceCommand)
      spots.set(name, details.spotId as string)
    }
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('keeps one Log entry for every change, with who and when, and none for a repeated tap', async () => {
    const id = await book(['D1'])
    expect(await setRule(id, 'pay_first')).toMatchObject({
      status: 'accepted',
      details: { rule: 'pay_first', changed: true },
    })
    expect(await storedRuleOf(id)).toBe('pay_first')
    expect((await detailOf(id)).payRule).toMatchObject({ rule: 'pay_first' })
    expect(await setRule(id, 'on_bill')).toMatchObject({ status: 'accepted' })
    // Taking the choice away again is a change of its own, and the Log says so in words.
    expect(await setRule(id, null)).toMatchObject({
      status: 'accepted',
      details: { rule: 'venue', changed: true },
    })
    expect(await storedRuleOf(id)).toBeNull()
    // The same rule again writes nothing and logs nothing: a repeated tap is the same tap.
    expect(await setRule(id, null)).toMatchObject({
      status: 'accepted',
      details: { rule: 'venue', changed: false },
    })
    const log = await logOf(id)
    expect(log.map((line) => [line.from_state, line.to_state])).toEqual([
      ['venue', 'pay_first'],
      ['pay_first', 'on_bill'],
      ['on_bill', 'venue'],
    ])
    for (const line of log) {
      expect(line.actor).toBe('user')
      expect(line.at).toBeInstanceOf(Date)
      // Kept as long as the other levels' changes are (D122 §7): this is who decided a guest pays.
      expect(line.retention).toBe('record')
    }
    expect(log[0]?.details).toMatchObject({ rule: 'pay_first', previous: 'venue' })
  })

  it('touches the row, so a sheet open on the old version is refused rather than saving over it', async () => {
    const id = await book(['D2'])
    const was = (await detailOf(id)).version
    expect(await setRule(id, 'pay_first', { expectedVersion: was })).toMatchObject({
      status: 'accepted',
    })
    const now = (await detailOf(id)).version
    expect(now).not.toBe(was)
    // The other screen still holds the version it read: its save is refused and writes nothing.
    expect(await setRule(id, 'on_bill', { expectedVersion: was })).toMatchObject({
      status: 'refused',
      code: 'reservation_stale',
    })
    expect(await storedRuleOf(id)).toBe('pay_first')
    expect(await logOf(id)).toHaveLength(1)
  })

  it('is a right of its own: seating a party is not deciding how it pays', async () => {
    const id = await book(['D3'])
    expect(await setRule(id, 'pay_first', {}, staff(hostessId))).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect(await storedRuleOf(id)).toBeNull()
    expect(await logOf(id)).toHaveLength(0)
    // The very same role with the one right a venue may give a hostess (D141, #324).
    expect(await setRule(id, 'pay_first', {}, staff(rulerId))).toMatchObject({ status: 'accepted' })
    expect(await storedRuleOf(id)).toBe('pay_first')
  })

  it('refuses a block, which is nobody at a table, and a party whose night is over', async () => {
    const block = (
      await accept({
        type: 'block.save',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        endsAt: null,
        spotIds: [spotId('D4')],
        reason: 'repair',
      } as ServiceCommand)
    ).reservationId as Id<'rv'>
    expect(await setRule(block, 'pay_first')).toMatchObject({
      status: 'refused',
      code: 'kind_not_allowed',
    })
    const gone = await book(['D4'])
    await accept({ type: 'reservation.set_status', reservationId: gone, status: 'no_show' })
    expect(await setRule(gone, 'pay_first')).toMatchObject({
      status: 'refused',
      code: 'status_move_not_allowed',
    })
    expect(await storedRuleOf(gone)).toBeNull()
  })

  it('holds for the sitting the party was seated on, and stops at the next one', async () => {
    const id = await book(['D5'])
    await accept({ type: 'reservation.set_pay_rule', reservationId: id, rule: 'pay_first' })
    // Closed: a rule is about a sitting, and a shut table has none.
    expect(await tileOf(tableOf('D5'))).toBeNull()
    await accept({ type: 'reservation.arrive', reservationId: id })
    expect(await tileOf(tableOf('D5'))).toEqual({ payFirst: true, level: 'reservation' })
    // "No, new guests" — ordering's own renewal (#329). The rule does not reach the new sitting.
    await accept({ type: 'table.new_guests', tableId: tableOf('D5') })
    expect(await tileOf(tableOf('D5'))).toEqual({ payFirst: false, level: 'venue' })
    // And the party still carries it: what ended is this sitting, not the choice someone made.
    expect(await storedRuleOf(id)).toBe('pay_first')
  })

  it("loses to a table's own setting, and the sheet says which rule applies and why", async () => {
    const id = await book(['D1'])
    await accept({ type: 'reservation.set_pay_rule', reservationId: id, rule: 'pay_first' })
    await accept({ type: 'reservation.arrive', reservationId: id })
    expect(await tileOf(tableOf('D1'))).toEqual({ payFirst: true, level: 'reservation' })
    // The table itself is on the bill, whatever the party was told: the table decides (D122 §5).
    await accept({
      type: 'pay_first.set',
      change: { table: tableOf('D1'), value: false },
    } as ServiceCommand)
    expect(await tileOf(tableOf('D1'))).toEqual({ payFirst: false, level: 'table' })
    expect((await detailOf(id)).payRule).toEqual({
      rule: 'pay_first',
      beaten: [{ spot: 'D1', rule: 'on_bill' }],
    })
    // A table that pays first beats the party the same way round.
    await accept({
      type: 'pay_first.set',
      change: { table: tableOf('D1'), value: true },
    } as ServiceCommand)
    expect(await tileOf(tableOf('D1'))).toEqual({ payFirst: true, level: 'table' })
    expect((await detailOf(id)).payRule.beaten).toEqual([{ spot: 'D1', rule: 'pay_first' }])
    await accept({
      type: 'pay_first.set',
      change: { table: tableOf('D1'), value: null },
    } as ServiceCommand)
    expect((await detailOf(id)).payRule.beaten).toEqual([])
  })
})
