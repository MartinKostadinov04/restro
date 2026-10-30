// RED by design (the repair-review's A7, RR-A7-4): `sent_order.answer` reads the sent order by id
// alone (sent-order-answer.ts:44-48), and `lockAround` then takes the table's rows without asking
// which venue it is at. A person with `alerts.answer` at venue 1, with venue 1 in the context, settles
// an Unconfirmed sent order of venue 2, where the person holds no role. When this goes green, move it
// into security-cross-venue.test.ts.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionVenue } from '../apply/provision'
import { createArea, createTable } from '../apply/tables'
import { hasDatabase, testSlug } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'

const SEED = ['restro', 'system', 'attack-seed'] as const

describe.skipIf(!hasDatabase)('a sent order of another venue of the organisation', () => {
  let world: ServiceWorld
  let staffUser: string
  let venue2: string
  let table2: string
  let sitting2: string
  let counter = 1

  beforeAll(async () => {
    world = await openServiceWorld('cross-venue-red')
    const venue = await provisionVenue(world.app, world.tenantId, {
      name: 'Second club',
      slug: testSlug('cross-venue-red-2'),
    })
    venue2 = venue.id
    const area = await createArea(world.app, world.tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error('no area')
    const table = await createTable(world.app, world.tenantId, {
      areaId: area.area.id,
      name: null,
      number: '9',
    })
    if (!table.ok) throw new Error('no table')
    table2 = table.table.id
    sitting2 = newId('st')
    await world.owner.query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
      [sitting2, world.tenantId, venue2, table2, new Date().toISOString().slice(0, 10), ...SEED],
    )
    staffUser = await world.addUser('member')
    await world.addStaff(['alerts.answer'], staffUser)
  }, 120_000)

  afterAll(async () => {
    await world?.close()
  }, 60_000)

  async function unconfirmedAtVenue2(): Promise<string> {
    const id = newId('so')
    await world.owner.query(
      `insert into restro.sent_orders
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, lines,
          total_minor, action_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $8, 'unconfirmed', '[{"n":1}]'::jsonb, 500, $7, 'guest', 'guest', 'attack-seed')`,
      [
        id,
        world.tenantId,
        venue2,
        table2,
        sitting2,
        new Date().toISOString().slice(0, 10),
        randomUUID(),
        `R${(counter++).toString().padStart(4, '0')}`,
      ],
    )
    return id
  }

  it('sent_order.answer by a role at venue 1 must not settle it', async () => {
    const id = await unconfirmedAtVenue2()
    const { result } = await applyService(
      world.app,
      { type: 'sent_order.answer', sentOrderId: id, answer: 'not_found' } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: staffUser, sessionId: `s-${staffUser}` },
        jobId: `web-${randomUUID()}`,
        signedInAt: new Date(),
      },
    )
    const { rows } = await world.owner.query<{ state: string }>(
      'select state from restro.sent_orders where id = $1',
      [id],
    )
    expect(rows[0]?.state).toBe('unconfirmed')
    expect(result).toMatchObject({ status: 'refused', code: 'sent_order_missing' })
  }, 30_000)
})
