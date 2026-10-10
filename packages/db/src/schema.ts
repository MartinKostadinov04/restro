// Drizzle schema for every table Restro owns. All of them live in the Postgres schema `restro`
// (never `public`). Row-level security, the RLS helper and the app role's privileges are not
// expressible here: they live in the SQL migrations (migrations/0001_tenant_rls.sql) and in
// src/table-access.ts, whose header says how to add a table.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
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

// --- Authentication (Better Auth) -------------------------------------------------------------
// Better Auth's tables, in schema `restro` with an `auth_` prefix. They are not tenant-scoped
// (a person signs in before any tenant is known) and carry no `tenant_id`: table-access.ts
// declares them `system`, so the app role can read and write them without a tenant set. The
// organisation id IS the tenant id (`tn_…`, check below); apps/web builds Better Auth over these
// objects with its own pool on the app role. Column names follow Better Auth's fields (core
// tables plus the `organization` plugin); do not rename them casually.

/** A person who can sign in to the venue admin. */
export const authUser = restro.table('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique('auth_user_email_unique'),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A sign-in session; `activeOrganizationId` is the tenant the person is working in. */
export const authSession = restro.table(
  'auth_session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique('auth_session_token_unique'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (t) => [index('auth_session_user_id_idx').on(t.userId)],
)

/** A way to sign in (for us: the email + password pair). `password` is a scrypt hash. */
export const authAccount = restro.table(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_account_user_id_idx').on(t.userId)],
)

/** Single-use tokens (email verification, password reset). Nothing writes here yet. */
export const authVerification = restro.table(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
)

/**
 * A customer organisation: the same thing as a tenant. Its id is the tenant id (`tn_…`), made by
 * `newId('tn')`, and `provisionTenant` (core/apply) creates the matching `tenants` row when the
 * organisation is created. There is deliberately no foreign key to `tenants`: that table is
 * tenant-scoped (row-level security), this one is not.
 */
export const authOrganization = restro.table(
  'auth_organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('auth_organization_slug_unique'),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('auth_organization_id_is_tenant_id', sql`${t.id} ~ '^tn_[0-9A-Za-z]+$'`)],
)

/** A user's membership of an organisation, with a role (owner, admin, member). */
export const authMember = restro.table(
  'auth_member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => authOrganization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_member_organization_id_idx').on(t.organizationId),
    index('auth_member_user_id_idx').on(t.userId),
    unique('auth_member_organization_id_user_id_unique').on(t.organizationId, t.userId),
  ],
)

/** An invitation to join an organisation (the admin is invite-only; the UI comes later). */
export const authInvitation = restro.table(
  'auth_invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => authOrganization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('auth_invitation_organization_id_idx').on(t.organizationId),
    index('auth_invitation_email_idx').on(t.email),
  ],
)
