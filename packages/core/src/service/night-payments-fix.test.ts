// What the end of the night lists to fix, and to whom (#115) on a real Postgres, as the restro_app
// role: a hold that ran out is a problem only when someone was told; a row leaves once a person has
// dealt with its alert, and stays when the day's close cleared it (#162); a waiter-level reader is
// not shown a card not charged or a hold that ran out; the closing message counts neither; an
// answered payment is no longer unconfirmed in the totals; and each alert of a question asked twice
// is matched to the answer that followed it. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor } from './context'
import { readNightPayments, readNightPaymentsReport } from './night-payments'
import { readNight } from './night-read'

describe.skipIf(!hasDatabase)(
  'what the end of the night lists to fix (as the restro_app role)',
  () => {
    let world: ServiceWorld
    let staffUser: string
    let managerUser: string
    let day: string
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

    async function addPayment(
      name: string,
      fields: {
        tableIndex: number
        state: string
        reason?: string | null
        capturedMinor?: number | null
        receiptNumber?: string | null
        serviceDate?: string
      },
    ) {
      const tableId = world.tables[fields.tableIndex] as string
      let sittingId = sittings.get(tableId)
      if (sittingId === undefined) {
        sittingId = await world.openSitting(tableId, day)
        sittings.set(tableId, sittingId)
      }
      const id = newId('py')
      ids[name] = id
      await world.owner.query(
        `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, tip_minor, captured_minor, receipt_number, currency,
          provider_kind, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', $7, $8, $9, 3800, 200, $10, $11, 'EUR', 'sim',
               now(), $12, $13, $14)`,
        [
          id,
          world.tenantId,
          world.venueId,
          tableId,
          sittingId,
          fields.serviceDate ?? day,
          fields.state,
          fields.reason ?? null,
          createHash('sha256').update(randomUUID()).digest('hex'),
          fields.capturedMinor ?? null,
          fields.receiptNumber ?? null,
          ...seed,
        ],
      )
      return id
    }

    async function addAlert(
      kind: string,
      paymentId: string,
      fields: { raisedAt?: string; doneAt?: string; cleared?: boolean } = {},
    ) {
      const id = newId('al')
      await world.owner.query(
        `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          raised_at, done_at, done_by, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'venue', $6, 'money.follow_up', $7::jsonb,
               coalesce($8::timestamptz, now()), $9::timestamptz,
               case when $9::timestamptz is null then null else 'system' end, $10, $11, $12)`,
        [
          id,
          world.tenantId,
          world.venueId,
          day,
          kind,
          paymentId,
          JSON.stringify({
            paymentId,
            amountMinor: 3800,
            ...(fields.cleared ? { clearedAt: 'day_close' } : {}),
          }),
          fields.raisedAt ?? null,
          fields.doneAt ?? null,
          ...seed,
        ],
      )
      return id
    }

    async function addAnswer(paymentId: string, answer: string, at: string) {
      await world.owner.query(
        `insert into restro.log_entries
         (tenant_id, venue_id, service_date, kind, payment_id, to_state, reason, details, retention,
          at, source, actor, job_id)
       values ($1, $2, $3, 'payment.answered', $4, $5, $5, '{"answering":"close"}'::jsonb, 'record',
               $6::timestamptz, 'staff', 'system', 'test-seed')`,
        [world.tenantId, world.venueId, day, paymentId, answer, at],
      )
    }

    beforeAll(async () => {
      world = await openServiceWorld('night-payments-fix')
      staffUser = await world.addUser('member')
      await world.addStaff(['night.view', 'alerts.answer'], staffUser)
      managerUser = await world.addUser('member')
      await world.addStaff(['night.view_full', 'log.view', 'money.follow_up'], managerUser)
      const first = await readNight(world.app, input(user(staffUser)))
      if (!first.ok) throw new Error(`refused: ${first.code}`)
      day = first.night.day

      // An abandoned checkout ends released/expired with nobody told.
      await addPayment('abandoned', { tableIndex: 0, state: 'released', reason: 'expired' })
      const told = await addPayment('told', { tableIndex: 0, state: 'released', reason: 'expired' })
      await addAlert('payment_hold_expired', told)
      const failedDone = await addPayment('failedDone', { tableIndex: 1, state: 'capture_failed' })
      await addAlert('payment_capture_failed', failedDone, { doneAt: '2020-01-01T21:00:00Z' })
      const failedCleared = await addPayment('failedCleared', {
        tableIndex: 1,
        state: 'capture_failed',
      })
      await addAlert('payment_capture_failed', failedCleared, {
        doneAt: '2020-01-01T21:00:00Z',
        cleared: true,
      })
      const strandedDone = await addPayment('strandedDone', { tableIndex: 2, state: 'stranded' })
      await addAlert('payment_stranded', strandedDone, { doneAt: '2020-01-01T21:00:00Z' })
      const strandedOpen = await addPayment('strandedOpen', { tableIndex: 2, state: 'stranded' })
      await addAlert('payment_stranded', strandedOpen)
      // Answered, it waits for the worker: not unconfirmed any more for a person.
      await addPayment('answered', {
        tableIndex: 3,
        state: 'unconfirmed',
        reason: 'receipt_printed',
      })
      // Asked twice (a pay-first round): each alert gets the answer that followed it.
      const twice = await addPayment('twice', {
        tableIndex: 3,
        state: 'captured',
        capturedMinor: 3800,
        receiptNumber: 'R-1',
      })
      await addAlert('payment_unconfirmed', twice, {
        raisedAt: '2020-01-01T20:00:00Z',
        doneAt: '2020-01-01T20:02:00Z',
      })
      await addAnswer(twice, 'no_receipt', '2020-01-01T20:01:00Z')
      await addAlert('payment_unconfirmed', twice, {
        raisedAt: '2020-01-01T20:10:00Z',
        doneAt: '2020-01-01T20:12:00Z',
      })
      await addAnswer(twice, 'receipt_printed', '2020-01-01T20:11:00Z')
    })

    afterAll(async () => {
      await world?.close()
    })

    it('lists a hold that ran out only when someone was told, and drops what a person dealt with', async () => {
      const read = await readNightPayments(world.app, input(user(managerUser)))
      if (!read.ok) throw new Error(read.code)
      expect(read.payments.fix.map((fix) => fix.payment.id).sort()).toEqual(
        [ids.told, ids.failedCleared, ids.strandedOpen].sort(),
      )
      const byId = new Map(read.payments.fix.map((fix) => [fix.payment.id, fix]))
      expect(byId.get(ids.told as string)?.alert).not.toBeNull()
      // The day's close cleared this one: it stays listed, with no alert left to press.
      expect(byId.get(ids.failedCleared as string)?.alert).toBeNull()
    })

    it('shows a waiter-level reader neither a card not charged nor a hold that ran out', async () => {
      const read = await readNightPayments(world.app, input(user(staffUser)))
      if (!read.ok) throw new Error(read.code)
      expect(read.payments.fix.map((fix) => fix.problem)).toEqual(['stranded'])
    })

    it('counts neither of the two in the closing message, and not an answered payment as unconfirmed', async () => {
      const report = await readNightPaymentsReport(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        day,
      })
      expect(report.fix.map((entry) => entry.what)).toEqual(['stranded'])
      expect(report.taken).toBe(1)
      const night = await readNight(world.app, input(user(managerUser)))
      if (!night.ok) throw new Error(night.code)
      expect(night.night.money).toMatchObject({ paymentsUnconfirmed: 0, unconfirmedMinor: 0 })
    })

    it('gives each alert of a question asked twice the answer that followed it', async () => {
      const read = await readNightPayments(world.app, input(user(managerUser)))
      if (!read.ok) throw new Error(read.code)
      const asked = read.payments.money?.alerts.filter((alert) => alert.paymentId === ids.twice)
      expect(asked?.map((alert) => alert.answer?.code)).toEqual(['no_receipt', 'receipt_printed'])
    })

    it("lists an earlier night's open question on today's page with its day, until it is answered", async () => {
      const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10)
      const asked = await addPayment('earlierAsked', {
        tableIndex: 3,
        state: 'unconfirmed',
        reason: 'close_unknown',
        serviceDate: yesterday,
      })
      // A charge with no receipt number from that night is a line without an answer: not carried over.
      const noReceipt = await addPayment('earlierNoReceipt', {
        tableIndex: 3,
        state: 'captured',
        capturedMinor: 3800,
        serviceDate: yesterday,
      })
      await addAlert('payment_unconfirmed', asked)
      // Cleared by the day's close: nobody is asked any more, so it does not come back every night.
      const clearedFailed = await addPayment('earlierFailedCleared', {
        tableIndex: 3,
        state: 'capture_failed',
        serviceDate: yesterday,
      })
      await addAlert('payment_capture_failed', clearedFailed, {
        doneAt: '2020-01-01T21:00:00Z',
        cleared: true,
      })
      const openFailed = await addPayment('earlierFailedOpen', {
        tableIndex: 3,
        state: 'capture_failed',
        serviceDate: yesterday,
      })
      await addAlert('payment_capture_failed', openFailed)
      const today = await readNightPayments(world.app, input(user(managerUser)))
      if (!today.ok) throw new Error(today.code)
      const earlier = today.payments.fix.find((fix) => fix.payment.id === asked)
      expect(earlier).toMatchObject({ problem: 'unconfirmed', earlier: yesterday })
      expect(today.payments.fix.some((fix) => fix.payment.id === noReceipt)).toBe(false)
      expect(today.payments.fix.some((fix) => fix.payment.id === clearedFailed)).toBe(false)
      expect(today.payments.fix.find((fix) => fix.payment.id === openFailed)?.earlier).toBe(
        yesterday,
      )
      // A card not charged is not shown to a waiter-level reader, tonight's or an earlier night's.
      const staffToday = await readNightPayments(world.app, input(user(staffUser)))
      if (!staffToday.ok) throw new Error(staffToday.code)
      expect(staffToday.payments.fix.some((fix) => fix.payment.id === openFailed)).toBe(false)
      expect(staffToday.payments.fix.some((fix) => fix.payment.id === asked)).toBe(true)
      // Today's own rows carry no night's mark, and the counts are today's alone.
      expect(
        today.payments.fix
          .filter((fix) => fix.payment.id !== asked && fix.payment.id !== openFailed)
          .every((fix) => fix.earlier === null),
      ).toBe(true)

      // Yesterday's own page lists its own day, as before.
      const past = await readNightPayments(world.app, {
        ...input(user(managerUser)),
        day: yesterday,
      })
      if (!past.ok) throw new Error(past.code)
      expect(past.payments.fix.map((fix) => fix.payment.id).sort()).toEqual(
        [asked, noReceipt, clearedFailed, openFailed].sort(),
      )
      expect(past.payments.fix.every((fix) => fix.earlier === null)).toBe(true)

      // The closing message counts today's night only.
      const report = await readNightPaymentsReport(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        day,
      })
      expect(report.fix.map((entry) => entry.what)).toEqual(['stranded'])

      // Answered, it waits for the worker and leaves the list.
      await world.owner.query(
        `update restro.payments set reason = 'receipt_printed' where id = $1`,
        [asked],
      )
      const after = await readNightPayments(world.app, input(user(managerUser)))
      if (!after.ok) throw new Error(after.code)
      expect(after.payments.fix.some((fix) => fix.payment.id === asked)).toBe(false)
    })
  },
)
