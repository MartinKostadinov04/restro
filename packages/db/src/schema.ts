// Drizzle schema for every table Restro owns. All of them live in the Postgres schema `restro`
// (never `public`). Row-level security, the RLS helper and the app role's privileges are not
// expressible here: they live in the SQL migrations (migrations/0001_tenant_rls.sql) and in
// src/table-access.ts, whose header says how to add a table.
import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/** The Postgres schema that holds every Restro table. */
export const restro = pgSchema('restro')

/** A tenant: one customer organisation. Row visible only when it is the current tenant. */
export const tenants = restro.table(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tenants_id_format', sql`${t.id} ~ '^tn_[0-9A-Za-z]+$'`)],
)

/** A venue (one club) of a tenant. Tenant-isolated by row-level security. */
export const venues = restro.table(
  'venues',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** IANA time zone the venue's day and schedules are counted in. */
    timezone: text('timezone').notNull().default('Europe/Sofia'),
    /** Local time at which the venue's service day ends (D45); the night before owns earlier hours. */
    serviceDayEndsAt: time('service_day_ends_at').notNull().default('07:00'),
    currency: text('currency').notNull().default('EUR'),
    defaultLocale: text('default_locale').notNull().default('bg_BG'),
    enabledLocales: text('enabled_locales').array().notNull().default(sql`'{bg_BG,en_US}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `venues_touch_updated_at` trigger, whatever writes the row. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('venues_tenant_id_slug_unique').on(t.tenantId, t.slug),
    check('venues_id_format', sql`${t.id} ~ '^vn_[0-9A-Za-z]+$'`),
    check('venues_default_locale_enabled', sql`${t.defaultLocale} = any(${t.enabledLocales})`),
  ],
)

/**
 * A template version (template as data). `tenant_id` null = a system template every tenant can
 * read. Rows are immutable: the app role has no UPDATE or DELETE on this table.
 */
export const templates = restro.table(
  'templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('templates_owner_key_version_unique').on(
      sql`coalesce(${t.tenantId}, '')`,
      t.key,
      t.version,
    ),
    check('templates_id_format', sql`${t.id} ~ '^tp_[0-9A-Za-z]+$'`),
    check('templates_version_positive', sql`${t.version} >= 1`),
    check('templates_definition_object', sql`jsonb_typeof(${t.definition}) = 'object'`),
  ],
)

/** Liveness of each worker process. System table: no tenant; the app role may upsert. */
export const workerHeartbeats = restro.table('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull().defaultNow(),
  version: text('version').notNull(),
})
