// RR-36, attacked (the repair-review's A7): a command names a row of a second venue of the same
// organisation, with the first venue in its context. RLS can't help here: both venues are the
// tenant's. Every staff, worker and guest command that names a row is tried; the second venue's rows
// must not move.
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionVenue } from '../apply/provision'
import { createArea, createTable } from '../apply/tables'
import { hasDatabase, testSlug } from '../apply/test-database'
import { newId } from '../ids'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import { guestAct, guestPayment, hashPaymentHandle } from './guest'
import { GUEST_LIMITS, type GuestLimit, GuestLimiter, type GuestLimitName } from './guest-limits'
import { PERMISSIONS } from './permissions'

const SEED = ['restro', 'system', 'attack-seed'] as const
const LOOSE = Object.fromEntries(
  Object.entries(GUEST_LIMITS).map(([name, limit]) => [name, { ...limit, max: 10_000 }]),
) as Record<GuestLimitName, GuestLimit>

type Row = {
  venue: string
  table: string
  sitting: string
  sentOrder: string
  payment: string
  refund: string
  alert: string
  waiterCall: string
  pause: string
  bar: string
  role: string
  staff: string
  device: string
  day: string
}

const STAFF: readonly [string, (row: Row) => Record<string, unknown>][] = [
  // RR-73: read by id alone, a role at venue 1 settled venue 2's Unconfirmed round.
  [
    'sent_order.answer',
    (r) => ({ type: 'sent_order.answer', sentOrderId: r.sentOrder, answer: 'not_found' }),
  ],
  [
    'payment.answer',
    (r) => ({
      type: 'payment.answer',
      paymentId: r.payment,
      answering: 'close',
      answer: 'on_till',
    }),
  ],
  ['payment.storno_done', (r) => ({ type: 'payment.storno_done', refundId: r.refund })],
  [
    'payment.refund_failed_seen',
    (r) => ({ type: 'payment.refund_failed_seen', refundId: r.refund }),
  ],
  ['alert.done', (r) => ({ type: 'alert.done', alertId: r.alert })],
  ['waiter_call.done', (r) => ({ type: 'waiter_call.done', waiterCallId: r.waiterCall })],
  ['receipt.brought', (r) => ({ type: 'receipt.brought', paymentId: r.payment })],
  ['receipt.unbrought', (r) => ({ type: 'receipt.unbrought', paymentId: r.payment })],
  ['table.open', (r) => ({ type: 'table.open', tableId: r.table })],
  ['table.close', (r) => ({ type: 'table.close', tableId: r.table })],
  ['table.new_guests', (r) => ({ type: 'table.new_guests', tableId: r.table })],
  [
    'table.mark_payment',
    (r) => ({ type: 'table.mark_payment', tableId: r.table, isPaymentTable: true }),
  ],
  ['table.resume', (r) => ({ type: 'table.resume', tableId: r.table })],
  ['table_code.reissue', (r) => ({ type: 'table_code.reissue', tableId: r.table })],
  ['ordering.pause a bar', (r) => ({ type: 'ordering.pause', barId: r.bar })],
  ['ordering.lift', (r) => ({ type: 'ordering.lift', pauseId: r.pause })],
  // The people of another venue: a role here must not reach them (staff.ts's other-venue check).
  ['role.update', (r) => ({ type: 'role.update', roleId: r.role, permissions: [...PERMISSIONS] })],
  ['role.archive', (r) => ({ type: 'role.archive', roleId: r.role })],
  [
    'staff.rename',
    (r) => ({ type: 'staff.rename', staffMemberId: r.staff, displayName: 'Hacked' }),
  ],
  ['staff.assign', (r) => ({ type: 'staff.assign', staffMemberId: r.staff, roleId: 'staff' })],
  ['staff.unassign', (r) => ({ type: 'staff.unassign', staffMemberId: r.staff })],
  ['staff.archive', (r) => ({ type: 'staff.archive', staffMemberId: r.staff })],
  [
    'staff.link_account',
    (r) => ({ type: 'staff.link_account', staffMemberId: r.staff, userId: 'attack-user' }),
  ],
  [
    'staff.link_telegram',
    (r) => ({ type: 'staff.link_telegram', staffMemberId: r.staff, telegramUserId: null }),
  ],
  ['pin.reset', (r) => ({ type: 'pin.reset', staffMemberId: r.staff })],
  ['pin.reveal', (r) => ({ type: 'pin.reveal', staffMemberIds: [r.staff] })],
  ['device.revoke', (r) => ({ type: 'device.revoke', deviceId: r.device })],
]

const WORKER: readonly [string, (row: Row) => Record<string, unknown>][] = [
  // RR-73: a job carries its order's own venue; another venue's id is simply not there.
  [
    'sent_order.transition',
    (r) => ({ type: 'sent_order.transition', sentOrderId: r.sentOrder, fence: 1, to: 'sending' }),
  ],
  [
    'payment.claim_table',
    (r) => ({ type: 'payment.claim_table', paymentId: r.payment, freeTables: [] }),
  ],
  ['payment.table_freed', (r) => ({ type: 'payment.table_freed', paymentId: r.payment })],
  ['payment.turn', (r) => ({ type: 'payment.turn', paymentId: r.payment, release: null })],
  [
    'payment.isolated',
    (r) => ({ type: 'payment.isolated', paymentId: r.payment, outcome: 'moved', code: null }),
  ],
  ['payment.stuck', (r) => ({ type: 'payment.stuck', paymentId: r.payment })],
  [
    'payment.erase_receipt_email',
    (r) => ({ type: 'payment.erase_receipt_email', paymentId: r.payment }),
  ],
  ['payment.hold_unknown', (r) => ({ type: 'payment.hold_unknown', paymentId: r.payment })],
  [
    'payment.settle',
    (r) => ({
      type: 'payment.settle',
      paymentId: r.payment,
      from: 'cancelling',
      reason: 'cancelled',
    }),
  ],
  [
    'payment.observe',
    (r) => ({
      type: 'payment.observe',
      paymentId: r.payment,
      providerKind: 'sim',
      providerPaymentRef: 'pi_attack',
      capturedMinor: 1,
      refunds: [],
      dispute: null,
    }),
  ],
  ['floor.table_vanished', (r) => ({ type: 'floor.table_vanished', tableId: r.table })],
  ['floor.table_returned', (r) => ({ type: 'floor.table_returned', tableId: r.table })],
  ['alert.suppressed', (r) => ({ type: 'alert.suppressed', alertIds: [r.alert] })],
]

const PICTURED = [
  'sent_orders',
  'payments',
  'payment_refunds',
  'alerts',
  'waiter_calls',
  'pauses',
  'sittings',
  'venue_roles',
  'staff_assignments',
  'shared_devices',
] as const

describe.skipIf(!hasDatabase)('a command naming another venue of the organisation (RR-36)', () => {
  let world: ServiceWorld
  let v2: Row
  let staffUser: string
  let v2Handle: string
  const answers: Record<string, unknown> = {}

  async function seedRows(venue: string, table: string, day: string, hash: string): Promise<Row> {
    const { owner, tenantId } = world
    const sitting = newId('st')
    await owner.query(
      `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
       values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
      [sitting, tenantId, venue, table, day, ...SEED],
    )
    const sentOrder = newId('so')
    await owner.query(
      `insert into restro.sent_orders
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, reference, state, lines,
          total_minor, action_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'REFX', 'unconfirmed', '[{"n":1}]'::jsonb, 500, $7, 'guest', 'guest', 'attack-seed')`,
      [sentOrder, tenantId, venue, table, sitting, day, randomUUID()],
    )
    const payment = newId('py')
    await owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'entered', $7, 'EUR', 'sim', 'guest', 'guest', 'attack-seed')`,
      [payment, tenantId, venue, table, sitting, day, hash],
    )
    const refund = newId('rf')
    await owner.query(
      `insert into restro.payment_refunds
         (id, tenant_id, venue_id, payment_id, amount_minor, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, 100, $5, $6, $7, $8)`,
      [refund, tenantId, venue, payment, day, ...SEED],
    )
    const alert = newId('al')
    await owner.query(
      `insert into restro.alerts (id, tenant_id, venue_id, service_date, kind, subject_id, source, actor, job_id)
       values ($1, $2, $3, $4, 'till_down', $5, $6, $7, $8)`,
      [alert, tenantId, venue, day, table, ...SEED],
    )
    const waiterCall = newId('wc')
    await owner.query(
      `insert into restro.waiter_calls (id, tenant_id, venue_id, table_id, sitting_id, service_date, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'guest', 'guest', 'attack-seed')`,
      [waiterCall, tenantId, venue, table, sitting, day],
    )
    const pause = newId('pa')
    await owner.query(
      `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause, restro_started, source, actor, job_id)
       values ($1, $2, $3, $4, 'table', $5, 'staff', true, $6, $7, $8)`,
      [pause, tenantId, venue, day, table, ...SEED],
    )
    const bar = newId('br')
    await owner.query(
      `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, 'Bar', $4)`,
      [bar, tenantId, venue, bar],
    )
    const role = newId('rl')
    await owner.query(
      `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
       values ($1, $2, $3, 'Barman', '["alerts.answer"]'::jsonb, $4, $5, $6)`,
      [role, tenantId, venue, ...SEED],
    )
    const staff = newId('sm')
    await owner.query(
      `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
       values ($1, $2, 'Other venue person', null, $3, $4, $5)`,
      [staff, tenantId, ...SEED],
    )
    await owner.query(
      `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, staff, venue, role, ...SEED],
    )
    const device = newId('dv')
    await owner.query(
      `insert into restro.shared_devices (id, tenant_id, venue_id, name, session_id, source, actor, job_id)
       values ($1, $2, $3, 'Bar tablet', $4, $5, $6, $7)`,
      [device, tenantId, venue, `sess-${device}`, ...SEED],
    )
    return {
      venue,
      table,
      sitting,
      sentOrder,
      payment,
      refund,
      alert,
      waiterCall,
      pause,
      bar,
      role,
      staff,
      device,
      day,
    }
  }

  /** The second venue's rows as they stand. */
  async function picture(venue: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    const person = await world.owner.query<{ row: unknown }>(
      `select to_jsonb(t) as row from restro.staff_members t where t.id = $1`,
      [v2?.staff ?? ''],
    )
    out.staff_members = JSON.stringify(person.rows.map((entry) => entry.row))
    for (const name of PICTURED) {
      const found = await world.owner.query<{ row: unknown }>(
        `select to_jsonb(t) as row from restro.${name} t where tenant_id = $1 and venue_id = $2 order by 1`,
        [world.tenantId, venue],
      )
      out[name] = JSON.stringify(found.rows.map((entry) => entry.row))
    }
    return out
  }

  beforeAll(async () => {
    world = await openServiceWorld('cross-venue')
    const venue = await provisionVenue(world.app, world.tenantId, {
      name: 'Second club',
      slug: testSlug('cross-venue-2'),
    })
    const area = await createArea(world.app, world.tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error('no area')
    const table = await createTable(world.app, world.tenantId, {
      areaId: area.area.id,
      name: null,
      number: '9',
    })
    if (!table.ok) throw new Error('no table')
    v2Handle = randomBytes(16).toString('base64url')
    v2 = await seedRows(
      venue.id,
      table.table.id,
      new Date().toISOString().slice(0, 10),
      hashPaymentHandle(v2Handle),
    )
    staffUser = await world.addUser('member')
    await world.addStaff([...PERMISSIONS], staffUser)
  }, 120_000)

  afterAll(async () => {
    if (process.env.ATTACK_DUMP) {
      writeFileSync(process.env.ATTACK_DUMP, JSON.stringify(answers, null, 1))
    }
    await world?.close()
  }, 60_000)

  const staffContext = () => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff' as const,
    actor: { kind: 'user' as const, userId: staffUser, sessionId: `s-${staffUser}` },
    jobId: `web-${randomUUID()}`,
    signedInAt: new Date(),
  })
  const workerContext = () => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker' as const,
    actor: { kind: 'system' as const },
    jobId: `payment-${randomUUID()}`,
  })

  describe('a person with every permission at venue 1, venue 1 in the context', () => {
    for (const [name, command] of STAFF) {
      it(`${name}: venue 2 did not move`, async () => {
        const before = await picture(v2.venue)
        const { result } = await applyService(world.app, command(v2) as never, staffContext())
        answers[`staff ${name}`] = result
        expect(await picture(v2.venue)).toEqual(before)
        expect(result, 'the venue check, not the row state, must be the refusal').toMatchObject({
          status: 'refused',
          code: expect.stringMatching(/_missing$|^permission_denied$/),
        })
      }, 30_000)
    }
  })

  describe('a worker job of venue 1', () => {
    for (const [name, command] of WORKER) {
      it(`${name}: venue 2 did not move`, async () => {
        const before = await picture(v2.venue)
        const { result } = await applyService(world.app, command(v2) as never, workerContext())
        answers[`worker ${name}`] = result
        expect(await picture(v2.venue)).toEqual(before)
        if (name !== 'alert.suppressed') {
          expect(result, 'the venue check, not the row state, must be the refusal').toMatchObject({
            status: 'refused',
            code: expect.stringMatching(/_missing$/),
          })
        }
      }, 30_000)
    }
  })

  describe("a phone at venue 1's table, holding venue 2's payment handle", () => {
    const code = `code${randomUUID().replaceAll('-', '')}`
    const limiter = new GuestLimiter(LOOSE)
    beforeAll(async () => {
      await world.owner.query(
        'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
        [world.tables[0], code, await hashTableCode(code)],
      )
    }, 30_000)

    for (const type of ['pay.returned', 'pay.cancel'] as const) {
      it(`${type}: venue 2's payment did not move`, async () => {
        const before = await picture(v2.venue)
        const answer = await guestAct(world.app, {
          code,
          command: { actionId: randomUUID(), type } as never,
          ageMs: 50,
          view: 'bill',
          phone: randomUUID(),
          limiter,
          handle: v2Handle,
          queuePayment: async () => {
            throw new Error('a job was queued for another venue')
          },
        } as never)
        answers[`guest ${type}`] = answer.ok ? answer.result : answer
        expect(await picture(v2.venue)).toEqual(before)
        if (answer.ok) expect(answer.result.subjectId ?? null).not.toBe(v2.payment)
      }, 30_000)
    }

    it("the payment read answers nothing for venue 2's handle", async () => {
      const read = await guestPayment(world.app, { code, handle: v2Handle, limiter })
      answers['guest read'] = read
      expect(JSON.stringify(read)).not.toContain(v2.payment)
      expect(read).toEqual({ ok: false, code: 'unknown_payment' })
    }, 30_000)
  })
})
