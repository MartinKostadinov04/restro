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
// - The list is typed over `TABLE_ACCESS`, so a table added there without an area here is a
//   compile error, and the test fails on a table in the database that is in neither.
//
// Adding a table: put it in `TABLE_ACCESS` (see table-access.ts) and give it its area here. A table
// of guest-event analytics (D103, T84) belongs to `events` and must not reference a core table:
// ids of core rows are plain text, validated by a CHECK, as `guest_events` does (migration 0045).
// The reservation tables (#323) are not here yet: they join `bookings`' own area when they land.
//
// This file must stay free of runtime imports, like table-access.ts.
import type { RestroTableName } from './table-access'

/** The areas D103 names for the later schema split. */
export type TableArea = 'core' | 'events' | 'money' | 'auth' | 'jobs'

/**
 * Every table in schema `restro` and the area it belongs to. Note the name clash: the table
 * `events` is the append-only provenance log of every change (rule 2), so it is **core**; the
 * guest events of D103 are `guest_events`.
 */
export const TABLE_AREAS = {
  // --- core: venues, menus and documents, publishing, tables and service -------------------
  tenants: 'core',
  venues: 'core',
  templates: 'core',
  integrations: 'core',
  barsy_venues: 'core',
  menus: 'core',
  nodes: 'core',
  placements: 'core',
  field_values: 'core',
  source_records: 'core',
  source_links: 'core',
  events: 'core',
  // The record of each sync/resolve/publish run, with FKs into integrations; it is purged with
  // the venue's data. Whether it moves to `jobs` with the queue is a call for the split itself.
  job_runs: 'core',
  places: 'core',
  assets: 'core',
  areas: 'core',
  tables: 'core',
  menu_routes: 'core',
  venue_slug_history: 'core',
  organization_slug_history: 'core',
  snapshots: 'core',
  publish_pointers: 'core',
  item_first_published: 'core',
  tags: 'core',
  tombstones: 'core',
  purge_log: 'core',
  bars: 'core',
  sittings: 'core',
  table_orders: 'core',
  sent_orders: 'core',
  sent_order_notes: 'core',
  locks: 'core',
  bill_readings: 'core',
  log_entries: 'core',
  waiter_calls: 'core',
  alerts: 'core',
  pauses: 'core',
  service_days: 'core',
  staff_members: 'core',
  venue_roles: 'core',
  staff_assignments: 'core',
  shared_devices: 'core',
  push_subscriptions: 'core',

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
} as const satisfies Record<RestroTableName, TableArea>

/** The names of the tables in an area, sorted. */
export function tablesInArea(area: TableArea): string[] {
  return Object.entries(TABLE_AREAS as Record<string, TableArea>)
    .filter(([, value]) => value === area)
    .map(([name]) => name)
    .sort()
}
