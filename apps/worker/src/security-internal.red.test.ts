// RED by design (the repair-review's A7; RR-9 and RR-10). A link code that was used once works again
// after the worker restarts, and the holder of the one service token can act as anyone.
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'

import { sealTableCode } from '@restro/core/seal'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  openServiceWorld,
  type ServiceWorld,
} from '../../../packages/core/src/testing/service-world'
import type { TelegramClient } from './alerts/telegram'
import { makeLinkCode, openLinkCode } from './alerts/telegram-link'
import { handleStart } from './alerts/telegram-linking'
import { RevealRequestSchema, reveal } from './reveal'

const hasDatabase = process.env.DATABASE_URL_OWNER !== undefined
const keys = generateKeyPairSync('x25519')
const TOKEN = 'attack-service-token-attack-service-token'
const log = { warn: () => {}, info: () => {} }
const telegram = { sendMessage: async () => ({}) } as unknown as TelegramClient

describe.skipIf(!hasDatabase)('RR-9 and RR-10 (as restro_app)', () => {
  let world: ServiceWorld
  let table: string
  let ownerId: string
  let person: string

  beforeAll(async () => {
    world = await openServiceWorld('internal-red')
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

  const telegramOf = async () =>
    (
      await world.owner.query<{ telegram_user_id: string | null }>(
        'select telegram_user_id from restro.staff_members where id = $1',
        [person],
      )
    ).rows[0]?.telegram_user_id

  it('RR-9: a person link used once must not work again after a restart', async () => {
    const now = new Date()
    const code = makeLinkCode(TOKEN, {
      purpose: 'person',
      venueId: world.venueId as never,
      staffMemberId: person as never,
      now,
    })
    const start = (userId: string) => ({
      userId,
      chatId: userId,
      chatType: 'private' as const,
      title: '',
      code,
    })
    const deps = () => ({
      pool: world.app,
      telegram,
      log: log as never,
      now: () => now,
      linkSecret: TOKEN,
    })
    // The worker that took the code the first time.
    await handleStart({ ...deps(), used: new Map() }, start('1001'))
    expect(await telegramOf()).toBe('1001')
    // The same code leaked; the worker has restarted, its `used` map is empty.
    await handleStart({ ...deps(), used: new Map() }, start('2002'))
    expect(await telegramOf()).toBe('1001')
  }, 30_000)

  it('RR-10: a reveal must not take a session that does not exist', async () => {
    const answer = await reveal(
      { pool: world.app, privateKey: keys.privateKey },
      RevealRequestSchema.parse({
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: { kind: 'user', userId: ownerId, sessionId: 'a-session-nobody-signed-in-with' },
        signedInAt: new Date().toISOString(),
        tableIds: [table],
      }),
    )
    expect(answer.status).toBe('refused')
  }, 30_000)

  it('RR-10: the service token must not also be the key that signs Telegram links', () => {
    // Whoever holds the bearer of /internal/reveal can make a link for any person at any venue. A
    // link key of its own would fail here; at the pin the key is derived from the token.
    const forged = makeLinkCode(TOKEN, {
      purpose: 'person',
      venueId: world.venueId as never,
      staffMemberId: person as never,
      now: new Date(),
    })
    expect(openLinkCode(TOKEN, forged, new Date())).toBeNull()
  })
})
