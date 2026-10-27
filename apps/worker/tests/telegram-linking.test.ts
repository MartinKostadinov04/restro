// Linking Telegram from the owner's Alerts settings (#87) on Postgres, with the bot replaced by a
// fake: the signed link opens in the venue's group (the group's chat id is written, once) or in a
// person's private chat (their Telegram id, for one person only); a link that ran out, was used,
// or is opened in the wrong kind of chat changes nothing; the bot removed from the group makes the
// venue forget it; and the web app's request for a link needs `settings.alerts` and a sign-in of
// the last 15 minutes. Every change is a `record` Log entry.
import { newId } from '@restro/core'
import { provisionTenant, provisionVenue } from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { StartMessage, TelegramClient } from '../src/alerts/telegram'
import { makeLinkCode, openLinkCode } from '../src/alerts/telegram-link'
import { createTelegramApi } from '../src/alerts/telegram-link-api'
import { handleMembership, handleStart, type LinkingDeps } from '../src/alerts/telegram-linking'
import { venueOfChat } from '../src/alerts/telegram-poller'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  type TestDatabase,
  testSlug,
  withOwnerClient,
} from './database'

allowSlowSetup()

const SECRET = 'a-reveal-token-of-at-least-32-characters'
const GROUP = '-100777'
const quiet = { warn: () => undefined, info: () => undefined }

describe.skipIf(!hasDatabase)('linking Telegram', () => {
  let db: TestDatabase
  let pool: DbPool
  const tenantId = newId('tn')
  let venueId: `vn_${string}`
  let ownerId: string
  let memberId: string
  let mariaStaffId: `sm_${string}`
  let pavelStaffId: `sm_${string}`
  let outsideStaffId: `sm_${string}`
  let used: Map<string, number>
  const said: { chatId: string; text: string }[] = []
  const now = () => new Date()

  const telegram: TelegramClient = {
    async sendMessage(chatId, text) {
      said.push({ chatId, text })
      return { chatId, messageId: 1 }
    },
    async editMessage() {},
    async answerCallback() {},
    async getMe() {
      return { username: 'restro_bot' }
    },
    async getUpdates() {
      return []
    },
  }
  const deps = (): LinkingDeps => ({
    pool,
    telegram,
    log: quiet,
    now,
    linkSecret: SECRET,
    used,
  })

  const query = (sql: string, values: unknown[] = []) =>
    withOwnerClient(db.ownerUrl, async (client) => (await client.query(sql, values)).rows)
  const seed = ['restro', 'system', 'test-seed']

  async function addUser(role: string): Promise<string> {
    const id = `link-${newId('us').slice(3)}`
    await query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
      id,
      'A person',
      `${id}@example.test`,
    ])
    await query(
      'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
      [`mb-${id}`, tenantId, id, role],
    )
    return id
  }
  async function addStaff(
    name: string,
    permissions: string[],
    options: { userId?: string; atVenue?: boolean } = {},
  ): Promise<`sm_${string}`> {
    const staffMemberId = newId('sm')
    await query(
      `insert into restro.staff_members (id, tenant_id, display_name, user_id, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [staffMemberId, tenantId, name, options.userId ?? null, ...seed],
    )
    if (options.atVenue !== false) {
      const roleId = newId('rl')
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
    return staffMemberId
  }
  const chatIdOfVenue = async () =>
    (
      (await query('select settings #>> $2 as chat from restro.venues where id = $1', [
        venueId,
        '{ordering,telegramChatId}',
      ])) as { chat: string | null }[]
    )[0]?.chat ?? null
  const telegramIdOf = async (id: string) =>
    (
      (await query('select telegram_user_id as t from restro.staff_members where id = $1', [
        id,
      ])) as { t: string | null }[]
    )[0]?.t ?? null
  const logOf = async (reason: string) =>
    (await query(
      `select retention, details from restro.log_entries
        where venue_id = $1 and kind = 'settings.changed' and reason = $2 order by seq`,
      [venueId, reason],
    )) as { retention: string; details: Record<string, unknown> }[]

  const start = (code: string, over: Partial<StartMessage> = {}): StartMessage => ({
    userId: '4242',
    chatId: GROUP,
    chatType: 'supergroup',
    title: 'Club Nova staff',
    code,
    ...over,
  })
  const groupCode = (at = now()) => makeLinkCode(SECRET, { purpose: 'group', venueId, now: at })
  const personCode = (staffMemberId: `sm_${string}`) =>
    makeLinkCode(SECRET, { purpose: 'person', venueId, staffMemberId, now: now() })

  beforeAll(async () => {
    db = await createTestDatabase()
    pool = createPool(db.appUrl, { applicationName: 'restro-worker-link-tests', max: 4 })
    await provisionTenant(pool, { tenantId, name: 'Link club' })
    await query(
      `insert into restro.auth_organization (id, name, slug) values ($1, 'Link club', $2)`,
      [tenantId, `link-${newId('tn').slice(3, 11)}`],
    )
    const venue = await provisionVenue(pool, tenantId, {
      name: 'Club Nova',
      slug: testSlug('link'),
    })
    venueId = venue.id as `vn_${string}`
    await query(`update restro.venues set default_locale = 'en_US' where id = $1`, [venueId])
    ownerId = await addUser('owner')
    memberId = await addUser('member')
    mariaStaffId = await addStaff('Maria', ['alerts.answer'], { userId: memberId })
    pavelStaffId = await addStaff('Pavel', ['alerts.answer'])
    outsideStaffId = await addStaff('Outside', [], { atVenue: false })
  }, 240_000)

  afterAll(async () => {
    await pool?.end()
    await db?.drop()
  })

  beforeEach(async () => {
    said.length = 0
    used = new Map()
    await query(`update restro.venues set settings = settings - 'ordering' where id = $1`, [
      venueId,
    ])
    await query('update restro.staff_members set telegram_user_id = null where tenant_id = $1', [
      tenantId,
    ])
  })

  describe('the venue’s group', () => {
    it('links the group the bot was added to by the owner’s link, once, as a record Log entry', async () => {
      const code = groupCode()
      await handleStart(deps(), start(code))
      expect(await chatIdOfVenue()).toBe(GROUP)
      const entries = await logOf('telegram_linked')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        retention: 'record',
        details: { group: 'Club Nova staff' },
      })
      expect(said).toEqual([
        { chatId: GROUP, text: 'Restro is linked to Club Nova. Alerts will come here.' },
      ])

      // The same link in another group changes nothing: it was used.
      said.length = 0
      await handleStart(deps(), start(code, { chatId: '-100888', title: 'Another' }))
      expect(await chatIdOfVenue()).toBe(GROUP)
      expect(said[0]?.text).toBe('This link ran out. Ask for a new one in Restro.')
    })

    it('says nothing in a group for a code that is not Restro’s, and changes nothing', async () => {
      await handleStart(deps(), start('A'.repeat(62)))
      expect(said).toEqual([])
      expect(await chatIdOfVenue()).toBeNull()
    })

    it('does not link a group from a link made for a person, nor a person from a group’s', async () => {
      await handleStart(deps(), start(personCode(mariaStaffId)))
      expect(await chatIdOfVenue()).toBeNull()
      expect(said[0]?.text).toContain('another kind of chat')
      said.length = 0
      await handleStart(
        deps(),
        start(groupCode(), { chatType: 'private', chatId: '4242', title: '' }),
      )
      expect(await telegramIdOf(mariaStaffId)).toBeNull()
      expect(said[0]?.text).toContain('another kind of chat')
    })

    it('refuses a link past its 15 minutes', async () => {
      const long = new Date(Date.now() - 16 * 60_000)
      await handleStart(deps(), start(groupCode(long)))
      expect(await chatIdOfVenue()).toBeNull()
      expect(said[0]?.text).toBe('This link ran out. Ask for a new one in Restro.')
    })

    it('forgets the group when the bot is removed from it, and not for another group', async () => {
      await handleStart(deps(), start(groupCode()))
      const membership = { ...deps(), venueOfChat: (chat: string) => venueOfChat(pool, chat) }
      await handleMembership(membership, {
        chatId: '-100000',
        chatType: 'group',
        title: 'Elsewhere',
        status: 'kicked',
      })
      expect(await chatIdOfVenue()).toBe(GROUP)
      await handleMembership(membership, {
        chatId: GROUP,
        chatType: 'supergroup',
        title: 'Club Nova staff',
        status: 'left',
      })
      expect(await chatIdOfVenue()).toBeNull()
      const entries = await logOf('telegram_left')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        retention: 'record',
        details: { group: 'Club Nova staff' },
      })
    })
  })

  describe('a person', () => {
    const privateChat = { chatType: 'private', chatId: '4242', title: '' } as const

    it('links their Telegram id when they press Start on their own link', async () => {
      await handleStart(deps(), start(personCode(mariaStaffId), privateChat))
      expect(await telegramIdOf(mariaStaffId)).toBe('4242')
      expect(said[0]?.text).toBe(
        'You are linked at Club Nova. You can press Done on alerts in the group.',
      )
    })

    it('refuses one Telegram account for two people', async () => {
      await handleStart(deps(), start(personCode(mariaStaffId), privateChat))
      said.length = 0
      await handleStart(deps(), start(personCode(pavelStaffId), privateChat))
      expect(await telegramIdOf(pavelStaffId)).toBeNull()
      expect(said[0]?.text).toBe('This Telegram account is already linked to someone else.')
    })

    it('does not link someone who no longer works at the venue', async () => {
      await handleStart(deps(), start(personCode(outsideStaffId), privateChat))
      expect(await telegramIdOf(outsideStaffId)).toBeNull()
      expect(said[0]?.text).toBe('You are not on the staff of Club Nova in Restro.')
    })

    it('answers in Bulgarian for a Bulgarian venue', async () => {
      await query(`update restro.venues set default_locale = 'bg_BG' where id = $1`, [venueId])
      try {
        await handleStart(deps(), start(personCode(mariaStaffId), privateChat))
        expect(said[0]?.text).toBe(
          'Свързани сте в Club Nova. Можете да натискате „Готово“ на известията в групата.',
        )
      } finally {
        await query(`update restro.venues set default_locale = 'en_US' where id = $1`, [venueId])
      }
    })
  })

  describe('the web app’s request', () => {
    const api = () => createTelegramApi({ pool, telegram, secret: SECRET, now })
    const owner = () =>
      ({
        tenantId,
        venueId,
        actor: { kind: 'user', userId: ownerId, sessionId: 'session-1' },
        signedInAt: new Date().toISOString(),
      }) as const

    it('makes the group link and the person link, signed for this venue and ending in 15 minutes', async () => {
      const group = await api()({ ...owner(), action: 'link_group' })
      expect(group).toMatchObject({ status: 'accepted' })
      const url = new URL((group as { url: string }).url)
      expect(url.origin + url.pathname).toBe('https://t.me/restro_bot')
      const code = url.searchParams.get('startgroup') ?? ''
      expect(openLinkCode(SECRET, code, now())).toMatchObject({ purpose: 'group', venueId })

      const person = await api()({ ...owner(), action: 'link_person', staffMemberId: mariaStaffId })
      const personUrl = new URL((person as { url: string }).url)
      expect(openLinkCode(SECRET, personUrl.searchParams.get('start') ?? '', now())).toMatchObject({
        purpose: 'person',
        staffMemberId: mariaStaffId,
      })
    })

    it('refuses without the right, after 15 minutes, and for someone not at this venue', async () => {
      const stale = new Date(Date.now() - 16 * 60_000).toISOString()
      expect(await api()({ ...owner(), signedInAt: stale, action: 'link_group' })).toEqual({
        status: 'refused',
        code: 'sign_in_again',
      })
      expect(
        await api()({
          ...owner(),
          actor: { kind: 'user', userId: memberId, sessionId: 'session-2' },
          action: 'link_group',
        }),
      ).toEqual({ status: 'refused', code: 'permission_denied' })
      expect(
        await api()({ ...owner(), action: 'link_person', staffMemberId: outsideStaffId }),
      ).toEqual({ status: 'refused', code: 'staff_missing' })
    })

    it('sends a test message to the linked group in the venue’s language, or says there is none', async () => {
      expect(await api()({ ...owner(), action: 'test' })).toEqual({
        status: 'refused',
        code: 'no_group',
      })
      await handleStart(deps(), start(groupCode()))
      said.length = 0
      expect(await api()({ ...owner(), action: 'test' })).toEqual({ status: 'accepted' })
      expect(said).toEqual([
        { chatId: GROUP, text: 'Restro: a test message from Club Nova. Alerts will come here.' },
      ])
    })
  })
})
