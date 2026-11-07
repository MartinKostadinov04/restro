// Table codes stored in plain before #70 (D122 §9), against Postgres and a real publish store:
//
//   - `seal-table-codes` gives each such code its sealed copy, writes the venue's files under the
//     codes' hashes, removes the files named by the plain code and only then clears the plain
//     code; a second run finds nothing to do, and a run cut short is finished by the next;
//   - the reveal (`revealTableCodes`) opens the sealed copies for an owner signed in to the
//     venue's organisation, writes one `record` Log entry, and refuses anyone else; it opens a
//     staff PIN the same way, for a sign-in of the last 15 minutes (#72).
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalPublishStore, readTableTokenFile, tableTokenPath } from '@restro/assets'
import { JOB_NAMES, newId } from '@restro/core'
import { issueAllTableTokens, listVenueTables, sealPlainTableCodes } from '@restro/core/apply'
import { openTableCode } from '@restro/core/seal-open'
import { applyService } from '@restro/core/service'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { sealTableCodesOf } from '../src/jobs/seal-table-codes'
import { type RevealRequest, reveal, revealTableCodes } from '../src/reveal'
import {
  allowSlowSetup,
  createTestDatabase,
  hasDatabase,
  SETUP_TIMEOUT_MS,
  type TestDatabase,
} from './database'
import { createFakeBarsy } from './fake-barsy'
import { createWorld, type World } from './world'

allowSlowSetup()

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe.skipIf(!hasDatabase)('table codes stored in plain before #70', () => {
  const fake = createFakeBarsy()
  let db: TestDatabase
  let world: World
  let root: string
  let store: LocalPublishStore

  beforeAll(async () => {
    db = await createTestDatabase()
    fake.listen()
  }, SETUP_TIMEOUT_MS)
  afterAll(async () => {
    fake.close()
    await db?.drop()
  })
  beforeEach(async () => {
    fake.reset()
    world = await createWorld(fake, { database: db })
    root = await mkdtemp(path.join(tmpdir(), 'restro-seal-codes-'))
    store = new LocalPublishStore({ rootDir: root })
    await world.run(JOB_NAMES.barsyFullPull, {
      tenantId: world.tenantId,
      integrationId: world.integrationId,
      venueId: world.venueId,
    })
    await issueAllTableTokens(world.pool, world.tenantId, world.venueId, world.publicKeyText)
  })
  afterEach(async () => {
    await world.query('delete from restro.log_entries where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.assets where tenant_id = $1', [world.tenantId])
    await world.query('delete from restro.auth_organization where id = $1', [world.tenantId])
    await world.close()
    await rm(root, { recursive: true, force: true })
  })

  const deps = () => ({ pool: world.pool, store, publicKey: world.keys.publicKey })
  /** The world's tenant and venue, as a reveal request names them. */
  const venue = () => ({
    tenantId: world.tenantId as RevealRequest['tenantId'],
    venueId: world.venueId as RevealRequest['venueId'],
  })

  /**
   * Puts `count` of the venue's tables back the way #70 found them: the code in plain, its hash
   * (the migration's backfill), no sealed copy, and a file named by the plain code.
   */
  async function legacyCodes(count: number): Promise<{ tableId: string; code: string }[]> {
    const tables = (await listVenueTables(world.pool, world.tenantId, world.venueId)).filter(
      (table) => table.codeHash !== null,
    )
    const legacy = tables.slice(0, count).map((table, index) => ({
      tableId: table.id,
      code: `Legacy${String(index).padStart(2, '0')}${randomUUID().replace(/-/g, '').slice(0, 14)}`,
    }))
    for (const { tableId, code } of legacy) {
      await world.query(
        'update restro.tables set qr_token = $2, qr_code_hash = $3, qr_code_sealed = null where id = $1',
        [tableId, code, sha256(code)],
      )
      await store.put(tableTokenPath(code), new TextEncoder().encode('{}'), {
        contentType: 'application/json',
        cacheControl: 'no-cache',
      })
    }
    expect(legacy).toHaveLength(count)
    return legacy
  }

  const rowOf = async (tableId: string) =>
    (
      await world.query<{
        qr_token: string | null
        qr_code_hash: string | null
        qr_code_sealed: string | null
      }>('select qr_token, qr_code_hash, qr_code_sealed from restro.tables where id = $1', [
        tableId,
      ])
    )[0]

  it('seals the plain codes, moves their files to the hash and clears the plain code, once', async () => {
    const legacy = await legacyCodes(2)

    const done = await sealTableCodesOf(deps(), world.tenantId)
    expect(done).toEqual({ sealed: 2, filesRemoved: 2, cleared: 2 })

    for (const { tableId, code } of legacy) {
      const row = await rowOf(tableId)
      // The same code (no printed sticker changes), now only as its hash and its sealed copy.
      expect(row).toMatchObject({ qr_token: null, qr_code_hash: sha256(code) })
      expect(
        openTableCode(world.keys.privateKey, row?.qr_code_sealed ?? '', {
          tenantId: world.tenantId,
          tableId,
        }),
      ).toBe(code)
      expect(await store.get(tableTokenPath(code))).toBeNull()
      expect(await readTableTokenFile(store, sha256(code))).toMatchObject({
        venue_public_id: world.venuePublicId,
      })
    }

    // Nothing is left to do.
    expect(await sealTableCodesOf(deps(), world.tenantId)).toEqual({
      sealed: 0,
      filesRemoved: 0,
      cleared: 0,
    })
  })

  it('finishes a run that stopped after sealing: the next one moves the files and clears', async () => {
    const [legacy] = await legacyCodes(1)
    if (!legacy) throw new Error('no legacy code')
    // A run that died right after step 1.
    expect(await sealPlainTableCodes(world.pool, world.tenantId, world.keys.publicKey)).toBe(1)
    const half = await rowOf(legacy.tableId)
    expect(half?.qr_token).toBe(legacy.code)
    expect(half?.qr_code_sealed).toMatch(/^rs1\./)

    expect(await sealTableCodesOf(deps(), world.tenantId)).toEqual({
      sealed: 0,
      filesRemoved: 1,
      cleared: 1,
    })
    expect(await rowOf(legacy.tableId)).toMatchObject({
      qr_token: null,
      qr_code_sealed: half?.qr_code_sealed,
    })
    expect(await store.get(tableTokenPath(legacy.code))).toBeNull()
  })

  describe('the reveal', () => {
    async function addOwner(): Promise<string> {
      const userId = `reveal-${randomUUID()}`
      await world.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
        userId,
        'Test owner',
        `${userId}@example.test`,
      ])
      await world.query(
        'insert into restro.auth_member (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
        [`mb-${userId}`, world.tenantId, userId, 'owner'],
      )
      // A real sign-in: the internal endpoints look the session up (RR-10).
      await world.query(
        "insert into restro.auth_session (id, expires_at, token, user_id) values ($1, now() + interval '1 hour', $2, $3)",
        [`sess-${userId}`, `tok-${userId}`, userId],
      )
      return userId
    }
    const removeUser = (userId: string) =>
      world.query('delete from restro.auth_user where id = $1', [userId])

    it('opens the codes for the venue’s owner, a plain one too, and writes one record entry', async () => {
      const [legacy] = await legacyCodes(1)
      if (!legacy) throw new Error('no legacy code')
      const tables = (await listVenueTables(world.pool, world.tenantId, world.venueId)).filter(
        (table) => table.codeHash !== null,
      )
      const userId = await addOwner()
      try {
        const answer = await revealTableCodes(
          { pool: world.pool, privateKey: world.keys.privateKey },
          {
            ...venue(),
            tableIds: tables.map((table) => table.id),
            actor: { kind: 'user', userId, sessionId: `sess-${userId}` },
          },
        )
        if (answer.status !== 'accepted') throw new Error(`refused: ${answer.code}`)
        expect(Object.keys(answer.codes).sort()).toEqual(tables.map((table) => table.id).sort())
        // Each code is the one whose hash the table holds; the legacy one comes back in plain.
        for (const table of tables) {
          expect(sha256(answer.codes[table.id] ?? '')).toBe(table.codeHash)
        }
        expect(answer.codes[legacy.tableId]).toBe(legacy.code)

        const entries = await world.query<{ retention: string; details: unknown }>(
          "select retention, details from restro.log_entries where venue_id = $1 and kind = 'table_code.revealed'",
          [world.venueId],
        )
        expect(entries).toEqual([{ retention: 'record', details: { count: tables.length } }])
        // No code went into the Log.
        const text = JSON.stringify(entries)
        for (const code of Object.values(answer.codes)) expect(text).not.toContain(code)
      } finally {
        await world.query('delete from restro.log_entries where tenant_id = $1', [world.tenantId])
        await removeUser(userId)
      }
    })

    it('refuses an account that is not the organisation’s and a table it does not have', async () => {
      const [table] = await listVenueTables(world.pool, world.tenantId, world.venueId)
      if (!table) throw new Error('no table')
      const stranger = `reveal-${randomUUID()}`
      await world.query('insert into restro.auth_user (id, name, email) values ($1, $2, $3)', [
        stranger,
        'Stranger',
        `${stranger}@example.test`,
      ])
      await world.query(
        "insert into restro.auth_session (id, expires_at, token, user_id) values ($1, now() + interval '1 hour', $2, $3)",
        [`sess-${stranger}`, `tok-${stranger}`, stranger],
      )
      const userId = await addOwner()
      try {
        const keys = { pool: world.pool, privateKey: world.keys.privateKey }
        const base = venue()
        const asStranger = await revealTableCodes(keys, {
          ...base,
          tableIds: [table.id],
          actor: { kind: 'user', userId: stranger, sessionId: `sess-${stranger}` },
        })
        expect(asStranger.status).toBe('refused')
        const foreign = await revealTableCodes(keys, {
          ...base,
          tableIds: [newId('tb')],
          actor: { kind: 'user', userId, sessionId: `sess-${userId}` },
        })
        expect(foreign).toEqual({ status: 'refused', code: 'table_missing' })
      } finally {
        await removeUser(stranger)
        await removeUser(userId)
      }
    })

    it('opens a staff PIN for an owner signed in within 15 minutes, and logs it (#72)', async () => {
      const pepper = 'a-test-pepper-of-at-least-32-characters'
      const userId = await addOwner()
      const actor = { kind: 'user', userId, sessionId: `sess-${userId}` } as const
      const signedInAt = new Date()
      try {
        const { result } = await applyService(
          world.pool,
          { type: 'staff.add', displayName: 'Ana', roleId: 'staff' },
          { ...venue(), origin: 'staff', actor, jobId: `req-${randomUUID()}`, signedInAt },
          { sealPublicKey: world.publicKeyText, pinPepper: pepper },
        )
        if (result.status !== 'accepted') throw new Error(`refused: ${result.code}`)
        const staffMemberId = String(result.details.staffMemberId) as `sm_${string}`
        const keys = { pool: world.pool, privateKey: world.keys.privateKey }
        const request = { ...venue(), staffMemberIds: [staffMemberId], actor }

        const stale = new Date(Date.now() - 20 * 60_000).toISOString()
        expect(await reveal(keys, { ...request, signedInAt: stale })).toEqual({
          status: 'refused',
          code: 'sign_in_again',
        })
        const answer = await reveal(keys, { ...request, signedInAt: signedInAt.toISOString() })
        if (answer.status !== 'accepted') throw new Error(`refused: ${answer.code}`)
        const pin = answer.codes[staffMemberId] ?? ''
        expect(pin).toMatch(/^[0-9]{4}$/)
        const [row] = await world.query<{ pin_hmac: string }>(
          'select pin_hmac from restro.staff_members where id = $1',
          [staffMemberId],
        )
        const hmac = createHmac('sha256', pepper).update(`${world.tenantId}|${pin}`).digest('hex')
        expect(row?.pin_hmac).toBe(hmac)
        const entries = await world.query<{ retention: string; details: unknown }>(
          "select retention, details from restro.log_entries where venue_id = $1 and kind = 'pin.revealed'",
          [world.venueId],
        )
        expect(entries).toHaveLength(1)
        expect(entries[0]?.retention).toBe('record')
        expect(JSON.stringify(entries)).not.toContain(pin)
      } finally {
        await world.query('delete from restro.log_entries where tenant_id = $1', [world.tenantId])
        await world.query('delete from restro.staff_assignments where tenant_id = $1', [
          world.tenantId,
        ])
        await world.query('delete from restro.staff_members where tenant_id = $1', [world.tenantId])
        await world.query('delete from restro.venue_roles where tenant_id = $1', [world.tenantId])
        await removeUser(userId)
      }
    })
  })
})
