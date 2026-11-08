// The guest events write path (D142; #335) on a real Postgres, as the restro_app role: every event
// lands with the venue, the service day, the table and the moment on it, with its provenance and
// its retention class; a batch is one statement; one venue's events are invisible to another
// tenant; the app role may add and read them and nothing else; and the table itself refuses a kind,
// an id or an amount the model would never make. Skipped without a database.
import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { GUEST_EVENT_BATCH_MAX, type GuestEventInput } from './kinds'
import { type GuestEventScope, recordEvents } from './record'

const DAY = '2026-11-07'

interface Row {
  readonly kind: string
  readonly venue_id: string
  readonly table_id: string
  readonly sitting_id: string | null
  readonly node_id: string | null
  readonly amount_minor: string | null
  readonly currency: string | null
  readonly locale: string | null
  readonly outcome: string | null
  readonly retention: string
  readonly source: string
  readonly actor: string
  readonly job_id: string
  readonly service_date: string
  readonly at: Date
}

describe.skipIf(!hasDatabase)('recordEvents (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let sittingId: string

  function scope(over: Partial<GuestEventScope> = {}): GuestEventScope {
    return {
      tenantId: world.tenantId,
      venueId: world.venueId,
      tableId,
      serviceDate: DAY,
      sittingId,
      source: 'guest',
      actor: 'guest',
      jobId: 'guest-events-test',
      ...over,
    }
  }

  async function record(
    events: readonly GuestEventInput[],
    over: Partial<GuestEventScope> = {},
  ): Promise<readonly number[]> {
    return withTenantWrite(world.app, world.tenantId, (tx) => recordEvents(tx, scope(over), events))
  }

  /**
   * The message a refusal from Postgres carries. Drizzle wraps it ("Failed query: …") and keeps
   * the database's own words as the cause, so a posture test must read both.
   */
  async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
      return 'the database allowed it'
    } catch (error) {
      return `${String(error)} ${String((error as { cause?: unknown }).cause ?? '')}`
    }
  }

  /** Every event of the world's venue, oldest first. */
  async function rows(): Promise<readonly Row[]> {
    const read = await withTenantWrite(world.app, world.tenantId, (tx) =>
      tx.execute(
        sql`select * from restro.guest_events where venue_id = ${world.venueId} order by seq`,
      ),
    )
    return read.rows as unknown as readonly Row[]
  }

  beforeAll(async () => {
    world = await openServiceWorld('guest-events')
    tableId = world.tables[0] as string
    sittingId = await world.openSitting(tableId, DAY)
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    await world.owner.query('delete from restro.guest_events where venue_id = $1', [world.venueId])
  })

  it('writes one row per event, with the venue, the day, the table and the moment', async () => {
    const before = new Date()
    const seqs = await record([{ kind: 'menu.opened' }, { kind: 'order.line_added' }])
    expect(seqs).toHaveLength(2)
    expect(seqs[1]).toBeGreaterThan(seqs[0] as number)
    const written = await rows()
    expect(written.map((row) => row.kind)).toEqual(['menu.opened', 'order.line_added'])
    for (const row of written) {
      expect(row.venue_id).toBe(world.venueId)
      expect(row.table_id).toBe(tableId)
      expect(row.sitting_id).toBe(sittingId)
      expect(row.service_date).toBe(DAY)
      expect(row.retention).toBe('night')
      // Provenance, NOT NULL on every row (rule 2); service data carries no layer (D122 §9).
      expect(row.source).toBe('guest')
      expect(row.actor).toBe('guest')
      expect(row.job_id).toBe('guest-events-test')
      expect(new Date(row.at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      // Nothing the kind did not ask for.
      expect(row.node_id).toBeNull()
      expect(row.amount_minor).toBeNull()
      expect(row.currency).toBeNull()
      expect(row.locale).toBeNull()
      expect(row.outcome).toBeNull()
    }
  })

  it('keeps each kind to its own fields', async () => {
    const itemId = newId('nd')
    await record([
      { kind: 'item.opened', itemId },
      { kind: 'language.chosen', locale: 'en_US' },
      { kind: 'order.send_attempted', outcome: 'pos_unreachable' },
      { kind: 'pay.finished', outcome: 'ok', amount: { amount_minor: 1750, currency: 'EUR' } },
    ])
    const written = await rows()
    expect(written[0]).toMatchObject({ kind: 'item.opened', node_id: itemId, locale: null })
    expect(written[1]).toMatchObject({ kind: 'language.chosen', locale: 'en_US', node_id: null })
    expect(written[2]).toMatchObject({ kind: 'order.send_attempted', outcome: 'pos_unreachable' })
    expect(written[3]).toMatchObject({
      kind: 'pay.finished',
      outcome: 'ok',
      amount_minor: '1750',
      currency: 'EUR',
    })
  })

  it('takes the moment a phone reports, and the clock when it reports none', async () => {
    const at = new Date('2026-11-07T22:15:00.000Z')
    await record([{ kind: 'menu.opened', at }, { kind: 'menu.opened' }])
    const written = await rows()
    expect(new Date((written[0] as Row).at).toISOString()).toBe(at.toISOString())
    expect(new Date((written[1] as Row).at).getTime()).toBeGreaterThan(at.getTime())
  })

  it('records without a sitting (a table nobody has opened)', async () => {
    await record([{ kind: 'menu.opened' }], { sittingId: null })
    expect((await rows())[0]?.sitting_id).toBeNull()
  })

  it('refuses an unknown kind and an oversized batch, writing nothing', async () => {
    await expect(record([{ kind: 'menu.closed' } as never])).rejects.toThrow()
    await expect(
      record(Array.from({ length: GUEST_EVENT_BATCH_MAX + 1 }, () => ({ kind: 'menu.opened' }))),
    ).rejects.toThrow()
    // Nothing to record is not a mistake: a handler that measured nothing asks the database
    // nothing and is not made to fail for it.
    expect(await record([])).toEqual([])
    // A scope that names no table, or a table of another kind, is refused the same way.
    await expect(record([{ kind: 'menu.opened' }], { tableId: 'nd_not_a_table' })).rejects.toThrow()
    expect(await rows()).toEqual([])
  })

  it('writes a batch at the cap in one statement', async () => {
    const seqs = await record(
      Array.from({ length: GUEST_EVENT_BATCH_MAX }, () => ({ kind: 'menu.opened' as const })),
    )
    expect(seqs).toHaveLength(GUEST_EVENT_BATCH_MAX)
    // One insert: the sequence has no gap across the batch.
    expect((seqs.at(-1) as number) - (seqs[0] as number)).toBe(GUEST_EVENT_BATCH_MAX - 1)
  })

  it('hides one venue’s events from another tenant (row security)', async () => {
    await record([{ kind: 'menu.opened' }])
    expect(await rows()).toHaveLength(1)
    const other = newId('tn')
    const seen = await withTenantWrite(world.app, other, (tx) =>
      tx.execute(sql`select count(*)::int as n from restro.guest_events`),
    )
    expect((seen.rows[0] as { n: number }).n).toBe(0)
    // And an event cannot be written into another tenant's name either.
    await expect(record([{ kind: 'menu.opened' }], { tenantId: other })).rejects.toThrow()
  })

  it('lets the app role add and read, and nothing else', async () => {
    await record([{ kind: 'menu.opened' }])
    expect(
      await refusal(
        withTenantWrite(world.app, world.tenantId, (tx) =>
          tx.execute(sql`delete from restro.guest_events where venue_id = ${world.venueId}`),
        ),
      ),
    ).toMatch(/permission denied/)
    expect(
      await refusal(
        withTenantWrite(world.app, world.tenantId, (tx) =>
          tx.execute(sql`update restro.guest_events set kind = 'menu.opened'`),
        ),
      ),
    ).toMatch(/permission denied/)
    expect(await rows()).toHaveLength(1)
  })

  it('refuses in the database what the model would never make', async () => {
    const run = (columns: string, values: string) =>
      withTenantWrite(world.app, world.tenantId, (tx) =>
        tx.execute(
          sql.raw(
            `insert into restro.guest_events (tenant_id, venue_id, service_date, ${columns})
             values ('${world.tenantId}', '${world.venueId}', '${DAY}', ${values})`,
          ),
        ),
      )
    const ok = `'${tableId}', 'night', 'guest', 'guest', 'jb'`
    const columns = 'kind, table_id, retention, source, actor, job_id'
    // The shape of a kind is checked, not the list: a name of ours is taken, nonsense is not.
    await expect(run(columns, `'menu.opened', ${ok}`)).resolves.toBeDefined()
    await expect(run(columns, `'Nonsense!', ${ok}`)).rejects.toThrow()
    // A table id of another kind, and an amount without its currency.
    await expect(
      run(columns, `'menu.opened', 'nd_1234567890123456789012', 'night', 'guest', 'guest', 'jb'`),
    ).rejects.toThrow()
    await expect(
      run(
        `${columns}, amount_minor`,
        `'pay.started', '${tableId}', 'night', 'guest', 'guest', 'jb', 500`,
      ),
    ).rejects.toThrow()
    // A retention class we do not keep, and provenance left out (rule 2).
    await expect(
      run(columns, `'menu.opened', '${tableId}', 'forever', 'guest', 'guest', 'jb'`),
    ).rejects.toThrow()
    await expect(
      run(
        'kind, table_id, retention, source, actor',
        `'menu.opened', '${tableId}', 'night', 'guest', 'guest'`,
      ),
    ).rejects.toThrow()
    expect(await rows()).toHaveLength(1)
  })
})
