// Which area of the product each table belongs to, in one list (D103; ticket #342, task T85).
//
// D103 prepares the database to be split into separate Postgres schemas (core, auth, jobs, guest
// events, money, bookings) so a workload can move to its own instance. The one rule that makes a
// move possible, as D103 stands corrected on 11-09: **no foreign key from the events area into the
// core**, so guest events can move to an edge ingest without touching the menu engine.
//
// - The rule covers guest events only (Martin, 11-09). Money is NOT bound by it: `payments` and its
//   siblings hold foreign keys into core tables (venues, tables, sittings, bars, sent_orders) on
//   purpose, because the database refusing a payment that points at nothing is protection the
//   service relies on. Do not "fix" them; tests/table-areas.test.ts asserts nothing about money.
// - This list, tests/table-areas.test.ts and any later schema split read the same definition.
// - Core is the default: a table in `TABLE_ACCESS` that is not named below is core. So a new table
//   of the events area MUST be named below the day it is created, or the foreign-key test never
//   looks at it; the naming test in tests/table-areas.test.ts catches the obvious forgetting.
//
// Adding a table: put it in `TABLE_ACCESS` (see table-access.ts); if it is not core, name it below.
// A table of guest-event analytics (D103, T84) belongs to `events` and must not reference a core
// table: ids of core rows are plain text, validated by a CHECK, as `guest_events` does (migration
// 0045). The reservation tables (#323) are not here yet: they join `bookings`' own area when they
// land.
import { type RestroTableName, TABLE_ACCESS } from './table-access'

/** The areas D103 names for the later schema split. */
export type TableArea = 'core' | 'events' | 'money' | 'auth' | 'jobs'

/**
 * The tables that are NOT core, by area. Core is everything else in `TABLE_ACCESS`: the venues,
 * menus and documents, publishing, tables and service, the connector's records and the purge
 * records. (Core is the default so that this file names no connector's table: the vendor-words
 * guardrail, D67, keeps vendor names out of `packages/db/src`.)
 *
 * Note the name clash: the table `events` is the append-only provenance log of every change
 * (rule 2), so it is **core**; the guest events of D103 are `guest_events`. `job_runs`, the record
 * of each sync/resolve/publish run with foreign keys into the integrations, is core too; whether
 * it moves to `jobs` with the queue is a call for the split itself.
 */
export const NON_CORE_TABLE_AREAS = {
  // --- events: guest events (D103; T84). No foreign key into the core, ever. ----------------
  guest_events: 'events',

  // --- money: payments (D125, D126). Foreign keys into the core are allowed (see above). -----
  payments: 'money',
  payment_lines: 'money',
  payment_steps: 'money',
  payment_refunds: 'money',
  payment_accounts: 'money',
  provider_notices: 'money',

  // --- auth: Better Auth's tables and Restro's own admin team ---------------------------------
  operators: 'auth',
  auth_user: 'auth',
  auth_session: 'auth',
  auth_account: 'auth',
  auth_verification: 'auth',
  auth_organization: 'auth',
  auth_member: 'auth',
  auth_invitation: 'auth',

  // --- jobs: the worker's own bookkeeping (the pg-boss queue itself lives in schema `pgboss`) --
  worker_heartbeats: 'jobs',
} as const satisfies Partial<Record<RestroTableName, Exclude<TableArea, 'core'>>>

/**
 * Every table in schema `restro` and the area it belongs to: the non-core ones above, and core
 * for the rest. A table added to `TABLE_ACCESS` is core until it is named above.
 */
export const TABLE_AREAS: Readonly<Record<RestroTableName, TableArea>> = Object.fromEntries(
  (Object.keys(TABLE_ACCESS) as RestroTableName[]).map((name) => [
    name,
    (NON_CORE_TABLE_AREAS as Partial<Record<string, TableArea>>)[name] ?? 'core',
  ]),
) as Record<RestroTableName, TableArea>

/** The names of the tables in an area, sorted. */
export function tablesInArea(area: TableArea): string[] {
  return Object.entries(TABLE_AREAS)
    .filter(([, value]) => value === area)
    .map(([name]) => name)
    .sort()
}
