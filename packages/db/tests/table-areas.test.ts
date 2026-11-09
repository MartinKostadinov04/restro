// D103's no-foreign-key rule, made real (ticket #342; task T85, part four). As D103 stands
// corrected on 11-09 (Martin), the rule covers GUEST EVENTS only: no table of the events area holds
// a foreign key into the core, so guest events can move to an edge ingest without touching the
// menu engine. Money is deliberately outside it: `payments` and its siblings keep their foreign
// keys into venues, tables, sittings, bars and sent orders, and this file asserts nothing about
// them beyond naming them as the proof that the catalogue query sees real keys.
//
// It reads the live catalogue after `pnpm db:migrate` (not a hand-kept list of keys), so a table
// created tomorrow is covered the day it exists. Which table belongs to which area is the one list
// in src/table-areas.ts, the same one a later schema split reads.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { APP_SCHEMA, TABLE_ACCESS } from '../src/table-access'
import { TABLE_AREAS, type TableArea, tablesInArea } from '../src/table-areas'
import { hasDatabase, openOwnerPool } from './database'

interface ForeignKey {
  /** `schema.table` that holds the key. */
  readonly from: string
  /** `schema.table` it points at. */
  readonly to: string
  readonly constraint: string
}

const FOREIGN_KEYS_SQL = `
  select cn.nspname || '.' || c.relname as "from",
         pn.nspname || '.' || p.relname as "to",
         k.conname as "constraint"
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace cn on cn.oid = c.relnamespace
  join pg_class p on p.oid = k.confrelid
  join pg_namespace pn on pn.oid = p.relnamespace
  where k.contype = 'f'
  order by 1, 2, 3`

const areaOfName = (qualified: string): TableArea | undefined => {
  const [schema, name] = qualified.split('.')
  return schema === APP_SCHEMA ? (TABLE_AREAS as Record<string, TableArea>)[name ?? ''] : undefined
}

/** Foreign keys held by a table of `from` that point at a table of `to`, as readable lines. */
function crossing(keys: readonly ForeignKey[], from: TableArea, to: TableArea): string[] {
  return keys
    .filter((key) => areaOfName(key.from) === from && areaOfName(key.to) === to)
    .map((key) => `${key.from} -> ${key.to} (${key.constraint})`)
}

describe('the table areas list', () => {
  const areas: Record<string, TableArea> = TABLE_AREAS

  it('gives every table of the access list an area, and names no table that is not there', () => {
    expect(Object.keys(areas).sort()).toEqual(Object.keys(TABLE_ACCESS).sort())
  })

  it('puts guest events in the events area and the provenance log, which shares a name, in core', () => {
    expect(tablesInArea('events')).toEqual(['guest_events'])
    expect(areas.events).toBe('core')
  })

  it('puts the paying tables in money (D127), where the rule does not reach them', () => {
    expect(tablesInArea('money')).toEqual([
      'payment_accounts',
      'payment_lines',
      'payment_refunds',
      'payment_steps',
      'payments',
      'provider_notices',
    ])
  })
})

describe('the crossing finder', () => {
  const keys: ForeignKey[] = [
    { from: 'restro.guest_events', to: 'restro.venues', constraint: 'fk_a' },
    { from: 'restro.guest_events', to: 'restro.guest_events', constraint: 'fk_self' },
    { from: 'restro.payments', to: 'restro.venues', constraint: 'fk_b' },
    { from: 'restro.venues', to: 'restro.tenants', constraint: 'fk_c' },
  ]

  it('reports an events table pointing into the core and nothing else', () => {
    expect(crossing(keys, 'events', 'core')).toEqual([
      'restro.guest_events -> restro.venues (fk_a)',
    ])
  })

  it('leaves money alone (the rule is scoped to guest events, Martin 11-09)', () => {
    expect(crossing(keys, 'money', 'core')).toEqual(['restro.payments -> restro.venues (fk_b)'])
  })
})

describe.skipIf(!hasDatabase)('foreign keys of the events area, in the live catalogue', () => {
  let owner: pg.Pool
  let keys: ForeignKey[]
  let tableNames: string[]

  beforeAll(async () => {
    owner = await openOwnerPool()
    keys = (await owner.query<ForeignKey>(FOREIGN_KEYS_SQL)).rows
    tableNames = (
      await owner.query<{ name: string }>(
        `select c.relname as name from pg_class c
         where c.relnamespace = $1::regnamespace and c.relkind in ('r', 'p', 'f') order by 1`,
        [APP_SCHEMA],
      )
    ).rows.map((row) => row.name)
  })

  afterAll(async () => {
    await owner?.end()
  })

  it('has an area for every table in the database, so a new table cannot dodge the rule', () => {
    const unplaced = tableNames.filter((name) => !(name in TABLE_AREAS))
    expect(unplaced, 'add them to src/table-areas.ts').toEqual([])
    const missing = Object.keys(TABLE_AREAS).filter((name) => !tableNames.includes(name))
    expect(missing, 'listed but not in the database').toEqual([])
  })

  it('reads real keys (the query sees the catalogue; money keeps its keys into the core)', () => {
    expect(keys.length).toBeGreaterThan(50)
    expect(crossing(keys, 'money', 'core').length).toBeGreaterThanOrEqual(6)
    expect(keys.some((key) => key.from === 'restro.payments' && key.to === 'restro.venues')).toBe(
      true,
    )
  })

  it('holds no foreign key from a table of the events area into a core table (D103)', () => {
    expect(crossing(keys, 'events', 'core')).toEqual([])
  })

  it('holds no foreign key from the events area to any other area either', () => {
    // The rule names the core; a key into auth or jobs would tie guest events down just as much.
    const away = keys
      .filter((key) => areaOfName(key.from) === 'events' && areaOfName(key.to) !== 'events')
      .map((key) => `${key.from} -> ${key.to} (${key.constraint})`)
    expect(away).toEqual([])
  })

  it('holds no foreign key from the core into the events area (the other direction)', () => {
    expect(crossing(keys, 'core', 'events')).toEqual([])
  })

  it('would see an events table that did point into the core (the query catches a breach)', async () => {
    const client = await owner.connect()
    try {
      await client.query('begin')
      await client.query(
        `create table ${APP_SCHEMA}.zz_probe_events (venue_id text references ${APP_SCHEMA}.venues (id))`,
      )
      const probe = (await client.query<ForeignKey>(FOREIGN_KEYS_SQL)).rows
      const found = probe.filter((key) => key.from === `${APP_SCHEMA}.zz_probe_events`)
      expect(found.map((key) => key.to)).toEqual([`${APP_SCHEMA}.venues`])
      // Placed in the events area, the finder reports it.
      const placed = (name: string) =>
        name === 'zz_probe_events' ? 'events' : TABLE_AREAS[name as keyof typeof TABLE_AREAS]
      expect(
        probe.filter(
          (key) =>
            placed(key.from.split('.')[1] ?? '') === 'events' &&
            placed(key.to.split('.')[1] ?? '') === 'core',
        ).length,
      ).toBe(1)
    } finally {
      await client.query('rollback')
      client.release()
    }
  })
})
