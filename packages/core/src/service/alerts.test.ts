// The lifecycle of alerts (#83; D120, D122 §7) on a real Postgres, as the restro_app role: Done in
// Tonight and from Telegram, what the worker records it sent, the pauses kept as alerts, and the
// staff devices for Web Push. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { readDelivery } from './alert-delivery'
import { endpointHashOf } from './alerts'
import { applyService, type ServiceContext } from './index'

describe.skipIf(!hasDatabase)('alerts (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let answererId: string
  let plainId: string
  let operatorId: string

  beforeAll(async () => {
    world = await openServiceWorld('alerts')
    ownerId = await world.addUser('owner')
    answererId = await world.addUser('member')
    await world.addStaff(['alerts.answer'], answererId)
    plainId = await world.addUser('member')
    await world.addStaff(['tables.open_close'], plainId)
    operatorId = await world.addUser()
    await world.addOperator(operatorId)
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string, via?: 'tonight' | 'telegram'): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: via === 'telegram' ? 'telegram:-100' : 'session-1' },
    jobId: `alerts-${randomUUID()}`,
    ...(via === undefined ? {} : { via }),
  })
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `alerts-worker-${randomUUID()}`,
  })

  async function seed(
    kind: string,
    options: { audience?: 'venue' | 'restro'; permission?: string | null; subject?: string } = {},
  ): Promise<string> {
    const id = newId('al')
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, current_date, $4, $5, $6, $7, '{"reference":"K7Q"}'::jsonb,
               'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        kind,
        options.audience ?? 'venue',
        options.subject ?? newId('so'),
        options.permission === undefined ? 'alerts.answer' : options.permission,
      ],
    )
    return id
  }
  const alertRow = async (id: string) =>
    (
      await world.owner.query<{
        done_at: Date | null
        done_by: string | null
        via: string | null
        details: Record<string, unknown>
        telegram_message_ref: string | null
      }>(
        'select done_at, done_by, via, details, telegram_message_ref from restro.alerts where id = $1',
        [id],
      )
    ).rows[0]
  const done = (alertId: string, context: ServiceContext) =>
    applyService(world.app, { type: 'alert.done', alertId }, context)

  describe('Done', () => {
    it('marks an Unconfirmed order’s alert done and writes the Log entry', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await done(id, user(answererId, 'tonight'))
      expect(result).toMatchObject({ status: 'accepted', details: { changed: true } })
      const row = await alertRow(id)
      expect(row?.done_at).not.toBeNull()
      expect(row?.done_by).toBe(`user:${answererId}`)
      expect(row?.via).toBe('tonight')
      const log = await world.owner.query<{ via: string; reason: string }>(
        `select via, reason from restro.log_entries where kind = 'alert.done' and details ->> 'alertId' = $1`,
        [id],
      )
      expect(log.rows).toEqual([{ via: 'tonight', reason: 'order_unconfirmed' }])
    })

    it('records "via Telegram" when the venue group’s button was pressed', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await done(id, user(answererId, 'telegram'))
      expect(result.status).toBe('accepted')
      expect((await alertRow(id))?.via).toBe('telegram')
      const log = await world.owner.query<{ via: string }>(
        `select via from restro.log_entries where kind = 'alert.done' and details ->> 'alertId' = $1`,
        [id],
      )
      expect(log.rows).toEqual([{ via: 'telegram' }])
    })

    it('changes nothing the second time', async () => {
      const id = await seed('order_unconfirmed')
      await done(id, user(answererId))
      const first = await alertRow(id)
      const { result } = await done(id, user(answererId, 'telegram'))
      expect(result).toMatchObject({ status: 'accepted', details: { changed: false } })
      expect(await alertRow(id)).toEqual(first)
    })

    it('refuses an account whose role may not answer alerts', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await done(id, user(plainId))
      expect(result).toMatchObject({ status: 'refused', code: 'permission_denied' })
      expect((await alertRow(id))?.done_at).toBeNull()
    })

    it('lets an organisation owner answer, who holds every permission', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await done(id, user(ownerId))
      expect(result.status).toBe('accepted')
    })

    it('refuses an alert whose own permission the person lacks', async () => {
      const id = await seed('order_unconfirmed', { permission: 'money.follow_up' })
      const { result } = await done(id, user(answererId))
      expect(result).toMatchObject({ status: 'refused', code: 'permission_denied' })
    })

    it('keeps the Restro team’s alerts for an operator', async () => {
      const id = await seed('order_pace', { audience: 'restro', permission: null })
      const refused = await done(id, user(answererId))
      expect(refused.result).toMatchObject({ status: 'refused', code: 'alert_missing' })
      const { result } = await applyService(
        world.app,
        { type: 'alert.done', alertId: id },
        {
          ...user(operatorId),
          actor: { kind: 'operator', userId: operatorId },
        },
      )
      // An operator holds `ordering.lift` and `settings.roles` only: Done needs `alerts.answer`.
      expect(result).toMatchObject({ status: 'refused', code: 'permission_denied' })
    })

    it('has no Done for a pause, which closes when it lifts', async () => {
      const id = await seed('ordering_paused', { permission: null })
      const { result } = await done(id, user(ownerId))
      expect(result).toMatchObject({ status: 'refused', code: 'alert_closes_itself' })
    })

    it("has no Done for a card payment's question, which only its answer closes (#112)", async () => {
      for (const kind of ['payment_unconfirmed', 'payment_lines_not_back']) {
        const id = await seed(kind, { permission: 'money.follow_up' })
        const { result } = await done(id, user(ownerId))
        expect(result).toMatchObject({ status: 'refused', code: 'alert_needs_answer' })
      }
    })

    it('does not know an alert of another venue or one that is not there', async () => {
      const { result } = await done(newId('al'), user(ownerId))
      expect(result).toMatchObject({ status: 'refused', code: 'alert_missing' })
    })

    it('is refused from a guest or the worker', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await applyService(
        world.app,
        { type: 'alert.done', alertId: id },
        worker(),
      )
      expect(result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    })
  })

  describe('what the worker records', () => {
    it('keeps what each receiver was told, and the Telegram message to edit', async () => {
      const id = await seed('order_unconfirmed')
      const sent = await applyService(
        world.app,
        {
          type: 'alert.delivered',
          alertIds: [id],
          receiver: 'venueTelegram',
          step: 'new',
          telegramRef: '-100123:42',
        },
        worker(),
      )
      expect(sent.result).toMatchObject({ status: 'accepted', details: { recorded: 1 } })
      await applyService(
        world.app,
        { type: 'alert.delivered', alertIds: [id], receiver: 'push', step: 'new' },
        worker(),
      )
      const row = await alertRow(id)
      expect(row?.telegram_message_ref).toBe('-100123:42')
      const delivery = readDelivery(row?.details ?? {})
      expect(delivery.venueTelegram?.count).toBe(1)
      expect(delivery.push?.count).toBe(1)
      expect(row?.details.reference).toBe('K7Q')
    })

    it('marks alerts raised while the venue was closed as never to be sent', async () => {
      const id = await seed('order_unconfirmed')
      await applyService(world.app, { type: 'alert.suppressed', alertIds: [id] }, worker())
      expect(readDelivery((await alertRow(id))?.details ?? {}).suppressed).toBe(true)
    })

    it('is the worker’s alone', async () => {
      const id = await seed('order_unconfirmed')
      const { result } = await applyService(
        world.app,
        { type: 'alert.suppressed', alertIds: [id] },
        user(ownerId),
      )
      expect(result).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    })
  })

  describe('a pause kept as an alert', () => {
    const pausedAlerts = async () =>
      (
        await world.owner.query<{ id: string; done_at: Date | null; subject_id: string }>(
          `select id, done_at, subject_id from restro.alerts where venue_id = $1 and kind = 'ordering_paused' order by raised_at`,
          [world.venueId],
        )
      ).rows
    // The Done test above seeded a pause alert of its own; this block starts from none.
    beforeAll(async () => {
      await world.owner.query(
        `delete from restro.alerts where venue_id = $1 and kind = 'ordering_paused'`,
        [world.venueId],
      )
    })
    const sync = () => applyService(world.app, { type: 'alerts.sync_pauses' }, worker())
    const pause = async () => {
      const { result } = await applyService(
        world.app,
        { type: 'ordering.pause', barId: null },
        user(ownerId),
      )
      if (result.status !== 'accepted') throw new Error(`pause refused: ${result.code}`)
      return String(result.details.pauseId)
    }
    const lift = (pauseId: string) =>
      applyService(world.app, { type: 'ordering.lift', pauseId }, user(ownerId))

    it('raises one alert per pause, closes it when the pause lifts, and reopens it when the pause returns', async () => {
      expect((await sync()).result).toMatchObject({
        details: { raised: 0, reopened: 0, closed: 0 },
      })

      const first = await pause()
      expect((await sync()).result).toMatchObject({ details: { raised: 1 } })
      expect((await sync()).result).toMatchObject({ details: { raised: 0, closed: 0 } })
      const [open] = await pausedAlerts()
      expect(open).toMatchObject({ done_at: null, subject_id: world.venueId })

      await lift(first)
      expect((await sync()).result).toMatchObject({ details: { closed: 1 } })
      expect((await pausedAlerts())[0]?.done_at).not.toBeNull()

      // Back within 10 minutes and before anyone heard "back": the same pause.
      await pause()
      expect((await sync()).result).toMatchObject({ details: { raised: 0, reopened: 1 } })
      const after = await pausedAlerts()
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ id: open?.id, done_at: null })
    })

    it('starts a new alert once "back" was told', async () => {
      const [existing] = await pausedAlerts()
      const id = existing?.id as string
      const current = await world.owner.query<{ id: string }>(
        `select id from restro.pauses where venue_id = $1 and lifted_at is null`,
        [world.venueId],
      )
      await lift(String(current.rows[0]?.id))
      await sync()
      await applyService(
        world.app,
        { type: 'alert.delivered', alertIds: [id], receiver: 'team', step: 'back' },
        worker(),
      )
      await pause()
      expect((await sync()).result).toMatchObject({ details: { raised: 1, reopened: 0 } })
      expect(await pausedAlerts()).toHaveLength(2)
    })
  })

  describe('devices for Web Push', () => {
    const subscription = (n: number) => ({
      endpoint: `https://push.example.test/send/${n}-${'x'.repeat(30)}`,
      p256dh: 'B'.repeat(87),
      auth: 'a'.repeat(22),
    })
    const stored = async (endpoint: string) =>
      (
        await world.owner.query<{ user_id: string; revoked_at: Date | null }>(
          'select user_id, revoked_at from restro.push_subscriptions where endpoint_hash = $1',
          [endpointHashOf(endpoint)],
        )
      ).rows[0]

    it('stores a signed-in account’s device, and moves it to the next account that signs in', async () => {
      const device = subscription(1)
      const first = await applyService(
        world.app,
        { type: 'push.subscribe', ...device },
        user(answererId),
      )
      expect(first.result.status).toBe('accepted')
      expect((await stored(device.endpoint))?.user_id).toBe(answererId)
      await applyService(world.app, { type: 'push.subscribe', ...device }, user(ownerId))
      expect((await stored(device.endpoint))?.user_id).toBe(ownerId)
    })

    it('is for accounts that may answer alerts', async () => {
      const { result } = await applyService(
        world.app,
        { type: 'push.subscribe', ...subscription(4) },
        user(plainId),
      )
      expect(result).toMatchObject({ status: 'refused', code: 'permission_denied' })
    })

    it('refuses a PIN on a shared device, which has no account of its own', async () => {
      const device = subscription(2)
      const sessionId = `shared-${randomUUID()}`
      await world.addSharedDevice(sessionId)
      const staffMemberId = await world.addStaff(['alerts.answer'])
      const { result } = await applyService(
        world.app,
        { type: 'push.subscribe', ...subscription(2) },
        {
          ...user(ownerId),
          actor: { kind: 'staff', staffMemberId, sessionId },
        },
      )
      expect(result).toMatchObject({ status: 'refused', code: 'account_required' })
      expect(await stored(device.endpoint)).toBeUndefined()
    })

    it('ends a device for its own account, never for another, and for the worker', async () => {
      const device = subscription(3)
      await applyService(world.app, { type: 'push.subscribe', ...device }, user(answererId))
      const endpointHash = endpointHashOf(device.endpoint)

      await applyService(world.app, { type: 'push.revoke', endpointHash }, user(ownerId))
      expect((await stored(device.endpoint))?.revoked_at).toBeNull()

      await applyService(world.app, { type: 'push.revoke', endpointHash }, user(answererId))
      expect((await stored(device.endpoint))?.revoked_at).not.toBeNull()

      await applyService(world.app, { type: 'push.subscribe', ...device }, user(answererId))
      expect((await stored(device.endpoint))?.revoked_at).toBeNull()
      await applyService(world.app, { type: 'push.expire', endpointHash }, worker())
      expect((await stored(device.endpoint))?.revoked_at).not.toBeNull()
    })
  })
})
