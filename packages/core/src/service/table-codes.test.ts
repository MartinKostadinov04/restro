// The table-code commands (D122 §9; ticket #70) on a real Postgres, as the restro_app role: a
// re-issue writes a new hash and sealed copy, raises the code generation and logs a `record`
// entry; a reveal checks the tables are the venue's and logs one entry. Skipped without a database.
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { issueTableToken } from '../apply/tables'
import { hasDatabase } from '../apply/test-database'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'

const { publicKey } = generateKeyPairSync('x25519')

describe.skipIf(!hasDatabase)('the table-code commands (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let pinStaffId: string

  beforeAll(async () => {
    world = await openServiceWorld('table-codes')
    ownerId = await world.addUser('owner')
    pinStaffId = await world.addStaff(['settings.codes'])
  })

  afterAll(async () => {
    await world?.close()
  })

  const owner = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId: ownerId, sessionId: `sess-${randomUUID()}` },
    jobId: `req-${randomUUID()}`,
  })
  const codeOf = async (tableId: string) => {
    const { rows } = await world.owner.query<{
      qr_token: string | null
      qr_code_hash: string | null
      qr_code_sealed: string | null
      code_generation: number
    }>(
      'select qr_token, qr_code_hash, qr_code_sealed, code_generation from restro.tables where id = $1',
      [tableId],
    )
    return rows[0]
  }
  const logOf = async (kind: string) => {
    const { rows } = await world.owner.query<{
      table_id: string | null
      retention: string
      details: Record<string, unknown>
    }>(
      'select table_id, retention, details from restro.log_entries where venue_id = $1 and kind = $2 order by seq',
      [world.venueId, kind],
    )
    return rows
  }

  it('stores a first code only as its hash and a sealed copy', async () => {
    const tableId = world.tables[0] as string
    const issued = await issueTableToken(world.app, world.tenantId, tableId, publicKey)
    expect(issued).toMatchObject({ ok: true, retired: [] })
    const row = await codeOf(tableId)
    expect(row?.qr_token).toBeNull()
    expect(row?.qr_code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.qr_code_sealed).toMatch(/^rs1\./)
    expect(await issueTableToken(world.app, world.tenantId, tableId, publicKey)).toMatchObject({
      ok: false,
      error: 'has_code',
    })
  })

  it('re-issues a code: a new hash and seal, one more generation, a record Log entry', async () => {
    const tableId = world.tables[0] as string
    const before = await codeOf(tableId)
    const { result } = await applyService(
      world.app,
      { type: 'table_code.reissue', tableId },
      owner(),
      { sealPublicKey: publicKey },
    )
    expect(result).toEqual({
      status: 'accepted',
      actionId: null,
      ref: null,
      details: { retired: before?.qr_code_hash },
    })
    const after = await codeOf(tableId)
    expect(after?.qr_code_hash).not.toBe(before?.qr_code_hash)
    expect(after?.qr_code_sealed).not.toBe(before?.qr_code_sealed)
    expect(after?.qr_token).toBeNull()
    expect(after?.code_generation).toBe((before?.code_generation ?? 0) + 1)
    expect(await logOf('table_code.reissued')).toEqual([
      { table_id: tableId, retention: 'record', details: {} },
    ])
  })

  it('refuses a re-issue of a table without a code, and one by a PIN', async () => {
    const tableId = world.tables[1] as string
    const before = await codeOf(tableId)
    const options = { sealPublicKey: publicKey }
    expect(
      (await applyService(world.app, { type: 'table_code.reissue', tableId }, owner(), options))
        .result,
    ).toMatchObject({ status: 'refused', code: 'no_code' })
    const pin: ServiceContext = {
      ...owner(),
      actor: { kind: 'staff', staffMemberId: pinStaffId, sessionId: 'sess-device' },
    }
    expect(
      (await applyService(world.app, { type: 'table_code.reissue', tableId }, pin, options)).result,
    ).toMatchObject({ status: 'refused', code: 'own_sign_in_required' })
    const after = await codeOf(tableId)
    expect(after?.code_generation).toBe(before?.code_generation)
  })

  it('logs one reveal per call and refuses a table of another venue', async () => {
    const tableIds = world.tables.slice(0, 3) as string[]
    expect(
      (await applyService(world.app, { type: 'table_code.reveal', tableIds }, owner())).result,
    ).toMatchObject({ status: 'accepted', details: { count: 3 } })
    expect(await logOf('table_code.revealed')).toEqual([
      { table_id: null, retention: 'record', details: { count: 3 } },
    ])
    const elsewhere = await openServiceWorld('table-codes-other')
    try {
      const foreign = [...tableIds, elsewhere.tables[0] as string]
      expect(
        (await applyService(world.app, { type: 'table_code.reveal', tableIds: foreign }, owner()))
          .result,
      ).toMatchObject({ status: 'refused', code: 'table_missing' })
    } finally {
      await elsewhere.close()
    }
    expect(await logOf('table_code.revealed')).toHaveLength(1)
  })
})
