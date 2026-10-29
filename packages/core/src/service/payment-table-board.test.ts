// What Tables & QR shows about payment tables (#215): the queues that still lack one, named (bars
// by name, the tables with no bar last), and each table's bar, on a real Postgres as the
// restro_app role. Skipped without a database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { readPaymentTableBoard } from './index'

describe.skipIf(!hasDatabase)('the payment tables board (as the restro_app role)', () => {
  let world: ServiceWorld
  const bars = { roof: 'br_pt0000000000000000000a', main: 'br_pt0000000000000000000b' }

  beforeAll(async () => {
    world = await openServiceWorld('pay-table-board')
    for (const [id, name] of [
      [bars.roof, 'Roof bar'],
      [bars.main, 'Main bar'],
    ] as const) {
      await world.owner.query(
        `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, $4, $1)`,
        [id, world.tenantId, world.venueId, name],
      )
    }
    // Tables 1 and 2 belong to the roof bar, table 3 to the main bar, table 4 to none.
    const barOf = [bars.roof, bars.roof, bars.main, null]
    for (const [index, barId] of barOf.entries()) {
      await world.owner.query('update restro.tables set bar_id = $2 where id = $1', [
        world.tables[index],
        barId,
      ])
    }
  })

  afterAll(async () => {
    await world?.close()
  })

  const board = () => readPaymentTableBoard(world.app, world.tenantId, world.venueId)
  const mark = (index: number, on: boolean) =>
    world.owner.query('update restro.tables set is_payment_table = $2, hidden = $2 where id = $1', [
      world.tables[index],
      on,
    ])

  it('names every queue with guest tables and no payment table: bars by name, the no-bar queue last', async () => {
    const { queuesMissing } = await board()
    expect(queuesMissing).toEqual([
      { barId: bars.main, barName: 'Main bar' },
      { barId: bars.roof, barName: 'Roof bar' },
      { barId: null, barName: null },
    ])
  })

  it('drops a queue once a payment table serves it, and gives each table its bar', async () => {
    await mark(0, true)
    await mark(2, true)
    await mark(3, true)
    const { queuesMissing, barOfTable } = await board()
    // The roof bar still has a table for guests, but its payment table serves the queue.
    expect(queuesMissing).toEqual([])
    expect(barOfTable.get(world.tables[0] as string)).toEqual({ id: bars.roof, name: 'Roof bar' })
    expect(barOfTable.get(world.tables[2] as string)).toEqual({ id: bars.main, name: 'Main bar' })
    expect(barOfTable.has(world.tables[3] as string)).toBe(false)
  })

  it('brings a queue back when its payment table is unmarked', async () => {
    await mark(0, false)
    await mark(3, false)
    // The main bar keeps its payment table; the roof bar and the no-bar tables have none again.
    const { queuesMissing } = await board()
    expect(queuesMissing.map((queue) => queue.barName)).toEqual(['Roof bar', null])
  })
})
