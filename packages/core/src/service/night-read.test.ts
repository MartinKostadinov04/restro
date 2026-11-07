// Integration tests of the reads of Tonight's other screens (#86) on a real Postgres, as the
// restro_app role: the day's sent orders (search over the whole day, "Not added", the answer and
// who gave it), one sent order's sheet, the Log (permission, the hidden kind, the filters) and the
// end of the night (permission by role, live totals against a closed day's written ones, the
// message's facts). Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { TEAM_ALERT_KINDS } from './alert-rules'
import type { ServiceActor } from './context'
import {
  MAX_EXPORT_DAYS,
  readExportDays,
  readLog,
  readNight,
  readNightReport,
  readSentOrderDetail,
  readSentOrders,
} from './night-read'

describe.skipIf(!hasDatabase)(
  'the reads of the other Tonight screens (as the restro_app role)',
  () => {
    let world: ServiceWorld
    let nightUser: string
    let managerUser: string
    let waiterUser: string
    let staffMemberId: string
    let day: string
    let yesterday: string
    const ids: Record<string, string> = {}
    const sittings = new Map<string, string>()
    const seed = ['worker', 'system', 'test-seed']

    const user = (userId: string): ServiceActor => ({
      kind: 'user',
      userId,
      sessionId: `sess-${randomUUID()}`,
    })
    const input = (actor: ServiceActor) => ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor,
    })

    async function addSent(
      name: string,
      fields: {
        state: string
        reason?: string | null
        reference: string
        tableIndex: number
        serviceDate?: string
        qty?: number
        totalMinor?: number
        createdAt?: string
      },
    ) {
      const tableId = world.tables[fields.tableIndex] as string
      // One open sitting per table: the next order of the table joins it.
      let sittingId = sittings.get(tableId)
      if (sittingId === undefined) {
        sittingId = await world.openSitting(tableId, day)
        sittings.set(tableId, sittingId)
      }
      const id = newId('so')
      ids[name] = id
      const lineId = newId('ol')
      await world.owner.query(
        `insert into restro.sent_orders
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, reason,
          lines, total_minor, created_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, $10::jsonb, $11,
               coalesce($12::timestamptz, now()), $13, $14, $15)`,
        [
          id,
          world.tenantId,
          world.venueId,
          tableId,
          sittingId,
          fields.serviceDate ?? day,
          fields.reference,
          fields.state,
          fields.reason ?? null,
          JSON.stringify([
            {
              id: lineId,
              itemId: newId('nd'),
              optionIds: [],
              qty: fields.qty ?? 2,
              unitMinor: 250,
              name: 'Gin tonic',
              optionNames: ['no mint'],
            },
          ]),
          fields.totalMinor ?? 500,
          fields.createdAt ?? null,
          ...seed,
        ],
      )
      return { id, tableId, sittingId, lineId }
    }

    async function addLog(fields: {
      kind: string
      sentOrderId?: string
      tableId?: string
      toState?: string
      reason?: string
      actor?: string
      via?: string
      details?: Record<string, unknown>
      serviceDate?: string
      retention?: string
    }) {
      await world.owner.query(
        `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, sent_order_id, table_id, to_state, reason, via,
          details, retention, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'staff', $12, 'test-seed')`,
        [
          world.tenantId,
          world.venueId,
          fields.serviceDate ?? day,
          fields.kind,
          fields.sentOrderId ?? null,
          fields.tableId ?? null,
          fields.toState ?? null,
          fields.reason ?? null,
          fields.via ?? null,
          JSON.stringify(fields.details ?? {}),
          fields.retention ?? 'night',
          fields.actor ?? 'system',
        ],
      )
    }

    beforeAll(async () => {
      world = await openServiceWorld('night')
      // Staff with the end of the night's first sections only; a manager with the rest; a waiter
      // who sees Tonight but neither the Log nor the end of the night.
      nightUser = await world.addUser('member')
      staffMemberId = await world.addStaff(['night.view', 'alerts.answer'], nightUser)
      managerUser = await world.addUser('member')
      await world.addStaff(['night.view_full', 'log.view', 'money.follow_up'], managerUser)
      waiterUser = await world.addUser('member')
      await world.addStaff(['alerts.answer'], waiterUser)

      const first = await readSentOrders(world.app, input(user(nightUser)))
      if (!first.ok) throw new Error(`refused: ${first.code}`)
      day = first.page.day
      yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

      // Oldest first, so the list order is the creation order reversed.
      await addSent('added', {
        state: 'added',
        reference: 'K1A',
        tableIndex: 0,
        createdAt: '2020-01-01T20:00:00Z',
      })
      await addSent('sold', {
        state: 'not_sent',
        reason: 'item_unavailable',
        reference: 'K2B',
        tableIndex: 1,
        createdAt: '2020-01-01T20:10:00Z',
      })
      const unconfirmed = await addSent('unconfirmed', {
        state: 'unconfirmed',
        reason: 'check_timed_out',
        reference: 'K3C',
        tableIndex: 2,
        createdAt: '2020-01-01T20:20:00Z',
      })
      const found = await addSent('found', {
        state: 'added',
        reason: 'staff_found',
        reference: 'K4D',
        tableIndex: 3,
        createdAt: '2020-01-01T20:30:00Z',
      })
      await world.owner.query(
        `insert into restro.sent_order_notes
         (tenant_id, venue_id, sent_order_id, line_id, note, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, 'extra ice', $5, $6, $7, $8)`,
        [world.tenantId, world.venueId, found.id, found.lineId, day, ...seed],
      )
      await addSent('waiting', {
        state: 'waiting',
        reference: 'K5E',
        tableIndex: 0,
        createdAt: '2020-01-01T20:40:00Z',
      })
      await addSent('old', {
        state: 'added',
        reference: 'OLD',
        tableIndex: 0,
        serviceDate: yesterday,
      })

      await addLog({
        kind: 'sent_order.state',
        sentOrderId: found.id,
        toState: 'unconfirmed',
        reason: 'check_timed_out',
      })
      await addLog({
        kind: 'sent_order.state',
        sentOrderId: found.id,
        toState: 'added',
        reason: 'staff_found',
        actor: `staff:${staffMemberId}`,
        via: 'telegram',
      })
      await addLog({ kind: 'sent_order.landed_late', sentOrderId: unconfirmed.id, actor: 'system' })
      await addLog({ kind: 'lease.taken_over', tableId: unconfirmed.tableId })
      await addLog({
        kind: 'waiter_call.called',
        tableId: world.tables[1] as string,
        actor: 'guest',
      })
      await addLog({ kind: 'pause.started', reason: 'staff', details: { scope: 'venue' } })
      await addLog({ kind: 'settings.changed', reason: 'payment_table', retention: 'record' })
      await addLog({ kind: 'waiter_call.called', serviceDate: yesterday, actor: 'guest' })
    })

    afterAll(async () => {
      await world?.close()
    })

    describe('the sent orders', () => {
      it('lists the day newest first, with counts that ignore the search', async () => {
        const read = await readSentOrders(world.app, input(user(nightUser)))
        if (!read.ok) throw new Error(read.code)
        expect(read.page.rows.map((row) => row.reference)).toEqual([
          'K5E',
          'K4D',
          'K3C',
          'K2B',
          'K1A',
        ])
        expect(read.page.counts).toEqual({
          all: 5,
          notAdded: 2,
          added: 2,
          notSent: 1,
          unconfirmed: 1,
        })
        const row = read.page.rows[1]
        expect(row?.itemCount).toBe(2)
        expect(row?.totalMinor).toBe(500)
        expect(row?.table).toBe('4')
        expect(row?.numbered).toBe(true)
      })

      it('names who answered an Unconfirmed one, and where the answer came from', async () => {
        const read = await readSentOrders(world.app, input(user(nightUser)))
        if (!read.ok) throw new Error(read.code)
        const answered = read.page.rows.find((row) => row.reference === 'K4D')
        expect(answered?.answer).toEqual({
          answer: 'found',
          who: { kind: 'person', name: 'Waiter' },
          via: 'telegram',
        })
        const late = read.page.rows.find((row) => row.reference === 'K3C')
        expect(late?.landedAt).not.toBeNull()
        expect(late?.answer).toBeNull()
      })

      it('finds by reference (any case, from its first character) or by table, over the whole day', async () => {
        const byRef = await readSentOrders(world.app, { ...input(user(nightUser)), search: 'k2' })
        if (!byRef.ok) throw new Error(byRef.code)
        expect(byRef.page.rows.map((row) => row.reference)).toEqual(['K2B'])
        const byTable = await readSentOrders(world.app, { ...input(user(nightUser)), search: '1' })
        if (!byTable.ok) throw new Error(byTable.code)
        expect(byTable.page.rows.map((row) => row.reference)).toEqual(['K5E', 'K1A'])
        // A `%` is text, not a pattern.
        const wild = await readSentOrders(world.app, { ...input(user(nightUser)), search: '%' })
        if (!wild.ok) throw new Error(wild.code)
        expect(wild.page.rows).toHaveLength(0)
      })

      it('keeps only the ones that never reached the bill for "Not added", and pages', async () => {
        const read = await readSentOrders(world.app, {
          ...input(user(nightUser)),
          notAddedOnly: true,
        })
        if (!read.ok) throw new Error(read.code)
        expect(read.page.rows.map((row) => row.reference)).toEqual(['K3C', 'K2B'])
        const paged = await readSentOrders(world.app, { ...input(user(nightUser)), limit: 2 })
        if (!paged.ok) throw new Error(paged.code)
        expect(paged.page.rows).toHaveLength(2)
        expect(paged.page.hasMore).toBe(true)
      })

      it('shows every role that sees Tonight the list, but an earlier day only to the night screens', async () => {
        const waiter = await readSentOrders(world.app, input(user(waiterUser)))
        expect(waiter.ok).toBe(true)
        const earlier = await readSentOrders(world.app, {
          ...input(user(waiterUser)),
          day: yesterday,
        })
        expect(earlier).toEqual({ ok: false, code: 'permission_denied' })
        const staff = await readSentOrders(world.app, { ...input(user(nightUser)), day: yesterday })
        if (!staff.ok) throw new Error(staff.code)
        expect(staff.page.rows.map((row) => row.reference)).toEqual(['OLD'])
      })

      it('gives one sent order its lines, notes and steps', async () => {
        const read = await readSentOrderDetail(world.app, {
          ...input(user(waiterUser)),
          sentOrderId: ids.found as string,
        })
        if (!read.ok) throw new Error(read.code)
        const detail = read.detail
        expect(detail?.lines).toEqual([
          {
            qty: 2,
            name: 'Gin tonic',
            optionNames: ['no mint'],
            unitMinor: 250,
            note: 'extra ice',
          },
        ])
        expect(detail?.steps.map((step) => step.toState)).toEqual(['unconfirmed', 'added'])
        expect(detail?.steps[1]?.who).toEqual({ kind: 'person', name: 'Waiter' })
        const missing = await readSentOrderDetail(world.app, {
          ...input(user(waiterUser)),
          sentOrderId: newId('so'),
        })
        if (!missing.ok) throw new Error(missing.code)
        expect(missing.detail).toBeNull()
      })
    })

    describe('the Log', () => {
      it('is refused without log.view', async () => {
        expect(await readLog(world.app, input(user(nightUser)))).toEqual({
          ok: false,
          code: 'permission_denied',
        })
        expect(await readLog(world.app, input(user(waiterUser)))).toEqual({
          ok: false,
          code: 'permission_denied',
        })
      })

      it('shows the day newest first and never a lease taken over', async () => {
        const read = await readLog(world.app, input(user(managerUser)))
        if (!read.ok) throw new Error(read.code)
        const kinds = read.page.rows.map((row) => row.kind)
        expect(kinds).not.toContain('lease.taken_over')
        expect(kinds[0]).toBe('settings.changed')
        expect(kinds).toContain('waiter_call.called')
        const seqs = read.page.rows.map((row) => row.seq)
        expect(seqs).toEqual([...seqs].sort((a, b) => b - a))
        expect(read.page.days).toContain(yesterday)
      })

      it('filters by kind group and searches by reference or table', async () => {
        const pauses = await readLog(world.app, { ...input(user(managerUser)), group: 'pauses' })
        if (!pauses.ok) throw new Error(pauses.code)
        expect(pauses.page.rows.map((row) => row.kind)).toEqual(['pause.started'])
        expect(pauses.page.rows[0]?.scope).toEqual({ kind: 'venue', name: null })
        const byRef = await readLog(world.app, { ...input(user(managerUser)), search: 'k4' })
        if (!byRef.ok) throw new Error(byRef.code)
        expect(byRef.page.rows.map((row) => row.reference)).toEqual(['K4D', 'K4D'])
        expect(byRef.page.rows[0]?.who).toEqual({ kind: 'person', name: 'Waiter' })
        expect(byRef.page.rows[0]?.via).toBe('telegram')
        const byTable = await readLog(world.app, { ...input(user(managerUser)), search: '2' })
        if (!byTable.ok) throw new Error(byTable.code)
        expect(byTable.page.rows.map((row) => row.kind)).toEqual(['waiter_call.called'])
        expect(byTable.page.rows[0]?.who).toEqual({ kind: 'guest' })
      })

      it('shows the Restro team’s own alerts to the Restro team only (D122 §7)', async () => {
        const operatorId = await world.addUser('member')
        await world.addOperator(operatorId)
        // A venue alert, and a day holding nothing but one of the team's own.
        const lonelyDay = '2026-01-05'
        await addLog({ kind: 'alert.raised', reason: 'ordering_paused' })
        for (const reason of TEAM_ALERT_KINDS) {
          await addLog({ kind: 'alert.raised', reason })
          await addLog({ kind: 'alert.done', reason })
        }
        await addLog({ kind: 'alert.raised', reason: 'order_pace', serviceDate: lonelyDay })

        const alertsFor = async (actor: ServiceActor) => {
          const read = await readLog(world.app, input(actor))
          if (!read.ok) throw new Error(read.code)
          return {
            reasons: read.page.rows
              .filter((row) => row.kind.startsWith('alert.'))
              .map((row) => row.reason),
            others: read.page.rows.filter((row) => !row.kind.startsWith('alert.')).length,
            days: read.page.days,
          }
        }

        const venue = await alertsFor(user(managerUser))
        expect(venue.reasons).toEqual(['ordering_paused'])
        expect(venue.days).not.toContain(lonelyDay)

        const team = await alertsFor({ kind: 'operator', userId: operatorId })
        expect(team.reasons).toContain('ordering_paused')
        for (const reason of TEAM_ALERT_KINDS) expect(team.reasons).toContain(reason)
        expect(team.days).toContain(lonelyDay)
        // Nothing else moves: both read the same other lines.
        expect(team.others).toBe(venue.others)
        // The same person signed in as themselves, as the admin app reads.
        expect(await alertsFor(user(operatorId))).toEqual(team)
      })

      it('reads an earlier night by its date, and a future one as today', async () => {
        const earlier = await readLog(world.app, { ...input(user(managerUser)), day: yesterday })
        if (!earlier.ok) throw new Error(earlier.code)
        expect(earlier.page.today).toBe(false)
        expect(earlier.page.rows).toHaveLength(1)
        const future = await readLog(world.app, { ...input(user(managerUser)), day: '2999-01-01' })
        if (!future.ok) throw new Error(future.code)
        expect(future.page.day).toBe(day)
      })
    })

    describe('the end of the night', () => {
      it('is refused to a role without night.view or night.view_full', async () => {
        expect(await readNight(world.app, input(user(waiterUser)))).toEqual({
          ok: false,
          code: 'permission_denied',
        })
      })

      it('gives staff the first sections and no money; a manager the whole page', async () => {
        const staff = await readNight(world.app, input(user(nightUser)))
        if (!staff.ok) throw new Error(staff.code)
        expect(staff.night.full).toBe(false)
        expect(staff.night.money).toBeNull()
        const manager = await readNight(world.app, input(user(managerUser)))
        if (!manager.ok) throw new Error(manager.code)
        expect(manager.night.full).toBe(true)
        expect(manager.night.money).toEqual({
          payments: 0,
          capturedMinor: 0,
          tipMinor: 0,
          paymentsUnconfirmed: 0,
          unconfirmedMinor: 0,
        })
      })

      it('lists the Unconfirmed order to fix and counts the live night', async () => {
        const read = await readNight(world.app, input(user(managerUser)))
        if (!read.ok) throw new Error(read.code)
        const { night } = read
        expect(night.today).toBe(true)
        expect(night.hasService).toBe(true)
        expect(night.fix.map((row) => row.reference)).toEqual(['K3C'])
        expect(night.fix[0]?.items).toEqual([{ name: 'Gin tonic', options: ['no mint'], qty: 2 }])
        expect(night.fix[0]?.landedAt).not.toBeNull()
        expect(night.sent.counts.all).toBe(5)
        expect(night.sent.notAdded.rows.map((row) => row.reference)).toEqual(['K3C', 'K2B'])
        expect(night.totals).toMatchObject({
          sentOrders: 5,
          sentOrdersAdded: 2,
          sentOrdersNotSent: 1,
          sentOrdersUnconfirmed: 1,
          addedMinor: 1000,
        })
        expect(night.days).toContain(yesterday)
      })

      it('reads a closed day from its written totals and lists its answered problems', async () => {
        await world.owner.query(
          `insert into restro.service_days (tenant_id, venue_id, service_date, totals, source, actor, job_id)
         values ($1, $2, $3, $4::jsonb, 'worker', 'system', 'test-seed')`,
          [
            world.tenantId,
            world.venueId,
            yesterday,
            JSON.stringify({ sittings: 7, sentOrders: 9, sentOrdersAdded: 6, addedMinor: 4200 }),
          ],
        )
        const read = await readNight(world.app, { ...input(user(managerUser)), day: yesterday })
        if (!read.ok) throw new Error(read.code)
        expect(read.night.today).toBe(false)
        // The written totals win over a recount (the rows of the day were not the whole night).
        expect(read.night.totals).toMatchObject({ sittings: 7, sentOrders: 9, addedMinor: 4200 })
        expect(read.night.totals.waiterCalls).toBe(0)
      })

      it('holds the message of a closed day: counts and the problems, nothing else', async () => {
        await world.owner.query(
          `insert into restro.service_days (tenant_id, venue_id, service_date, totals, source, actor, job_id)
         values ($1, $2, $3, $4::jsonb, 'worker', 'system', 'test-seed')
         on conflict do nothing`,
          [
            world.tenantId,
            world.venueId,
            day,
            JSON.stringify({
              sentOrders: 5,
              sentOrdersAdded: 2,
              sentOrdersNotSent: 1,
              sentOrdersUnconfirmed: 1,
              tipMinor: 999,
            }),
          ],
        )
        const report = await readNightReport(world.app, {
          tenantId: world.tenantId,
          venueId: world.venueId,
          day,
        })
        expect(report).toMatchObject({
          day,
          sentOrders: 5,
          added: 2,
          notSent: 1,
          unconfirmed: 1,
          fix: [{ reference: 'K3C', name: null, number: '3' }],
        })
        expect(JSON.stringify(report)).not.toContain('999')
        expect(
          await readNightReport(world.app, {
            tenantId: world.tenantId,
            venueId: world.venueId,
            day: '2001-01-01',
          }),
        ).toBeNull()
      })
    })

    describe('the export of a date range (#87)', () => {
      it('lists the days of the range that hold sent orders and Log lines, oldest first', async () => {
        const read = await readExportDays(world.app, {
          ...input(user(managerUser)),
          from: yesterday,
          to: day,
        })
        if (!read.ok) throw new Error(read.code)
        expect(read.sentDays).toEqual([yesterday, day])
        expect(read.logDays.every((d) => d >= yesterday && d <= day)).toBe(true)
        const narrow = await readExportDays(world.app, {
          ...input(user(managerUser)),
          from: day,
          to: day,
        })
        expect(narrow.ok && narrow.sentDays).toEqual([day])
      })

      it('needs both the Log and the whole end of the night', async () => {
        for (const who of [nightUser, waiterUser]) {
          expect(
            await readExportDays(world.app, { ...input(user(who)), from: yesterday, to: day }),
          ).toEqual({ ok: false, code: 'permission_denied' })
        }
      })

      it('refuses a range that is backwards, not a date or too long', async () => {
        const refused = (from: string, to: string) =>
          readExportDays(world.app, { ...input(user(managerUser)), from, to })
        expect(await refused(day, yesterday)).toEqual({ ok: false, code: 'invalid_range' })
        expect(await refused('soon', day)).toEqual({ ok: false, code: 'invalid_range' })
        const long = new Date(Date.parse(`${day}T00:00:00Z`) - MAX_EXPORT_DAYS * 86_400_000)
        expect(await refused(long.toISOString().slice(0, 10), day)).toEqual({
          ok: false,
          code: 'invalid_range',
        })
      })
    })
  },
)
