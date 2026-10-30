// The worker's internal endpoints, attacked (the repair-review's A7), on a real Postgres as
// restro_app. Another organisation's ids and a plain member get nothing through a reveal, the service
// token is required, a public name is a 404, a reveal takes only a session that exists (RR-10), and a
// link used once doesn't work again after a restart (RR-9).
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'

import { sealTableCode } from '@restro/core/seal'
import { alertLocale, applyService, telegramLinkText } from '@restro/core/service'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  openServiceWorld,
  type ServiceWorld,
} from '../../../packages/core/src/testing/service-world'
import type { TelegramClient } from './alerts/telegram'
import { linkSecretOf, makeLinkCode, openLinkCode } from './alerts/telegram-link'
import { handleStart } from './alerts/telegram-linking'
import { type HealthServer, startHealthServer } from './health-server'
import { RevealRequestSchema, reveal } from './reveal'

const hasDatabase = process.env.DATABASE_URL_OWNER !== undefined
const keys = generateKeyPairSync('x25519')
const TOKEN = 'attack-service-token-attack-service-token'
const BOT_TOKEN = '123456:attack-bot-token-attack-bot-token'
const log = { warn: () => {}, info: () => {} }

/** A real sign-in of this account: what the web app's `session.session.id` names. */
async function signIn(world: ServiceWorld, userId: string, endsInMs = 3_600_000): Promise<string> {
  const id = `sess-${randomUUID()}`
  await world.owner.query(
    `insert into restro.auth_session (id, expires_at, token, user_id)
     values ($1, $2, $3, $4)`,
    [id, new Date(Date.now() + endsInMs), `tok-${id}`, userId],
  )
  return id
}

function call(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', agent: false, headers },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('the internal endpoints, over HTTP', () => {
  let server: HealthServer
  beforeAll(async () => {
    server = await startHealthServer(0, () => ({
      httpStatus: 200,
      body: { status: 'ok', lastBeatAt: null, pgboss: 'started' },
    }))
    server.setRevealHandler({
      token: TOKEN,
      reveal: async () => ({ status: 'refused', code: 'x' }),
      failed: () => {},
    } as never)
  })
  afterAll(async () => {
    await server?.close()
  })

  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  it('a public name is a 404, with the token too', async () => {
    const answer = await call(
      server.port,
      '/internal/reveal',
      { ...auth, host: 'restro.example' },
      '{}',
    )
    expect(answer).toBe(404)
  })
  it('no token, and a wrong token, are a 401', async () => {
    const host = { host: 'localhost', 'content-type': 'application/json' }
    expect(await call(server.port, '/internal/reveal', host, '{}')).toBe(401)
    expect(
      await call(server.port, '/internal/reveal', { ...host, authorization: 'Bearer wrong' }, '{}'),
    ).toBe(401)
    expect(
      await call(
        server.port,
        '/internal/reveal',
        { ...host, authorization: `bearer ${TOKEN}` },
        '{}',
      ),
    ).toBe(401)
  })
})

describe.skipIf(!hasDatabase)('a reveal (as restro_app)', () => {
  let victim: ServiceWorld
  let attacker: ServiceWorld
  let attackerOwner: string
  let member: string
  let table: string
  let attackerSession: string
  let memberSession: string

  const asOwner = () => ({
    tenantId: attacker.tenantId,
    venueId: attacker.venueId,
    actor: { kind: 'user' as const, userId: attackerOwner, sessionId: attackerSession },
    signedInAt: new Date().toISOString(),
  })

  beforeAll(async () => {
    victim = await openServiceWorld('reveal-victim')
    attacker = await openServiceWorld('reveal-attacker')
    attackerOwner = await attacker.addUser('owner')
    member = await victim.addUser('member')
    attackerSession = await signIn(attacker, attackerOwner)
    memberSession = await signIn(victim, member)
    table = victim.tables[0] as string
    const code = `code${randomUUID().replaceAll('-', '')}`
    await victim.owner.query(
      'update restro.tables set qr_code_sealed = $2, qr_code_hash = $3 where id = $1',
      [
        table,
        sealTableCode(keys.publicKey, code, { tenantId: victim.tenantId, tableId: table }),
        createHash('sha256').update(code).digest('hex'),
      ],
    )
  }, 120_000)

  afterAll(async () => {
    await victim?.close()
    await attacker?.close()
  }, 60_000)

  const deps = () => ({ pool: victim.app, privateKey: keys.privateKey })

  it("another organisation's owner, their own venue, the victim's tables: no code", async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asOwner(), tableIds: [table] }),
    )
    expect(JSON.stringify(answer)).not.toContain(table)
  }, 30_000)

  it("the victim's venue under the attacker's tenant: refused", async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asOwner(), venueId: victim.venueId, tableIds: [table] }),
    )
    expect(answer.status).toBe('refused')
  }, 30_000)

  it('a plain member of the same organisation: refused, codes and PINs', async () => {
    const asMember = {
      tenantId: victim.tenantId,
      venueId: victim.venueId,
      actor: { kind: 'user' as const, userId: member, sessionId: memberSession },
      signedInAt: new Date().toISOString(),
    }
    const codes = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asMember, tableIds: [table] }),
    )
    expect(codes.status).toBe('refused')
    const staff = await victim.addStaff(['alerts.answer'])
    const pins = await reveal(
      deps(),
      RevealRequestSchema.parse({ ...asMember, staffMemberIds: [staff] }),
    )
    expect(pins.status).toBe('refused')
  }, 30_000)

  it('someone named as an operator who is not one: refused', async () => {
    const answer = await reveal(
      deps(),
      RevealRequestSchema.parse({
        tenantId: victim.tenantId,
        venueId: victim.venueId,
        actor: { kind: 'operator', userId: attackerOwner },
        tableIds: [table],
      }),
    )
    expect(answer.status).toBe('refused')
  }, 30_000)
})

describe.skipIf(!hasDatabase)('RR-9 and RR-10 (as restro_app)', () => {
  let world: ServiceWorld
  let table: string
  let ownerId: string
  let person: string
  const telegram = {
    sendMessage: async (_chat: string, text: string) => {
      said.push(text)
      return {}
    },
  } as unknown as TelegramClient
  const said: string[] = []

  beforeAll(async () => {
    world = await openServiceWorld('internal')
    ownerId = await world.addUser('owner')
    table = world.tables[0] as string
    person = await world.addStaff(['alerts.answer'])
    const code = `code${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      'update restro.tables set qr_code_sealed = $2, qr_code_hash = $3 where id = $1',
      [
        table,
        sealTableCode(keys.publicKey, code, { tenantId: world.tenantId, tableId: table }),
        createHash('sha256').update(code).digest('hex'),
      ],
    )
  }, 120_000)

  afterAll(async () => {
    await world?.close()
  }, 60_000)

  describe('RR-9: a link used once', () => {
    /** The bot's line for a spent link, in the venue's language. */
    const ranOut = async () => {
      const venue = await world.owner.query<{ default_locale: string }>(
        'select default_locale from restro.venues where id = $1',
        [world.venueId],
      )
      return telegramLinkText(alertLocale(venue.rows[0]?.default_locale ?? ''), 'link_expired', '')
    }
    const telegramOf = async (staffMember: string) =>
      (
        await world.owner.query<{ telegram_user_id: string | null }>(
          'select telegram_user_id from restro.staff_members where id = $1',
          [staffMember],
        )
      ).rows[0]?.telegram_user_id
    const groupOf = async () =>
      (
        await world.owner.query<{ chat: string | null }>(
          "select settings->'ordering'->>'telegramChatId' as chat from restro.venues where id = $1",
          [world.venueId],
        )
      ).rows[0]?.chat
    const personCode = (staffMember: string, now: Date) =>
      makeLinkCode(BOT_TOKEN, {
        purpose: 'person',
        venueId: world.venueId as never,
        staffMemberId: staffMember as never,
        now,
      })
    const privately = (userId: string, code: string) => ({
      userId,
      chatId: userId,
      chatType: 'private' as const,
      title: '',
      code,
    })
    /** A worker just started: its `used` map is empty. */
    const restarted = (now: Date) => ({
      pool: world.app,
      telegram,
      log: log as never,
      now: () => now,
      linkSecret: BOT_TOKEN,
      used: new Map<string, number>(),
    })

    it('a person link must not work again after a restart', async () => {
      const now = new Date()
      const staffMember = await world.addStaff(['alerts.answer'])
      const code = personCode(staffMember, now)
      await handleStart(restarted(now), privately('1001', code))
      expect(await telegramOf(staffMember)).toBe('1001')
      // The same code leaked; the worker has restarted.
      said.length = 0
      await handleStart(restarted(now), privately('2002', code))
      expect(await telegramOf(staffMember)).toBe('1001')
      // Said as any spent link, not as a failure to try again.
      expect(said).toEqual([await ranOut()])
    }, 30_000)

    it('the owner unlinks, and the old link stays spent', async () => {
      const now = new Date()
      const staffMember = await world.addStaff(['alerts.answer'])
      const code = personCode(staffMember, now)
      await handleStart(restarted(now), privately('3003', code))
      const sessionId = await signIn(world, ownerId)
      const { result } = await applyService(
        world.app,
        { type: 'staff.link_telegram', staffMemberId: staffMember, telegramUserId: null } as never,
        {
          tenantId: world.tenantId,
          venueId: world.venueId,
          origin: 'staff',
          actor: { kind: 'user', userId: ownerId, sessionId },
          jobId: `unlink-${randomUUID()}`,
          signedInAt: new Date(),
        },
      )
      expect(result.status).toBe('accepted')
      await handleStart(restarted(now), privately('4004', code))
      expect(await telegramOf(staffMember)).toBeNull()
    }, 30_000)

    it('the same person pressing their link again changes nothing and is told it worked', async () => {
      const now = new Date()
      const staffMember = await world.addStaff(['alerts.answer'])
      const code = personCode(staffMember, now)
      await handleStart(restarted(now), privately('5005', code))
      said.length = 0
      await handleStart(restarted(now), privately('5005', code))
      expect(await telegramOf(staffMember)).toBe('5005')
      expect(said).toHaveLength(1)
      expect(said).not.toEqual([await ranOut()])
    }, 30_000)

    it('a link made after the last change still works: re-linking stays possible', async () => {
      const now = new Date()
      const staffMember = await world.addStaff(['alerts.answer'])
      await handleStart(restarted(now), privately('6006', personCode(staffMember, now)))
      const later = new Date(now.getTime() + 61_000)
      await handleStart(restarted(later), privately('7007', personCode(staffMember, later)))
      expect(await telegramOf(staffMember)).toBe('7007')
    }, 30_000)

    it('a group link must not move the alerts to another group after a restart', async () => {
      const now = new Date()
      const code = makeLinkCode(BOT_TOKEN, {
        purpose: 'group',
        venueId: world.venueId as never,
        now,
      })
      const inGroup = (chatId: string) => ({
        userId: '8008',
        chatId,
        chatType: 'group' as const,
        title: 'Staff',
        code,
      })
      await handleStart(restarted(now), inGroup('-1001'))
      expect(await groupOf()).toBe('-1001')
      await handleStart(restarted(now), inGroup('-2002'))
      expect(await groupOf()).toBe('-1001')
    }, 30_000)
  })

  describe('RR-10: a reveal and its session', () => {
    const asking = (actor: object) =>
      RevealRequestSchema.parse({
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor,
        signedInAt: new Date().toISOString(),
        tableIds: [table],
      })
    const deps = () => ({ pool: world.app, privateKey: keys.privateKey })
    const logged = async () =>
      Number(
        (
          await world.owner.query<{ n: string }>(
            'select count(*) as n from restro.log_entries where venue_id = $1',
            [world.venueId],
          )
        ).rows[0]?.n,
      )

    it('a session that does not exist is refused, before anything is logged', async () => {
      const before = await logged()
      const answer = await reveal(
        deps(),
        asking({ kind: 'user', userId: ownerId, sessionId: 'a-session-nobody-signed-in-with' }),
      )
      expect(answer).toEqual({ status: 'refused', code: 'session_unknown' })
      expect(await logged()).toBe(before)
    }, 30_000)

    it("another account's session, and one that has ended, are refused", async () => {
      const other = await world.addUser('member')
      const theirs = await signIn(world, other)
      expect(
        await reveal(deps(), asking({ kind: 'user', userId: ownerId, sessionId: theirs })),
      ).toEqual({ status: 'refused', code: 'session_unknown' })
      const ended = await signIn(world, ownerId, -60_000)
      expect(
        await reveal(deps(), asking({ kind: 'user', userId: ownerId, sessionId: ended })),
      ).toEqual({ status: 'refused', code: 'session_unknown' })
    }, 30_000)

    it('a real session of the owner still opens the code', async () => {
      const sessionId = await signIn(world, ownerId)
      const answer = await reveal(deps(), asking({ kind: 'user', userId: ownerId, sessionId }))
      expect(answer.status).toBe('accepted')
    }, 30_000)

    it('an operator has no session here: their PIN reveal still works', async () => {
      const operator = await world.addUser('member')
      await world.addOperator(operator)
      const answer = await reveal(
        deps(),
        RevealRequestSchema.parse({
          tenantId: world.tenantId,
          venueId: world.venueId,
          actor: { kind: 'operator', userId: operator },
          signedInAt: new Date().toISOString(),
          staffMemberIds: [person],
        }),
      )
      expect(answer.status).toBe('accepted')
    }, 30_000)
  })

  describe('RR-10: the service token and the Telegram links', () => {
    const config = { revealToken: TOKEN, alerts: { telegramToken: BOT_TOKEN } }

    it("the bearer of the internal endpoints can't make a link the worker takes", async () => {
      const secret = linkSecretOf(config)
      expect(secret).toBe(BOT_TOKEN)
      const forged = makeLinkCode(TOKEN, {
        purpose: 'person',
        venueId: world.venueId as never,
        staffMemberId: person as never,
        now: new Date(),
      })
      expect(openLinkCode(secret as string, forged, new Date())).toBeNull()
      const genuine = makeLinkCode(secret as string, {
        purpose: 'person',
        venueId: world.venueId as never,
        staffMemberId: person as never,
        now: new Date(),
      })
      expect(openLinkCode(secret as string, genuine, new Date())).toMatchObject({
        purpose: 'person',
      })
    })

    it('without the bot there is no linking, whatever the service token', () => {
      expect(linkSecretOf({ alerts: { telegramToken: null } })).toBeNull()
    })

    it('the worker signs and opens with that secret, not the service token', () => {
      const source = readFileSync(new URL('./worker.ts', import.meta.url), 'utf8')
      expect(source).toContain('linkSecret: linkSecretOf(config)')
      expect(source).toContain('secret: telegramToken')
      expect(source).not.toMatch(/(linkSecret|secret): config\.revealToken/)
    })
  })
})
