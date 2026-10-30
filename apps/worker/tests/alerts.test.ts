// Alerts reach people (#83; D120, D122 §7) on Postgres, with Web Push and Telegram replaced by
// fakes: an Unconfirmed order goes once to the ticked devices, the venue group (with Done) and the
// Restro team; nothing goes while the venue is closed; a pause is announced, reminded to the owners
// and the team, and announced as over once it has stayed over; a Done in Tonight edits the group's
// message; a Done from the group works for a linked account whose role may press it and for no one
// else, and the Log says "via Telegram".
//
// The clock is the real one plus an offset, because the database stamps what it records with its
// own clock (the alerts' raised and done times, and when each message was sent). So the clock
// cannot be pinned to a fixed date. Instead the venue's time zone is set, once, to the whole-hour
// zone in which it is about noon when the file starts (`middayZone`): the hours (ALL_DAYS end at
// 07:00) are then hours away at whatever time of day the file runs, offsets of an hour included.
import { randomUUID } from 'node:crypto'

import { DEFAULT_ORDERING_SETTINGS, newId } from '@restro/core'
import { createArea, createTable, provisionTenant, provisionVenue } from '@restro/core/apply'
import { applyService, type ServiceContext } from '@restro/core/service'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { deliverAlerts } from '../src/alerts/deliver'
import type { DeviceSubscription, PushOutcome, PushPayload, PushSender } from '../src/alerts/push'
import type { MessageRef, TelegramClient } from '../src/alerts/telegram'
import { handlePress } from '../src/alerts/telegram-poller'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

/**
 * The fixed-offset zone (`Etc/GMT±n`, whole hours) in which it is between 11:30 and 12:30 at `at`.
 * The test's clock runs up to 70 minutes past the start, so the venue is open for the whole file
 * at any time of day; a real zone such as Europe/Sofia would be at 06:00–07:00 for an hour a day.
 */
function middayZone(at: Date): string {
  const utcHours = at.getUTCHours() + at.getUTCMinutes() / 60
  const shift = Math.round(12 - utcHours) // hours east of UTC that make it noon: -12 to 12
  if (shift === 0) return 'Etc/UTC'
  return `Etc/GMT${shift > 0 ? '-' : '+'}${Math.abs(shift)}` // the sign of Etc/GMT is inverted
}

const VENUE_CHAT = '-100500'
const TEAM_CHAT = '-100999'
const ALL_DAYS = { opens: '07:00', lastOrders: '06:00', closes: '06:59' }
const OPEN_ALL_WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, ALL_DAYS]),
)
const CLOSED_ALL_WEEK = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, null]),
)
const quiet = {
  warn: () => undefined,
  error: (...args: unknown[]) => console.error(...args),
  info: () => undefined,
}

describe.skipIf(!hasDatabase)('alerts reach people', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let venueId: string
  let tableId: string
  let ownerId: string
  let answererId: string
  let plainId: string
  let offsetMs = 0
  const now = () => new Date(Date.now() + offsetMs)

  const pushed: { device: DeviceSubscription; payload: PushPayload }[] = []
  const outcomes = new Map<string, PushOutcome>()
  const push: PushSender = {
    async send(device, payload) {
      pushed.push({ device, payload })
      return outcomes.get(device.endpoint) ?? 'sent'
    },
  }
  const sent: {
    chatId: string
    text: string
    doneFor: string | undefined
    doneLabel: string | undefined
  }[] = []
  const edits: { ref: MessageRef; text: string }[] = []
  const answers: string[] = []
  let nextMessage = 100
  const telegram: TelegramClient = {
    async sendMessage(chatId, text, options) {
      sent.push({
        chatId,
        text,
        doneFor: options?.doneFor,
        doneLabel: options?.doneLabel,
      })
      return { chatId, messageId: nextMessage++ }
    },
    async editMessage(ref, text) {
      edits.push({ ref, text })
    },
    async answerCallback(_id, text) {
      answers.push(text)
    },
    async getMe() {
      return { username: 'restro_bot' }
    },
    async getUpdates() {
      return []
    },
  }
  const retryAfter = new Map<string, number>()
  const pass = () =>
    deliverAlerts({ pool, log: quiet, now, push, telegram, teamChatId: TEAM_CHAT, retryAfter })

  const query = (sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows)
  const setOrdering = (patch: Record<string, unknown>) =>
    query(
      `update restro.venues set settings = settings || jsonb_build_object('ordering', $2::jsonb) where id = $1`,
      [
        venueId,
        JSON.stringify({
          ...DEFAULT_ORDERING_SETTINGS,
          serviceHours: OPEN_ALL_WEEK,
          alertRecipientUserIds: [ownerId, answererId],
          telegramChatId: VENUE_CHAT,
          ...patch,
        }),
      ],
    )
  const user = (userId: string, via?: 'telegram'): ServiceContext => ({
    tenantId,
    venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: 'session-1' },
    jobId: `alerts-${randomUUID()}`,
    ...(via === undefined ? {} : { via }),
  })
  async function addUser(role?: string): Promise<string> {
    const id = `alerts-${newId('us').slice(3)}`
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      id,
      role === 'owner' ? 'Olga Owner' : 'A person',
      `${id}@example.test`,
    ])
    if (role !== undefined) {
      await query(
        'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
        [`mb-${id}`, tenantId, id, role],
      )
    }
    return id
  }
  async function addStaff(
    name: string,
    permissions: string[],
    userId: string,
    telegramUserId: string | null,
  ): Promise<void> {
    const staffMemberId = newId('sm')
    const roleId = newId('rl')
    const seed = ['restro', 'system', 'test-seed']
    await query(
      `insert into restro.staff_members (id, tenant_id, display_name, user_id, telegram_user_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [staffMemberId, tenantId, name, userId, telegramUserId, ...seed],
    )
    await query(
      `insert into restro.venue_roles (id, tenant_id, venue_id, name, permissions, source, actor, job_id)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        roleId,
        tenantId,
        venueId,
        `Role ${roleId.slice(3, 9)}`,
        JSON.stringify(permissions),
        ...seed,
      ],
    )
    await query(
      `insert into restro.staff_assignments (tenant_id, staff_member_id, venue_id, role_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, staffMemberId, venueId, roleId, ...seed],
    )
  }
  async function seedAlert(
    kind: string,
    options: { secondsAgo?: number; audience?: string; permission?: string } = {},
  ): Promise<string> {
    const id = newId('al')
    await query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          raised_at, source, actor, job_id)
       values ($1, $2, $3, current_date, $4, $5, $6, $7, $8::jsonb,
               now() + ($9 || ' milliseconds')::interval - ($10 || ' seconds')::interval,
               'restro', 'system', 'test-seed')`,
      [
        id,
        tenantId,
        venueId,
        kind,
        options.audience ?? 'venue',
        tableId,
        options.audience === 'restro' ? null : (options.permission ?? 'alerts.answer'),
        JSON.stringify({
          reference: 'K7Q',
          tableId,
          items: [{ name: 'Gin tonic', options: [], qty: 2 }],
        }),
        String(offsetMs),
        String(options.secondsAgo ?? 60),
      ],
    )
    return id
  }
  const rowOf = async (id: string) =>
    (
      (await query(
        'select done_at, done_by, via, details, telegram_message_ref from restro.alerts where id = $1',
        [id],
      )) as {
        done_at: Date | null
        done_by: string | null
        via: string | null
        details: { delivery?: Record<string, unknown> }
        telegram_message_ref: string | null
      }[]
    )[0]
  /** Each ticked account has one installed device (again: a test may have ended one). */
  async function subscribeDevices(): Promise<void> {
    for (const [userId, n] of [
      [ownerId, 1],
      [answererId, 2],
    ] as const) {
      const { result } = await applyService(
        pool,
        {
          type: 'push.subscribe',
          endpoint: `https://push.example.test/device/${n}-${'x'.repeat(30)}`,
          p256dh: 'B'.repeat(87),
          auth: 'a'.repeat(22),
        },
        user(userId),
      )
      if (result.status !== 'accepted') throw new Error(`subscribe refused: ${result.code}`)
    }
  }
  /** The venue's default language: the texts follow it (bg_BG is Bulgarian, anything else English). */
  const setLocale = (locale: 'bg_BG' | 'en_US') =>
    query('update restro.venues set default_locale = $2 where id = $1', [venueId, locale])
  const wipe = async () => {
    await query('delete from restro.alerts where venue_id = $1', [venueId])
    await query('delete from restro.pauses where venue_id = $1', [venueId])
    pushed.length = 0
    sent.length = 0
    edits.length = 0
    answers.length = 0
    outcomes.clear()
    retryAfter.clear()
    nextMessage = 100
    offsetMs = 0
    if (ownerId !== undefined) {
      await subscribeDevices()
      await setLocale('en_US')
    }
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-alerts-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Alerts club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Alerts club', $2)`,
      [tenantId, `alerts-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Club Nova',
      slug: testSlug('alerts'),
    })
    venueId = venue.id
    const area = await createArea(pool, tenantId, venue.id, 'Hall')
    if (!area.ok) throw new Error(area.reason)
    const table = await createTable(pool, tenantId, {
      areaId: area.area.id,
      name: null,
      number: '7',
    })
    if (!table.ok) throw new Error(table.reason)
    tableId = table.table.id

    ownerId = await addUser('owner')
    answererId = await addUser('member')
    plainId = await addUser('member')
    await addStaff('Maria', ['alerts.answer'], answererId, '555')
    await addStaff('Pavel', ['tables.open_close'], plainId, '777')
    await setOrdering({})
    await query('update restro.venues set timezone = $2 where id = $1', [
      venueId,
      middayZone(new Date()),
    ])
    await subscribeDevices()
    await setLocale('en_US')
  }, 240_000)

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  beforeEach(wipe)

  describe('an Unconfirmed order', () => {
    it('goes once to the ticked devices, the venue group with Done, and the Restro team', async () => {
      const id = await seedAlert('order_unconfirmed')
      expect(await pass()).toBe(3)

      expect(pushed.map((p) => p.device.endpoint.split('/').at(-1)?.slice(0, 1)).sort()).toEqual([
        '1',
        '2',
      ])
      expect(pushed[0]?.payload).toMatchObject({
        title: 'Table 7: an order couldn’t be confirmed',
        body: '2 × Gin tonic, ref K7Q. Check the bill in the POS.',
      })
      expect(JSON.stringify(pushed[0]?.payload)).not.toMatch(/so_|nd_|barsy/)

      const group = sent.filter((m) => m.chatId === VENUE_CHAT)
      expect(group).toHaveLength(1)
      expect(group[0]).toMatchObject({ doneFor: id })
      const team = sent.filter((m) => m.chatId === TEAM_CHAT)
      expect(team).toHaveLength(1)
      expect(team[0]?.text).toContain('Club Nova')
      expect(team[0]?.doneFor).toBeUndefined()

      const row = await rowOf(id)
      expect(row?.telegram_message_ref).toBe(`${VENUE_CHAT}:100`)
      expect(Object.keys(row?.details.delivery ?? {}).sort()).toEqual([
        'push',
        'team',
        'venueTelegram',
      ])
      expect(await pass()).toBe(0)
    })

    it('waits the first 10 seconds so a burst goes as one push', async () => {
      await seedAlert('order_unconfirmed', { secondsAgo: 2 })
      await pass()
      expect(pushed).toHaveLength(0)
      expect(sent.filter((m) => m.chatId === VENUE_CHAT)).toHaveLength(0)
    })

    it('is still waiting at 8 seconds', async () => {
      await seedAlert('order_unconfirmed', { secondsAgo: 8 })
      await pass()
      expect(pushed).toHaveLength(0)
      expect(sent.filter((m) => m.chatId === VENUE_CHAT)).toHaveLength(0)
    })

    it('reminds once after 10 minutes if nobody acted', async () => {
      await seedAlert('order_unconfirmed')
      await pass()
      pushed.length = 0
      offsetMs = 11 * 60_000
      await pass()
      expect(pushed.length).toBe(2)
      expect(pushed[0]?.payload.title).toBe('Reminder: Table 7: an order couldn’t be confirmed')
      pushed.length = 0
      offsetMs = 25 * 60_000
      await pass()
      expect(pushed).toHaveLength(0)
    })

    it('says Done by whom in the group when it is answered in Tonight', async () => {
      const id = await seedAlert('order_unconfirmed')
      await pass()
      const done = await applyService(pool, { type: 'alert.done', alertId: id }, user(ownerId))
      expect(done.result.status).toBe('accepted')
      await pass()
      expect(edits).toHaveLength(1)
      expect(edits[0]?.ref).toEqual({ chatId: VENUE_CHAT, messageId: 100 })
      expect(edits[0]?.text).toMatch(/\n\nDone by Olga Owner, \d\d:\d\d$/)
      await pass()
      expect(edits).toHaveLength(1)
    })

    it('says it was cleared at the end of the night when the day closed on it (#162)', async () => {
      const id = await seedAlert('order_unconfirmed')
      await pass()
      await query(`update restro.alerts set service_date = '2026-01-05' where id = $1`, [id])
      const closed = await applyService(
        pool,
        { type: 'service_day.close', serviceDate: '2026-01-05' },
        {
          tenantId,
          venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `day-close-${randomUUID()}`,
        },
      )
      expect(closed.result.status).toBe('accepted')
      await pass()
      expect(edits).toHaveLength(1)
      expect(edits[0]?.text).toMatch(/\n\nCleared at the end of the night$/)
      await pass()
      expect(edits).toHaveLength(1)
    })

    it('is never sent when it was raised while the venue was closed', async () => {
      await setOrdering({ serviceHours: CLOSED_ALL_WEEK })
      const id = await seedAlert('order_unconfirmed')
      expect(await pass()).toBe(0)
      expect((await rowOf(id))?.details.delivery).toEqual({ suppressed: true })
      await setOrdering({})
      expect(await pass()).toBe(0)
    })

    it('ends a device the push service no longer knows', async () => {
      outcomes.set(`https://push.example.test/device/2-${'x'.repeat(30)}`, 'gone')
      await seedAlert('order_unconfirmed')
      await pass()
      const live = (await query(
        `select count(*)::int as n from restro.push_subscriptions where revoked_at is null and tenant_id = $1`,
        [tenantId],
      )) as { n: number }[]
      expect(live[0]?.n).toBe(1)
    })

    it('tries again later when every send failed, and does not record it', async () => {
      outcomes.set(`https://push.example.test/device/1-${'x'.repeat(30)}`, 'failed')
      outcomes.set(`https://push.example.test/device/2-${'x'.repeat(30)}`, 'failed')
      const id = await seedAlert('order_unconfirmed')
      await pass()
      expect((await rowOf(id))?.details.delivery).not.toHaveProperty('push')
      const attempts = pushed.length
      await pass()
      expect(pushed.length).toBe(attempts)
      outcomes.clear()
      offsetMs = 60_000
      await pass()
      expect((await rowOf(id))?.details.delivery).toHaveProperty('push')
    })
  })

  describe('a payment alert (raised with money.follow_up, #87)', () => {
    let managerId: string
    const endpointsPushed = () =>
      pushed.map((p) => p.device.endpoint.split('/').at(-1)?.slice(0, 1)).sort()

    async function subscribeManager(): Promise<void> {
      const { result } = await applyService(
        pool,
        {
          type: 'push.subscribe',
          endpoint: `https://push.example.test/device/3-${'x'.repeat(30)}`,
          p256dh: 'B'.repeat(87),
          auth: 'a'.repeat(22),
        },
        user(managerId),
      )
      if (result.status !== 'accepted') throw new Error(`subscribe refused: ${result.code}`)
    }

    beforeEach(async () => {
      if (managerId === undefined) {
        managerId = await addUser('member')
        await addStaff('Boris', ['money.follow_up', 'alerts.answer'], managerId, null)
      }
      await subscribeManager()
      await setOrdering({})
    })

    afterAll(() => setOrdering({}))

    it('rings only the switched-on people who hold the permission; an owner always does', async () => {
      await seedAlert('payment_unconfirmed', { permission: 'money.follow_up' })
      await pass()
      // The owner (ticked) rings; Maria (ticked, may only answer alerts) does not; Boris is not ticked.
      expect(endpointsPushed()).toEqual(['1'])
    })

    it('rings every holder who has a device when none of them is switched on', async () => {
      await setOrdering({ alertRecipientUserIds: [answererId] })
      await seedAlert('payment_unconfirmed', { permission: 'money.follow_up' })
      await pass()
      expect(endpointsPushed()).toEqual(['1', '3'])
    })

    it('rings only the holder who is switched on, not the owner who is not', async () => {
      await setOrdering({ alertRecipientUserIds: [answererId, managerId] })
      await seedAlert('payment_unconfirmed', { permission: 'money.follow_up' })
      await pass()
      expect(endpointsPushed()).toEqual(['3'])
    })

    it('leaves an alert with another permission to the switched-on people as before', async () => {
      await seedAlert('order_unconfirmed')
      await pass()
      expect(endpointsPushed()).toEqual(['1', '2'])
    })
  })

  describe('the Restro team’s own alerts', () => {
    it('go to the team’s chat only, grouped', async () => {
      await seedAlert('order_pace', { audience: 'restro' })
      await seedAlert('order_pace', { audience: 'restro' })
      await pass()
      expect(pushed).toHaveLength(0)
      expect(sent.map((m) => m.chatId)).toEqual([TEAM_CHAT])
      expect(sent[0]?.text.split('\n\n')).toHaveLength(2)
    })
  })

  describe('a pause', () => {
    const lift = async () => {
      const [row] = (await query(
        'select id from restro.pauses where venue_id = $1 and lifted_at is null',
        [venueId],
      )) as { id: string }[]
      return applyService(
        pool,
        { type: 'ordering.lift', pauseId: row?.id as string },
        user(ownerId),
      )
    }

    it('is announced once, reminded to owners and the team, and announced as over', async () => {
      await applyService(pool, { type: 'ordering.pause', barId: null }, user(ownerId))
      await pass()
      expect(pushed.map((p) => p.payload.title)).toEqual([
        'Ordering is paused at Club Nova',
        'Ordering is paused at Club Nova',
      ])
      const toGroup = sent.filter((m) => m.chatId === VENUE_CHAT)
      expect(toGroup).toHaveLength(1)
      expect(toGroup[0]?.doneFor).toBeUndefined()
      expect(sent.filter((m) => m.chatId === TEAM_CHAT)).toHaveLength(1)
      pushed.length = 0
      sent.length = 0

      // An hour on: the owners, and the Restro team, are reminded; the staff are not.
      offsetMs = 61 * 60_000
      await pass()
      expect(pushed).toHaveLength(1)
      expect(pushed[0]?.payload.title).toBe('Ordering is still paused at Club Nova')
      expect(sent.map((m) => m.chatId)).toEqual([TEAM_CHAT])

      // Lifted: told it is back only after it has stayed over for 10 minutes.
      pushed.length = 0
      sent.length = 0
      // (The database stamps the lift with its own clock, so the test's clock goes back to it.)
      offsetMs = 0
      await lift()
      await pass()
      expect([pushed.length, sent.length]).toEqual([0, 0])
      offsetMs = 11 * 60_000
      await pass()
      expect(pushed.map((p) => p.payload.title)).toEqual([
        'Ordering is back at Club Nova',
        'Ordering is back at Club Nova',
      ])
      expect(sent.map((m) => m.text)).toEqual([
        'Ordering is back at Club Nova',
        'Ordering is back at Club Nova',
      ])
      await pass()
      expect(sent).toHaveLength(2)
    })

    it('stays one pause when it comes back within 10 minutes', async () => {
      await applyService(pool, { type: 'ordering.pause', barId: null }, user(ownerId))
      await pass()
      sent.length = 0
      pushed.length = 0
      await lift()
      await pass()
      await applyService(pool, { type: 'ordering.pause', barId: null }, user(ownerId))
      offsetMs = 12 * 60_000
      await pass()
      expect([sent.length, pushed.length]).toEqual([0, 0])
      const rows = (await query(
        `select count(*)::int as n from restro.alerts where venue_id = $1 and kind = 'ordering_paused'`,
        [venueId],
      )) as { n: number }[]
      expect(rows[0]?.n).toBe(1)
    })
  })

  describe('in Bulgarian, for a venue whose default language is bg_BG', () => {
    beforeEach(() => setLocale('bg_BG'))

    it('words an Unconfirmed order for the push, the venue group and the Restro team', async () => {
      await seedAlert('order_unconfirmed')
      await pass()
      expect(pushed[0]?.payload).toMatchObject({
        title: 'Маса 7: изпратена поръчка без потвърждение',
        body: '2 × Gin tonic, номер K7Q. Проверете сметката в POS системата.',
      })
      expect(sent[0]?.doneLabel).toBe('Готово')
      expect(sent.map((m) => m.text.split('\n')[0])).toEqual([
        'Маса 7: изпратена поръчка без потвърждение',
        'Club Nova: Маса 7: изпратена поръчка без потвърждение',
      ])
    })

    it('words a pause, a reminder to the owners and "back"', async () => {
      await applyService(pool, { type: 'ordering.pause', barId: null }, user(ownerId))
      await pass()
      expect(pushed[0]?.payload.title).toBe('Поръчките в Club Nova са спрени')
      pushed.length = 0
      offsetMs = 61 * 60_000
      await pass()
      expect(pushed[0]?.payload.title).toBe('Поръчките в Club Nova все още са спрени')
      offsetMs = 0
      const [row] = (await query(
        'select id from restro.pauses where venue_id = $1 and lifted_at is null',
        [venueId],
      )) as { id: string }[]
      await applyService(pool, { type: 'ordering.lift', pauseId: row?.id as string }, user(ownerId))
      await pass()
      sent.length = 0
      offsetMs = 11 * 60_000
      await pass()
      expect(sent.map((m) => m.text)).toEqual([
        'Поръчките в Club Nova са пуснати отново',
        'Поръчките в Club Nova са пуснати отново',
      ])
    })

    it('words the edit to Done and the bot’s answers', async () => {
      const id = await seedAlert('order_unconfirmed')
      await pass()
      edits.length = 0
      const press = (userId: string) => ({
        callbackId: `cb-${randomUUID()}`,
        userId,
        chatId: VENUE_CHAT,
        messageId: 100,
        text: 'Маса 7: изпратена поръчка без потвърждение',
        data: id,
      })
      const deps = { pool, telegram, log: quiet, now }
      await handlePress(deps, press('999'))
      await handlePress(deps, press('777'))
      await handlePress(deps, press('555'))
      await handlePress(deps, press('555'))
      expect(answers).toEqual([
        'Вашият Telegram не е свързан с акаунт в Restro.',
        'Ролята ви не може да отговаря на сигнали тук.',
        'Готово.',
        'Вече е готово.',
      ])
      expect(edits[0]?.text).toMatch(/\n\nГотово от Maria, \d\d:\d\d$/)
    })
  })

  describe('Done from the venue group', () => {
    const press = (userId: string, data: string, chatId = VENUE_CHAT) => ({
      callbackId: `cb-${randomUUID()}`,
      userId,
      chatId,
      messageId: 100,
      text: 'Table 7: an order couldn’t be confirmed',
      data,
    })
    const deps = () => ({ pool, telegram, log: quiet, now })

    it('marks the alert Done for a linked account whose role may, edits the message and says via Telegram', async () => {
      const id = await seedAlert('order_unconfirmed')
      await pass()
      edits.length = 0
      await handlePress(deps(), press('555', id))

      const row = await rowOf(id)
      expect(row?.done_at).not.toBeNull()
      expect(row?.via).toBe('telegram')
      expect(edits).toHaveLength(1)
      expect(edits[0]?.text).toMatch(/\n\nDone by Maria, \d\d:\d\d$/)
      expect(answers.at(-1)).toBe('Done.')
      const log = (await query(
        `select via from restro.log_entries where kind = 'alert.done' and details ->> 'alertId' = $1`,
        [id],
      )) as { via: string }[]
      expect(log).toEqual([{ via: 'telegram' }])

      // The sweep does not edit it a second time.
      await pass()
      expect(edits).toHaveLength(1)
    })

    it('answers “already done” the second time', async () => {
      const id = await seedAlert('order_unconfirmed')
      await handlePress(deps(), press('555', id))
      await handlePress(deps(), press('555', id))
      expect(answers).toEqual(['Done.', 'Already done.'])
    })

    it('does nothing for a Telegram user who is not linked', async () => {
      const id = await seedAlert('order_unconfirmed')
      await handlePress(deps(), press('999', id))
      expect((await rowOf(id))?.done_at).toBeNull()
      expect(answers).toEqual(['Your Telegram is not linked to a Restro account.'])
    })

    it('does nothing for a linked person whose role may not answer alerts', async () => {
      const id = await seedAlert('order_unconfirmed')
      await handlePress(deps(), press('777', id))
      expect((await rowOf(id))?.done_at).toBeNull()
      expect(answers).toEqual(['Your role cannot answer alerts here.'])
    })

    it('does nothing in a group that is not a venue’s, nor for a pause or the team’s alert', async () => {
      const id = await seedAlert('order_unconfirmed')
      await handlePress(deps(), press('555', id, '-100777'))
      expect((await rowOf(id))?.done_at).toBeNull()
      expect(answers.at(-1)).toBe('This group is not linked to a venue in Restro.')

      const pause = await seedAlert('ordering_paused')
      await handlePress(deps(), press('555', pause))
      expect((await rowOf(pause))?.done_at).toBeNull()
      const team = await seedAlert('order_pace', { audience: 'restro' })
      await handlePress(deps(), press('555', team))
      expect((await rowOf(team))?.done_at).toBeNull()
      await handlePress(deps(), press('555', 'not-an-alert'))
      expect(answers.at(-1)).toBe('That button is not for an alert.')
    })
  })
})
