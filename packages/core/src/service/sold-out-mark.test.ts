// The Log line of a "sold out tonight" mark made during service (D147, #437), on a real Postgres
// as the restro_app role: whoever holds the Staff role may mark, a shared device's own account may
// without a PIN, somebody who holds only the Log may not, taking a mark off is its own line, and
// two items in one tap are two lines. The mark itself is a menu change and is tested in
// apply/sold-out.test.ts. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, type ServiceCommand } from './index'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'

describe.skipIf(!hasDatabase)('a sold-out mark in the Log (as the restro_app role)', () => {
  let world: ServiceWorld
  let staffUserId: string
  let mayNotId: string
  const deviceSession = `device-${randomUUID()}`
  const ITEM = newId('nd')
  const OTHER = newId('nd')

  beforeAll(async () => {
    world = await openServiceWorld('sold-out-mark')
    staffUserId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, staffUserId)
    // Holds the Log and nothing else: may read the night, may not change the menu.
    mayNotId = await world.addUser('member')
    await world.addStaff(['log.view'], mayNotId)
    await world.addSharedDevice(deviceSession)
  })

  afterAll(async () => {
    await world?.close()
  })

  const context = (actor: ServiceActor): ServiceContext =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff',
      actor,
      via: 'tonight',
      jobId: `sold-out-${randomUUID()}`,
    }) as ServiceContext
  const user = (userId: string, sessionId = 'session-1'): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId,
  })
  const mark = (actor: ServiceActor, itemIds: readonly string[], soldOut = true) =>
    applyService(
      world.app,
      { type: 'sold_out.mark', itemIds: [...itemIds], soldOut } as ServiceCommand,
      context(actor),
    ).then((answer) => answer.result)

  const lines = async () => {
    const { rows } = await world.owner.query<{
      kind: string
      actor: string
      details: Record<string, unknown>
    }>(
      `select kind, actor, details from restro.log_entries
       where venue_id = $1 and kind like 'sold_out.%' order by seq`,
      [world.venueId],
    )
    return rows
  }

  it('is written for whoever holds the Staff role, and names the item and the person', async () => {
    expect(await mark(user(staffUserId), [ITEM])).toMatchObject({ status: 'accepted' })
    expect(await lines()).toMatchObject([
      { kind: 'sold_out.marked', actor: `user:${staffUserId}`, details: { itemId: ITEM } },
    ])
  })

  it('keeps taking the mark off as its own line', async () => {
    expect(await mark(user(staffUserId), [ITEM], false)).toMatchObject({ status: 'accepted' })
    const written = await lines()
    expect(written[written.length - 1]).toMatchObject({
      kind: 'sold_out.cleared',
      details: { itemId: ITEM },
    })
  })

  it('writes one line per item of one tap', async () => {
    const before = (await lines()).length
    expect(await mark(user(staffUserId), [ITEM, OTHER])).toMatchObject({ status: 'accepted' })
    const written = (await lines()).slice(before)
    expect(written.map((line) => line.details.itemId).sort()).toEqual([ITEM, OTHER].sort())
    expect(new Set(written.map((line) => line.kind))).toEqual(new Set(['sold_out.marked']))
  })

  it('is refused for somebody who does not hold it, and writes nothing', async () => {
    const before = (await lines()).length
    expect(await mark(user(mayNotId), [ITEM])).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect((await lines()).length).toBe(before)
  })

  it("takes the shared device's own account with no PIN, and names the account", async () => {
    const before = (await lines()).length
    expect(await mark(user(staffUserId, deviceSession), [OTHER], false)).toMatchObject({
      status: 'accepted',
    })
    const written = (await lines()).slice(before)
    expect(written).toMatchObject([
      { kind: 'sold_out.cleared', actor: `user:${staffUserId}`, details: { itemId: OTHER } },
    ])
  })
})
