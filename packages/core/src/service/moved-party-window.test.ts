// The moved-party read of a closed table (P22; #420, #427) on a real Postgres, as the restro_app
// role: a phone at a table whose last sitting ended with the party moved elsewhere is told where
// the bill stayed, for 60 minutes and never past the end of the venue's service day. The clock is
// injected (`readTableState`'s `now`), so the window's edges do not depend on when the test runs.
// The lookup is served by `sittings_table_id_ended_at_idx`: the plan says so. Skipped without a
// database.
import { withTenant } from '@restro/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { lastEndedSittingQuery, MOVED_AWAY_WINDOW_MS, readTableState } from './read'

/**
 * The venue's service day ends at 07:00 Sofia time (UTC+2 in February). At `NOW` (02:30 on the 10th)
 * the day began at 07:00 on the 9th, 19.5 hours ago; at `MORNING` (07:30 on the 10th) it began half
 * an hour ago, so an end 45 minutes ago is inside the 60 minutes yet before the day.
 */
const NOW = new Date('2026-02-10T00:30:00Z')
const MORNING = new Date('2026-02-10T05:30:00Z')
const MINUTE = 60_000

describe.skipIf(!hasDatabase)('the moved-party window (as the restro_app role)', () => {
  let world: ServiceWorld
  let table: string

  const minutesBefore = (at: Date, minutes: number) => new Date(at.getTime() - minutes * MINUTE)

  /** An ended sitting of the table, ended at `endedAt`, for `reason`. */
  const seedEnded = async (endedAt: Date, reason = 'party_moved', tableId = table) => {
    await world.owner.query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_at, opened_how, ended_at,
          end_reason, source, actor, job_id)
       values ($1, $2, $3, $4, '2026-02-09', $5, 'one', $6, $7, 'staff', 'system', 'test-seed')`,
      [
        newId('st'),
        world.tenantId,
        world.venueId,
        tableId,
        new Date(endedAt.getTime() - 120 * MINUTE),
        endedAt,
        reason,
      ],
    )
  }
  const movedAway = async (now: Date) => {
    const state = await readTableState(world.app, {
      tenantId: world.tenantId,
      tableId: table,
      now,
    })
    return state !== null && 'movedAway' in state && state.movedAway === true
  }

  beforeAll(async () => {
    world = await openServiceWorld('moved-window')
    table = world.tables[0] as string
  })
  afterAll(async () => {
    await world?.close()
  })

  it('says it for a sitting that ended inside the 60 minutes of the same service day', async () => {
    await world.owner.query('delete from restro.sittings where table_id = $1', [table])
    await seedEnded(minutesBefore(NOW, 30))
    expect(await movedAway(NOW)).toBe(true)
  })

  it('says it up to the last minute of the window, and not at the minute it closes', async () => {
    for (const [minutes, expected] of [
      [59, true],
      [60, false],
      [61, false],
    ] as const) {
      await world.owner.query('delete from restro.sittings where table_id = $1', [table])
      await seedEnded(minutesBefore(NOW, minutes))
      expect(await movedAway(NOW), `${minutes} minutes ago`).toBe(expected)
    }
    expect(MOVED_AWAY_WINDOW_MS).toBe(60 * MINUTE)
  })

  it('does not say it for a sitting that ended after the 60 minutes, though the day is the same', async () => {
    await world.owner.query('delete from restro.sittings where table_id = $1', [table])
    // 90 minutes before 02:30, i.e. 01:00 on the same service day (which began at 07:00 on the 9th).
    await seedEnded(minutesBefore(NOW, 90))
    expect(await movedAway(NOW)).toBe(false)
  })

  it('does not say it for a sitting that ended before the service day began, inside the 60 minutes', async () => {
    await world.owner.query('delete from restro.sittings where table_id = $1', [table])
    // 06:45 Sofia on the 10th: 45 minutes before MORNING, but yesterday's service day.
    await seedEnded(minutesBefore(MORNING, 45))
    expect(await movedAway(MORNING)).toBe(false)
    // Read at 06:50, ten minutes before that day ended, the same end is inside the window and the day.
    expect(await movedAway(minutesBefore(MORNING, 40))).toBe(true)
  })

  it('reads the newest end only: a later close for another reason takes the message away', async () => {
    await world.owner.query('delete from restro.sittings where table_id = $1', [table])
    await seedEnded(minutesBefore(NOW, 40))
    await seedEnded(minutesBefore(NOW, 10), 'bill_closed')
    expect(await movedAway(NOW)).toBe(false)
  })

  it('serves the lookup with sittings_table_id_ended_at_idx, with the tenant test as a filter', async () => {
    await world.owner.query('delete from restro.sittings where table_id = $1', [table])
    // Enough ended sittings, across the venue's tables, that a scan is not the cheap plan.
    await world.owner.query(
      `insert into restro.sittings
         (id, tenant_id, venue_id, table_id, service_date, opened_at, opened_how, ended_at,
          end_reason, source, actor, job_id)
       select 'st_' || md5(random()::text || n::text), $1, $2, ($3::text[])[1 + n % 4], '2026-02-09',
              $4::timestamptz - (n || ' minutes')::interval - interval '2 hours', 'one',
              $4::timestamptz - (n || ' minutes')::interval, 'bill_closed', 'staff', 'system', 'test-seed'
         from generate_series(1, 6000) n`,
      [world.tenantId, world.venueId, world.tables, MORNING],
    )
    await world.owner.query('analyze restro.sittings')
    const plan = await withTenant(world.app, world.tenantId, async (tx) => {
      const query = lastEndedSittingQuery(tx, {
        tableId: table,
        after: minutesBefore(NOW, 60),
        notBefore: minutesBefore(NOW, 600),
      })
      const result = await tx.execute<{ 'QUERY PLAN': string }>(sql`explain ${query}`)
      return result.rows.map((row) => row['QUERY PLAN']).join('\n')
    })
    expect(plan).toContain('sittings_table_id_ended_at_idx')
    expect(plan).not.toMatch(/Seq Scan on sittings/)
    // The key is the table and the end: the tenant test is Row Level Security's, applied as a
    // filter on the rows the index returns, so the index needs no `tenant_id` of its own.
    expect(plan).toMatch(/Index Cond: \(\(table_id = /)
    await world.owner.query('delete from restro.sittings where table_id = any($1)', [world.tables])
  })
})
