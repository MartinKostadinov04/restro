// The floor reading's two worker steps (#71; verification, platform row 20), through
// `applyService` as the restro_app role on a real Postgres: a vanished table pauses its open
// sitting and never ends it, a table listed again lifts the pause, repeats change nothing, and only
// the worker may send either. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'

describe.skipIf(!hasDatabase)('the floor reading steps (as the restro_app role)', () => {
  let world: ServiceWorld

  beforeAll(async () => {
    world = await openServiceWorld('floorpause')
  })
  afterAll(async () => {
    await world?.close()
  })

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
  })
  const vanished = (tableId: string) => ({ type: 'floor.table_vanished', tableId })
  const returned = (tableId: string) => ({ type: 'floor.table_returned', tableId })

  const pausesOf = async (tableId: string) =>
    (
      await world.owner.query(
        'select * from restro.pauses where target_id = $1 order by started_at',
        [tableId],
      )
    ).rows as {
      scope: string
      cause: string
      restro_started: boolean
      lifted_at: Date | null
      lift_reason: string | null
      source: string
      actor: string
    }[]
  const logKinds = async (tableId: string) =>
    (
      await world.owner.query(
        'select kind, reason from restro.log_entries where table_id = $1 order by seq',
        [tableId],
      )
    ).rows as { kind: string; reason: string | null }[]

  it('pauses the open sitting of a table that vanished, and never ends it', async () => {
    const [table] = world.tables
    if (table === undefined) throw new Error('no table')
    const sittingId = await world.openSitting(table)
    const { result } = await applyService(world.app, vanished(table), worker())
    expect(result).toMatchObject({ status: 'accepted', details: { paused: true, already: false } })
    const pauses = await pausesOf(table)
    expect(pauses).toHaveLength(1)
    expect(pauses[0]).toMatchObject({
      scope: 'table',
      cause: 'table_vanished',
      restro_started: true,
      lifted_at: null,
      source: 'worker',
      actor: 'system',
    })
    const sitting = await world.owner.query(
      'select ended_at, end_reason from restro.sittings where id = $1',
      [sittingId],
    )
    expect(sitting.rows[0]).toEqual({ ended_at: null, end_reason: null })
    expect(await logKinds(table)).toContainEqual({
      kind: 'pause.started',
      reason: 'table_vanished',
    })
  })

  it('changes nothing when told again', async () => {
    const [table] = world.tables
    if (table === undefined) throw new Error('no table')
    const { result } = await applyService(world.app, vanished(table), worker())
    expect(result).toMatchObject({ status: 'accepted', details: { paused: true, already: true } })
    expect(await pausesOf(table)).toHaveLength(1)
  })

  it('lifts the pause when the table is listed again, and again changes nothing', async () => {
    const [table] = world.tables
    if (table === undefined) throw new Error('no table')
    const { result } = await applyService(world.app, returned(table), worker())
    expect(result).toMatchObject({ status: 'accepted', details: { lifted: true } })
    const [pause] = await pausesOf(table)
    expect(pause?.lifted_at).not.toBeNull()
    expect(pause?.lift_reason).toBe('table_returned')
    expect(await logKinds(table)).toContainEqual({ kind: 'pause.lifted', reason: 'table_returned' })
    const again = await applyService(world.app, returned(table), worker())
    expect(again.result).toMatchObject({ status: 'accepted', details: { lifted: false } })
    // The sitting is still open: the pause came and went without ending it.
    const open = await world.owner.query(
      'select count(*)::int as n from restro.sittings where table_id = $1 and ended_at is null',
      [table],
    )
    expect(open.rows[0]?.n).toBe(1)
  })

  it('can pause the table again when it vanishes again', async () => {
    const [table] = world.tables
    if (table === undefined) throw new Error('no table')
    const { result } = await applyService(world.app, vanished(table), worker())
    expect(result).toMatchObject({ status: 'accepted', details: { paused: true, already: false } })
    expect(await pausesOf(table)).toHaveLength(2)
  })

  it('has nothing to pause on a table that is not open for phones', async () => {
    const table = world.tables[1]
    if (table === undefined) throw new Error('no table')
    const { result } = await applyService(world.app, vanished(table), worker())
    expect(result).toMatchObject({ status: 'accepted', details: { paused: false } })
    expect(await pausesOf(table)).toHaveLength(0)
  })

  it('takes only the worker, and only a table of this venue', async () => {
    const table = world.tables[2]
    if (table === undefined) throw new Error('no table')
    const guest = await applyService(world.app, vanished(table), {
      ...worker(),
      origin: 'guest',
      actor: { kind: 'guest' },
    })
    expect(guest.result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    const staff = await applyService(world.app, returned(table), {
      ...worker(),
      origin: 'staff',
      actor: { kind: 'user', userId: 'u1', sessionId: 's1' },
      via: 'tonight',
    })
    expect(staff.result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    const missing = await applyService(world.app, vanished('tb_0123456789ABCDEFGHIJKL'), worker())
    expect(missing.result).toMatchObject({ status: 'refused', code: 'table_missing' })
  })
})
