// Recording a reading of a table's POS bills and the sitting's end by a reading (#74) on a real
// Postgres, as the restro_app role: a complete reading is stored with our ids and names (our
// item's name through its till link: the published menu's, else the POS's own; else "Other
// item"), discount and free lines as the POS gives
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
import { provisionMenu } from '../apply/provision'
import { loadCurrentSnapshot, publishMenu } from '../apply/publish'
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
    // Item 501 is linked to our "Beer" (the till's text with an English override over it, never
    // published); POS item 999 is linked to nothing.
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
    // Nothing is published here: the linked item takes the POS's own name, never the override (#345).
    expect(part?.lines.map((line) => [line.name, line.quantity, line.amountMinor])).toEqual([
      [{ bg_BG: 'Бира Каменица' }, '2', 1000],
      [null, '0.5', 300],
      [null, '1', -400],
      [{ bg_BG: 'Бира Каменица' }, '1', 0],
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

  it('a first reading that is partial shows no bill, ends nothing, and leaves the table due', async () => {
    const tableId = table(0)
    const sittingId = await world.openSitting(tableId)
    expect(await record(tableId, partial)).toEqual({
      recorded: true,
      complete: false,
      ended: false,
    })
    expect((await state(tableId)).bill).toBeNull()
    expect(await sitting(sittingId)).toMatchObject({ ended_at: null })
    // "Never read well": older than the sitting, so the tick and a guest's open read it again.
    const read = await row(tableId)
    expect(read?.complete).toBe(false)
    expect(read?.read_at.getTime()).toBe(0)
    expect(read?.bills).toEqual([])
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

  it('ends the sitting once a payment of it is over and its payment table is free', async () => {
    const tableId = table(0)
    const sittingId = (await state(tableId)).sitting?.id ?? (await world.openSitting(tableId))
    await record(tableId, complete(round))
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, captured_minor, currency, provider_kind, settled_at, source, actor, job_id)
       select $1, $2, $3, $4, $5, service_date, 'on_bill', 'captured', $6, 1000, 1000, 'EUR', 'sim',
              now(), $7, $8, $9
       from restro.sittings where id = $5`,
      [
        newId('py'),
        world.tenantId,
        world.venueId,
        tableId,
        sittingId,
        createHash('sha256').update(randomUUID()).digest('hex'),
        ...SEED,
      ],
    )
    expect(await record(tableId, complete())).toMatchObject({ ended: true })
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

// #345: a bill line is named as the guest's menu names its item, from the published snapshot of
// the table's menu, never by a composer edit that is not published yet. An item the published
// menu does not have is named by the POS's own name (its till text, D75).
describe.skipIf(!hasDatabase)('names on the table bill come from the published menu (#345)', () => {
  let world: ServiceWorld
  let menuId: string
  const integrationId = newId('in')
  const beer = newId('nd')
  const gin = newId('nd')
  const MANAGER = 'user:us_readings_names'

  const changeSet = (source: string, actor: string, ops: unknown[]) =>
    ({
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops,
    }) as unknown as ChangeSet
  const run = async (changes: ChangeSet) => {
    expect((await apply(world.app, world.tenantId, changes)).rejected).toEqual([])
  }
  const rename = (id: string, value: Record<string, string>, basis: Record<string, string>) =>
    run(
      changeSet('manual', MANAGER, [
        {
          op: 'setField',
          node: { id },
          fieldKey: 'name',
          layer: 'override',
          scope: 'master',
          value,
          basis,
        },
      ]),
    )
  const publish = async () => {
    const published = await publishMenu(world.app, world.tenantId, {
      menuId,
      venueId: world.venueId,
      reason: 'manual',
      actor: MANAGER,
    })
    expect(published.status).toBe('published')
  }

  beforeAll(async () => {
    world = await openServiceWorld('readings-names')
    await world.owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host) values ($1, $2, 'sim', '127.0.0.1:9')`,
      [integrationId, world.tenantId],
    )
    const menu = await provisionMenu(world.app, world.tenantId, world.venueId)
    menuId = menu.id
    const section = newId('nd')
    await run(
      changeSet('manual', MANAGER, [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        {
          op: 'setField',
          node: { id: section },
          fieldKey: 'title',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Бар', en_US: 'Bar' },
        },
      ]),
    )
    // POS item 501 is our beer, on the menu; POS item 502 is our gin, linked but on no menu.
    for (const [id, external, name] of [
      [beer, '501', 'Каменица'],
      [gin, '502', 'Джин'],
    ] as const) {
      const record = newId('sr')
      await world.owner.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw, payload)
         values ($1, $2, $3, 'article', $4, 'master', $5, '{}', '{}'::jsonb)`,
        [record, world.tenantId, integrationId, external, sha256Hex(record)],
      )
      const link = { integration: integrationId, externalType: 'article', externalId: external }
      const till = (fieldKey: string, value: unknown, scope = 'master') => ({
        op: 'setField',
        node: { link },
        fieldKey,
        layer: 'till',
        scope,
        value,
        sourceRecordId: record,
        mappingVersion: 1,
      })
      const here = `venue:${world.venueId}`
      await run(
        changeSet(`till:${integrationId}`, `integration:${integrationId}`, [
          { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
          { op: 'linkSource', node: { id }, link },
          till('name', { bg_BG: name }),
          till('price', { amount_minor: 500, currency: 'EUR' }, here),
          till('for_sale', true, here),
          till('visible', true),
          till('allergens', []),
        ]),
      )
    }
    await run(
      changeSet('manual', MANAGER, [
        { op: 'setPlacement', item: { id: beer }, section: { id: section }, sortKey: 'end' },
      ]),
    )
    // The owner's name for the beer, published: what the guest's menu shows.
    await rename(beer, { bg_BG: 'Каменица 500 мл' }, { bg_BG: 'Каменица' })
    await publish()
    await world.owner.query('update restro.venues set live_menu_id = $2 where id = $1', [
      world.venueId,
      menu.id,
    ])
  })

  afterAll(async () => {
    await world?.close()
  })

  const reading = {
    complete: true as const,
    currency: 'EUR',
    bills: [
      {
        pos: 'B1',
        totalMinor: 1000,
        paidMinor: 0,
        openedAt: '2026-11-08T20:00:00.000Z',
        openedByRestro: false,
        paymentInFlight: false,
        lines: [
          ['11', '501', 'Каменица'],
          ['12', '502', 'Джин'],
        ].map(([pos, itemPos, posName]) => ({
          pos,
          itemPos,
          posName,
          quantity: '1',
          amountMinor: 500,
          enteredBy: 'staff',
          enteredAt: null,
          restroRef: null,
        })),
      },
    ],
  }
  const record = async (tableId: string) => {
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
    expect(result.status).toBe('accepted')
  }
  const state = async (tableId: string) => {
    const read = await readTableState(world.app, { tenantId: world.tenantId, tableId })
    if (read === null || read.unchanged) throw new Error('no table state')
    return read
  }
  const names = async (tableId: string) =>
    (await state(tableId)).bill?.bills[0]?.lines.map((line) => line.name)
  const publishedName = async (id: string) => {
    const snapshot = await loadCurrentSnapshot(world.app, world.tenantId, {
      menuId,
      venueId: world.venueId,
    })
    return snapshot?.body?.items[id]?.name
  }

  it('shows the published name, not an unpublished rename, and the new one after Publish', async () => {
    const tableId = world.tables[0] as string
    await world.openSitting(tableId)
    // Renamed in the composer and not published (the gin is on no menu at all).
    await rename(beer, { bg_BG: 'Каменица 0,5 л' }, { bg_BG: 'Каменица' })
    await rename(gin, { bg_BG: 'Джин Бомбай' }, { bg_BG: 'Джин' })

    await record(tableId)
    // The fact the change is safe because of: the published snapshot keys its items by the same
    // id the till link resolves to, so the bill names the beer exactly as the guest's menu does.
    expect(await publishedName(beer)).toEqual({ bg_BG: 'Каменица 500 мл' })
    expect(await names(tableId)).toEqual([await publishedName(beer), { bg_BG: 'Джин' }])
    const before = await state(tableId)

    await publish()
    await record(tableId)
    expect(await publishedName(beer)).toEqual({ bg_BG: 'Каменица 0,5 л' })
    expect(await names(tableId)).toEqual([{ bg_BG: 'Каменица 0,5 л' }, { bg_BG: 'Джин' }])
    // The next reading after a Publish touches the table, so open phones see the new name.
    expect((await state(tableId)).version).toBeGreaterThan(before.version)
  })
})
