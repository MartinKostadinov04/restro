// Tables open for phones and their sittings (D122 §4, §7; ticket #73) on a real Postgres, as the
// restro_app role: open, Open all, close, Close all and New guests are idempotent by nature, an end
// empties the order and its memories and raises the table's version, every open and end is in the
// Log, payment tables are never opened and never get a code, and a role without
// `tables.open_close` can do none of it. Skipped without a database.
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { issueTableToken, setTableHidden } from '../apply/tables'
import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, readTableState, type ServiceCommand } from './index'

const { publicKey } = generateKeyPairSync('x25519')

describe.skipIf(!hasDatabase)('tables open for phones (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let managerId: string
  let barmanId: string

  beforeAll(async () => {
    world = await openServiceWorld('sittings')
    ownerId = await world.addUser('owner')
    // A member who is no owner or admin holds what their venue role holds.
    managerId = await world.addUser('member')
    await world.addStaff(['tables.open_close'], managerId)
    barmanId = await world.addUser('member')
    await world.addStaff(['tables.resume', 'alerts.answer'], barmanId)
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId: `sess-${randomUUID()}`,
  })
  const context = (actor: ServiceActor) =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff',
      actor,
      jobId: `req-${randomUUID()}`,
      signedInAt: new Date(),
    }) satisfies ServiceContext
  const run = async (command: ServiceCommand, actor: ServiceActor = user(ownerId)) =>
    (await applyService(world.app, command, context(actor))).result
  const accepted = async (command: ServiceCommand, actor?: ServiceActor) => {
    const result = await run(command, actor)
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
    return result.details
  }
  const table = (index: number) => world.tables[index] as `tb_${string}`
  const openSittingOf = async (tableId: string) => {
    const { rows } = await world.owner.query<{ id: string; opened_how: string }>(
      'select id, opened_how from restro.sittings where table_id = $1 and ended_at is null',
      [tableId],
    )
    return rows[0] ?? null
  }
  const sittingRow = async (id: string) => {
    const { rows } = await world.owner.query<{
      ended_at: Date | null
      end_reason: string | null
      actor: string
    }>('select ended_at, end_reason, actor from restro.sittings where id = $1', [id])
    return rows[0]
  }
  const logOf = async (sittingId: string) => {
    const { rows } = await world.owner.query<{
      kind: string
      reason: string | null
      actor: string
      via: string | null
      retention: string
      details: Record<string, unknown>
    }>(
      `select kind, reason, actor, via, retention, details from restro.log_entries
       where sitting_id = $1 order by seq`,
      [sittingId],
    )
    return rows
  }
  const versionOf = async (tableId: string) => {
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    return state?.version ?? -1
  }
  const closeEverything = async () => {
    await accepted({ type: 'tables.close_all' })
  }

  it('opens a table, logs it and says who opened it when asked again', async () => {
    const owner = user(ownerId)
    const tableId = table(0)
    const before = await versionOf(tableId)
    const first = await accepted({ type: 'table.open', tableId }, owner)
    expect(first).toMatchObject({ opened: true, openedBy: `user:${ownerId}`, openedVia: 'tonight' })
    const sitting = await openSittingOf(tableId)
    expect(sitting).toEqual({ id: first.sittingId, opened_how: 'one' })
    expect(await versionOf(tableId)).toBeGreaterThan(before)

    const again = await accepted({ type: 'table.open', tableId }, user(managerId))
    expect(again).toEqual({ ...first, opened: false })
    expect(await logOf(String(first.sittingId))).toEqual([
      {
        kind: 'sitting.opened',
        reason: null,
        actor: `user:${ownerId}`,
        via: 'tonight',
        retention: 'night',
        details: { how: 'one' },
      },
    ])
  })

  it('closes a table: the order and its memories are emptied, nothing is deleted', async () => {
    const tableId = table(0)
    const sitting = await openSittingOf(tableId)
    if (sitting === null) throw new Error('table 1 is not open')
    // Stand-ins for the guest API (#75): lines, an earlier order and the ring of actions.
    await world.owner.query(
      `update restro.table_orders
         set lines = '[{"id":"ol_x","qty":1,"note":"no ice"}]', earlier = '[{"id":"ol_y"}]',
             earlier_at = now(), recent_actions = '[{"actionId":"a"}]', idle_expires_at = now()
       where sitting_id = $1`,
      [sitting.id],
    )
    const before = await versionOf(tableId)

    expect(await accepted({ type: 'table.close', tableId }, user(managerId))).toEqual({
      closed: true,
      sittingId: sitting.id,
    })
    expect(await openSittingOf(tableId)).toBeNull()
    expect(await sittingRow(sitting.id)).toMatchObject({
      end_reason: 'staff_closed',
      actor: `user:${managerId}`,
    })
    const { rows } = await world.owner.query(
      `select lines, earlier, earlier_at, recent_actions, idle_expires_at
       from restro.table_orders where sitting_id = $1`,
      [sitting.id],
    )
    expect(rows).toEqual([
      { lines: [], earlier: null, earlier_at: null, recent_actions: [], idle_expires_at: null },
    ])
    expect(await versionOf(tableId)).toBeGreaterThan(before)
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    expect(state).toMatchObject({ sitting: null })
    expect((await logOf(sitting.id)).map((entry) => [entry.kind, entry.reason])).toEqual([
      ['sitting.opened', null],
      ['sitting.ended', 'staff_closed'],
    ])

    const again = await accepted({ type: 'table.close', tableId })
    expect(again).toMatchObject({
      closed: false,
      sittingId: sitting.id,
      endReason: 'staff_closed',
      endedBy: `user:${managerId}`,
    })
  })

  it('starts the next group with New guests, and a repeat changes nothing', async () => {
    const tableId = table(1)
    const { sittingId: first } = await accepted({ type: 'table.open', tableId })
    const renewed = await accepted({
      type: 'table.new_guests',
      tableId,
      sittingId: String(first) as `st_${string}`,
    })
    expect(renewed).toMatchObject({ renewed: true, endedSittingId: first })
    expect(renewed.sittingId).not.toBe(first)
    expect(await sittingRow(String(first))).toMatchObject({ end_reason: 'new_guests' })
    expect((await openSittingOf(tableId))?.id).toBe(renewed.sittingId)

    // The same tap again (a retry): the sitting it names has ended, so the new group stays.
    const repeat = await accepted({
      type: 'table.new_guests',
      tableId,
      sittingId: String(first) as `st_${string}`,
    })
    expect(repeat).toMatchObject({ renewed: false, sittingId: renewed.sittingId })
    expect((await openSittingOf(tableId))?.id).toBe(renewed.sittingId)
    expect((await logOf(String(first))).map((entry) => [entry.kind, entry.reason])).toEqual([
      ['sitting.opened', null],
      ['sitting.ended', 'new_guests'],
    ])
    await closeEverything()
  })

  it('opens every usable table with Open all and closes them with Close all', async () => {
    await accepted({ type: 'table.open', tableId: table(2) })
    // Table 4 is hidden: no guest page, so it stays closed.
    const hidden = await setTableHidden(world.app, world.tenantId, table(3), true)
    expect(hidden.ok).toBe(true)

    expect(await accepted({ type: 'tables.open_all' })).toEqual({
      opened: 2,
      alreadyOpen: 1,
      skipped: 1,
    })
    for (const index of [0, 1, 2]) expect(await openSittingOf(table(index))).not.toBeNull()
    expect(await openSittingOf(table(3))).toBeNull()
    expect((await openSittingOf(table(0)))?.opened_how).toBe('all')
    expect(await run({ type: 'table.open', tableId: table(3) })).toMatchObject({
      code: 'table_hidden',
    })
    expect(await accepted({ type: 'tables.open_all' })).toMatchObject({ opened: 0, alreadyOpen: 3 })

    const open = await Promise.all([0, 1, 2].map((index) => openSittingOf(table(index))))
    expect(await accepted({ type: 'tables.close_all' })).toEqual({ closed: 3 })
    for (const sitting of open) {
      expect(await sittingRow(String(sitting?.id))).toMatchObject({ end_reason: 'staff_closed' })
      expect((await logOf(String(sitting?.id))).at(-1)).toMatchObject({
        kind: 'sitting.ended',
        reason: 'staff_closed',
      })
    }
    expect(await accepted({ type: 'tables.close_all' })).toEqual({ closed: 0 })
    await setTableHidden(world.app, world.tenantId, table(3), false)
  })

  it('opens a table once when two people tap Open at the same moment', async () => {
    const tableId = table(2)
    const answers = await Promise.all([
      accepted({ type: 'table.open', tableId }, user(ownerId)),
      accepted({ type: 'table.open', tableId }, user(managerId)),
    ])
    expect(answers.filter((answer) => answer.opened === true)).toHaveLength(1)
    expect(new Set(answers.map((answer) => answer.sittingId)).size).toBe(1)
    await closeEverything()
  })

  it('refuses every sitting command to a role without tables.open_close', async () => {
    const barman = user(barmanId)
    const tableId = table(0)
    const commands: ServiceCommand[] = [
      { type: 'table.open', tableId },
      { type: 'table.close', tableId },
      { type: 'table.new_guests', tableId },
      { type: 'tables.open_all' },
      { type: 'tables.close_all' },
    ]
    for (const command of commands) {
      expect(await run(command, barman), command.type).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
    }
    expect(await openSittingOf(tableId)).toBeNull()
  })

  it('needs a PIN on a shared device for what names a person, and opens with the PIN holder’s role', async () => {
    const sessionId = `sess-${randomUUID()}`
    await world.addSharedDevice(sessionId)
    const tableId = table(0)
    const device: ServiceActor = { kind: 'user', userId: ownerId, sessionId }
    expect(await run({ type: 'tables.open_all' }, device)).toMatchObject({
      code: 'pin_required',
    })
    const waiter = await world.addStaff(['tables.open_close'])
    const opened = await accepted(
      { type: 'table.open', tableId },
      { kind: 'staff', staffMemberId: waiter as `sm_${string}`, sessionId },
    )
    expect(opened).toMatchObject({ opened: true, openedBy: `staff:${waiter}` })
    await closeEverything()
  })

  it('opens and closes one table for the shared device’s own account, named in the Log (#85)', async () => {
    const sessionId = `sess-${randomUUID()}`
    await world.addSharedDevice(sessionId)
    const tableId = table(0)
    const device: ServiceActor = { kind: 'user', userId: ownerId, sessionId }
    const before = (
      await world.owner.query<{ seq: string }>(
        'select coalesce(max(seq), 0)::text as seq from restro.log_entries where tenant_id = $1',
        [world.tenantId],
      )
    ).rows[0]?.seq
    expect(await accepted({ type: 'table.open', tableId }, device)).toMatchObject({
      opened: true,
      openedBy: `user:${ownerId}`,
    })
    expect(await accepted({ type: 'table.close', tableId }, device)).toMatchObject({ closed: true })
    // The Log names the device's account, as D122 §7 says.
    const log = await world.owner.query<{ kind: string; actor: string }>(
      `select kind, actor from restro.log_entries where tenant_id = $1 and seq > $2 and kind in ('sitting.opened', 'sitting.ended')`,
      [world.tenantId, before],
    )
    expect(log.rows.length).toBeGreaterThanOrEqual(2)
    for (const row of log.rows) expect(row.actor).toBe(`user:${ownerId}`)
    await closeEverything()
  })

  describe('payment tables', () => {
    it('marks a payment table with settings.payment_tables: hidden, its code retired, logged', async () => {
      const tableId = table(1)
      const issued = await issueTableToken(world.app, world.tenantId, tableId, publicKey)
      if (!issued.ok) throw new Error(`no code: ${JSON.stringify(issued)}`)

      // A manager role without the permission may not; a stale sign-in may not either.
      expect(
        await run({ type: 'table.mark_payment', tableId, isPaymentTable: true }, user(managerId)),
      ).toMatchObject({ code: 'permission_denied' })
      const stale = await applyService(
        world.app,
        { type: 'table.mark_payment', tableId, isPaymentTable: true },
        { ...context(user(ownerId)), signedInAt: new Date(Date.now() - 16 * 60_000) },
      )
      expect(stale.result).toMatchObject({ code: 'sign_in_again' })

      // An open table is closed first.
      await accepted({ type: 'table.open', tableId })
      expect(
        await run({ type: 'table.mark_payment', tableId, isPaymentTable: true }),
      ).toMatchObject({ code: 'table_open' })
      await accepted({ type: 'table.close', tableId })

      const marked = await accepted({ type: 'table.mark_payment', tableId, isPaymentTable: true })
      expect(marked.changed).toBe(true)
      expect(String(marked.retired).split(',')).toContain(issued.table.codeHash)
      const { rows } = await world.owner.query(
        `select is_payment_table, hidden, qr_code_hash, qr_code_sealed from restro.tables
         where id = $1`,
        [tableId],
      )
      expect(rows).toEqual([
        { is_payment_table: true, hidden: true, qr_code_hash: null, qr_code_sealed: null },
      ])
      const { rows: entries } = await world.owner.query(
        `select retention, reason, details from restro.log_entries
         where table_id = $1 and kind = 'settings.changed'`,
        [tableId],
      )
      expect(entries).toEqual([
        { retention: 'record', reason: 'payment_table', details: { isPaymentTable: true } },
      ])
      expect(
        await accepted({ type: 'table.mark_payment', tableId, isPaymentTable: true }),
      ).toMatchObject({ changed: false })
    })

    it('never opens a payment table for phones, nor gives it a code', async () => {
      const tableId = table(1)
      expect(await run({ type: 'table.open', tableId })).toMatchObject({ code: 'payment_table' })
      expect(await run({ type: 'table.new_guests', tableId })).toMatchObject({
        code: 'payment_table',
      })
      expect(await accepted({ type: 'tables.open_all' })).toMatchObject({ skipped: 1 })
      expect(await openSittingOf(tableId)).toBeNull()
      await closeEverything()

      const code = await issueTableToken(world.app, world.tenantId, tableId, publicKey)
      expect(code).toMatchObject({ ok: false, error: 'payment_table' })
      const shown = await setTableHidden(world.app, world.tenantId, tableId, false)
      expect(shown).toMatchObject({ ok: false, error: 'payment_table' })

      // Taking the mark away leaves the table hidden and without a code, for the manager.
      expect(
        await accepted({ type: 'table.mark_payment', tableId, isPaymentTable: false }),
      ).toMatchObject({ changed: true, retired: '' })
      const { rows } = await world.owner.query(
        'select is_payment_table, hidden from restro.tables where id = $1',
        [tableId],
      )
      expect(rows).toEqual([{ is_payment_table: false, hidden: true }])
    })

    it('refuses to take the mark away while a payment holds the table (#215)', async () => {
      const tableId = table(3)
      const unmark = { type: 'table.mark_payment', tableId, isPaymentTable: false } as const
      await accepted({ type: 'table.mark_payment', tableId, isPaymentTable: true })

      // A payment owns the table from `queued` until it is final and the table reads empty (D127).
      const holder = `py_${randomUUID().replaceAll('-', '')}`
      await world.owner.query(
        `insert into restro.locks
           (tenant_id, venue_id, scope, key, holder, fence, taken_at, source, actor, job_id)
         values ($1, $2, 'payment_table', $3, $4, 1, now(), 'restro', 'system', 'unmark-test')`,
        [world.tenantId, world.venueId, tableId, holder],
      )
      expect(await run(unmark)).toMatchObject({ status: 'refused', code: 'payment_table_busy' })
      const { rows: held } = await world.owner.query(
        'select is_payment_table from restro.tables where id = $1',
        [tableId],
      )
      expect(held).toEqual([{ is_payment_table: true }])
      // Marking it again is not what the lease guards.
      expect(
        await accepted({ type: 'table.mark_payment', tableId, isPaymentTable: true }),
      ).toMatchObject({ changed: false })

      // Once the payment frees the table, the mark can go.
      await world.owner.query(
        `update restro.locks set holder = null, released_at = now()
         where tenant_id = $1 and scope = 'payment_table' and key = $2`,
        [world.tenantId, tableId],
      )
      expect(await accepted(unmark)).toMatchObject({ changed: true })
    })
  })

  it('refuses to open a table that left the POS floor while its pause is active', async () => {
    const tableId = table(2)
    await accepted({ type: 'table.open', tableId })
    const worker = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `job-${randomUUID()}`,
    } satisfies ServiceContext
    const vanished = await applyService(
      world.app,
      { type: 'floor.table_vanished', tableId },
      worker,
    )
    expect(vanished.result).toMatchObject({ status: 'accepted', details: { paused: true } })
    await accepted({ type: 'table.close', tableId })
    expect(await run({ type: 'table.open', tableId })).toMatchObject({ code: 'table_vanished' })

    await applyService(world.app, { type: 'floor.table_returned', tableId }, worker)
    expect(await accepted({ type: 'table.open', tableId })).toMatchObject({ opened: true })
    await closeEverything()
  })
})
