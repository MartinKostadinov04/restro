// The time window of a staff Undo on Tonight (#219; Martin 10-29, B7) on a real Postgres, as the
// restro_app role. Every Tonight write that offers an Undo answers with a token (the Log entry it
// wrote and its time); the inverse command sends it back. Inside 30 seconds and with the thing
// untouched it works; after the window it is refused `undo_expired`; when another member changed
// the thing meanwhile it is refused `undo_stale` and changes nothing; without a token it is a normal
// command. Covers open and close, Open all, pause and lift, and Brought. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { serviceDate } from '../service-day'
import { STAFF_UNDO_WINDOW_MS } from '../table-order'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, type ServiceCommand } from './index'

describe.skipIf(!hasDatabase)('the Undo window of Tonight (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let day: string

  beforeAll(async () => {
    world = await openServiceWorld('undo-window')
    ownerId = await world.addUser('owner')
    const { rows } = await world.owner.query<{ timezone: string; ends: string }>(
      'select timezone, service_day_ends_at::text as ends from restro.venues where id = $1',
      [world.venueId],
    )
    day = serviceDate(new Date(), rows[0]?.timezone as string, rows[0]?.ends as string)
  })

  afterAll(async () => {
    await world?.close()
  })

  // Every call is its own job, as every request of the web app is: the Undo's own entries are not
  // another member's change.
  const user = (): ServiceActor => ({
    kind: 'user',
    userId: ownerId,
    sessionId: `sess-${randomUUID()}`,
  })
  const context = (origin: ServiceContext['origin'] = 'staff') =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin,
      actor: origin === 'staff' ? user() : { kind: 'system' },
      jobId: `req-${randomUUID()}`,
      ...(origin === 'staff' ? { via: 'tonight' } : {}),
    }) as ServiceContext
  const run = async (command: unknown, origin: ServiceContext['origin'] = 'staff') =>
    (await applyService(world.app, command as ServiceCommand, context(origin))).result
  const accepted = async (command: unknown) => {
    const result = await run(command)
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
    return result.details
  }
  const table = (index: number) => world.tables[index] as `tb_${string}`
  const tokenOf = (details: Record<string, unknown>) => ({ entry: Number(details.undoEntry) })

  /** Makes the write older than the window: its Log entry is 31 seconds older. */
  const ageBeyondWindow = (entry: number) =>
    world.owner.query(
      `update restro.log_entries set at = at - make_interval(secs => $2) where seq = $1`,
      [entry, STAFF_UNDO_WINDOW_MS / 1000 + 1],
    )
  const isOpen = async (tableId: string) =>
    (
      await world.owner.query(
        'select 1 from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
    ).rowCount === 1
  const closeEverything = async () => {
    await accepted({ type: 'tables.close_all' })
  }

  describe('opening and closing a table', () => {
    it('answers with the Log entry of the write and its time, and none for a repeat', async () => {
      const tableId = table(0)
      const opened = await accepted({ type: 'table.open', tableId })
      const { rows } = await world.owner.query<{ kind: string; at: Date; table_id: string }>(
        'select kind, at, table_id from restro.log_entries where seq = $1',
        [tokenOf(opened).entry],
      )
      expect(rows[0]).toMatchObject({ kind: 'sitting.opened', table_id: tableId })
      expect(new Date(String(opened.undoAt)).getTime()).toBe(rows[0]?.at.getTime())

      // Open on an open table writes nothing: no token, so no Undo to take someone's open back.
      const again = await accepted({ type: 'table.open', tableId })
      expect(again).toMatchObject({ opened: false })
      expect(again).not.toHaveProperty('undoEntry')
      await closeEverything()
    })

    it('undoes an open inside the window', async () => {
      const tableId = table(0)
      const opened = await accepted({ type: 'table.open', tableId })
      const undone = await accepted({ type: 'table.close', tableId, undo: tokenOf(opened) })
      expect(undone).toMatchObject({ closed: true })
      expect(await isOpen(tableId)).toBe(false)
    })

    it('refuses the Undo of an open after the window, and leaves the table open', async () => {
      const tableId = table(0)
      const opened = await accepted({ type: 'table.open', tableId })
      await ageBeyondWindow(tokenOf(opened).entry)
      expect(await run({ type: 'table.close', tableId, undo: tokenOf(opened) })).toMatchObject({
        status: 'refused',
        code: 'undo_expired',
      })
      expect(await isOpen(tableId)).toBe(true)
      // Without the token it is the normal command, whatever the age.
      expect(await accepted({ type: 'table.close', tableId })).toMatchObject({ closed: true })
    })

    it('refuses the Undo of an open when another member closed and opened it again', async () => {
      const tableId = table(0)
      const opened = await accepted({ type: 'table.open', tableId })
      await accepted({ type: 'table.close', tableId })
      const theirs = await accepted({ type: 'table.open', tableId })
      expect(await run({ type: 'table.close', tableId, undo: tokenOf(opened) })).toMatchObject({
        status: 'refused',
        code: 'undo_stale',
      })
      // Their open stands, and the refusal changed nothing.
      expect(await isOpen(tableId)).toBe(true)
      const { rows } = await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
      expect(rows[0]?.id).toBe(theirs.sittingId)
      await closeEverything()
    })

    it('undoes a close inside the window, refuses it after, and when someone opened meanwhile', async () => {
      const tableId = table(1)
      await accepted({ type: 'table.open', tableId })
      const closed = await accepted({ type: 'table.close', tableId })
      expect(await accepted({ type: 'table.open', tableId, undo: tokenOf(closed) })).toMatchObject({
        opened: true,
      })
      expect(await isOpen(tableId)).toBe(true)

      const closedAgain = await accepted({ type: 'table.close', tableId })
      await ageBeyondWindow(tokenOf(closedAgain).entry)
      expect(await run({ type: 'table.open', tableId, undo: tokenOf(closedAgain) })).toMatchObject({
        code: 'undo_expired',
      })
      expect(await isOpen(tableId)).toBe(false)

      await accepted({ type: 'table.open', tableId })
      const closedThird = await accepted({ type: 'table.close', tableId })
      const theirs = await accepted({ type: 'table.open', tableId })
      expect(await run({ type: 'table.open', tableId, undo: tokenOf(closedThird) })).toMatchObject({
        code: 'undo_stale',
      })
      const { rows } = await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
      expect(rows[0]?.id).toBe(theirs.sittingId)
      await closeEverything()
    })

    it('refuses a token that names no entry of this venue as expired', async () => {
      const tableId = table(0)
      await accepted({ type: 'table.open', tableId })
      expect(
        await run({ type: 'table.close', tableId, undo: { entry: 999_999_999_999 } }),
      ).toMatchObject({ code: 'undo_expired' })
      expect(await isOpen(tableId)).toBe(true)
      await closeEverything()
    })

    it('rejects a token that is not a Log entry number', async () => {
      expect(
        await run({ type: 'table.close', tableId: table(0), undo: { entry: 'x' } }),
      ).toMatchObject({ code: 'invalid_command' })
    })
  })

  describe('Open all', () => {
    it('answers with a token; its Undo closes each table, but not one changed since', async () => {
      const opened = await accepted({ type: 'tables.open_all' })
      expect(opened).toMatchObject({ opened: 4 })
      const token = tokenOf(opened)

      // Another member closed the first table, then opened it again.
      await accepted({ type: 'table.close', tableId: table(0) })
      await accepted({ type: 'table.open', tableId: table(0) })
      expect(await run({ type: 'table.close', tableId: table(0), undo: token })).toMatchObject({
        code: 'undo_stale',
      })
      expect(await isOpen(table(0))).toBe(true)

      for (const index of [1, 2, 3]) {
        expect(
          await accepted({ type: 'table.close', tableId: table(index), undo: token }),
        ).toMatchObject({ closed: true })
        expect(await isOpen(table(index))).toBe(false)
      }
      await closeEverything()
    })

    it('is too late for every table after the window', async () => {
      const opened = await accepted({ type: 'tables.open_all' })
      await ageBeyondWindow(tokenOf(opened).entry)
      expect(
        await run({ type: 'table.close', tableId: table(2), undo: tokenOf(opened) }),
      ).toMatchObject({ code: 'undo_expired' })
      expect(await isOpen(table(2))).toBe(true)
      await closeEverything()
    })

    it('gives no token when it opened nothing', async () => {
      await accepted({ type: 'tables.open_all' })
      const again = await accepted({ type: 'tables.open_all' })
      expect(again).toMatchObject({ opened: 0 })
      expect(again).not.toHaveProperty('undoEntry')
      await closeEverything()
    })
  })

  describe('pausing and resuming ordering', () => {
    const activePauses = async () =>
      (
        await world.owner.query<{ id: string }>(
          'select id from restro.pauses where venue_id = $1 and lifted_at is null and cause = $2',
          [world.venueId, 'staff'],
        )
      ).rows.map((row) => row.id)
    const liftAll = async () => {
      await world.owner.query(
        'update restro.pauses set lifted_at = now() where venue_id = $1 and lifted_at is null',
        [world.venueId],
      )
    }

    it('undoes a pause by lifting it inside the window', async () => {
      await liftAll()
      const paused = await accepted({ type: 'ordering.pause', barId: null })
      expect(paused).toHaveProperty('undoEntry')
      const undone = await accepted({
        type: 'ordering.lift',
        pauseId: paused.pauseId,
        undo: tokenOf(paused),
      })
      expect(undone).toMatchObject({ lifted: true })
      expect(await activePauses()).toEqual([])
    })

    it('refuses the Undo of a pause after the window, and when someone lifted it meanwhile', async () => {
      await liftAll()
      const paused = await accepted({ type: 'ordering.pause', barId: null })
      await ageBeyondWindow(tokenOf(paused).entry)
      expect(
        await run({ type: 'ordering.lift', pauseId: paused.pauseId, undo: tokenOf(paused) }),
      ).toMatchObject({ code: 'undo_expired' })
      expect(await activePauses()).toEqual([paused.pauseId])
      // No token: a normal lift.
      await accepted({ type: 'ordering.lift', pauseId: paused.pauseId })

      const second = await accepted({ type: 'ordering.pause', barId: null })
      await accepted({ type: 'ordering.lift', pauseId: second.pauseId })
      const third = await accepted({ type: 'ordering.pause', barId: null })
      // Their pause is not the one the Undo meant: the lift of `second` is stale.
      expect(
        await run({ type: 'ordering.lift', pauseId: second.pauseId, undo: tokenOf(second) }),
      ).toMatchObject({ code: 'undo_stale' })
      expect(await activePauses()).toEqual([third.pauseId])
      await liftAll()
    })

    it('gives no token to a repeat that found the pause already there', async () => {
      await liftAll()
      await accepted({ type: 'ordering.pause', barId: null })
      const again = await accepted({ type: 'ordering.pause', barId: null })
      expect(again).toMatchObject({ already: true })
      expect(again).not.toHaveProperty('undoEntry')
      await liftAll()
    })

    it('undoes a lift by pausing again, unless someone paused again or the window passed', async () => {
      await liftAll()
      const paused = await accepted({ type: 'ordering.pause', barId: null })
      const lifted = await accepted({ type: 'ordering.lift', pauseId: paused.pauseId })
      expect(lifted).toHaveProperty('undoEntry')
      expect(
        await accepted({ type: 'ordering.pause', barId: null, undo: tokenOf(lifted) }),
      ).toMatchObject({ already: false })
      expect(await activePauses()).toHaveLength(1)

      // Lifted again; this time another member pauses before the Undo arrives.
      const [current] = await activePauses()
      const liftedAgain = await accepted({ type: 'ordering.lift', pauseId: current })
      const theirs = await accepted({ type: 'ordering.pause', barId: null })
      expect(
        await run({ type: 'ordering.pause', barId: null, undo: tokenOf(liftedAgain) }),
      ).toMatchObject({ code: 'undo_stale' })
      expect(await activePauses()).toEqual([theirs.pauseId])

      // Lifted once more, then too old.
      const liftedLate = await accepted({ type: 'ordering.lift', pauseId: theirs.pauseId })
      await ageBeyondWindow(tokenOf(liftedLate).entry)
      expect(
        await run({ type: 'ordering.pause', barId: null, undo: tokenOf(liftedLate) }),
      ).toMatchObject({ code: 'undo_expired' })
      expect(await activePauses()).toEqual([])
    })
  })

  describe('Brought', () => {
    const worker = () => context('worker')
    let sitting: string | null = null
    async function toBring(): Promise<string> {
      const id = newId('py')
      const tableId = table(0)
      sitting ??= await world.openSitting(tableId)
      const sittingId = sitting
      await world.owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            amount_minor, tip_minor, currency, provider_kind, receipt_number, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', 'closed', $7, 1500, 100, 'EUR', 'sim-pay',
            'R-000123', 'restro', 'system', 'test-seed')`,
        [
          id,
          world.tenantId,
          world.venueId,
          tableId,
          sittingId,
          day,
          createHash('sha256').update(id).digest('hex'),
        ],
      )
      const captured = await applyService(
        world.app,
        {
          type: 'payment.captured',
          paymentId: id,
          outcome: 'captured',
          capturedMinor: 1450,
          code: null,
        } as ServiceCommand,
        worker(),
      )
      expect(captured.result).toMatchObject({ status: 'accepted' })
      return id
    }
    const brought = async (id: string) => {
      const { rows } = await world.owner.query<{ brought_at: Date | null }>(
        'select receipt_brought_at as brought_at from restro.payments where id = $1',
        [id],
      )
      return rows[0]?.brought_at !== null
    }

    it('undoes Brought inside the window, refuses it after, and after another member changed it', async () => {
      const id = await toBring()
      const first = await accepted({ type: 'receipt.brought', paymentId: id })
      expect(first).toMatchObject({ changed: true })
      expect(
        await accepted({ type: 'receipt.unbrought', paymentId: id, undo: tokenOf(first) }),
      ).toMatchObject({ brought: false, changed: true })
      expect(await brought(id)).toBe(false)

      // Too old.
      const second = await accepted({ type: 'receipt.brought', paymentId: id })
      await ageBeyondWindow(tokenOf(second).entry)
      expect(
        await run({ type: 'receipt.unbrought', paymentId: id, undo: tokenOf(second) }),
      ).toMatchObject({ code: 'undo_expired' })
      expect(await brought(id)).toBe(true)

      // Another member put it back and marked it again: the first member's Undo is stale.
      await accepted({ type: 'receipt.unbrought', paymentId: id })
      const third = await accepted({ type: 'receipt.brought', paymentId: id })
      await accepted({ type: 'receipt.unbrought', paymentId: id })
      await accepted({ type: 'receipt.brought', paymentId: id })
      expect(
        await run({ type: 'receipt.unbrought', paymentId: id, undo: tokenOf(third) }),
      ).toMatchObject({ code: 'undo_stale' })
      expect(await brought(id)).toBe(true)
    })

    it('gives no token to a repeat that changed nothing', async () => {
      const id = await toBring()
      await accepted({ type: 'receipt.brought', paymentId: id })
      const repeat = await accepted({ type: 'receipt.brought', paymentId: id })
      expect(repeat).toMatchObject({ changed: false })
      expect(repeat).not.toHaveProperty('undoEntry')
    })
  })

  it('gives a command from outside Tonight no token', async () => {
    const result = await applyService(
      world.app,
      { type: 'table.open', tableId: table(3) } as ServiceCommand,
      { ...context(), via: 'telegram' } as ServiceContext,
    )
    expect(result.result).toMatchObject({ status: 'accepted', details: { opened: true } })
    if (result.result.status === 'accepted') {
      expect(result.result.details).not.toHaveProperty('undoEntry')
    }
    await closeEverything()
  })
})
