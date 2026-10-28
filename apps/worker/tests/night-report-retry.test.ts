// The end-of-night message goes until it has gone (#179; #86) on Postgres, as the restro_app role,
// with a fake Telegram: a day whose first send fails gets its message at the next tick, once, and
// is then marked (`service_day.report_sent`); a marked day is never sent again; a day older than
// `NIGHT_REPORT_MAX_AGE_DAYS` is not sent; a venue with no group is not marked and is looked at
// again; the days go oldest first. Skipped without a database.
import { readFileSync } from 'node:fs'

import { DEFAULT_ORDERING_SETTINGS, newId } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { TelegramClient } from '../src/alerts/telegram'
import { NIGHT_REPORT_MAX_AGE_DAYS, sendDueNightReports } from '../src/jobs/service-day'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const DAY_MS = 86_400_000
const dayOffset = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10)

describe.skipIf(!hasDatabase)('the end-of-night message retry (as the restro_app role)', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  const now = new Date()
  const warnings: unknown[] = []
  const log = { info: () => undefined, warn: (fields: unknown) => warnings.push(fields) }

  const query = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(text, values)).rows as T[])

  async function venue(name: string, chatId: string | null): Promise<string> {
    const made = await provisionVenue(pool, tenantId, { name, slug: testSlug('night-retry') })
    const settings = { ordering: { ...DEFAULT_ORDERING_SETTINGS, telegramChatId: chatId } }
    await query('update restro.venues set settings = $1::jsonb where id = $2', [
      JSON.stringify(settings),
      made.id,
    ])
    return made.id
  }
  async function closedDay(venueId: string, serviceDate: string, reportSent = false) {
    await query(
      `insert into restro.service_days
         (tenant_id, venue_id, service_date, report_sent_at, source, actor, job_id)
       values ($1, $2, $3, ${reportSent ? 'now()' : 'null'}, 'restro', 'system', 'test-seed')`,
      [tenantId, venueId, serviceDate],
    )
  }
  const sentAt = async (venueId: string, serviceDate: string) =>
    (
      await query<{ report_sent_at: Date | null }>(
        'select report_sent_at from restro.service_days where venue_id = $1 and service_date = $2',
        [venueId, serviceDate],
      )
    )[0]?.report_sent_at ?? null

  function fakeTelegram() {
    const state = { failing: false, sent: [] as { chatId: string; text: string }[] }
    const client = {
      sendMessage: async (chatId: string, text: string) => {
        if (state.failing) throw new Error('telegram down')
        state.sent.push({ chatId, text })
        return { chatId, messageId: state.sent.length }
      },
    } as unknown as TelegramClient
    return { state, client }
  }

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-night-retry-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Night club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Night club', $2)`,
      [tenantId, `night-${newId('tn').slice(3, 11).toLowerCase()}`],
    )
  })

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  it('sends a day whose first send failed at the next tick, once, and marks it', async () => {
    const v = await venue('Retry Bar', '-1001')
    const day = dayOffset(now, 1)
    await closedDay(v, day)
    const telegram = fakeTelegram()
    telegram.state.failing = true
    warnings.length = 0
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(await sentAt(v, day)).toBeNull()

    telegram.state.failing = false
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(1)
    expect(telegram.state.sent).toHaveLength(1)
    expect(await sentAt(v, day)).not.toBeNull()

    // Marked: the next ticks send nothing more.
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(0)
    expect(telegram.state.sent).toHaveLength(1)
  })

  it('never sends a day that is already marked', async () => {
    const v = await venue('Marked Bar', '-1002')
    await closedDay(v, dayOffset(now, 1), true)
    const telegram = fakeTelegram()
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(0)
    expect(telegram.state.sent).toEqual([])
  })

  it('does not send a day older than NIGHT_REPORT_MAX_AGE_DAYS', async () => {
    const v = await venue('Old Bar', '-1003')
    const old = dayOffset(now, NIGHT_REPORT_MAX_AGE_DAYS + 3)
    await closedDay(v, old)
    const telegram = fakeTelegram()
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(0)
    expect(telegram.state.sent).toEqual([])
    expect(await sentAt(v, old)).toBeNull()
  })

  it('leaves a venue with no group unmarked, and looks at it again', async () => {
    const v = await venue('Quiet Bar', null)
    const day = dayOffset(now, 1)
    await closedDay(v, day)
    const telegram = fakeTelegram()
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(0)
    expect(telegram.state.sent).toEqual([])
    expect(await sentAt(v, day)).toBeNull()
    // The group is linked later: the same day goes at the next tick.
    await query('update restro.venues set settings = $1::jsonb where id = $2', [
      JSON.stringify({ ordering: { ...DEFAULT_ORDERING_SETTINGS, telegramChatId: '-1004' } }),
      v,
    ])
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBe(1)
    expect(await sentAt(v, day)).not.toBeNull()
  })

  it('sends nothing, and marks nothing, without a bot', async () => {
    const v = await venue('Botless Bar', '-1005')
    const day = dayOffset(now, 1)
    await closedDay(v, day)
    expect(await sendDueNightReports(pool, now, null, log)).toBe(0)
    expect(await sentAt(v, day)).toBeNull()
  })

  it('sends the days oldest first', async () => {
    const v = await venue('Order Bar', '-1006')
    const older = dayOffset(now, 2)
    const newer = dayOffset(now, 1)
    await closedDay(v, newer)
    await closedDay(v, older)
    const telegram = fakeTelegram()
    expect(await sendDueNightReports(pool, now, telegram.client, log)).toBeGreaterThanOrEqual(2)
    const [first, second] = [await sentAt(v, older), await sentAt(v, newer)]
    expect((first as Date).getTime()).toBeLessThanOrEqual((second as Date).getTime())
  })

  it('marks the days closed before the column with their close time (the migration)', async () => {
    const statement = readFileSync(
      new URL('../../../packages/db/migrations/0036_night_report_sent.sql', import.meta.url),
      'utf8',
    )
      .split('--> statement-breakpoint')[1]
      ?.trim()
    expect(statement).toMatch(/^UPDATE "restro"\."service_days"/)
    const v = await venue('Backfill Bar', '-1007')
    const day = dayOffset(now, 1)
    await closedDay(v, day)
    await query(statement as string)
    const [row] = await query<{ same: boolean }>(
      `select report_sent_at = closed_at as same from restro.service_days
        where venue_id = $1 and service_date = $2`,
      [v, day],
    )
    expect(row?.same).toBe(true)
  })
})
