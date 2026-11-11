// The door on a real Postgres (ticket #329): arrival, walk-ins, the guest count, the undo and
// freeing, each through `applyService`. What is pinned here is what only a database can show.
//
// Three of these tests are the ones the lead asked for by name, and they are the reason this file
// exists rather than another describe block in `apply.test.ts`:
//
// 1. **One way to open a table.** Marking a party present opens its Table's codes through the very
//    path ordering uses — the sitting it leaves behind is the same row `table.open` would have
//    written, and `table.close` ends it. There is no second opener to drift from the first.
// 2. **The same-guests question is never answered by a default, and "New guests" is never sent on
//    its own.** With a table already open and no answer the command is *refused*; the answer "the
//    same guests" keeps the sitting the order hangs on, and only "new guests" renews it. No status
//    command can reach Seated, so these are the only doors in.
// 3. **Seating asks who is **on** the spot, never the booking rule.** A party still at its table
//    long past the turn time stops a walk-in, while a *booking* for that same hour is allowed.
//
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { type Id, newId } from '../../ids'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { readArrivalChecks, readTablesTonight } from './arrive-checks'

/** The venue's turn time in these tests: ninety minutes, as a club's would be. */
const TURN = 90

describe.skipIf(!hasDatabase)('the door (as the restro_app role)', () => {
  let world: ServiceWorld
  /** The owner: holds every permission, so she is the hostess with the right to open a table. */
  let ownerId: string
  /** A person whose role works tonight's floor but may not open or close a Table (D122 §7). */
  let floorOnlyId: string
  let planId: string
  /** Tonight, as the venue counts a service day (D45): every test below works on it. */
  let today: string
  /** The spots of the plan, each one its own Table: `D1` is `world.tables[0]`, and so on. */
  const spots = new Map<string, string>()

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

  const spotId = (name: string) => spots.get(name) as Id<'sp'>
  const tableOf = (name: string) => world.tables[Number(name.slice(1)) - 1] as Id<'tb'>

  /** The open sitting of a table, or null: this is "the table is open for phones". */
  const openSittingOf = async (tableId: string) =>
    (
      await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
    ).rows[0]?.id ?? null

  const reservationOf = async (id: string) =>
    (
      await world.owner.query<{
        status: string
        kind: string
        party_size: number | null
        ends_at: Date | null
        seated_at: Date | null
        ended_at: Date | null
        reason: string | null
      }>(
        `select status, kind, party_size, ends_at, seated_at, ended_at, reason
           from restro.reservations where id = $1`,
        [id],
      )
    ).rows[0]

  /**
   * Every hold row a reservation has, released ones included: where a party sat is kept, never
   * deleted, so a party seated after it was booked has the booking's released row as well.
   */
  const heldSpotsOf = async (reservationId: string) =>
    (
      await world.owner.query<{ spot_id: string; held_to: Date | null; released_at: Date | null }>(
        `select spot_id, held_to, released_at from restro.reservation_spots
          where reservation_id = $1 order by spot_id`,
        [reservationId],
      )
    ).rows

  /** The spots it holds *now*, with the hour each hold runs to: the rows nobody has released. */
  const stillHeldBy = async (reservationId: string) =>
    (await heldSpotsOf(reservationId)).filter((row) => row.released_at === null)

  /** A payment of the sitting that nobody has settled: what `payment_in_flight` is about. */
  const payingOn = async (tableId: string, sittingId: string) => {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          action_id, amount_minor, tip_minor, currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'held', $7, $8, 1200, 0, 'EUR',
               'sim', 'guest', 'guest', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        today,
        createHash('sha256').update(randomUUID()).digest('hex'),
        randomUUID(),
      ],
    )
    return id
  }

  const settle = (paymentId: string) =>
    world.owner.query(
      `update restro.payments set state = 'captured', captured_minor = 1200, settled_at = now()
        where id = $1`,
      [paymentId],
    )

  /** A booking tonight on `spotNames`, at the hour given (the default is right now). */
  const book = async (
    spotNames: readonly string[],
    over: Record<string, unknown> = {},
  ): Promise<Id<'rv'>> =>
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

  beforeAll(async () => {
    world = await openServiceWorld('door')
    ownerId = await world.addUser('owner')
    floorOnlyId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], floorOnlyId)
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await accept({ type: 'reservation_settings.set', turnMinutes: TURN } as ServiceCommand)
    planId = (await accept({ type: 'plan.save', name: 'Floor', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    // Every spot is one Table of the venue, which is what makes the door's table work visible.
    for (const [index, name] of ['D1', 'D2', 'D3', 'D4'].entries()) {
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

  /**
   * The floor, cleared between tests. Every test below brings its own party and most leave it
   * sitting where it sat — which is what a night looks like, but it would hand the next test a
   * `spot_taken` from the party before it. Cleared as the owner, in SQL, on purpose: this is the
   * file's own book-keeping, and sending it through the commands would test them with itself.
   */
  afterEach(async () => {
    if (world === undefined) return
    await world.owner.query(
      `update restro.reservation_spots set released_at = now()
        where released_at is null and tenant_id = $1`,
      [world.tenantId],
    )
    await world.owner.query(
      `update restro.reservations set status = 'finished', ended_at = now()
        where venue_id = $1 and status in ('requested', 'reserved', 'waiting', 'seated')`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.payments set state = 'captured', captured_minor = 1200, settled_at = now()
        where venue_id = $1 and settled_at is null`,
      [world.venueId],
    )
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed'
        where venue_id = $1 and ended_at is null`,
      [world.venueId],
    )
  })

  it('opens the table for phones through the one open path, and Tonight closes that same sitting', async () => {
    const id = await book(['D1'])
    expect(await openSittingOf(tableOf('D1'))).toBeNull()
    const details = await accept({ type: 'reservation.arrive', reservationId: id })
    // The arrival says which tables it opened, and that list is what its undo closes again.
    expect(details).toMatchObject({
      status: 'seated',
      changed: true,
      opened: tableOf('D1'),
      tablesOpen: 1,
    })
    const sittingId = await openSittingOf(tableOf('D1'))
    expect(sittingId).not.toBeNull()
    // The same row Tonight writes and ends: one opener, one closer, no second path to drift.
    await accept({ type: 'table.close', tableId: tableOf('D1') })
    expect(await openSittingOf(tableOf('D1'))).toBeNull()
    // D134 again, from the door's side: closing the table says nothing about the party.
    expect(await reservationOf(id)).toMatchObject({ status: 'seated', ended_at: null })
  })

  it('refuses to seat anybody while the same-guests question is unanswered', async () => {
    // A waiter opened the table before the hostess brought the party: an order may be on it.
    await accept({ type: 'table.open', tableId: tableOf('D2') })
    const was = await openSittingOf(tableOf('D2'))
    const id = await book(['D2'])
    expect(await run({ type: 'reservation.arrive', reservationId: id })).toMatchObject({
      status: 'refused',
      code: 'same_guests_unanswered',
      details: { tableId: tableOf('D2') },
    })
    // Nothing moved: not the party, not the sitting its order hangs on.
    expect(await reservationOf(id)).toMatchObject({ status: 'reserved' })
    expect(await openSittingOf(tableOf('D2'))).toBe(was)

    // "The same guests": the sitting stands, so their order and their phones are untouched.
    expect(
      await accept({ type: 'reservation.arrive', reservationId: id, sameGuests: true }),
    ).toMatchObject({ status: 'seated', kept: tableOf('D2'), renewed: '' })
    expect(await openSittingOf(tableOf('D2'))).toBe(was)
    await accept({ type: 'table.close', tableId: tableOf('D2') })
  })

  it('sends New guests only as the answer to that question, never on its own', async () => {
    await accept({ type: 'table.open', tableId: tableOf('D3') })
    const was = await openSittingOf(tableOf('D3'))
    const id = await book(['D3'])
    expect(
      await accept({ type: 'reservation.arrive', reservationId: id, sameGuests: false }),
    ).toMatchObject({ status: 'seated', renewed: tableOf('D3'), kept: '' })
    // A new sitting: the old order is behind it, and a round the waiter rang stays on the bill.
    const now = await openSittingOf(tableOf('D3'))
    expect(now).not.toBeNull()
    expect(now).not.toBe(was)
    await accept({ type: 'table.close', tableId: tableOf('D3') })
  })

  it('has no other way in: no status command can seat a party (#329)', async () => {
    const id = await book(['D4'])
    // `seated` left the schema, so this is not a refusal of a rule — the command cannot be made.
    expect(
      await run({ type: 'reservation.set_status', reservationId: id, status: 'seated' } as never),
    ).toMatchObject({ status: 'refused', code: 'invalid_command' })
    // Nor can a booking be created already sitting: only the door's own commands seat anybody.
    expect(
      await run({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: new Date().toISOString(),
        kind: 'booking',
        status: 'seated',
        partySize: 2,
        partyLabel: 'Through the back door',
        phone: '+359888111222',
        spotIds: [spotId('D4')],
      } as never),
    ).toMatchObject({ status: 'refused', code: 'invalid_command' })
    expect(await reservationOf(id)).toMatchObject({ status: 'reserved' })
  })

  it('seats a walk-in off the plan, and names the party in the way of the next one', async () => {
    const walkIn = (await accept({
      type: 'reservation.seat_walk_in',
      serviceDate: today,
      spotIds: [spotId('D1')],
      partySize: 3,
    } as ServiceCommand)) as Record<string, unknown>
    const first = walkIn.reservationId as Id<'rv'>
    expect(await reservationOf(first)).toMatchObject({ status: 'seated', kind: 'walk_in' })
    expect(await openSittingOf(tableOf('D1'))).not.toBeNull()

    // The spot is taken by somebody who is **on** it, and the refusal says who, so the hostess
    // can go and move them rather than guess.
    expect(
      await run({
        type: 'reservation.seat_walk_in',
        serviceDate: today,
        spotIds: [spotId('D1')],
        partySize: 2,
      } as ServiceCommand),
    ).toMatchObject({
      status: 'refused',
      code: 'spot_taken',
      details: { spotId: spotId('D1'), reservationId: first },
    })

    // A **booking** for the same spot later tonight is allowed all the same: the turn time is a
    // planning assumption, and the two questions disagree here on purpose (`overlap.ts`).
    const later = new Date(Date.now() + 4 * 60 * 60_000).toISOString()
    expect(
      await run({
        type: 'reservation.create',
        serviceDate: today,
        startsAt: later,
        kind: 'booking',
        status: 'reserved',
        partySize: 2,
        partyLabel: 'Later tonight',
        phone: '+359888333444',
        spotIds: [spotId('D1')],
      } as ServiceCommand),
    ).toMatchObject({ status: 'accepted' })

    await accept({ type: 'reservation.release_spots', reservationId: first })
  })

  it('takes the hour she chose when a party is seated early', async () => {
    const id = await book(['D2'], { startsAt: new Date(Date.now() + 90 * 60_000).toISOString() })
    const until = new Date(Date.now() + 2 * 60 * 60_000)
    await accept({
      type: 'reservation.arrive',
      reservationId: id,
      endsAt: until.toISOString(),
    } as ServiceCommand)
    const row = await reservationOf(id)
    expect(row?.status).toBe('seated')
    expect(row?.ends_at?.getTime()).toBe(until.getTime())
    // The hold ends at her hour, not at the end of a turn counted from the booked one.
    const held = await stillHeldBy(id)
    expect(held).toHaveLength(1)
    expect(held[0]?.held_to?.getTime()).toBe(until.getTime())
    await accept({ type: 'reservation.release_spots', reservationId: id })
  })

  it('counts more guests joining without touching the table or the order', async () => {
    const id = await book(['D3'])
    await accept({ type: 'reservation.arrive', reservationId: id })
    const sittingId = await openSittingOf(tableOf('D3'))
    expect(
      await accept({ type: 'reservation.set_guests', reservationId: id, partySize: 7 }),
    ).toMatchObject({ partySize: 7, changed: true })
    expect(await reservationOf(id)).toMatchObject({ status: 'seated', party_size: 7 })
    // The same sitting: this is never "New guests", so nothing of the order is cleared.
    expect(await openSittingOf(tableOf('D3'))).toBe(sittingId)
    // The same number again is no change at all, which is what a second tap means.
    expect(
      await accept({ type: 'reservation.set_guests', reservationId: id, partySize: 7 }),
    ).toMatchObject({ changed: false })
    await accept({ type: 'reservation.release_spots', reservationId: id })
  })

  it('waits for a payment on the way instead of closing the table under it', async () => {
    const id = await book(['D4'])
    await accept({ type: 'reservation.arrive', reservationId: id })
    const sittingId = await openSittingOf(tableOf('D4'))
    if (sittingId === null) throw new Error('the arrival opened no table')
    const payment = await payingOn(tableOf('D4'), sittingId)

    expect(await run({ type: 'reservation.release_spots', reservationId: id })).toMatchObject({
      status: 'refused',
      code: 'payment_in_flight',
      details: { tableId: tableOf('D4'), sittingId },
    })
    // An end status is refused the same way, and for the same reason: a guest's card is held.
    expect(
      await run({ type: 'reservation.set_status', reservationId: id, status: 'finished' }),
    ).toMatchObject({ status: 'refused', code: 'payment_in_flight' })
    expect(await reservationOf(id)).toMatchObject({ status: 'seated' })
    expect(await openSittingOf(tableOf('D4'))).toBe(sittingId)

    await settle(payment)
    await accept({ type: 'reservation.release_spots', reservationId: id })
    // Freeing closes the codes and gives the spots back — and leaves the party as it was (D136).
    expect(await openSittingOf(tableOf('D4'))).toBeNull()
    expect((await heldSpotsOf(id)).every((held) => held.released_at !== null)).toBe(true)
    expect(await reservationOf(id)).toMatchObject({ status: 'seated', ended_at: null })

    // And its Undo is the party claiming the same spots again, which opens the codes again.
    await accept({
      type: 'reservation.hold_spots',
      reservationId: id,
      spotIds: [spotId('D4')],
    } as ServiceCommand)
    expect(await openSittingOf(tableOf('D4'))).not.toBeNull()
    await accept({ type: 'reservation.set_status', reservationId: id, status: 'finished' })
  })

  describe('undoing an arrival', () => {
    /** Puts the arrival's Log entry back in time, so the window has really passed. */
    const ageTheArrival = (reservationId: string, minutes: number) =>
      world.owner.query(
        `update restro.log_entries
            set at = at - ($2 || ' minutes')::interval
          where reservation_id = $1 and kind = 'reservation.status' and to_state = 'seated'`,
        [reservationId, String(minutes)],
      )

    it('puts a booking back and closes the table its arrival opened', async () => {
      const id = await book(['D1'])
      await accept({ type: 'reservation.arrive', reservationId: id })
      expect(await openSittingOf(tableOf('D1'))).not.toBeNull()
      await accept({ type: 'reservation.undo_arrival', reservationId: id })
      expect(await reservationOf(id)).toMatchObject({ status: 'reserved', ended_at: null })
      expect(await openSittingOf(tableOf('D1'))).toBeNull()
      expect((await heldSpotsOf(id)).every((held) => held.released_at !== null)).toBe(true)
    })

    it('leaves a table the waiter had open before the party sat down alone', async () => {
      await accept({ type: 'table.open', tableId: tableOf('D2') })
      const his = await openSittingOf(tableOf('D2'))
      const id = await book(['D2'])
      await accept({ type: 'reservation.arrive', reservationId: id, sameGuests: true })
      await accept({ type: 'reservation.undo_arrival', reservationId: id })
      expect(await reservationOf(id)).toMatchObject({ status: 'reserved' })
      // The undo of a write never closes what that write did not open.
      expect(await openSittingOf(tableOf('D2'))).toBe(his)
      await accept({ type: 'table.close', tableId: tableOf('D2') })
    })

    it('cancels a walk-in the seat tap itself made, and never deletes its row', async () => {
      const id = (
        await accept({
          type: 'reservation.seat_walk_in',
          serviceDate: today,
          spotIds: [spotId('D3')],
          partySize: 2,
        } as ServiceCommand)
      ).reservationId as Id<'rv'>
      await accept({ type: 'reservation.undo_arrival', reservationId: id })
      // It was never on the waiting list, so there is nowhere to put it back to (D135).
      expect(await reservationOf(id)).toMatchObject({
        status: 'cancelled',
        reason: 'arrival_undone',
      })
      expect(await openSittingOf(tableOf('D3'))).toBeNull()
    })

    it('puts a waiting walk-in back on the waiting list', async () => {
      const id = (
        await accept({
          type: 'waiting.add',
          serviceDate: today,
          partySize: 2,
          partyLabel: 'At the bar',
        } as ServiceCommand)
      ).reservationId as Id<'rv'>
      await accept({
        type: 'reservation.hold_spots',
        reservationId: id,
        spotIds: [spotId('D4')],
      } as ServiceCommand)
      await accept({ type: 'reservation.arrive', reservationId: id })
      await accept({ type: 'reservation.undo_arrival', reservationId: id })
      expect(await reservationOf(id)).toMatchObject({ status: 'waiting' })
      await accept({ type: 'reservation.release_spots', reservationId: id })
    })

    it('refuses an undo that comes too late, rather than quietly doing it', async () => {
      const id = await book(['D1'])
      await accept({ type: 'reservation.arrive', reservationId: id })
      await ageTheArrival(id, 5)
      expect(await run({ type: 'reservation.undo_arrival', reservationId: id })).toMatchObject({
        status: 'refused',
        code: 'undo_expired',
      })
      // By now a phone at the table may have been scanning for minutes: nothing is taken back.
      expect(await reservationOf(id)).toMatchObject({ status: 'seated' })
      expect(await openSittingOf(tableOf('D1'))).not.toBeNull()
      await accept({ type: 'reservation.release_spots', reservationId: id })
    })

    it('refuses an undo where there was no arrival to undo', async () => {
      const id = await book(['D2'])
      expect(await run({ type: 'reservation.undo_arrival', reservationId: id })).toMatchObject({
        status: 'refused',
        code: 'undo_arrival_not_allowed',
      })
    })
  })

  it('seats a party without the right to open a table, and says the table stayed closed', async () => {
    const id = await book(['D3'])
    // The floor is hers to work; opening a Table for phones is the ordering side's right (D122).
    const details = await accept(
      { type: 'reservation.arrive', reservationId: id },
      staff(floorOnlyId),
    )
    expect(details).toMatchObject({
      status: 'seated',
      tableClosed: true,
      opened: '',
      tablesOpen: 0,
    })
    expect(await openSittingOf(tableOf('D3'))).toBeNull()
    expect(await reservationOf(id)).toMatchObject({ status: 'seated' })
    await accept({ type: 'reservation.release_spots', reservationId: id })
  })

  it('refuses New guests to a person who may not open or close a table', async () => {
    await accept({ type: 'table.open', tableId: tableOf('D4') })
    const id = await book(['D4'])
    // Clearing somebody's order is not something a hostess's own right can reach.
    expect(
      await run(
        { type: 'reservation.arrive', reservationId: id, sameGuests: false } as ServiceCommand,
        staff(floorOnlyId),
      ),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    expect(await reservationOf(id)).toMatchObject({ status: 'reserved' })
    await accept({ type: 'table.close', tableId: tableOf('D4') })
  })

  describe('what the door is told before it seats anybody', () => {
    const advice = (over: Record<string, unknown> = {}, userId?: string) =>
      readArrivalChecks(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: {
          kind: 'user',
          userId: userId ?? ownerId,
          sessionId: `sess-${randomUUID()}`,
        } satisfies ServiceActor,
        ...over,
      })

    it('names the Table of each spot, whether its codes are open and whether it carries a bill', async () => {
      const read = await advice({ spotIds: [spotId('D1')] })
      if (!read.ok) throw new Error(read.code)
      expect(read.checks.night).toBeNull()
      expect(read.checks.spotIds).toEqual([spotId('D1')])
      expect(read.checks.tables).toMatchObject([
        { tableId: tableOf('D1'), open: false, bill: false },
      ])
      // Rule 3: our own ids and the name staff read, never a POS id or an internal field.
      expect(JSON.stringify(read.checks)).not.toContain('pos')
    })

    it('says a table carries a bill after its round, so she is told before she seats anybody', async () => {
      await accept({ type: 'table.open', tableId: tableOf('D2') })
      const sittingId = await openSittingOf(tableOf('D2'))
      if (sittingId === null) throw new Error('the table did not open')
      await world.addSentOrder({
        tableId: tableOf('D2'),
        sittingId,
        actionId: randomUUID(),
        // The bar's own ticket number: the column takes three to six capitals or digits.
        reference: randomUUID().slice(0, 6).toUpperCase(),
        serviceDate: today,
      })
      const open = await advice({ spotIds: [spotId('D2')] })
      if (!open.ok) throw new Error(open.code)
      expect(open.checks.tables).toMatchObject([{ tableId: tableOf('D2'), open: true, bill: true }])

      // The warning never forbids it (D134): she may seat a party onto that very table, so long
      // as she answers for what is on it — the same guests, so their round stands.
      const id = await book(['D2'])
      await accept({ type: 'reservation.arrive', reservationId: id, sameGuests: true })

      // Freeing their table closes its codes, and the bill goes with the sitting: the next party's
      // first round would start one of its own, so there is nothing left to warn her about.
      await accept({ type: 'reservation.release_spots', reservationId: id })
      const closed = await advice({ spotIds: [spotId('D2')] })
      if (!closed.ok) throw new Error(closed.code)
      expect(closed.checks.tables).toMatchObject([
        { tableId: tableOf('D2'), open: false, bill: false },
      ])
    })

    it('names whoever is on the spot, and the party holding it later tonight', async () => {
      const walkIn = (
        await accept({
          type: 'reservation.seat_walk_in',
          serviceDate: today,
          spotIds: [spotId('D3')],
          partySize: 2,
          partyLabel: 'At the table now',
        } as ServiceCommand)
      ).reservationId as Id<'rv'>
      const later = new Date(Date.now() + 3 * 60 * 60_000)
      await book(['D3'], { startsAt: later.toISOString(), partyLabel: 'Later tonight' })

      const read = await advice({ spotIds: [spotId('D3')] })
      if (!read.ok) throw new Error(read.code)
      expect(read.checks.onTheSpot).toMatchObject({ reservationId: walkIn })
      expect(read.checks.heldLater).toMatchObject({ name: 'Later tonight' })
      // A whole turn time fits before the booking, so the door offers to seat until its hour.
      expect(read.checks.until?.getTime()).toBe(later.getTime())
      await accept({ type: 'reservation.release_spots', reservationId: walkIn })
    })

    it('tells Tonight who holds a table later, and says nothing of a party already sitting', async () => {
      const later = new Date(Date.now() + 3 * 60 * 60_000)
      const booked = await book(['D4'], {
        startsAt: later.toISOString(),
        partyLabel: 'Booked on D4',
      })
      const read = await readTablesTonight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: {
          kind: 'user',
          userId: ownerId,
          sessionId: `sess-${randomUUID()}`,
        } satisfies ServiceActor,
        tableIds: [tableOf('D4')],
      })
      if (!read.ok) throw new Error(read.code)
      expect(read.tables).toMatchObject([{ tableId: tableOf('D4'), name: 'Booked on D4' }])

      // Once they are sitting there the warning has nothing to add: the waiter at the tile is
      // opening the table *for* them.
      await accept({ type: 'reservation.arrive', reservationId: booked })
      const sat = await readTablesTonight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: {
          kind: 'user',
          userId: ownerId,
          sessionId: `sess-${randomUUID()}`,
        } satisfies ServiceActor,
        tableIds: [tableOf('D4')],
      })
      if (!sat.ok) throw new Error(sat.code)
      expect(sat.tables).toEqual([])
      await accept({ type: 'reservation.release_spots', reservationId: booked })
    })
  })

  it('marks a party present with no table at all: the tap is on the row too', async () => {
    const id = await book([])
    expect(await accept({ type: 'reservation.arrive', reservationId: id })).toMatchObject({
      status: 'seated',
      opened: '',
      // The screen says "the table is open for phones" only from this count (#396): none opened.
      tablesOpen: 0,
    })
    expect(await reservationOf(id)).toMatchObject({ status: 'seated' })
    expect(await heldSpotsOf(id)).toEqual([])
  })
})
