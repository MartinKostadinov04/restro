// The pay-first command (#216; D113, D122 §5) on a real Postgres, as the restro_app role: each patch
// shape merges into the saved settings, a deleted hall or table is pruned instead of blocking a save,
// two saves at once of different tables both stay, each shape needs its own right and a sign-in of
// the last 15 minutes, and a change is one `record` Log entry. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_PAY_FIRST_SETTINGS, readPayFirstSettings } from '../pay-first-settings'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import {
  applyService,
  readPayFirstOverview,
  readPayFirstTablesBoard,
  type ServiceCommand,
} from './index'

describe.skipIf(!hasDatabase)('the pay-first command (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let tablesUserId: string
  let payingUserId: string
  let areaId: string
  let tableA: string
  let tableB: string
  let tableC: string

  beforeAll(async () => {
    world = await openServiceWorld('pay-first-settings')
    ownerId = await world.addUser('owner')
    // Each holds one of the two rights and nothing else that matters here.
    tablesUserId = await world.addUser('member')
    await world.addStaff(['settings.payment_tables'], tablesUserId)
    payingUserId = await world.addUser('member')
    await world.addStaff(['settings.connect_payments'], payingUserId)
    const { rows } = await world.owner.query<{ id: string }>(
      'select id from restro.areas where venue_id = $1',
      [world.venueId],
    )
    areaId = rows[0]?.id ?? ''
    ;[tableA, tableB, tableC] = world.tables as [string, string, string]
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
  const set = (change: Record<string, unknown>, actor?: ServiceActor, signedInAt?: Date | null) =>
    run({ type: 'pay_first.set', change } as ServiceCommand, actor, signedInAt)
  const stored = async () => {
    const { rows } = await world.owner.query<{ settings: Record<string, unknown> }>(
      'select settings from restro.venues where id = $1',
      [world.venueId],
    )
    return rows[0]?.settings ?? {}
  }
  const payFirst = async () => readPayFirstSettings(await stored())
  const logOf = async () => {
    const { rows } = await world.owner.query<{
      retention: string
      table_id: string | null
      details: Record<string, unknown>
    }>(
      `select retention, table_id, details from restro.log_entries
        where venue_id = $1 and kind = 'settings.changed' and reason = 'pay_first' order by seq`,
      [world.venueId],
    )
    return rows
  }

  it('saves the item default and the venue switch, keeping the other keys of the settings', async () => {
    await world.owner.query(
      `update restro.venues set settings = settings || '{"other": 1}'::jsonb where id = $1`,
      [world.venueId],
    )
    expect(await set({ itemMode: 'pay_first' })).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    expect(await set({ applies: false })).toMatchObject({ status: 'accepted' })
    expect(await payFirst()).toEqual({
      ...DEFAULT_PAY_FIRST_SETTINGS,
      itemMode: 'pay_first',
      applies: false,
    })
    expect((await stored()).other).toBe(1)
  })

  it("sets and clears an area's and a table's own choice, each leaving the rest", async () => {
    await set({ group: areaId, value: true })
    await set({ table: tableA, value: false })
    expect(await payFirst()).toMatchObject({
      itemMode: 'pay_first',
      applies: false,
      groups: { [areaId]: true },
      tables: { [tableA]: false },
    })
    await set({ table: tableA, value: null })
    await set({ group: areaId, value: null })
    expect(await payFirst()).toMatchObject({ groups: {}, tables: {} })
  })

  it('logs a change as one record entry, and a repeat logs nothing', async () => {
    const before = (await logOf()).length
    await set({ table: tableB, value: true })
    const entries = await logOf()
    expect(entries).toHaveLength(before + 1)
    const last = entries.at(-1)
    expect(last?.retention).toBe('record')
    expect(last?.table_id).toBe(tableB)
    expect(last?.details).toEqual({ level: 'table', value: 'on', previous: 'follow' })
    expect(await set({ table: tableB, value: true })).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await logOf()).toHaveLength(before + 1)
    await set({ table: tableB, value: null })
  })

  it("refuses a table or a hall that is not the venue's live one, and saves nothing", async () => {
    const before = await stored()
    expect(await set({ table: newId('tb'), value: true })).toMatchObject({
      status: 'refused',
      code: 'table_missing',
    })
    expect(await set({ group: newId('ar'), value: true })).toMatchObject({
      status: 'refused',
      code: 'group_missing',
    })
    expect(await stored()).toEqual(before)
  })

  it('refuses a change that names two things or the wrong kind of id', async () => {
    for (const change of [
      { itemMode: 'pay_first', applies: true },
      { itemMode: 'later' },
      { table: areaId, value: true },
      { group: tableA, value: true },
      // A bar's choice has no screen (Martin's Q2): the command takes areas only.
      { group: newId('br'), value: true },
      { table: tableA },
      {},
    ]) {
      expect(await set(change), JSON.stringify(change)).toMatchObject({
        status: 'refused',
        code: 'invalid_command',
      })
    }
  })

  it('drops what was deleted since it was set, instead of failing the next save', async () => {
    const gone = newId('tb')
    const goneArea = newId('ar')
    await set({ table: tableC, value: true })
    // A table and a hall deleted (or never there) after they were set: stored by hand, as the old
    // whole-object writer could leave them.
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{payFirst}',
         (settings->'payFirst') || jsonb_build_object(
           'tables', (settings->'payFirst'->'tables') || jsonb_build_object($2::text, true),
           'groups', (settings->'payFirst'->'groups') || jsonb_build_object($3::text, false))
       ) where id = $1`,
      [world.venueId, gone, goneArea],
    )
    expect(Object.keys((await payFirst()).tables)).toContain(gone)
    expect(await set({ itemMode: 'on_bill' })).toMatchObject({ status: 'accepted' })
    const after = await payFirst()
    expect(after.tables).toEqual({ [tableC]: true })
    expect(after.groups).toEqual({})
    expect(after.itemMode).toBe('on_bill')
  })

  it('drops a table the venue archived, and counts only live areas and tables', async () => {
    await set({ table: tableB, value: false })
    await set({ group: areaId, value: true })
    expect(
      (await readPayFirstOverview(world.app, world.tenantId, world.venueId, await stored()))
        .overrides,
    ).toBe(3)
    await world.owner.query('update restro.tables set archived_at = now() where id = $1', [tableB])
    expect(
      (await readPayFirstOverview(world.app, world.tenantId, world.venueId, await stored()))
        .overrides,
    ).toBe(2)
    expect(await set({ applies: true })).toMatchObject({ status: 'accepted' })
    expect(Object.keys((await payFirst()).tables)).toEqual([tableC])
    // The archived table itself can no longer be set.
    expect(await set({ table: tableB, value: true })).toMatchObject({
      status: 'refused',
      code: 'table_missing',
    })
  })

  it('keeps both of two saves that meet on the venue row, for different tables', async () => {
    await set({ table: tableC, value: null })
    await set({ group: areaId, value: null })
    const [, , , tableD] = world.tables as [string, string, string, string]
    const results = await world.saveTogether([
      () => set({ table: tableA, value: true }),
      () => set({ table: tableD, value: false }),
    ])
    for (const result of results) expect(result.status).toBe('accepted')
    const after = await payFirst()
    expect(after.tables).toEqual({ [tableA]: true, [tableD]: false })
  })

  it("needs the right for the shape: connect payments for the venue's, payment tables for a table's", async () => {
    const tables = user(tablesUserId)
    const paying = user(payingUserId)
    for (const change of [{ itemMode: 'pay_first' }, { applies: true }]) {
      expect(await set(change, tables)).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
      expect(await set(change, paying)).toMatchObject({ status: 'accepted' })
    }
    for (const change of [
      { table: tableA, value: null },
      { group: areaId, value: true },
    ]) {
      expect(await set(change, paying)).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
      expect(await set(change, tables)).toMatchObject({ status: 'accepted' })
    }
  })

  it('needs a sign-in of the last 15 minutes, and a person to sign in (never a PIN)', async () => {
    const before = await stored()
    expect(
      await set({ applies: false }, user(ownerId), new Date(Date.now() - 16 * 60_000)),
    ).toMatchObject({ status: 'refused', code: 'sign_in_again' })
    expect(
      await set({ applies: false }, {
        kind: 'staff',
        staffMemberId: newId('sm'),
        sessionId: 'sess-device',
      } as ServiceActor),
    ).toMatchObject({ status: 'refused', code: 'own_sign_in_required' })
    expect(await stored()).toEqual(before)
  })

  it("tells Tables & QR which tables can be paid first: only where paying is on and the table's POS opens a bill (#217)", async () => {
    const board = async () =>
      readPayFirstTablesBoard(world.app, world.tenantId, world.venueId, await stored())
    // No POS and no account yet: nothing can be paid first anywhere.
    expect(await board()).toMatchObject({ possible: false, capable: new Set() })

    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_pftables', 'lost_access', '{}'::jsonb, now(), 'restro', 'system', 'test-seed')`,
      [world.tenantId, world.venueId],
    )
    try {
      // Paused (lost access) still shows the rows. Every live table of the POS can take it; the
      // one an earlier test archived cannot.
      const on = await board()
      expect(on.possible).toBe(true)
      expect(on.capable.has(tableA)).toBe(true)
      expect(on.capable.has(tableC)).toBe(true)
      expect(on.capable.has(tableB)).toBe(false)
      expect(on.settings).toEqual(await payFirst())

      // A table the POS no longer serves gets no row.
      await world.owner.query(`update restro.places set state = 'deleted' where table_id = $1`, [
        tableA,
      ])
      const after = await board()
      expect(after.capable.has(tableA)).toBe(false)
      expect(after.capable.has(tableC)).toBe(true)

      // A POS that can't open a bill that names itself, or a disconnected account: no rows at all.
      await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: false })
      expect(await board()).toMatchObject({ possible: false, capable: new Set() })
      await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
      await world.owner.query(
        `update restro.payment_accounts set state = 'disconnected' where venue_id = $1`,
        [world.venueId],
      )
      expect(await board()).toMatchObject({ possible: false, capable: new Set() })
    } finally {
      await world.owner.query('delete from restro.payment_accounts where venue_id = $1', [
        world.venueId,
      ])
    }
  })
})
