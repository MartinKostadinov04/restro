// The owner's paying choices on the service write path (#116, #198) on a real Postgres, as the
// restro_app role: the smallest card payment and the venue's legal details need
// `settings.connect_payments` and a sign-in of the last 15 minutes, merge into the saved settings,
// are one `record` Log entry naming the keys (never the values), and a smallest payment below the
// provider's minimum or above €1,000 is refused. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { readLegalDetails } from '../legal-details'
import { readPayingSettings } from '../paying-settings'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, type ServiceCommand } from './index'

const LEGAL = {
  name: 'Club Nights EOOD',
  eik: '123456789',
  address: 'Sofia, 1 Example Street',
  privacyUrl: 'https://club.example/privacy',
}

describe.skipIf(!hasDatabase)('the paying choices command (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let managerId: string

  beforeAll(async () => {
    world = await openServiceWorld('paying-settings')
    ownerId = await world.addUser('owner')
    managerId = await world.addUser('member')
    await world.addStaff(['tables.open_close', 'settings.guards'], managerId)
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId: `sess-${randomUUID()}`,
  })
  const run = async (
    command: ServiceCommand,
    actor: ServiceActor = user(ownerId),
    signedInAt: Date | null = new Date(),
  ) => {
    const context: ServiceContext = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff',
      actor,
      jobId: `req-${randomUUID()}`,
      ...(signedInAt === null ? {} : { signedInAt }),
    }
    return (await applyService(world.app, command, context)).result
  }
  const stored = async () => {
    const { rows } = await world.owner.query<{ settings: Record<string, unknown> }>(
      'select settings from restro.venues where id = $1',
      [world.venueId],
    )
    return rows[0]?.settings ?? {}
  }
  const logOf = async () => {
    const { rows } = await world.owner.query<{
      retention: string
      details: Record<string, unknown>
    }>(
      `select retention, details from restro.log_entries
        where venue_id = $1 and kind = 'settings.changed' and reason = 'paying' order by seq`,
      [world.venueId],
    )
    return rows
  }

  it('saves the smallest payment and the details, logging the keys and no value', async () => {
    const result = await run({
      type: 'settings.paying_set',
      changes: { minCardMinor: 500, legalDetails: LEGAL },
      providerMinMinor: 50,
    })
    expect(result).toMatchObject({ status: 'accepted', details: { changed: true } })
    const settings = await stored()
    expect(readPayingSettings(settings)).toEqual({ minCardMinor: 500 })
    expect(readLegalDetails(settings)).toEqual(LEGAL)
    const entries = await logOf()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.retention).toBe('record')
    expect(entries[0]?.details).toEqual({ keys: 'minCardMinor,legalDetails' })
  })

  it('merges: one key changed leaves the other, and a repeat logs nothing', async () => {
    await run({
      type: 'settings.paying_set',
      changes: { minCardMinor: null },
      providerMinMinor: 50,
    })
    const settings = await stored()
    expect(readPayingSettings(settings)).toEqual({ minCardMinor: null })
    expect(readLegalDetails(settings)).toEqual(LEGAL)
    const before = (await logOf()).length
    const again = await run({
      type: 'settings.paying_set',
      changes: { minCardMinor: null },
      providerMinMinor: 50,
    })
    expect(again).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect((await logOf()).length).toBe(before)
  })

  it("refuses a smallest payment below the provider's minimum or above €1,000, and saves none", async () => {
    const before = await stored()
    expect(
      await run({
        type: 'settings.paying_set',
        changes: { minCardMinor: 49 },
        providerMinMinor: 50,
      }),
    ).toMatchObject({ status: 'refused', code: 'invalid_settings' })
    expect(
      await run({
        type: 'settings.paying_set',
        changes: { minCardMinor: 100_001 },
        providerMinMinor: 50,
      }),
    ).toMatchObject({ status: 'refused' })
    expect(await stored()).toEqual(before)
  })

  it('refuses details that are not a full set, with a bad ЕИК or a link that is not https', async () => {
    const before = await stored()
    for (const bad of [
      { ...LEGAL, eik: '12345' },
      { ...LEGAL, privacyUrl: 'http://club.example/privacy' },
      { ...LEGAL, name: '' },
      { name: LEGAL.name },
    ]) {
      const result = await run({
        type: 'settings.paying_set',
        changes: { legalDetails: bad as never },
        providerMinMinor: 50,
      })
      expect(result.status).toBe('refused')
    }
    expect(await stored()).toEqual(before)
  })

  it('clears the details with null', async () => {
    await run({
      type: 'settings.paying_set',
      changes: { legalDetails: null },
      providerMinMinor: 50,
    })
    expect(readLegalDetails(await stored())).toBeNull()
  })

  it('needs the right to connect payments and a sign-in of the last 15 minutes', async () => {
    expect(
      await run(
        { type: 'settings.paying_set', changes: { minCardMinor: 600 }, providerMinMinor: 50 },
        user(managerId),
      ),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
    expect(
      await run(
        { type: 'settings.paying_set', changes: { minCardMinor: 600 }, providerMinMinor: 50 },
        user(ownerId),
        new Date(Date.now() - 16 * 60_000),
      ),
    ).toMatchObject({ status: 'refused', code: 'sign_in_again' })
  })
})
