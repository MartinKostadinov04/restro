// Recording a reading of a table's POS bills and the sitting's end by a reading (#74) on a real
// Postgres, as the restro_app role: a complete reading is stored with our ids and names (our
// item's name through its till link, else "Other item"), discount and free lines as the POS gives
// them; the ids stay the same at every reading and an identical reading leaves the table's version
// alone; a partial reading keeps the bill shown and concludes nothing (rule 6); a table opened
// before its first item is not ended by its empty bill; the sitting ends when its bill closes
// after it held lines, unless a payment holds a payment table; and nothing backend reaches the
// table's state. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apply } from '../apply/apply'
import { hasDatabase } from '../apply/test-database'
import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { isId, newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { billBackendValues, forbiddenPaths, parseStoredBills } from './bill'
import { applyService, readTableState } from './index'

const KEY = 'readings-test-key-'.padEnd(48, 'x')
const SEED = ['restro', 'system', 'test-seed'] as const

describe.skipIf(!hasDatabase)('readings of the table bill (as the restro_app role)', () => {
  let world: ServiceWorld
  const integrationId = newId('in')
  const beer = newId('nd')

  beforeAll(async () => {
    world = await openServiceWorld('readings')
    await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integrationId}, ${world.tenantId}, 'sim', '127.0.0.1:9')`),
    )
    const record = newId('sr')
    await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${world.tenantId}, ${integrationId}, 'article', '501', 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
    // Item 501 is linked to our "Beer" (the till's text with an English override over it); POS
    // item 999 is linked to nothing.
    const link = { integration: integrationId, externalType: 'article', externalId: '501' }
    const till: ChangeSet = {
      id: newId('cs'),
      source: `till:${integrationId}`,
      jobId: newId('jb'),
      actor: `integration:${integrationId}`,
      observedAt: new Date().toISOString(),
      ops: [
        { op: 'createNode', id: beer, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: beer }, link },
        {
          op: 'setField',
          node: { link },
          fieldKey: 'name',
          layer: 'till',
          scope: 'master',
          value: { bg_BG: 'Бира Каменица' },
          sourceRecordId: record,
          mappingVersion: 1,
        },
      ],
    } as ChangeSet
    expect((await apply(world.app, world.tenantId, till)).rejected).toEqual([])
    const override: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_readings_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'setField',
          node: { id: beer },
          fieldKey: 'name',
          layer: 'override',
          scope: 'master',
          value: { en_US: 'Beer' },
          basis: { bg_BG: 'Бира Каменица' },
        },
      ],
    } as ChangeSet
    expect((await apply(world.app, world.tenantId, override)).rejected).toEqual([])
  })

  afterAll(async () => {
    await world?.close()
  })

  const table = (index: number) => world.tables[index] as `tb_${string}`

  type Line = {
    pos: string
    item: string | null
    name: string | null
    quantity: string
    amountMinor: number
  }
  const posBill = (pos: string, totalMinor: number, lines: Line[]) => ({
    pos,
    totalMinor,
    paidMinor: 0,
    openedAt: '2026-10-26T20:00:00.000Z',
    openedByRestro: false,
    paymentInFlight: false,
    lines: lines.map((line) => ({
      pos: line.pos,
      itemPos: line.item,
      posName: line.name,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
      enteredBy: 'restro',
      enteredAt: null,
      restroRef: `ref-${line.pos}`,
    })),
  })
  const complete = (...bills: ReturnType<typeof posBill>[]) => ({
    complete: true as const,
    currency: 'EUR',
    bills,
  })
  const partial = { complete: false as const, reason: 'page 2 failed' }

  const record = async (tableId: string, reading: unknown) => {
    const { result } = await applyService(
      world.app,
      { type: 'reading.record', tableId, reading } as never,
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'worker',
        actor: { kind: 'integration', integrationId },
        jobId: `table-read-${randomUUID()}`,
      },
      { billIdKey: KEY },
    )
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
    return result.details
  }
  const state = async (tableId: string) => {
    const read = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    if (read === null || read.unchanged) throw new Error('no table state')
    return read
  }
  const row = async (tableId: string) => {
    const { rows } = await world.owner.query<{
      read_seq: string
      read_at: Date
      complete: boolean
      bills: unknown
    }>('select read_seq, read_at, complete, bills from restro.bill_readings where table_id = $1', [
      tableId,
    ])
    return rows[0] ?? null
  }
  const sitting = async (id: string) => {
    const { rows } = await world.owner.query<{
      ended_at: Date | null
      end_reason: string | null
      had_bill_lines: boolean
    }>('select ended_at, end_reason, had_bill_lines from restro.sittings where id = $1', [id])
    return rows[0]
  }
  const endsLogged = async (sittingId: string) => {
    const { rows } = await world.owner.query<{ reason: string | null; actor: string }>(
      `select reason, actor from restro.log_entries where sitting_id = $1 and kind = 'sitting.ended'`,
      [sittingId],
    )
    return rows
  }

  const round = posBill('B1', 900, [
    { pos: '11', item: '501', name: 'Бира Каменица', quantity: '2', amountMinor: 1000 },
    { pos: '12', item: '999', name: 'Мезе', quantity: '0.5', amountMinor: 300 },
    { pos: '13', item: null, name: 'Отстъпка', quantity: '1', amountMinor: -400 },
    { pos: '14', item: '501', name: 'Бира Каменица', quantity: '1', amountMinor: 0 },
  ])

  it('stores nothing for a table with no open sitting', async () => {
    expect(await record(table(0), complete(round))).toEqual({ recorded: false })
    expect(await row(table(0))).toBeNull()
  })

  it('shows the bill with our ids and names, the POS amounts, and nothing backend', async () => {
    const tableId = table(1)
    const sittingId = await world.openSitting(tableId)
    const before = await state(tableId)
    expect(before.bill).toBeNull()

    expect(await record(tableId, complete(round))).toEqual({
      recorded: true,
      complete: true,
      ended: false,
      bills: 1,
      lines: 4,
    })
    expect((await sitting(sittingId))?.had_bill_lines).toBe(true)
    const after = await state(tableId)
    expect(after.version).toBeGreaterThan(before.version)
    const bill = after.bill
    if (bill === null) throw new Error('no bill')
    expect(bill).toMatchObject({ complete: true, currency: 'EUR', totalMinor: 900, owedMinor: 900 })
    const [part] = bill.bills
    expect(isId('rd', part?.id)).toBe(true)
    expect(part?.lines.map((line) => [line.name, line.quantity, line.amountMinor])).toEqual([
      [{ bg_BG: 'Бира Каменица', en_US: 'Beer' }, '2', 1000],
      [null, '0.5', 300],
      [null, '1', -400],
      [{ bg_BG: 'Бира Каменица', en_US: 'Beer' }, '1', 0],
    ])
    expect(part?.lines.every((line) => isId('bn', line.id))).toBe(true)

    // The forbidden-values walk over the whole table state a phone is built from.
    const stored = parseStoredBills((await row(tableId))?.bills)
    expect(stored[0]?.lines[0]?.itemId).toBe(beer)
    const forbidden = billBackendValues(stored)
    for (const value of ['B1', '501', '999', 'Мезе', 'Отстъпка', 'ref-11']) {
      expect(forbidden.has(value), value).toBe(true)
    }
    expect(forbiddenPaths(after, forbidden)).toEqual([])
  })

  it('keeps the ids at every reading and leaves the version alone when nothing changed', async () => {
    const tableId = table(1)
    const first = await state(tableId)
    const ids = (s: typeof first) =>
      s.bill?.bills.flatMap((b) => [b.id, ...b.lines.map((l) => l.id)])
    const seq = Number((await row(tableId))?.read_seq)

    await record(tableId, complete(round))
    const again = await state(tableId)
    expect(again.version).toBe(first.version)
    expect(ids(again)).toEqual(ids(first))
    expect(Number((await row(tableId))?.read_seq)).toBe(seq + 1)
  })

  it('a partial reading keeps the bill and its age, says so once, and ends nothing', async () => {
    const tableId = table(1)
    const good = await row(tableId)
    const before = await state(tableId)

    expect(await record(tableId, partial)).toEqual({
      recorded: true,
      complete: false,
      ended: false,
    })
    const once = await state(tableId)
    expect(once.version).toBeGreaterThan(before.version)
    expect(once.bill).toEqual({ ...before.bill, complete: false })
    const kept = await row(tableId)
    expect(kept?.read_at).toEqual(good?.read_at)
    expect(kept?.bills).toEqual(good?.bills)

    await record(tableId, partial)
    expect((await state(tableId)).version).toBe(once.version)
    expect((await state(tableId)).sitting).toEqual(before.sitting)
  })

  it('does not end a table opened before its first item', async () => {
    const tableId = table(2)
    const sittingId = await world.openSitting(tableId)
    expect(await record(tableId, complete())).toMatchObject({ ended: false, lines: 0 })
    expect(await record(tableId, complete(posBill('B9', 0, [])))).toMatchObject({ ended: false })
    expect(await sitting(sittingId)).toMatchObject({ ended_at: null, had_bill_lines: false })
  })

  it('ends the sitting when its bill closes after it held lines, and clears the reading', async () => {
    const tableId = table(1)
    const sittingId = (await state(tableId)).sitting?.id ?? null
    if (sittingId === null) throw new Error('no sitting')

    // A partial reading that lists no bill is no close (rule 6).
    expect(await record(tableId, partial)).toMatchObject({ ended: false })
    expect(await record(tableId, complete())).toMatchObject({ ended: true })
    expect(await sitting(sittingId)).toMatchObject({ end_reason: 'bill_closed' })
    expect(await endsLogged(sittingId)).toEqual([
      { reason: 'bill_closed', actor: `integration:${integrationId}` },
    ])
    expect((await row(tableId))?.bills).toEqual([])
    const after = await state(tableId)
    expect(after.sitting).toBeNull()
    expect(after.bill).toBeNull()

    // A new sitting does not show the old reading.
    await world.openSitting(tableId)
    expect((await state(tableId)).bill).toBeNull()
  })

  it('does not end while the table lines sit on a payment table (part 2)', async () => {
    const tableId = table(2)
    const sittingId = (await state(tableId)).sitting?.id ?? null
    if (sittingId === null) throw new Error('no sitting')
    await record(tableId, complete(round))
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          currency, provider_kind, payment_table_id, source, actor, job_id)
       select $1, $2, $3, $4, $5, service_date, 'on_bill', 'queued', $6, 'EUR', 'sim', $7, $8, $9, $10
       from restro.sittings where id = $5`,
      [
        newId('py'),
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        createHash('sha256').update(randomUUID()).digest('hex'),
        table(3),
        ...SEED,
      ],
    )
    expect(await record(tableId, complete())).toMatchObject({ ended: false })
    expect(await sitting(sittingId)).toMatchObject({ ended_at: null })
  })
})
