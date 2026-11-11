// The plan editor on a real Postgres, as the restro_app role (#397). What only a database can show:
// that a venue goes from no plan to a laid-out one through `applyService` alone (the commands the
// editor's actions send), that `readPlanEditor` hands back exactly what was saved — the place, the
// kinds with how many spots use each, the bookings still to come on each spot — and that the rules
// the editor words are the path's own: a kind in use is not removed, a name is not taken twice, a
// removed spot leaves the plan. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import { serviceDate as serviceDateOf } from '../../service-day'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { readPlanEditor } from './plan-editor-read'

/** A night well ahead, so the bookings below are always still to come. */
const NIGHT = '2030-01-10'
const AT = new Date(Date.UTC(2030, 0, 10, 21, 0, 0)).toISOString()

describe.skipIf(!hasDatabase)('the plan editor (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let today: string

  const staff = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt: new Date(),
  })

  const run = async (command: Record<string, unknown>) =>
    (await applyService(world.app, command as ServiceCommand, staff(ownerId))).result

  async function accept(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await run(command)
    if (result.status !== 'accepted') {
      throw new Error(`${String(command.type)} refused: ${result.code}`)
    }
    return result.details
  }

  const read = () => readPlanEditor(world.app, world.tenantId, world.venueId, today)

  beforeAll(async () => {
    world = await openServiceWorld('plan-editor')
    ownerId = await world.addUser('owner')
    const venue = (
      await world.owner.query<{ timezone: string; ends_at: string }>(
        'select timezone, service_day_ends_at::text as ends_at from restro.venues where id = $1',
        [world.venueId],
      )
    ).rows[0]
    today = serviceDateOf(new Date(), venue?.timezone ?? 'UTC', venue?.ends_at ?? '07:00:00')
    await accept({ type: 'reservation_settings.set', turnMinutes: 120 })
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('reads a venue with no plan as empty, so the screen offers to start one', async () => {
    const empty = await read()
    expect(empty).toMatchObject({ plans: [], spots: [], kinds: [], unreadable: 0 })
    // The venue's Tables come with it (the world seeds some), each by our own id (rule 3).
    expect(empty.tables.length).toBeGreaterThan(0)
    for (const table of empty.tables) expect(table.id).toMatch(/^tb_/)
  })

  it('lays a plan out from nothing and reads back exactly what was saved', async () => {
    // What "Draw the plan" sends: the kinds a venue starts from, then the plan, made current.
    await accept({
      type: 'spot_kind.save',
      key: 'table',
      label: 'Маса',
      symbol: 'table',
      defaultSeats: 4,
    })
    await accept({ type: 'spot_kind.save', key: 'booth', label: 'Сепаре', symbol: 'booth' })
    const planId = (await accept({ type: 'plan.save', name: 'Зала', makeCurrent: true }))
      .planId as string
    // What "New spot" and a drag send: the whole spot each time, with no Table named.
    const spotId = (
      await accept({
        type: 'spot.save',
        planId,
        name: 'Маса 1',
        kind: 'table',
        shape: 'rect',
        x: 2,
        y: 2,
        width: 10,
        height: 10,
        rotation: 0,
        seats: null,
      })
    ).spotId as string
    await accept({
      type: 'spot.save',
      spotId,
      planId,
      name: 'Маса 1',
      kind: 'table',
      shape: 'circle',
      x: 14,
      y: 6,
      width: 12,
      height: 12,
      rotation: 0,
      seats: 6,
    })
    await accept({ type: 'plan.save', planId, name: 'Голяма зала' })

    const plan = await read()
    expect(plan.plans).toEqual([{ id: planId, name: 'Голяма зала', current: true }])
    expect(plan.spots).toEqual([
      {
        id: spotId,
        planId,
        name: 'Маса 1',
        kind: 'table',
        place: { shape: 'circle', x: 14, y: 6, width: 12, height: 12, rotation: 0 },
        seats: 6,
        tableId: null,
        bookings: 0,
      },
    ])
    expect(
      plan.kinds.map(({ key, label, symbol, defaultSeats, spots }) => ({
        key,
        label,
        symbol,
        defaultSeats,
        spots,
      })),
    ).toEqual(
      expect.arrayContaining([
        { key: 'table', label: 'Маса', symbol: 'table', defaultSeats: 4, spots: 1 },
        { key: 'booth', label: 'Сепаре', symbol: 'booth', defaultSeats: null, spots: 0 },
      ]),
    )
    expect(plan.unreadable).toBe(0)
  })

  it('refuses a second spot by a name already on the floor, by its own code', async () => {
    const [plan] = (await read()).plans
    const result = await run({
      type: 'spot.save',
      planId: plan?.id,
      name: 'Маса 1',
      kind: 'booth',
      shape: 'booth',
      x: 40,
      y: 2,
      width: 16,
      height: 10,
    })
    expect(result).toMatchObject({ status: 'refused', code: 'spot_name_taken' })
  })

  it('counts the bookings still to come on a spot, and none that let it go', async () => {
    const [spot] = (await read()).spots
    const book = async () =>
      (
        await accept({
          type: 'reservation.create',
          serviceDate: NIGHT,
          startsAt: AT,
          kind: 'booking',
          status: 'reserved',
          partySize: 4,
          partyLabel: `Party ${randomUUID().slice(0, 6)}`,
          phone: `+35988${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
          spotIds: [spot?.id],
        })
      ).reservationId as string
    const held = await book()
    expect((await read()).spots[0]?.bookings).toBe(1)
    await accept({ type: 'reservation.cancel', reservationId: held })
    expect((await read()).spots[0]?.bookings).toBe(0)
    await book()
    expect((await read()).spots[0]?.bookings).toBe(1)
  })

  it('keeps a kind while spots use it, and lets it go (and come back) once they do not', async () => {
    const before = await read()
    const spot = before.spots[0]
    expect(await run({ type: 'spot_kind.remove', key: 'table' })).toMatchObject({
      status: 'refused',
      code: 'spot_kind_in_use',
    })

    await accept({ type: 'spot.remove', spotId: spot?.id })
    const after = await read()
    expect(after.spots).toEqual([])
    expect(after.kinds.find((kind) => kind.key === 'table')?.spots).toBe(0)
    // A removed spot is gone for good: the editor's removal is a dialog, never an Undo.
    expect(
      await run({
        type: 'spot.save',
        spotId: spot?.id,
        planId: spot?.planId,
        name: 'Маса 1',
        kind: 'table',
        shape: 'rect',
        x: 2,
        y: 2,
        width: 10,
        height: 10,
      }),
    ).toMatchObject({ status: 'refused', code: 'spot_missing' })

    await accept({ type: 'spot_kind.remove', key: 'table' })
    expect((await read()).kinds.map((kind) => kind.key)).toEqual(['booth'])
    // The Undo of a kind's removal: saving it again under its key.
    await accept({
      type: 'spot_kind.save',
      key: 'table',
      label: 'Маса',
      symbol: 'table',
      defaultSeats: 4,
    })
    expect((await read()).kinds.map((kind) => kind.key).sort()).toEqual(['booth', 'table'])
  })

  it('reads nothing of another organisation', async () => {
    const other = await openServiceWorld('plan-editor-other')
    try {
      expect(await readPlanEditor(world.app, other.tenantId, world.venueId, today)).toEqual({
        plans: [],
        spots: [],
        kinds: [],
        tables: [],
        unreadable: 0,
      })
    } finally {
      await other.close()
    }
  })
})
