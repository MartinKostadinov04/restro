// Integration tests of the service write path (design §2.1–§2.4; ticket #69) on a real Postgres,
// as the restro_app role. The real commands are stubs, so the machinery is driven through test
// definitions: origins and permissions, the repeat check (the ring, a Send's action id), the
// savepoint that rolls a refusal back, the version bump, the Log's provenance and `busy` on a
// held row. The real stubs are checked through `applyService`. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { hasDatabase } from '../apply/test-database'
import { idSchema, newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext, Via } from './context'
import { type CommandRegistry, defineCommand } from './definition'
import { executeCommand } from './engine'
import { applyService } from './index'
import { readTableState } from './read'
import { accepted, refused } from './results'

const calls = { edit: 0, refuse: 0 }

const onTable = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), tableId: idSchema('tb'), actionId: z.uuid() })

/** Test definitions that drive the machinery the real commands will use. */
const REGISTRY: CommandRegistry = {
  // A command whose ticket has not built it (every real one is built now, #83).
  'test.unbuilt': defineCommand({
    schema: z.strictObject({ type: z.literal('test.unbuilt') }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: null,
  }),
  'test.edit': defineCommand({
    schema: onTable('test.edit'),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    handle: async (stx, command) => {
      calls.edit += 1
      stx.rows.touch(command.tableId)
      await stx.log({ kind: 'waiter_call.called', tableId: command.tableId })
      return accepted(command.actionId)
    },
  }),
  'test.refuse': defineCommand({
    schema: onTable('test.refuse'),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    handle: async (stx, command) => {
      calls.refuse += 1
      stx.rows.touch(command.tableId)
      await stx.log({ kind: 'waiter_call.lapsed', tableId: command.tableId })
      return refused(command.actionId, 'line_held')
    },
  }),
  'test.trip': defineCommand({
    schema: onTable('test.trip'),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    handle: async (stx, command) => {
      await stx.log({ kind: 'waiter_call.lapsed', tableId: command.tableId })
      stx.keepOnRefusal(async () => {
        stx.rows.touch(command.tableId)
        await stx.log({ kind: 'guard.tripped', tableId: command.tableId, reason: 'test_trip' })
      })
      return refused(command.actionId, 'line_held')
    },
  }),
  'test.kept': defineCommand({
    schema: onTable('test.kept'),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    handle: async (stx, command) => {
      stx.keepOnRefusal(async () => {
        await stx.log({ kind: 'guard.tripped', tableId: command.tableId, reason: 'test_kept' })
      })
      return accepted(command.actionId)
    },
  }),
  'test.send': defineCommand({
    schema: onTable('test.send'),
    origins: ['guest'],
    permission: null,
    idempotency: 'sent_order',
    handle: async () => {
      throw new Error('the handler of a repeated Send ran')
    },
  }),
  'test.open': defineCommand({
    schema: z.strictObject({ type: z.literal('test.open'), tableId: idSchema('tb') }),
    origins: ['staff'],
    permission: 'tables.open_close',
    idempotency: 'by_nature',
    handle: async (stx, command) => {
      await stx.log({ kind: 'sitting.opened', tableId: command.tableId })
      return accepted(null)
    },
  }),
  'test.quick': defineCommand({
    schema: z.strictObject({ type: z.literal('test.quick'), tableId: idSchema('tb') }),
    origins: ['staff'],
    permission: 'tables.open_close',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: async () => accepted(null),
  }),
  'test.quick_lift': defineCommand({
    schema: z.strictObject({ type: z.literal('test.quick_lift') }),
    origins: ['staff'],
    permission: 'ordering.lift',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: async () => accepted(null),
  }),
  'test.quick_settings': defineCommand({
    schema: z.strictObject({ type: z.literal('test.quick_settings') }),
    origins: ['staff'],
    permission: 'settings.codes',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: async () => accepted(null),
  }),
  'test.codes': defineCommand({
    schema: z.strictObject({ type: z.literal('test.codes') }),
    origins: ['staff'],
    permission: 'settings.codes',
    idempotency: 'by_nature',
    handle: async () => accepted(null),
  }),
  'test.lift': defineCommand({
    schema: z.strictObject({ type: z.literal('test.lift') }),
    origins: ['staff'],
    permission: 'ordering.lift',
    idempotency: 'by_nature',
    handle: async () => accepted(null),
  }),
}

describe.skipIf(!hasDatabase)('the service write path (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let adminId: string
  let waiterUserId: string
  let barmanUserId: string
  let outsiderId: string
  let pinStaffId: string
  let deviceSession: string

  beforeAll(async () => {
    world = await openServiceWorld('engine')
    ownerId = await world.addUser('owner')
    adminId = await world.addUser('admin')
    waiterUserId = await world.addUser('member')
    await world.addStaff(['tables.open_close', 'alerts.answer'], waiterUserId)
    barmanUserId = await world.addUser('member')
    await world.addStaff(['sold_out'], barmanUserId)
    outsiderId = await world.addUser()
    // A PIN's person may hold a settings permission in their role; a PIN never unlocks it.
    pinStaffId = await world.addStaff(['tables.open_close', 'settings.codes'])
    deviceSession = `sess-${randomUUID()}`
    await world.addSharedDevice(deviceSession)
  })

  afterAll(async () => {
    await world?.close()
  })

  const jobId = () => `req-${randomUUID()}`
  const guest = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: jobId(),
  })
  const staff = (actor: ServiceActor, via: Via = 'tonight'): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor,
    jobId: jobId(),
    via,
  })
  const user = (userId: string, sessionId = `sess-${randomUUID()}`): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId,
  })
  const run = (command: unknown, context: ServiceContext) =>
    executeCommand(world.app, REGISTRY, command, context)
  const versionOf = async (tableId: string) => {
    const state = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    if (state === null) throw new Error(`no table ${tableId}`)
    return state.version
  }
  const logOf = async (tableId: string) =>
    (
      await world.owner.query(
        `select kind, source, actor, job_id, via, retention from restro.log_entries
         where tenant_id = $1 and table_id = $2 order by seq`,
        [world.tenantId, tableId],
      )
    ).rows

  describe('origins and permissions', () => {
    const open = () => ({ type: 'test.open', tableId: world.tables[0] })

    it('refuses an unknown or malformed command as invalid', async () => {
      expect(await run({ type: 'nope' }, guest())).toMatchObject({ code: 'invalid_command' })
      expect(
        await run({ type: 'test.edit', tableId: world.tables[0], actionId: 'x' }, guest()),
      ).toMatchObject({ status: 'refused', code: 'invalid_command' })
    })

    it('refuses a staff command from a guest, before the database is asked', async () => {
      expect(await run(open(), guest())).toMatchObject({ code: 'origin_not_allowed' })
    })

    it('throws on a context whose actor does not fit its origin (the caller is wrong)', async () => {
      await expect(run(open(), { ...guest(), origin: 'staff' })).rejects.toThrow()
    })

    it('lets the organisation owner and admin do everything', async () => {
      expect(await run(open(), staff(user(ownerId)))).toMatchObject({ status: 'accepted' })
      expect(await run(open(), staff(user(adminId)))).toMatchObject({ status: 'accepted' })
      expect(await run({ type: 'test.codes' }, staff(user(adminId)))).toMatchObject({
        status: 'accepted',
      })
    })

    it('gives anyone else their venue role, and refuses what it lacks', async () => {
      expect(await run(open(), staff(user(waiterUserId)))).toMatchObject({ status: 'accepted' })
      expect(await run(open(), staff(user(barmanUserId)))).toMatchObject({
        code: 'permission_denied',
      })
      expect(await run({ type: 'test.codes' }, staff(user(waiterUserId)))).toMatchObject({
        code: 'permission_denied',
      })
    })

    it('refuses an account that is not a member of the organisation', async () => {
      expect(await run(open(), staff(user(outsiderId)))).toMatchObject({ code: 'actor_unknown' })
    })

    it('asks for a PIN on a shared device, even from the owner, and lets the PIN decide', async () => {
      expect(await run(open(), staff(user(ownerId, deviceSession)))).toMatchObject({
        code: 'pin_required',
      })
      const pin: ServiceActor = {
        kind: 'staff',
        staffMemberId: pinStaffId,
        sessionId: deviceSession,
      }
      expect(await run(open(), staff(pin))).toMatchObject({ status: 'accepted' })
      // A PIN is good only on a shared device of this venue.
      expect(await run(open(), staff({ ...pin, sessionId: 'not-a-device' }))).toMatchObject({
        code: 'actor_unknown',
      })
    })

    it('lets the shared device’s own account run a quick answer with what Staff hold', async () => {
      const quick = { type: 'test.quick', tableId: world.tables[0] }
      // Even an owner's tablet holds only Staff's rights, and only for a command marked quick.
      expect(await run(quick, staff(user(ownerId, deviceSession)))).toMatchObject({
        status: 'accepted',
      })
      expect(
        await run({ type: 'test.quick_lift' }, staff(user(ownerId, deviceSession))),
      ).toMatchObject({
        code: 'permission_denied',
      })
      // Not even a flagged command reaches a settings permission from a device.
      expect(
        await run({ type: 'test.quick_settings' }, staff(user(ownerId, deviceSession))),
      ).toMatchObject({
        code: 'permission_denied',
      })
      // A command without the flag is still pin_required, whatever it needs.
      expect(await run({ type: 'test.codes' }, staff(user(ownerId, deviceSession)))).toMatchObject({
        code: 'pin_required',
      })
      // An account that is not a member of the organisation gets nothing from a device.
      expect(await run(quick, staff(user(outsiderId, deviceSession)))).toMatchObject({
        code: 'actor_unknown',
      })
      // Off a shared device the account's own role decides, as before.
      expect(await run(quick, staff(user(barmanUserId)))).toMatchObject({
        code: 'permission_denied',
      })
    })

    it('never lets a PIN unlock a settings permission', async () => {
      const pin: ServiceActor = {
        kind: 'staff',
        staffMemberId: pinStaffId,
        sessionId: deviceSession,
      }
      expect(await run({ type: 'test.codes' }, staff(pin))).toMatchObject({
        code: 'own_sign_in_required',
      })
    })

    it("gives Restro's admin team its own permissions while its grant is active", async () => {
      const active = await world.addUser()
      await world.addOperator(active)
      const revoked = await world.addUser()
      await world.addOperator(revoked, true)
      const operator = (userId: string) => staff({ kind: 'operator', userId })
      expect(await run({ type: 'test.lift' }, operator(active))).toMatchObject({
        status: 'accepted',
      })
      expect(await run(open(), operator(active))).toMatchObject({ code: 'permission_denied' })
      expect(await run({ type: 'test.lift' }, operator(revoked))).toMatchObject({
        code: 'actor_unknown',
      })
    })
  })

  describe('the real commands', () => {
    // Every command is built (the last, `alert.done`, by #83), so a definition of the test's own
    // stands in for one that is not.
    it('refuses a command not built yet as not_built', async () => {
      const owner = staff(user(ownerId))
      expect(await run({ type: 'test.unbuilt' }, owner)).toEqual(refused(null, 'not_built'))
    })

    it('refuses a table of another venue as missing, and a guest sending a staff command', async () => {
      const elsewhere = await openServiceWorld('engine-other')
      try {
        const actionId = randomUUID()
        const missing = await applyService(
          world.app,
          { type: 'waiter.call', tableId: elsewhere.tables[0], actionId, kind: 'waiter', ageMs: 0 },
          guest(),
        )
        expect(missing).toEqual({ result: refused(actionId, 'table_missing'), state: null })
      } finally {
        await elsewhere.close()
      }
      const staffOnly = await applyService(
        world.app,
        { type: 'table.open', tableId: world.tables[0] },
        guest(),
      )
      expect(staffOnly).toEqual({ result: refused(null, 'origin_not_allowed'), state: null })
    })
  })

  describe('repeats, rollback and versions', () => {
    it('refuses an order edit on a table that is not open', async () => {
      const actionId = randomUUID()
      expect(await run({ type: 'test.edit', tableId: world.tables[3], actionId }, guest())).toEqual(
        refused(actionId, 'table_not_open'),
      )
    })

    it('answers a repeated action id with its first answer, runs it once and bumps once', async () => {
      const tableId = world.tables[1] as string
      await world.openSitting(tableId)
      expect(await versionOf(tableId)).toBe(0)

      const first = { type: 'test.edit', tableId, actionId: randomUUID() }
      const before = calls.edit
      const answer = await run(first, guest())
      expect(answer).toEqual(accepted(first.actionId))
      const after = await versionOf(tableId)
      expect(after).toBeGreaterThan(0)

      expect(await run(first, guest())).toEqual(answer)
      expect(calls.edit).toBe(before + 1)
      expect(await versionOf(tableId)).toBe(after)

      await run({ ...first, actionId: randomUUID() }, guest())
      expect(calls.edit).toBe(before + 2)
      expect(await versionOf(tableId)).toBe(after + 1)
    })

    it('keeps the version rising when new guests sit down', async () => {
      const tableId = world.tables[1] as string
      const last = await versionOf(tableId)
      await world.owner.query(
        `update restro.sittings set ended_at = now(), end_reason = 'new_guests'
         where tenant_id = $1 and table_id = $2 and ended_at is null`,
        [world.tenantId, tableId],
      )
      await world.openSitting(tableId)
      // The new sitting has no order row yet: its version is the table's highest so far.
      expect(await versionOf(tableId)).toBe(last)
      await run({ type: 'test.edit', tableId, actionId: randomUUID() }, guest())
      expect(await versionOf(tableId)).toBeGreaterThan(last)
    })

    it('rolls a refused handler back: no Log entry, no bump, and the refusal is remembered', async () => {
      const tableId = world.tables[2] as string
      await world.openSitting(tableId)
      await run({ type: 'test.edit', tableId, actionId: randomUUID() }, guest())
      const version = await versionOf(tableId)
      const logged = (await logOf(tableId)).length

      const command = { type: 'test.refuse', tableId, actionId: randomUUID() }
      const before = calls.refuse
      const answer = await run(command, guest())
      expect(answer).toEqual(refused(command.actionId, 'line_held'))
      expect(await versionOf(tableId)).toBe(version)
      expect(await logOf(tableId)).toHaveLength(logged)

      expect(await run(command, guest())).toEqual(answer)
      expect(calls.refuse).toBe(before + 1)
    })

    it('keeps the writes a refusing handler set aside for its refusal, and only for a refusal', async () => {
      // The table the rollback test opened.
      const tableId = world.tables[2] as string
      await run({ type: 'test.edit', tableId, actionId: randomUUID() }, guest())
      const version = await versionOf(tableId)
      const logged = (await logOf(tableId)).length

      const command = { type: 'test.trip', tableId, actionId: randomUUID() }
      expect(await run(command, guest())).toEqual(refused(command.actionId, 'line_held'))
      // The handler's own entry is rolled back; the kept one stays and the table's version rises.
      const kinds = (await logOf(tableId)).slice(logged).map((entry) => entry.kind)
      expect(kinds).toEqual(['guard.tripped'])
      expect(await versionOf(tableId)).toBe(version + 1)

      // An accepted handler's kept writes never run.
      await run({ type: 'test.kept', tableId, actionId: randomUUID() }, guest())
      expect((await logOf(tableId)).slice(logged).map((entry) => entry.kind)).toEqual([
        'guard.tripped',
      ])
    })

    it('answers a repeated Send with the sent order its action id made', async () => {
      const tableId = world.tables[3] as string
      const sittingId = await world.openSitting(tableId)
      const actionId = randomUUID()
      const sentOrderId = await world.addSentOrder({
        tableId,
        sittingId,
        actionId,
        reference: 'K7Q2',
      })
      expect(await run({ type: 'test.send', tableId, actionId }, guest())).toEqual(
        accepted(actionId, { ref: 'K7Q2', details: { sentOrderId } }),
      )
    })

    it('answers busy when the table order is held past the lock timeout', async () => {
      const tableId = world.tables[1] as string
      const holder = await world.owner.connect()
      try {
        await holder.query('begin')
        await holder.query(
          `select id from restro.table_orders where tenant_id = $1 and table_id = $2 for update`,
          [world.tenantId, tableId],
        )
        const actionId = randomUUID()
        expect(await run({ type: 'test.edit', tableId, actionId }, guest())).toEqual(
          refused(actionId, 'busy'),
        )
      } finally {
        await holder.query('rollback')
        holder.release()
      }
    })
  })

  describe('provenance (rule 2)', () => {
    it('stamps source, actor, job and via on every Log entry', async () => {
      const tableId = world.tables[0] as string
      const context = staff(user(waiterUserId), 'telegram')
      await run({ type: 'test.open', tableId }, context)
      const guestContext = guest()
      await world.openSitting(tableId)
      await run({ type: 'test.edit', tableId, actionId: randomUUID() }, guestContext)

      const rows = await logOf(tableId)
      expect(rows).toContainEqual({
        kind: 'sitting.opened',
        source: 'staff',
        actor: `user:${waiterUserId}`,
        job_id: context.jobId,
        via: 'telegram',
        retention: 'night',
      })
      expect(rows).toContainEqual({
        kind: 'waiter_call.called',
        source: 'guest',
        actor: 'guest',
        job_id: guestContext.jobId,
        via: 'guest_page',
        retention: 'night',
      })
      const { rows: orders } = await world.owner.query(
        `select source, actor, job_id from restro.table_orders
         where tenant_id = $1 and table_id = $2 and job_id = $3`,
        [world.tenantId, tableId, guestContext.jobId],
      )
      expect(orders).toEqual([{ source: 'guest', actor: 'guest', job_id: guestContext.jobId }])
    })
  })
})
