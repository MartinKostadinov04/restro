// Drizzle schema for every table Restro owns. All of them live in the Postgres schema `restro`
// (never `public`). Row-level security, the RLS helper and the app role's privileges are not
// expressible here: they live in the SQL migrations (migrations/0001_tenant_rls.sql) and in
// src/table-access.ts, whose header says how to add a table.
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
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
    /**
     * Organisation-wide settings that are not columns of their own (adjustments I1, D81).
     * `systems`: the POS systems the organisation chose in Settings › Integrations, as connector
     * kinds (`integrations.kind`); an instance can only be added for a chosen system, and a
     * system with instances cannot be unchosen. core/apply validates and writes it.
     */
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_id_format', sql`${t.id} ~ '^tn_[0-9A-Za-z]+$'`),
    check('tenants_settings_object', sql`jsonb_typeof(${t.settings}) = 'object'`),
  ],
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
    /**
     * The readable part of the public menu address (`/m/<slug>-<public_id>`, D68). Cosmetic and
     * editable: it is not unique, and a stale one still finds the menu. The format is checked in
     * core (`isVenueSlug`) before every write.
     */
    slug: text('slug').notNull(),
    /**
     * The random code that finds the venue's menu (`/m/<slug>-<public_id>`, `v/<public_id>.json`,
     * D68): 12 characters of `a-z0-9` from `crypto` (core `newPublicId`), set when the venue is
     * created and never changed. Never derived from `id` (rule 3).
     */
    publicId: text('public_id').notNull(),
    /** IANA time zone the venue's day and schedules are counted in. */
    timezone: text('timezone').notNull().default('Europe/Sofia'),
    /** Local time at which the venue's service day ends (D45); the night before owns earlier hours. */
    serviceDayEndsAt: time('service_day_ends_at').notNull().default('07:00'),
    currency: text('currency').notNull().default('EUR'),
    defaultLocale: text('default_locale').notNull().default('bg_BG'),
    enabledLocales: text('enabled_locales').array().notNull().default(sql`'{bg_BG,en_US}'::text[]`),
    /**
     * Venue settings that are not columns of their own (S3-03). `design` is the venue's design
     * record (D129, core's `DesignRecordSchema`): the look of the guest menu, written only by
     * core's `apply()` (`setDesign`); the publisher turns it into the snapshot's theme and
     * `design` block. It replaced `theme` and `presentation` (migration 0045).
     */
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `venues_touch_updated_at` trigger, whatever writes the row. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the venue was deleted (D76, brief CF-18); null = live. Deleting a venue only archives
     * it: the row, its menu, tables and settings stay (history is append-only, rule 2) and the app
     * role has no DELETE on this table. Core's `archiveVenue` / `restoreVenue` are the only
     * writers; every other writer of one venue calls `lockLiveVenue` first, and every admin read
     * and worker job leaves archived venues out. The public code and the QR tokens stay, so a
     * restore brings the same addresses back.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * The venue's live menu (D88, D90; migration 0019): the one guests see at the venue's address
     * and wherever no area or table route says otherwise (`menu_routes`). Null only while the
     * venue is being created, before its first menu exists. Core's menu writers set it; the
     * foreign key makes it a menu of this very venue, and purging that menu clears it (in the
     * database the key says `ON DELETE SET NULL (live_menu_id)`, a column list this builder
     * cannot express; migration 0019 writes it by hand).
     */
    liveMenuId: text('live_menu_id'),
    /**
     * Set by Unpublish (D86): the guest files were withdrawn and the venue shows as Draft until
     * the next publish clears it. Null = nothing withdrawn.
     */
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
  },
  (t) => [
    // The public code is the venue's global address (D68, replacing the unique slug of T61): unique
    // across all tenants. Row-level security hides other tenants' rows, which is why only the index
    // can tell that a drawn code is taken (`provisionVenue` draws again).
    uniqueIndex('venues_public_id_unique').on(t.publicId),
    check('venues_public_id_format', sql`${t.publicId} ~ '^[a-z0-9]{12}$'`),
    check('venues_settings_object', sql`jsonb_typeof(${t.settings}) = 'object'`),
    // Target of the composite foreign keys (tenant_id, venue_id) of the document tables.
    unique('venues_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'venues_live_menu_fk',
      columns: [t.tenantId, t.id, t.liveMenuId],
      foreignColumns: liveMenuTarget(),
    }).onDelete('set null'),
    check('venues_id_format', sql`${t.id} ~ '^vn_[0-9A-Za-z]+$'`),
    check('venues_default_locale_enabled', sql`${t.defaultLocale} = any(${t.enabledLocales})`),
    // The address name is unique within the organisation (D84, migration 0022): the guest address
    // is `/m/<organisation>/<venue>`. A venue in the bin keeps its name; a purged one frees it.
    unique('venues_tenant_id_slug_unique').on(t.tenantId, t.slug),
  ],
)

/**
 * The columns `venues_live_menu_fk` points at: `(tenant_id, venue_id, id)` of `menus`. A function
 * with a declared return type, because `venues` and `menus` reference each other (menus belong
 * to a venue; a venue names its live menu): TypeScript cannot infer two constants from each
 * other, while Drizzle only calls the table's config callback later, once both exist.
 */
function liveMenuTarget(): [AnyPgColumn, AnyPgColumn, AnyPgColumn] {
  return [menus.tenantId, menus.venueId, menus.id]
}

/**
 * A venue's earlier address names (D84): an old name keeps redirecting to the venue and stays
 * reserved in the organisation until the venue is purged (then the purge job deletes these rows).
 * Written by core's address writer when a venue is renamed.
 */
export const venueSlugHistory = restro.table(
  'venue_slug_history',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    slug: text('slug').notNull(),
    replacedAt: timestamp('replaced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'venue_slug_history_pkey', columns: [t.tenantId, t.slug] }),
    foreignKey({
      name: 'venue_slug_history_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    index('venue_slug_history_venue_id_idx').on(t.venueId),
    check(
      'venue_slug_history_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 63`,
    ),
  ],
)

/**
 * Organisations' earlier address names (D84): the organisation part of a guest address is
 * `auth_organization.slug`, unique platform-wide, so its old names are reserved platform-wide
 * too. A system table like `auth_organization` (no tenant scope: every organisation's history
 * must be checked when a slug is chosen). Written by the organisation's address action.
 */
export const organizationSlugHistory = restro.table(
  'organization_slug_history',
  {
    slug: text('slug').primaryKey(),
    organizationId: text('organization_id').notNull(),
    replacedAt: timestamp('replaced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('organization_slug_history_organization_id_idx').on(t.organizationId),
    check(
      'organization_slug_history_organization_id',
      sql`${t.organizationId} ~ '^tn_[0-9A-Za-z]+$'`,
    ),
    check(
      'organization_slug_history_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 63`,
    ),
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

// --- The purge (D83; adjustments V1) --------------------------------------------------------------
// A deleted venue is purged after 30 days (or at once), by the worker's purge job through its own
// database role, the only one with DELETE on venue data (src/table-access.ts). What it erases is
// gone; what it must never give back is kept here.

/**
 * Codes that must never be reissued (D83): the public codes and table tokens of purged venues.
 * A system table (no tenant scope): both kinds are unique across all tenants, and the generators
 * (`newPublicId`, `newTableToken`) check here before a code is used. Written by the purge role
 * only; the app role reads.
 */
export const tombstones = restro.table(
  'tombstones',
  {
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    /** Which organisation the code belonged to, for the record. */
    organizationId: text('organization_id').notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'tombstones_pkey', columns: [t.kind, t.value] }),
    check('tombstones_kind', sql`${t.kind} in ('public_code', 'table_token')`),
    check('tombstones_value_length', sql`length(${t.value}) between 1 and 128`),
    check('tombstones_organization_id', sql`${t.organizationId} ~ '^tn_[0-9A-Za-z]+$'`),
  ],
)

/**
 * What the purge job erased, without content (D83): which venue, menu, instance or version set,
 * and how many rows of each table went. The subject's id is kept as text with no foreign key:
 * the row it names is gone. Tenant-scoped; written by the purge role, read by the admin.
 */
export const purgeLog = restro.table(
  'purge_log',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** What was purged: a venue, a binned menu, a removed POS instance, old versions, tables. */
    kind: text('kind').notNull(),
    /** The purged thing's id (`vn_…`, `nd_…`, `in_…`), or the venue whose versions were purged. */
    subjectId: text('subject_id').notNull(),
    /** Rows deleted per table, e.g. `{"nodes": 120, "snapshots": 4}`. Never content. */
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('purge_log_tenant_id_at_idx').on(t.tenantId, t.at),
    check(
      'purge_log_kind',
      sql`${t.kind} in ('venue', 'menu', 'instance', 'versions', 'tables', 'service')`,
    ),
    check('purge_log_subject_id', sql`${t.subjectId} ~ '^[a-z]{2}_[0-9A-Za-z]+$'`),
    check('purge_log_counts_object', sql`jsonb_typeof(${t.counts}) = 'object'`),
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

// --- The menu document and its sources (brief S2-01) ------------------------------------------
// Every table below is tenant-scoped: a NOT NULL tenant_id, FORCE row-level security (migration
// 0004) and composite foreign keys `(tenant_id, x_id) -> (tenant_id, id)`. Postgres checks a
// foreign key without row-level security, so a plain key could point at another tenant's row;
// the composite key cannot. barsy ids live only in integrations, barsy_venues, source_records,
// source_links and places, never in nodes or field_values (rule 3). Only `@restro/core/apply`
// writes nodes, placements, field_values, source_links and events (rule 1).

/** Edition layers: edition:<id> (the other layers are listed in the checks). */
const EDITION_LAYER_PATTERN = sql.raw(`'^edition:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'`)
/**
 * Sources other than `manual`: till:<integration>, the role of whichever connector feeds a
 * venue's till (brief CF-03). The vendor is the integration's `kind`, never part of a source.
 */
const SOURCE_PATTERN = sql.raw(`'^till:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'`)
/** Actors other than `system`: user:<id>, integration:<id> (never personal data). */
const ACTOR_PATTERN = sql.raw(`'^(user|integration):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'`)
/** Scopes other than `master`: venue:<our vn_ id> (never a barsy bid). */
const VENUE_SCOPE_PATTERN = sql.raw(`'^venue:vn_[0-9A-Za-z]+$'`)
/** SHA-256 as 64 lower-case hex characters. */
const SHA256_PATTERN = sql.raw(`'^[0-9a-f]{64}$'`)
/** External types and other names: the change sets' name pattern. */
const NAME_PATTERN = sql.raw(`'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'`)

/**
 * Sort keys compare by byte order, never by a language's collation (`Zz` < `a0` must hold): the
 * column is `text COLLATE "C"` whatever the database's default collation is.
 */
const byteOrderText = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
})

/** What an integration is configured with (stored snake_case, like every stored value). */
export interface IntegrationConfig {
  /** Which barsy price feeds `price` (`actual_price` or `current_price`): an open decision. */
  price_source?: string
  /** The barsy article-detail key mapped to allergens. */
  allergen_detail_key?: string
  /** The language barsy text without a language tag is stored in (a key of `LOCALES`). */
  default_locale?: string
  /** The mapping version barsy writes record (doc "Barsy to canonical mapping"). */
  mapping_version?: number
  /**
   * Whether a sync that changed something publishes the menu on its own (doc "Publish policy").
   * Absent means true. S3-04 turns this into a setting of the Integration tab.
   */
  publish_after_sync?: boolean
  /**
   * What the instance's service connector declares its POS lets Restro do (D122 §3), snake_case
   * (`notes_reach_ticket`, `first_items_open_bill`…): written by every complete floor reading
   * (core's `applyFloor`, #78) and read through core's `readServiceCapabilities`, where missing
   * means not declared. Any connector with a floor reading gets it.
   */
  service_capabilities?: Record<string, boolean>
}

/**
 * A configured connection to one barsy installation. `credentials_sealed` is written by the web
 * app sealed with the worker's public key, so only the worker can open it (D55).
 */
export const integrations = restro.table(
  'integrations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    /**
     * The instance's name in the admin (adjustments I1, D81): what the owner calls this
     * connection, e.g. the system's name and a city, so several instances of one system can be
     * told apart. Trimmed, 1–80 characters. Migration 0018 named existing rows "<kind> – <host>",
     * and a BEFORE INSERT trigger gives a row inserted without a name that same default.
     */
    name: text('name').notNull(),
    host: text('host').notNull(),
    credentialsSealed: text('credentials_sealed'),
    status: text('status').notNull().default('new'),
    statusDetail: text('status_detail'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    config: jsonb('config').$type<IntegrationConfig>().notNull().default({}),
    /**
     * When the instance was removed in Settings › Integrations (adjustments I1, D81; migration
     * 0027); null = in use. A removed instance is hidden from the admin and never synced, but the
     * row, its credentials and what it synced stay (nothing is erased from app code; the purge
     * job clears a removed instance's data later, D91). Core's `removeIntegration` is the only
     * writer, and refuses while a venue still links to the instance.
     */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('integrations_tenant_id_id_unique').on(t.tenantId, t.id),
    check('integrations_id_format', sql`${t.id} ~ '^in_[0-9A-Za-z]+$'`),
    check('integrations_kind', sql`${t.kind} in ('barsy', 'sim')`),
    check(
      'integrations_name_length',
      sql`char_length(${t.name}) between 1 and 80 and ${t.name} = btrim(${t.name})`,
    ),
    check('integrations_status', sql`${t.status} in ('new', 'connected', 'error')`),
    check('integrations_config_object', sql`jsonb_typeof(${t.config}) = 'object'`),
  ],
)

/** A venue of a barsy installation (`bid`), optionally mapped to one of our venues. */
export const barsyVenues = restro.table(
  'barsy_venues',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id').notNull(),
    bid: integer('bid').notNull(),
    name: text('name').notNull(),
    venueId: text('venue_id'),
    /** The catalogue root this venue's menu is read from (D56); null until chosen. */
    catalogueRootCatId: integer('catalogue_root_cat_id'),
    /**
     * The catalogue (item set) this venue sells from, as the till lists it; venues can share one
     * (T71). Written whenever the venue list is read; null until then (brief CF-16).
     */
    catalogueId: integer('catalogue_id'),
    /**
     * Which till price this venue's menu shows (`actual_price` or `current_price`): per venue,
     * because prices differ per venue (D73). Null: the integration's `config.price_source`.
     */
    priceSource: text('price_source'),
    /**
     * The menu roots the till designates for this venue (D88; migration 0024): the category its
     * public menu starts at (`public_cat_id`) and the one its till tree starts at (`cat_id`), as
     * the venue list reports them; null until read, or when the till has none. The sync keeps one
     * menu per root that is in the tree (`menu_root` links). `catalogue_root_cat_id` above is the
     * picker of before (D56), no longer read by the sync; it goes with the picker.
     */
    publicCatId: integer('public_cat_id'),
    treeCatId: integer('tree_cat_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'barsy_venues_pkey', columns: [t.integrationId, t.bid] }),
    // Target of places' composite foreign key.
    unique('barsy_venues_tenant_id_integration_id_bid_unique').on(
      t.tenantId,
      t.integrationId,
      t.bid,
    ),
    // A venue of ours maps to at most one barsy venue.
    unique('barsy_venues_venue_id_unique').on(t.venueId),
    foreignKey({
      name: 'barsy_venues_integration_fk',
      columns: [t.tenantId, t.integrationId],
      foreignColumns: [integrations.tenantId, integrations.id],
    }),
    foreignKey({
      name: 'barsy_venues_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    // Named for the till role, not the vendor (D67: no new vendor words outside a connector).
    check(
      'till_venue_price_source',
      sql`${t.priceSource} is null or ${t.priceSource} in ('actual_price', 'current_price')`,
    ),
    check('till_venue_catalogue_id', sql`${t.catalogueId} is null or ${t.catalogueId} >= 0`),
    check('till_venue_public_cat_id', sql`${t.publicCatId} is null or ${t.publicCatId} >= 0`),
    check('till_venue_tree_cat_id', sql`${t.treeCatId} is null or ${t.treeCatId} >= 0`),
  ],
)

/**
 * A node of a menu document: menu, section, item, modifier group, option or special. Menus and
 * items have no parent (items appear in sections through placements); every other node has one.
 * The app never deletes a node: `status` archives it.
 */
export const nodes = restro.table(
  'nodes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    nodeType: text('node_type').notNull(),
    parentId: text('parent_id'),
    /**
     * Order among siblings (sections, modifier groups, options): a fractional key compared by
     * byte order. Exactly the nodes with a parent have one.
     */
    sortKey: byteOrderText('sort_key'),
    status: text('status').notNull().default('active'),
    /** Goes up by one with each change set that changes the node's values, status or links. */
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('nodes_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'nodes_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index('nodes_parent_id_idx').on(t.parentId),
    check('nodes_id_format', sql`${t.id} ~ '^nd_[0-9A-Za-z]+$'`),
    check(
      'nodes_node_type',
      sql`${t.nodeType} in ('menu', 'section', 'item', 'modifier_group', 'option', 'special')`,
    ),
    check('nodes_status', sql`${t.status} in ('active', 'hidden', 'archived')`),
    check('nodes_revision_positive', sql`${t.revision} >= 1`),
    check(
      'nodes_parent_by_type',
      sql`(${t.nodeType} in ('menu', 'item')) = (${t.parentId} is null)`,
    ),
    check('nodes_not_own_parent', sql`${t.parentId} <> ${t.id}`),
    check('nodes_sort_key_with_parent', sql`(${t.parentId} is null) = (${t.sortKey} is null)`),
    check('nodes_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
  ],
)

/**
 * A menu of a venue: several per venue, exactly one of them live (`venues.live_menu_id`; D88,
 * D90, migration 0019). Its id is its root node's id: a menu is its root node. Each menu has its
 * own draft and published versions (`snapshots`, `publish_pointers`); a venue's template, design
 * and guest features are shared by all its menus. A hand-made venue's owner adds, renames,
 * reorders and bins menus (`deleted_at`); a POS venue's menus are the roots its till designates.
 */
export const menus = restro.table(
  'menus',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    templateKey: text('template_key').notNull(),
    templateVersion: integer('template_version').notNull(),
    rootNodeId: text('root_node_id').notNull(),
    /** The header name guests see (D92); null = the venue's name. Trimmed, 1–120 characters. */
    name: text('name'),
    /** Order among the venue's menus (Settings › Menus): a fractional key compared by byte order. */
    sortKey: byteOrderText('sort_key').notNull().default('a0'),
    /**
     * When the owner moved the menu to the venue's bin (D91); null = in use. A binned menu is
     * never the live one, is left out of every list and is purged after 30 days (D83).
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `menus_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Target of the composite foreign keys (tenant_id, menu_id) of the publish tables.
    unique('menus_tenant_id_id_unique').on(t.tenantId, t.id),
    // Target of `venues_live_menu_fk` and `menu_routes_menu_fk`: a menu of that same venue.
    unique('menus_tenant_id_venue_id_id_unique').on(t.tenantId, t.venueId, t.id),
    index('menus_venue_id_idx').on(t.venueId, t.sortKey),
    foreignKey({
      name: 'menus_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    foreignKey({
      name: 'menus_root_node_fk',
      columns: [t.tenantId, t.rootNodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    check('menus_id_is_root_node', sql`${t.id} = ${t.rootNodeId}`),
    check('menus_template_version_positive', sql`${t.templateVersion} >= 1`),
    check(
      'menus_name_length',
      sql`${t.name} is null or (char_length(${t.name}) between 1 and 120 and ${t.name} = btrim(${t.name}))`,
    ),
    check('menus_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
  ],
)

/** An item shown in a section at a fractional sort key (layout lives apart from the schema). */
export const placements = restro.table(
  'placements',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    itemId: text('item_id').notNull(),
    sectionId: text('section_id').notNull(),
    sortKey: byteOrderText('sort_key').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'placements_pkey', columns: [t.sectionId, t.itemId] }),
    index('placements_item_id_idx').on(t.itemId),
    foreignKey({
      name: 'placements_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    foreignKey({
      name: 'placements_section_fk',
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    check('placements_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
  ],
)

/**
 * Tier 1: one object exactly as a source returned it. `raw` is the exact body slice (lossless:
 * barsy prices are JSON floats), `payload` its parsed form. Append-only: a new row only when the
 * content hash changes.
 */
export const sourceRecords = restro.table(
  'source_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id').notNull(),
    externalType: text('external_type').notNull(),
    externalId: text('external_id').notNull(),
    scope: text('scope').notNull(),
    contentHash: text('content_hash').notNull(),
    raw: text('raw').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_records_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'source_records_integration_fk',
      columns: [t.tenantId, t.integrationId],
      foreignColumns: [integrations.tenantId, integrations.id],
    }),
    index('source_records_external_idx').on(
      t.integrationId,
      t.externalType,
      t.externalId,
      t.scope,
      t.fetchedAt,
    ),
    check('source_records_id_format', sql`${t.id} ~ '^sr_[0-9A-Za-z]+$'`),
    check('source_records_external_type', sql`${t.externalType} ~ ${NAME_PATTERN}`),
    check(
      'source_records_scope',
      sql`${t.scope} = 'master' or ${t.scope} ~ ${VENUE_SCOPE_PATTERN}`,
    ),
    check('source_records_content_hash', sql`${t.contentHash} ~ ${SHA256_PATTERN}`),
  ],
)

/** Our node <-> an external object (barsy article 102751). Never leaves the backend (rule 3). */
export const sourceLinks = restro.table(
  'source_links',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id').notNull(),
    externalType: text('external_type').notNull(),
    externalId: text('external_id').notNull(),
    nodeId: text('node_id').notNull(),
    state: text('state').notNull().default('active'),
    /**
     * When `state` last changed (set by `apply()` on every transition; creation counts). The
     * sync's "missing for 7 days → deleted" step reads it.
     */
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastHash: text('last_hash'),
  },
  (t) => [
    primaryKey({
      name: 'source_links_pkey',
      columns: [t.integrationId, t.externalType, t.externalId],
    }),
    // One link per source per node.
    unique('source_links_node_id_integration_id_unique').on(t.nodeId, t.integrationId),
    foreignKey({
      name: 'source_links_integration_fk',
      columns: [t.tenantId, t.integrationId],
      foreignColumns: [integrations.tenantId, integrations.id],
    }),
    foreignKey({
      name: 'source_links_node_fk',
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    check('source_links_state', sql`${t.state} in ('active', 'missing', 'deleted')`),
    check('source_links_external_type', sql`${t.externalType} ~ ${NAME_PATTERN}`),
    check('source_links_external_id', sql`length(${t.externalId}) between 1 and 128`),
    check('source_links_last_hash', sql`${t.lastHash} ~ ${SHA256_PATTERN}`),
  ],
)

/**
 * Tier 2: one value per node x field x layer x scope, with its provenance (rule 2: layer, source
 * and job are NOT NULL). An override is a row in layer `override` with its `basis`. A row with
 * `valid = false` holds a rejected write and its reason, for a slot that had no good value: a
 * rejected write never replaces a good one.
 */
export const fieldValues = restro.table(
  'field_values',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
    fieldKey: text('field_key').notNull(),
    layer: text('layer').notNull(),
    scope: text('scope').notNull(),
    value: jsonb('value').notNull(),
    valueHash: text('value_hash').notNull(),
    source: text('source').notNull(),
    jobId: text('job_id').notNull(),
    actor: text('actor').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    sourceRecordId: text('source_record_id'),
    mappingVersion: integer('mapping_version'),
    basis: jsonb('basis'),
    valid: boolean('valid').notNull().default(true),
    rejectReason: text('reject_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'field_values_pkey',
      columns: [t.nodeId, t.fieldKey, t.layer, t.scope],
    }),
    foreignKey({
      name: 'field_values_node_fk',
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    foreignKey({
      name: 'field_values_source_record_fk',
      columns: [t.tenantId, t.sourceRecordId],
      foreignColumns: [sourceRecords.tenantId, sourceRecords.id],
    }),
    check('field_values_field_key', sql`${t.fieldKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check(
      'field_values_layer',
      sql`${t.layer} in ('till', 'manual', 'override') or ${t.layer} ~ ${EDITION_LAYER_PATTERN}`,
    ),
    check('field_values_scope', sql`${t.scope} = 'master' or ${t.scope} ~ ${VENUE_SCOPE_PATTERN}`),
    check('field_values_source', sql`${t.source} = 'manual' or ${t.source} ~ ${SOURCE_PATTERN}`),
    check('field_values_actor', sql`${t.actor} = 'system' or ${t.actor} ~ ${ACTOR_PATTERN}`),
    check('field_values_job_id', sql`length(${t.jobId}) between 1 and 128`),
    check('field_values_value_hash', sql`${t.valueHash} ~ ${SHA256_PATTERN}`),
    // Each source writes its own layers: a till -> till, manual -> the rest.
    check(
      'field_values_layer_matches_source',
      sql`(${t.layer} = 'till') = (${t.source} like 'till:%')`,
    ),
    check('field_values_venue_scope_till_only', sql`${t.scope} = 'master' or ${t.layer} = 'till'`),
    check(
      'field_values_basis_on_overrides',
      sql`(${t.layer} = 'override') = (${t.basis} is not null)`,
    ),
    check(
      'field_values_till_provenance',
      sql`${t.layer} <> 'till' or (${t.sourceRecordId} is not null and ${t.mappingVersion} is not null)`,
    ),
    check('field_values_mapping_version_positive', sql`${t.mappingVersion} >= 1`),
    check('field_values_reject_reason', sql`${t.valid} = (${t.rejectReason} is null)`),
  ],
)

/**
 * The change-set ops an `events` row can record (`op`): the same names as `ChangeSetOp['op']` in
 * @restro/core (a core test keeps the two lists equal). Duplicated here because this package
 * cannot import core.
 */
export const EVENT_OPS = [
  'setField',
  'clearField',
  'createNode',
  'setPlacement',
  'removePlacement',
  'moveNode',
  'setNodeStatus',
  'linkSource',
  'unlinkSource',
  'setLinkState',
  'setDesign',
] as const

/**
 * Append-only changelog (rule 2): one row per change, old -> new (null = nothing). The app role
 * may only SELECT and INSERT. `seq` is an identity column, so inserting needs no privilege on
 * its sequence.
 *
 * `op` says what kind of change the row records. `setField` and `clearField` rows are changes of
 * a field value: `field_key` is the field, `layer` and `scope` the slot. The structural ops
 * (`createNode`, `setNodeStatus`, `setPlacement`, `removePlacement`, `moveNode`, `linkSource`,
 * `unlinkSource`, `setLinkState`) fill the same columns with a reserved key naming what changed
 * (`node`, `status`, `placement`, `parent`, `link`), the layer of their source (`manual` or
 * `till`), scope `master`, and JSON in `old_value` / `new_value` that names only our
 * own ids and never an external id (rule 3): `{section, sort_key}` for a placement,
 * `{parent, sort_key}` for a move, `{type, parent, status}` for a new node,
 * `{source, external_type}` for a link, `{source, external_type, state}` for a link-state
 * change (`source` is `till:<integration>`), the status text for a status change. `node_id` is
 * the node that changed (the item, for a placement).
 *
 * `setDesign` (D129, migration 0045) is about a venue, not a node: `node_id` is null (and only
 * there, `events_node_only_for_document_ops`), `field_key` is `design`, the layer `manual`, the
 * scope the venue's (`venue:<vn_ id>`, which is how the purge finds it), and the old and new
 * values are the design record before (null for the first) and after.
 */
export const events = restro.table(
  'events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /**
     * The node that changed; null for the rows that are not about the document: `setDesign` (a
     * venue's design) and `setStyle` / `setStyleStatus` (one of the organisation's saved Styles).
     */
    nodeId: text('node_id'),
    /** What kind of change this row records; rows from before the column count as `setField`. */
    op: text('op').notNull().default('setField'),
    fieldKey: text('field_key').notNull(),
    layer: text('layer').notNull(),
    scope: text('scope').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    source: text('source').notNull(),
    actor: text('actor').notNull(),
    jobId: text('job_id').notNull(),
    changeSetId: text('change_set_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'events_node_fk',
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    index('events_node_id_seq_idx').on(t.nodeId, t.seq),
    check(
      'events_op',
      sql`${t.op} in ('setField', 'clearField', 'createNode', 'setPlacement', 'removePlacement', 'moveNode', 'setNodeStatus', 'linkSource', 'unlinkSource', 'setLinkState', 'setDesign', 'setStyle', 'setStyleStatus')`,
    ),
    check(
      'events_node_only_for_document_ops',
      sql`(${t.op} in ('setDesign', 'setStyle', 'setStyleStatus')) = (${t.nodeId} is null)`,
    ),
    // A saved Style is the organisation's, so its row carries the master scope and the manual layer.
    check(
      'events_style_scope',
      sql`${t.op} not in ('setStyle', 'setStyleStatus') or (${t.scope} = 'master' and ${t.fieldKey} in ('style', 'style_status') and ${t.layer} = 'manual')`,
    ),
    check(
      'events_design_scope',
      sql`${t.op} <> 'setDesign' or (${t.scope} ~ ${VENUE_SCOPE_PATTERN} and ${t.fieldKey} = 'design' and ${t.layer} = 'manual')`,
    ),
    check('events_field_key', sql`${t.fieldKey} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check(
      'events_layer',
      sql`${t.layer} in ('till', 'manual', 'override') or ${t.layer} ~ ${EDITION_LAYER_PATTERN}`,
    ),
    check('events_scope', sql`${t.scope} = 'master' or ${t.scope} ~ ${VENUE_SCOPE_PATTERN}`),
    check('events_source', sql`${t.source} = 'manual' or ${t.source} ~ ${SOURCE_PATTERN}`),
    check('events_actor', sql`${t.actor} = 'system' or ${t.actor} ~ ${ACTOR_PATTERN}`),
    check('events_job_id', sql`length(${t.jobId}) between 1 and 128`),
    check('events_change_set_id', sql`${t.changeSetId} ~ '^cs_[0-9A-Za-z]+$'`),
    check('events_is_a_change', sql`${t.oldValue} is not null or ${t.newValue} is not null`),
  ],
)

/**
 * What a run records beside its counters (`job_runs.details`): the lines of text it wrote down
 * (what it skipped, and why) and the writes `apply()` refused. Our ids only: `nodeRef` is a node
 * id (`nd_…`), never a barsy id, and is null when the op named a node that does not exist.
 */
export interface JobRunDetails {
  notes: string[]
  refused: { nodeRef: string | null; fieldKey?: string; code: string }[]
  /**
   * The venue of ours (`vn_…`) a run was for, so the history of the whole installation can say
   * which venue each pull belonged to (CF-09b). Absent on runs recorded before it existed and on
   * runs that belong to no venue (the connection check).
   */
  venue_id?: string
  /** True when a full pull did not conclude absence. Absent on runs recorded before it existed. */
  deletionCheckSkipped?: boolean
  /**
   * Set when a complete full pull found nothing, or far fewer items than the menu holds, so its
   * absence conclusion was held and nothing was hidden (T62): why, how many items it would have
   * hidden and how many were on the menu. Absent when nothing was held.
   */
  absence_held?: {
    reason: 'empty_read' | 'too_many_missing'
    would_hide: number
    active: number
  }
}

/** One run of a job (full pull, incremental pull, photo fetch, …) with its counters. */
export const jobRuns = restro.table(
  'job_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    counters: jsonb('counters').$type<Record<string, number>>().notNull().default({}),
    /** What went wrong, for people. Never query parameters, credentials or personal data. */
    errorSummary: text('error_summary'),
    /** The same, structured for the Integration tab. Null on runs recorded before it existed. */
    details: jsonb('details').$type<JobRunDetails>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'job_runs_integration_fk',
      columns: [t.tenantId, t.integrationId],
      foreignColumns: [integrations.tenantId, integrations.id],
    }),
    check('job_runs_id_format', sql`${t.id} ~ '^jb_[0-9A-Za-z]+$'`),
    check('job_runs_kind', sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check('job_runs_status', sql`${t.status} in ('queued', 'running', 'completed', 'failed')`),
    check('job_runs_counters_object', sql`jsonb_typeof(${t.counters}) = 'object'`),
    check(
      'job_runs_details_object',
      sql`${t.details} is null or jsonb_typeof(${t.details}) = 'object'`,
    ),
  ],
)

// --- Areas and tables (adjustments T1; D94, D95) ---------------------------------------------
// The platform's own model of where guests sit: a venue has areas (halls, a terrace), an area has
// tables. A hand-made venue's owner creates, renames and deletes them; a POS venue's come from the
// till through its connector, which mirrors them (`places` for the first connector) and may only
// rename, reorder and hide them. Guests only ever see a table's `tb_` id and its QR token (rule 3).
// Tenant-scoped like every table here; only `@restro/core/apply` writes them.

/** An area of a venue. `source_key` is the till's own key for it (its hall id) when it came from a till. */
export const areas = restro.table(
  'areas',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    /** The name guests and staff see: the owner's, or our name over the till's. Trimmed, 1–60. */
    name: text('name').notNull(),
    /** Order among the venue's areas: a fractional key compared by byte order. */
    sortKey: byteOrderText('sort_key').notNull(),
    /** A hidden area and its tables get no codes and no guest page (D95). */
    hidden: boolean('hidden').notNull().default(false),
    /**
     * The key the till reports for this area (its hall id, as text), so a sync finds it again
     * whatever it is called; null = the owner's own area. Never shown to guests.
     */
    sourceKey: text('source_key'),
    /** Set when the owner deleted the area (hand-made venues, D95); purged later (D83). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `areas_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('areas_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'areas_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    index('areas_venue_id_idx').on(t.venueId, t.sortKey),
    // One area per till hall and venue.
    uniqueIndex('areas_venue_id_source_key_unique')
      .on(t.venueId, t.sourceKey)
      .where(sql`${t.sourceKey} is not null`),
    check('areas_id_format', sql`${t.id} ~ '^ar_[0-9A-Za-z]+$'`),
    check(
      'areas_name_length',
      sql`char_length(${t.name}) between 1 and 60 and ${t.name} = btrim(${t.name})`,
    ),
    check('areas_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
    check(
      'areas_source_key_length',
      sql`${t.sourceKey} is null or length(${t.sourceKey}) between 1 and 128`,
    ),
  ],
)

/**
 * A bar of a venue (`br_`; D122 §2, D124 §1): the counter that serves some of its tables, where
 * their sent orders print and whose ordering staff can pause. Read from the POS's floor and never
 * edited in Restro; a venue whose POS has no bars, or can't say, has none. Menu-side: only
 * `apply()` writes it (the write-target guard pins this).
 */
export const bars = restro.table(
  'bars',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    /** The POS's name for the bar. Trimmed, 1–60 characters. */
    name: text('name').notNull(),
    /** The key the POS reports for this bar, so a reading finds it again. Backend only (rule 3). */
    sourceKey: text('source_key').notNull(),
    /** Set when a complete floor reading no longer shows the bar; never deleted by the app. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `bars_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('bars_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'bars_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    uniqueIndex('bars_venue_id_source_key_unique').on(t.venueId, t.sourceKey),
    check('bars_id_format', sql`${t.id} ~ '^br_[0-9A-Za-z]+$'`),
    check(
      'bars_name_length',
      sql`char_length(${t.name}) between 1 and 60 and ${t.name} = btrim(${t.name})`,
    ),
    check('bars_source_key_length', sql`length(${t.sourceKey}) between 1 and 128`),
  ],
)

/**
 * A table (or a seat, a bar spot) of an area. `number` is what staff know it by (the till's
 * number, or the owner's); `name` is our name over it, shown to guests when set (D95). The QR
 * token on its sticker is unique across all tenants, and a purged token is tombstoned, never
 * reissued (D83).
 */
export const venueTables = restro.table(
  'tables',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    areaId: text('area_id').notNull(),
    /** Our name for it, or null (guests then see `number`). Trimmed, 1–40 characters. */
    name: text('name'),
    /** The till's number or label, or the owner's; null only when `name` is set. Trimmed, 1–40. */
    number: text('number'),
    /** Order among the area's tables: a fractional key compared by byte order. */
    sortKey: byteOrderText('sort_key').notNull(),
    /** A hidden table gets no code and no guest page (D95: non-public and placeholder places). */
    hidden: boolean('hidden').notNull().default(false),
    /** The QR token on its sticker (the guest files' token pattern), or null when it has no code. */
    qrToken: text('qr_token'),
    /**
     * SHA-256 of the code, lower-case hex: what a guest's code is looked up by (D122 §9,
     * `restro.guest_table_by_code_hash`). Set exactly when the table has a code. No slow hash:
     * the code has at least 128 random bits.
     */
    qrCodeHash: text('qr_code_hash'),
    /**
     * The code sealed with the worker's public key (D55), so stickers can be printed again; only
     * the worker opens it. Null until the code is sealed (#70: the plain `qr_token` then goes).
     */
    qrCodeSealed: text('qr_code_sealed'),
    /**
     * The bar that serves it, read from the POS's floor (D122 §7); null where the POS has no bars
     * or can't say (D124 §1). Written by `apply()`.
     */
    barId: text('bar_id'),
    /**
     * A payment table of its bar (D122 §8): never opened for phones, never given a code. Read
     * from the POS or marked by a manager, through `apply()`.
     */
    isPaymentTable: boolean('is_payment_table').notNull().default(false),
    /**
     * Rises each time the table's code is re-issued, so a location pass of an older code dies at
     * once (D122 §9). Service-side: only `applyService` writes it, never `apply()`.
     */
    codeGeneration: integer('code_generation').notNull().default(1),
    /** Set when the owner deleted the table (hand-made venues, D95); purged later (D83). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `tables_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tables_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('tables_qr_token_unique').on(t.qrToken),
    unique('tables_qr_code_hash_unique').on(t.qrCodeHash),
    foreignKey({
      name: 'tables_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    foreignKey({
      name: 'tables_area_fk',
      columns: [t.tenantId, t.areaId],
      foreignColumns: [areas.tenantId, areas.id],
    }),
    foreignKey({
      name: 'tables_bar_fk',
      columns: [t.tenantId, t.barId],
      foreignColumns: [bars.tenantId, bars.id],
    }),
    index('tables_area_id_idx').on(t.areaId, t.sortKey),
    index('tables_bar_id_idx').on(t.barId).where(sql`${t.barId} is not null`),
    check('tables_id_format', sql`${t.id} ~ '^tb_[0-9A-Za-z]+$'`),
    check(
      'tables_name_length',
      sql`${t.name} is null or (char_length(${t.name}) between 1 and 40 and ${t.name} = btrim(${t.name}))`,
    ),
    check(
      'tables_number_length',
      sql`${t.number} is null or (char_length(${t.number}) between 1 and 40 and ${t.number} = btrim(${t.number}))`,
    ),
    check('tables_has_label', sql`${t.name} is not null or ${t.number} is not null`),
    check('tables_code_generation_positive', sql`${t.codeGeneration} >= 1`),
    // A payment table never carries a code a guest could scan (D122 §8).
    check('tables_payment_table_no_code', sql`not ${t.isPaymentTable} or ${t.qrCodeHash} is null`),
    check('tables_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
    check(
      'tables_qr_token_format',
      sql`${t.qrToken} is null or ${t.qrToken} ~ '^[A-Za-z0-9_-]{8,128}$'`,
    ),
    check(
      'tables_qr_code_hash_format',
      sql`${t.qrCodeHash} is null or ${t.qrCodeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'tables_qr_code_sealed_format',
      sql`${t.qrCodeSealed} is null or (${t.qrCodeSealed} ~ '^rs1\\.' and length(${t.qrCodeSealed}) <= 1024)`,
    ),
    // A code is the hash plus its plain or sealed form; no form without the hash, no hash alone.
    check(
      'tables_qr_code_complete',
      sql`(${t.qrCodeHash} is null) = (${t.qrToken} is null and ${t.qrCodeSealed} is null)`,
    ),
  ],
)

/**
 * Menu routing (D95; adjustments M2): which menu an area or a table shows. The venue's live menu
 * (`venues.live_menu_id`) is the default; a row here for an area overrides it for that area, a
 * row for a table overrides the area. One row per area or table, with exactly one of the two
 * set; `menu_id` null means "no choice of its own" (inherit), so clearing a route is an update.
 * The publisher resolves the dictionary into the guest files (rule 4): an unpublished or binned
 * menu falls back to the next level up.
 */
export const menuRoutes = restro.table(
  'menu_routes',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    areaId: text('area_id'),
    tableId: text('table_id'),
    menuId: text('menu_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('menu_routes_area_id_unique').on(t.areaId).where(sql`${t.areaId} is not null`),
    uniqueIndex('menu_routes_table_id_unique').on(t.tableId).where(sql`${t.tableId} is not null`),
    index('menu_routes_venue_id_idx').on(t.venueId),
    foreignKey({
      name: 'menu_routes_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    foreignKey({
      name: 'menu_routes_area_fk',
      columns: [t.tenantId, t.areaId],
      foreignColumns: [areas.tenantId, areas.id],
    }),
    foreignKey({
      name: 'menu_routes_table_fk',
      columns: [t.tenantId, t.tableId],
      foreignColumns: [venueTables.tenantId, venueTables.id],
    }),
    // The chosen menu is a menu of this very venue; purging it clears the choice (in the
    // database: `ON DELETE SET NULL (menu_id)`, written by hand in migration 0021).
    foreignKey({
      name: 'menu_routes_menu_fk',
      columns: [t.tenantId, t.venueId, t.menuId],
      foreignColumns: [menus.tenantId, menus.venueId, menus.id],
    }).onDelete('set null'),
    check('menu_routes_one_target', sql`(${t.areaId} is null) <> (${t.tableId} is null)`),
  ],
)

/** A barsy place (a table) of a barsy venue. Guests only ever see its `tb_` id and QR token. */
export const places = restro.table(
  'places',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id').notNull(),
    bid: integer('bid').notNull(),
    /** barsy's `place_id` and `place_num`, kept as text: lossless whatever barsy sends. */
    placeId: text('place_id').notNull(),
    placeNum: text('place_num'),
    salonName: text('salon_name'),
    /** The till's hall id and its order among halls (D95: halls keyed by id); null until read. */
    salonId: text('salon_id'),
    salonWeight: integer('salon_weight'),
    isPublic: boolean('is_public').notNull(),
    state: text('state').notNull().default('active'),
    /**
     * The platform table this place is mirrored into (`tables`, migration 0020); null while the
     * place's till venue serves no venue of ours. The table holds the QR token and the name the
     * manager chose (migration 0025 moved them there from this row).
     */
    tableId: text('table_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('places_integration_id_bid_place_id_unique').on(t.integrationId, t.bid, t.placeId),
    unique('places_table_id_unique').on(t.tableId),
    foreignKey({
      name: 'places_barsy_venue_fk',
      columns: [t.tenantId, t.integrationId, t.bid],
      foreignColumns: [barsyVenues.tenantId, barsyVenues.integrationId, barsyVenues.bid],
    }),
    // A purged table (D83) leaves the place without one; the next read makes a new table if the
    // place's till venue serves a venue (in the database: `ON DELETE SET NULL (table_id)`,
    // written by hand in migration 0026, since a plain SET NULL would null the tenant too).
    foreignKey({
      name: 'places_table_fk',
      columns: [t.tenantId, t.tableId],
      foreignColumns: [venueTables.tenantId, venueTables.id],
    }).onDelete('set null'),
    check('places_id_format', sql`${t.id} ~ '^tb_[0-9A-Za-z]+$'`),
    check('places_state', sql`${t.state} in ('active', 'missing', 'deleted')`),
  ],
)

/**
 * The photo variants made for one asset (brief S3-01b): the width in pixels of the webp file each
 * variant name uses, `a/<as_ id>/w<width>.webp` in the publish store. Never wider than the
 * original, so two names can share one file (a 300 px original has 300, 300, 300).
 */
export interface AssetVariants {
  thumb: number
  card: number
  full: number
}

/** An image or file in the asset store; values point to it by its `as_` id, never by URL. */
export const assets = restro.table(
  'assets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    origin: text('origin').notNull(),
    /** Where it came from (the connector's picture it was fetched for); backend only. */
    originRef: text('origin_ref'),
    checksum: text('checksum'),
    contentType: text('content_type'),
    width: integer('width'),
    height: integer('height'),
    storageKey: text('storage_key'),
    status: text('status').notNull().default('pending'),
    /** The webp variants made for the publish store; null until the `asset-variants` job ran. */
    variants: jsonb('variants').$type<AssetVariants>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('assets_id_format', sql`${t.id} ~ '^as_[0-9A-Za-z]+$'`),
    check(
      'assets_variants_object',
      sql`${t.variants} is null or jsonb_typeof(${t.variants}) = 'object'`,
    ),
    check('assets_origin', sql`${t.origin} in ('upload', 'connector')`),
    check('assets_status', sql`${t.status} in ('pending', 'stored', 'failed')`),
    check('assets_checksum', sql`${t.checksum} ~ ${SHA256_PATTERN}`),
    check('assets_dimensions_positive', sql`${t.width} > 0 and ${t.height} > 0`),
    check(
      'assets_stored_is_complete',
      sql`${t.status} <> 'stored' or (${t.checksum} is not null and ${t.storageKey} is not null and ${t.contentType} is not null)`,
    ),
  ],
)

// --- What was published (brief S3-01a) ----------------------------------------------------------
// Tenant-scoped like the document tables (FORCE row-level security, composite foreign keys).
// Only `@restro/core/apply` writes them (rule 1). A snapshot body never changes: a trigger
// (migration 0008) lets an update move `status` from `held` to `published` or `rejected` and
// record who decided, nothing else; the app role cannot delete a snapshot.

/** A snapshot's state: live history (`published`), waiting for a person (`held`), or turned down. */
export const SNAPSHOT_STATUSES = ['published', 'held', 'rejected'] as const

/** Why a snapshot row exists: a person pressed Publish, a sync published, or a rollback. */
export const SNAPSHOT_REASONS = ['manual', 'auto_sync', 'rollback'] as const

/**
 * Why an automatic publish was held (`snapshots.held_reason`): V11, with the counts the publish
 * dialog shows and the items (our `nd_` ids) the publish would hide.
 */
export interface SnapshotHeldReason {
  code: 'V11'
  hidden: number
  previously_visible: number
  hidden_item_ids: string[]
}

/**
 * One version of a menu for one venue: the `menu-snapshot/1` JSON (`body`) and how it came to
 * be. `version` counts up per menu + venue across every row (held, rejected and rollback rows
 * included), so it never repeats. A `rollback` row has no body of its own: it records that the
 * pointer moved back to `restores_snapshot_id`.
 */
export const snapshots = restro.table(
  'snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    menuId: text('menu_id').notNull(),
    venueId: text('venue_id').notNull(),
    version: integer('version').notNull(),
    /** SHA-256 of the body without its `snapshot` header (a rollback row: its target's hash). */
    hash: text('hash').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    /** Who published: `system`, `user:<id>` or `integration:<id>` (never personal data). */
    actor: text('actor').notNull(),
    heldReason: jsonb('held_reason').$type<SnapshotHeldReason>(),
    /** A rollback row: the earlier snapshot the pointer moved back to. */
    restoresSnapshotId: text('restores_snapshot_id'),
    /** A held row: who approved or rejected it, and when. */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** A short code for the decision: `superseded` for a held row a later publish replaced. */
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    // Target of the pointer's and the rollback rows' foreign keys: a snapshot of this menu + venue.
    unique('snapshots_tenant_id_menu_id_venue_id_id_unique').on(
      t.tenantId,
      t.menuId,
      t.venueId,
      t.id,
    ),
    unique('snapshots_menu_id_venue_id_version_unique').on(t.menuId, t.venueId, t.version),
    foreignKey({
      name: 'snapshots_menu_fk',
      columns: [t.tenantId, t.menuId],
      foreignColumns: [menus.tenantId, menus.id],
    }),
    foreignKey({
      name: 'snapshots_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    foreignKey({
      name: 'snapshots_restores_fk',
      columns: [t.tenantId, t.menuId, t.venueId, t.restoresSnapshotId],
      foreignColumns: [t.tenantId, t.menuId, t.venueId, t.id],
    }),
    check('snapshots_id_format', sql`${t.id} ~ '^sn_[0-9A-Za-z]+$'`),
    check('snapshots_version_positive', sql`${t.version} >= 1`),
    check('snapshots_hash', sql`${t.hash} ~ ${SHA256_PATTERN}`),
    check('snapshots_status', sql`${t.status} in ('published', 'held', 'rejected')`),
    check('snapshots_reason', sql`${t.reason} in ('manual', 'auto_sync', 'rollback')`),
    check('snapshots_actor', sql`${t.actor} = 'system' or ${t.actor} ~ ${ACTOR_PATTERN}`),
    check(
      'snapshots_decided_by',
      sql`${t.decidedBy} is null or ${t.decidedBy} = 'system' or ${t.decidedBy} ~ ${ACTOR_PATTERN}`,
    ),
    // Exactly the rollback rows have no body and name what they restore.
    check('snapshots_body_unless_rollback', sql`(${t.reason} = 'rollback') = (${t.body} is null)`),
    check(
      'snapshots_restores_on_rollback',
      sql`(${t.reason} = 'rollback') = (${t.restoresSnapshotId} is not null)`,
    ),
    check('snapshots_body_object', sql`${t.body} is null or jsonb_typeof(${t.body}) = 'object'`),
    check(
      'snapshots_rollback_published',
      sql`${t.reason} <> 'rollback' or ${t.status} = 'published'`,
    ),
    check(
      'snapshots_published_at',
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    // Only an automatic publish is ever held (V11), and a held or rejected row says why.
    check(
      'snapshots_held_reason',
      sql`(${t.heldReason} is null or (${t.reason} = 'auto_sync' and jsonb_typeof(${t.heldReason}) = 'object')) and (${t.status} = 'published' or ${t.heldReason} is not null)`,
    ),
    check('snapshots_decision', sql`(${t.decidedBy} is null) = (${t.decidedAt} is null)`),
    check(
      'snapshots_decision_note',
      sql`${t.decisionNote} is null or (${t.decidedBy} is not null and ${t.decisionNote} ~ '^[a-z][a-z0-9_]{0,63}$')`,
    ),
  ],
)

/** The snapshot a menu + venue shows now (`current.json`). One row per menu + venue. */
export const publishPointers = restro.table(
  'publish_pointers',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    menuId: text('menu_id').notNull(),
    venueId: text('venue_id').notNull(),
    currentSnapshotId: text('current_snapshot_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'publish_pointers_pkey', columns: [t.menuId, t.venueId] }),
    foreignKey({
      name: 'publish_pointers_menu_fk',
      columns: [t.tenantId, t.menuId],
      foreignColumns: [menus.tenantId, menus.id],
    }),
    foreignKey({
      name: 'publish_pointers_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    // The pointer can only name a snapshot of the same menu + venue.
    foreignKey({
      name: 'publish_pointers_snapshot_fk',
      columns: [t.tenantId, t.menuId, t.venueId, t.currentSnapshotId],
      foreignColumns: [snapshots.tenantId, snapshots.menuId, snapshots.venueId, snapshots.id],
    }),
  ],
)

/**
 * When an item first appeared on a published menu for a venue: feeds the resolver's
 * `firstPublishedAt` (the "new" badge). Written once per item, never changed.
 */
export const itemFirstPublished = restro.table(
  'item_first_published',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
    menuId: text('menu_id').notNull(),
    venueId: text('venue_id').notNull(),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'item_first_published_pkey',
      columns: [t.menuId, t.venueId, t.nodeId],
    }),
    foreignKey({
      name: 'item_first_published_node_fk',
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
    }),
    foreignKey({
      name: 'item_first_published_menu_fk',
      columns: [t.tenantId, t.menuId],
      foreignColumns: [menus.tenantId, menus.id],
    }),
    foreignKey({
      name: 'item_first_published_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
  ],
)

// --- Tags (brief S3-06, D60) --------------------------------------------------------------------
// A venue's own list of tags ("Signature", "Spicy", "Local"). Items hold tag ids in their `tags`
// field (a manual-layer value written through apply()); this table is the vocabulary those ids
// point into, so it is a side table like `places`, not part of the menu document. Tenant-scoped
// like every table here (FORCE row-level security, composite foreign keys). Only
// `@restro/core/apply` writes it. A tag is archived, never deleted: old snapshots and the items
// that hold its id stay readable.

/** A venue-defined tag: names in the venue's languages and a colour token (never a raw colour). */
export const tags = restro.table(
  'tags',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    /** `LocalizedText`: the name per language (core validates the languages). */
    label: jsonb('label').$type<Record<string, string>>().notNull(),
    /** One of the theme's accent token names (core's `TAG_COLORS`); the database checks the shape. */
    color: text('color').notNull(),
    /** Order among the venue's tags: a fractional key compared by byte order. */
    sortKey: byteOrderText('sort_key').notNull(),
    /** Set while the tag is archived: hidden from pickers and left out of new snapshots. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `tags_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Target of composite foreign keys that may point at a tag later.
    unique('tags_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'tags_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }),
    index('tags_venue_id_idx').on(t.venueId, t.sortKey),
    check('tags_id_format', sql`${t.id} ~ '^tg_[0-9A-Za-z]+$'`),
    check(
      'tags_label_object',
      sql`jsonb_typeof(${t.label}) = 'object' and ${t.label} <> '{}'::jsonb`,
    ),
    check('tags_color_format', sql`${t.color} ~ '^[a-z][a-z0-9_]{0,31}$'`),
    check('tags_sort_key_format', sql`${t.sortKey} ~ '^[A-Za-z][0-9A-Za-z]*$'`),
  ],
)

/**
 * An organisation's saved Styles (D129, My styles; migration 0047): a named set of design choices
 * the owner keeps and applies at any venue of the organisation. The row is the organisation's, not
 * a venue's, and row-level security keeps it to the organisation like every other tenant table.
 *
 * `style_values` holds core's `StyleValues`: a value for every choice option but the body font. The
 * colours, the Advanced roles and the logo are never here — they are the venue's brand (D128) — so
 * applying a saved Style, or copying another venue's design, can never carry a venue's brand away.
 * `style` is the premade Style the values came from, kept for the record; nothing links back.
 *
 * Every row carries its provenance, NOT NULL (rule 2): the manual layer and source (a Style is
 * never a till's), the member who wrote it, the job and the change set. Only `apply()`'s `setStyle`
 * and `setStyleStatus` write it. Deleting is a soft removal (`removed_at`), which the owner's Undo
 * clears: nothing here is ever deleted by app code, only by the purge (D83). A name is unique among
 * the organisation's Styles that are not removed; `apply()` compares names without case under the
 * tenant's document lock, and the partial index below is the backstop.
 */
export const designStyles = restro.table(
  'design_styles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The owner's name for the Style. Trimmed, 1–60 characters. */
    name: text('name').notNull(),
    /** The premade Style the values came from (core's `PremadeStyleId`). */
    style: text('style').notNull(),
    /** Core's `StyleValues`: every choice option but the body font. */
    styleValues: jsonb('style_values').$type<Record<string, unknown>>().notNull(),
    /** Set while the Style is removed and the toast's Undo can bring it back. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    layer: text('layer').notNull(),
    source: text('source').notNull(),
    actor: text('actor').notNull(),
    jobId: text('job_id').notNull(),
    changeSetId: text('change_set_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `design_styles_touch_updated_at` trigger. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('design_styles_tenant_id_id_unique').on(t.tenantId, t.id),
    index('design_styles_tenant_id_name_idx').on(t.tenantId, t.name),
    uniqueIndex('design_styles_live_name_unique')
      .on(t.tenantId, t.name)
      .where(sql`${t.removedAt} is null`),
    check('design_styles_id_format', sql`${t.id} ~ '^ds_[0-9A-Za-z]+$'`),
    check(
      'design_styles_name_length',
      sql`char_length(${t.name}) between 1 and 60 and ${t.name} = btrim(${t.name})`,
    ),
    check('design_styles_style_format', sql`${t.style} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('design_styles_values_object', sql`jsonb_typeof(${t.styleValues}) = 'object'`),
    check('design_styles_layer', sql`${t.layer} = 'manual'`),
    check('design_styles_source', sql`${t.source} = 'manual'`),
    check('design_styles_actor', sql`${t.actor} ~ ${ACTOR_PATTERN}`),
    check('design_styles_job_id', sql`length(${t.jobId}) between 1 and 128`),
    check('design_styles_change_set_id', sql`${t.changeSetId} ~ '^cs_[0-9A-Za-z]+$'`),
  ],
)

// --- Service data (ordering, D122 §9; design `docs/deliverables/2026-10-21-service-data-design.md`)
// Everything a night of ordering writes: sittings, the table's order, sent orders and their notes,
// locks, readings of the POS bill, the Log, waiter calls, alerts, pauses, service days, and the
// staff side (members, venue roles, assignments, shared devices, push subscriptions). Only
// `@restro/core/service` (`applyService`) writes these tables; the write-target guard pins it.
// Every row carries its provenance (rule 2 as D122 §9 and the design §2.2 put it): `source`,
// `actor` and `job_id`, NOT NULL. Never stored here: card digits, a guest's phone, device, IP or
// position, the table code, secrets or raw POS requests. Columns marked *backend* hold POS
// references that never reach a guest (rule 3).

/** Where a service write came from (design §2.2). */
const SERVICE_SOURCE_VALUES = sql.raw(`('guest', 'staff', 'worker', 'provider', 'restro', 'pos')`)
/**
 * Who did it: `system`, `guest`, `user:<id>`, `staff:sm_…`, `integration:in_…` or
 * `operator:<id>` (Restro's admin team). Never personal data.
 */
const SERVICE_ACTOR_PATTERN = sql.raw(
  `'^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'`,
)
/** Where a staff answer came from (D122 §7). */
const VIA_VALUES = sql.raw(`('guest_page', 'tonight', 'telegram', 'worker', 'provider')`)

/** The provenance columns of a service row: its last write's source, actor and job (rule 2). */
function serviceProvenance() {
  return {
    source: text('source').notNull(),
    actor: text('actor').notNull(),
    /** The worker's job run, or the id the server made for the web request. */
    jobId: text('job_id').notNull(),
  }
}

/** The checks every service table repeats on its provenance columns. */
function provenanceChecks(
  table: string,
  t: { source: AnyPgColumn; actor: AnyPgColumn; jobId: AnyPgColumn },
) {
  return [
    check(`${table}_source`, sql`${t.source} in ${SERVICE_SOURCE_VALUES}`),
    check(`${table}_actor`, sql`${t.actor} ~ ${SERVICE_ACTOR_PATTERN}`),
    check(`${table}_job_id`, sql`${t.jobId} ~ ${NAME_PATTERN}`),
  ]
}

/** The composite foreign key from a service row to its venue. */
function venueFk(name: string, t: { tenantId: AnyPgColumn; venueId: AnyPgColumn }) {
  return foreignKey({
    name: `${name}_venue_fk`,
    columns: [t.tenantId, t.venueId],
    foreignColumns: [venues.tenantId, venues.id],
  })
}

/** The composite foreign key from a service row to its table. */
function tableFk(name: string, t: { tenantId: AnyPgColumn; tableId: AnyPgColumn }) {
  return foreignKey({
    name: `${name}_table_fk`,
    columns: [t.tenantId, t.tableId],
    foreignColumns: [venueTables.tenantId, venueTables.id],
  })
}

/**
 * A sitting (`st_`): one group of guests at a table, from opening the table for phones to its end
 * (D122 §4). A table is open for phones exactly while it has a sitting with no end.
 */
export const sittings = restro.table(
  'sittings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    tableId: text('table_id').notNull(),
    /** The venue's service day (it ends at 07:00 by default). */
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    /** Opened alone, or with "Open all". */
    openedHow: text('opened_how').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
    /** Whether the POS bill has held lines, so a table opened before its first item isn't ended. */
    hadBillLines: boolean('had_bill_lines').notNull().default(false),
    /** Set at the end of the service day: 18 months on (D111); the purge only compares it. */
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sittings_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('sittings', t),
    tableFk('sittings', t),
    // One open sitting per table.
    uniqueIndex('sittings_open_table_unique')
      .on(t.tenantId, t.tableId)
      .where(sql`${t.endedAt} is null`),
    index('sittings_venue_id_service_date_idx').on(t.venueId, t.serviceDate),
    index('sittings_retain_until_idx').on(t.retainUntil),
    check('sittings_id_format', sql`${t.id} ~ '^st_[0-9A-Za-z]+$'`),
    check('sittings_opened_how', sql`${t.openedHow} in ('one', 'all')`),
    check('sittings_end_pair', sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    check(
      'sittings_end_reason',
      sql`${t.endReason} is null or ${t.endReason} in ('bill_closed', 'staff_closed', 'new_guests', 'closing_hour', 'code_reissued')`,
    ),
    ...provenanceChecks('sittings', t),
  ],
)

/**
 * The table's shared order (`to_`; D117): one row per sitting, inserted on the first add and
 * updated in place (fillfactor 70, no index on changing columns, so updates stay HOT). `lines`
 * carries no price. Emptied when the sitting ends, so unsent notes go at once.
 */
export const tableOrders = restro.table(
  'table_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    tableId: text('table_id').notNull(),
    sittingId: text('sitting_id').notNull(),
    /** Only rises; every phone compares it. */
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    /** The order's lines (`ol_` ids), checked with Zod in core. */
    lines: jsonb('lines').$type<unknown[]>().notNull().default([]),
    /** The earlier order set aside, offered back with "Restore". */
    earlier: jsonb('earlier').$type<unknown[]>(),
    earlierAt: timestamp('earlier_at', { withTimezone: true }),
    /** The ring of the last 64 action ids and their results (idempotency, D121 2.4). */
    recentActions: jsonb('recent_actions').$type<unknown[]>().notNull().default([]),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('table_orders_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('table_orders_tenant_id_sitting_id_unique').on(t.tenantId, t.sittingId),
    venueFk('table_orders', t),
    tableFk('table_orders', t),
    foreignKey({
      name: 'table_orders_sitting_fk',
      columns: [t.tenantId, t.sittingId],
      foreignColumns: [sittings.tenantId, sittings.id],
    }),
    check('table_orders_id_format', sql`${t.id} ~ '^to_[0-9A-Za-z]+$'`),
    check('table_orders_version', sql`${t.version} >= 0`),
    check('table_orders_lines_array', sql`jsonb_typeof(${t.lines}) = 'array'`),
    check(
      'table_orders_earlier_array',
      sql`${t.earlier} is null or jsonb_typeof(${t.earlier}) = 'array'`,
    ),
    check(
      'table_orders_recent_actions',
      sql`jsonb_typeof(${t.recentActions}) = 'array' and jsonb_array_length(${t.recentActions}) <= 64`,
    ),
    ...provenanceChecks('table_orders', t),
  ],
)

/** The states of a sent order (D116, D122 §4). */
export const SENT_ORDER_STATES = [
  'waiting',
  'sending',
  'checking',
  'awaiting_approval',
  'added',
  'not_sent',
  'unconfirmed',
] as const

/**
 * A sent order (`so_`): what one Send asked the POS to add (D115–D117). Its id is the
 * server-generated key Restro sends where the POS deduplicates (rule 9). Money in minor units.
 */
export const sentOrders = restro.table(
  'sent_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    tableId: text('table_id').notNull(),
    sittingId: text('sitting_id').notNull(),
    /** The bar the table belonged to at Send, or null (D124 §1). */
    barId: text('bar_id'),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    /** On the bill or pay first. */
    kind: text('kind').notNull(),
    /** The short code a waiter reads, such as K7Q. */
    reference: text('reference').notNull(),
    state: text('state').notNull(),
    /** A code from core's fixed list, or null. */
    reason: text('reason'),
    /** The lines as sent: `ol_` id, item, options, quantity, unit price, name. No note. */
    lines: jsonb('lines').$type<unknown[]>().notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    /** For the alert's "Bill before this order". */
    billBeforeMinor: bigint('bill_before_minor', { mode: 'number' }),
    /** *Backend*: the POS bill it joined. */
    posBillRef: text('pos_bill_ref'),
    /** *Backend*: the POS lines the read-back matched. */
    matchedLines: jsonb('matched_lines').$type<unknown[]>(),
    /**
     * *Backend*: what the match needs of the reading before the write, kept while the sent order
     * may still be Sending, Checking or Unconfirmed, so a later reading can find a late landing
     * (#135). Cleared once the sent order settles otherwise, once it lands late and at the end
     * of the service day.
     */
    landingBasis: jsonb('landing_basis'),
    /** The phone's action id (idempotency); cleared at the end of the service day. */
    actionId: text('action_id'),
    /** The sent order a deliberate repeat confirmed after the duplicate warning. */
    duplicateOf: text('duplicate_of'),
    /** The consent text's version the guest saw (D119). */
    consentVersion: text('consent_version'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sent_orders_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('sent_orders_tenant_id_action_id_unique').on(t.tenantId, t.actionId),
    uniqueIndex('sent_orders_venue_reference_unique').on(t.venueId, t.serviceDate, t.reference),
    venueFk('sent_orders', t),
    tableFk('sent_orders', t),
    foreignKey({
      name: 'sent_orders_sitting_fk',
      columns: [t.tenantId, t.sittingId],
      foreignColumns: [sittings.tenantId, sittings.id],
    }),
    foreignKey({
      name: 'sent_orders_bar_fk',
      columns: [t.tenantId, t.barId],
      foreignColumns: [bars.tenantId, bars.id],
    }),
    foreignKey({
      name: 'sent_orders_duplicate_of_fk',
      columns: [t.tenantId, t.duplicateOf],
      foreignColumns: [t.tenantId, t.id],
    }),
    // The 15-minute duplicate warning.
    index('sent_orders_table_id_created_at_idx').on(t.tableId, t.createdAt.desc()),
    // Tonight's open sent orders.
    index('sent_orders_open_idx')
      .on(t.venueId, t.serviceDate)
      .where(sql`${t.state} in ('unconfirmed', 'waiting', 'sending', 'checking')`),
    index('sent_orders_retain_until_idx').on(t.retainUntil),
    check('sent_orders_id_format', sql`${t.id} ~ '^so_[0-9A-Za-z]+$'`),
    check('sent_orders_kind', sql`${t.kind} in ('on_bill', 'pay_first')`),
    check('sent_orders_reference_format', sql`${t.reference} ~ '^[A-Z0-9]{3,6}$'`),
    check(
      'sent_orders_state',
      sql`${t.state} in ('waiting', 'sending', 'checking', 'awaiting_approval', 'added', 'not_sent', 'unconfirmed')`,
    ),
    check('sent_orders_reason', sql`${t.reason} is null or ${t.reason} ~ ${NAME_PATTERN}`),
    check(
      'sent_orders_lines_array',
      sql`jsonb_typeof(${t.lines}) = 'array' and jsonb_array_length(${t.lines}) > 0`,
    ),
    check('sent_orders_total_minor', sql`${t.totalMinor} >= 0`),
    check('sent_orders_action_id', sql`${t.actionId} is null or ${t.actionId} ~ ${NAME_PATTERN}`),
    ...provenanceChecks('sent_orders', t),
  ],
)

/**
 * The notes of a sent order's lines, one row per noted line, kept apart so the 31-day erasure is a
 * row delete by the purge role (design §4). Append-only. Alerts, Telegram and the Log never read it.
 */
export const sentOrderNotes = restro.table(
  'sent_order_notes',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    sentOrderId: text('sent_order_id').notNull(),
    /** The line's `ol_` id. */
    lineId: text('line_id').notNull(),
    note: text('note').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sent_order_notes_pk', columns: [t.tenantId, t.sentOrderId, t.lineId] }),
    venueFk('sent_order_notes', t),
    foreignKey({
      name: 'sent_order_notes_sent_order_fk',
      columns: [t.tenantId, t.sentOrderId],
      foreignColumns: [sentOrders.tenantId, sentOrders.id],
    }),
    index('sent_order_notes_service_date_idx').on(t.serviceDate),
    check('sent_order_notes_line_id_format', sql`${t.lineId} ~ '^ol_[0-9A-Za-z]+$'`),
    check(
      'sent_order_notes_note_length',
      sql`char_length(${t.note}) between 1 and 500 and ${t.note} = btrim(${t.note})`,
    ),
    ...provenanceChecks('sent_order_notes', t),
  ],
)

/**
 * A lease on something only one writer may hold at a time (design §2.3), one row per thing, reused
 * all night and never deleted. A take is the one conditional statement of the service path;
 * deadlines are compared with the database's `now()`.
 */
export const locks = restro.table(
  'locks',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    /** Order slot per table, payment table (held with no deadline, D127). */
    scope: text('scope').notNull(),
    /** Our id of what is held. */
    key: text('key').notNull(),
    /** The `so_` or `py_` id holding it, or null. */
    holder: text('holder'),
    /** Rises on every take. */
    fence: bigint('fence', { mode: 'number' }).notNull().default(0),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    deadline: timestamp('deadline', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    ...serviceProvenance(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'locks_pk', columns: [t.tenantId, t.scope, t.key] }),
    venueFk('locks', t),
    check('locks_scope', sql`${t.scope} in ('order_slot', 'payment_table')`),
    check('locks_key_format', sql`${t.key} ~ '^[a-z]{2}_[0-9A-Za-z]+$'`),
    check(
      'locks_holder_format',
      sql`${t.holder} is null or ${t.holder} ~ '^(so|py)_[0-9A-Za-z]+$'`,
    ),
    // A held lease runs out at its deadline, except a payment table: a payment owns it until the
    // payment is final and a read shows the table empty, and no lock runs out meanwhile (D127,
    // #104). Its holder has no deadline at all, so nothing can take it over.
    check(
      'locks_holder_deadline',
      sql`${t.holder} is null or (${t.deadline} is not null) = (${t.scope} <> 'payment_table')`,
    ),
    check('locks_fence', sql`${t.fence} >= 0`),
    ...provenanceChecks('locks', t),
  ],
)

/**
 * The latest reading of a table's POS bills (D122 §4, §6): one row per table (payment tables too),
 * overwritten by each reading and emptied when the sitting ends; kept for minutes, never as a
 * record. `bills` holds one entry per POS bill in the connector's reading shape (the POS's total,
 * what is paid, the opening time, whether it is a payment's isolated bill, its lines with signed
 * amounts and decimal-string quantities), checked with Zod in core; its POS references are
 * *backend*. No waiter or POS-user identity.
 */
export const billReadings = restro.table(
  'bill_readings',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    tableId: text('table_id').notNull(),
    /** Rises with every reading of the table. */
    readSeq: bigint('read_seq', { mode: 'number' }).notNull().default(0),
    readAt: timestamp('read_at', { withTimezone: true }).notNull(),
    /** False when any part failed: such a reading concludes nothing (rule 6). */
    complete: boolean('complete').notNull(),
    bills: jsonb('bills').$type<unknown[]>().notNull().default([]),
    ...serviceProvenance(),
  },
  (t) => [
    primaryKey({ name: 'bill_readings_pk', columns: [t.tenantId, t.tableId] }),
    venueFk('bill_readings', t),
    tableFk('bill_readings', t),
    check('bill_readings_read_seq', sql`${t.readSeq} >= 0`),
    check('bill_readings_bills_array', sql`jsonb_typeof(${t.bills}) = 'array'`),
    ...provenanceChecks('bill_readings', t),
  ],
)

/**
 * The Log (D120): every state change of a sent order, sitting, pause, alert, waiter call, setting,
 * role and permission. Append-only; `night` entries are kept 31 days, `record` entries (guard and
 * permission changes) 18 months (D122 §7). The Log screen reads payment steps beside it (part 2).
 */
export const logEntries = restro.table(
  'log_entries',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    /** A kind from core's list, e.g. `sent_order.state`, `guard.tripped`. */
    kind: text('kind').notNull(),
    sentOrderId: text('sent_order_id'),
    /** A payment (`py_`), from part 2 on. */
    paymentId: text('payment_id'),
    tableId: text('table_id'),
    sittingId: text('sitting_id'),
    fromState: text('from_state'),
    toState: text('to_state'),
    reason: text('reason'),
    via: text('via'),
    /** Checked with Zod in core; never a note, never guest data. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    retention: text('retention').notNull(),
    ...serviceProvenance(),
  },
  (t) => [
    venueFk('log_entries', t),
    index('log_entries_venue_id_at_idx').on(t.venueId, t.at.desc()),
    index('log_entries_sent_order_id_idx')
      .on(t.sentOrderId, t.seq)
      .where(sql`${t.sentOrderId} is not null`),
    index('log_entries_venue_table_at_idx').on(t.venueId, t.tableId, t.at.desc()),
    index('log_entries_retention_service_date_idx').on(t.retention, t.serviceDate),
    check('log_entries_kind', sql`${t.kind} ~ ${NAME_PATTERN}`),
    check(
      'log_entries_ids',
      sql`(${t.sentOrderId} is null or ${t.sentOrderId} ~ '^so_[0-9A-Za-z]+$') and (${t.paymentId} is null or ${t.paymentId} ~ '^py_[0-9A-Za-z]+$') and (${t.tableId} is null or ${t.tableId} ~ '^tb_[0-9A-Za-z]+$') and (${t.sittingId} is null or ${t.sittingId} ~ '^st_[0-9A-Za-z]+$')`,
    ),
    check('log_entries_via', sql`${t.via} is null or ${t.via} in ${VIA_VALUES}`),
    check('log_entries_details_object', sql`jsonb_typeof(${t.details}) = 'object'`),
    check('log_entries_retention', sql`${t.retention} in ('night', 'record')`),
    ...provenanceChecks('log_entries', t),
  ],
)

/** The request kinds a call can hold (core's `CALL_WAITER_KINDS`, #180). */
const WAITER_CALL_KINDS = sql.raw(
  `array['waiter', 'bill', 'ice', 'water', 'glasses', 'clean_table', 'terminal']::text[]`,
)

/** A guest's "Call a waiter" (`wc_`): no text from the guest, no identity. */
export const waiterCalls = restro.table(
  'waiter_calls',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    tableId: text('table_id').notNull(),
    sittingId: text('sitting_id').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * What the guests asked for (#180), in the venue's list order: one call per table collects the
     * requests of everyone at it. `waiter` alone is the plain call.
     */
    kinds: text('kinds').array().notNull().default(sql`'{waiter}'::text[]`),
    /** The newest request added to the call: the unanswered time counts from here. */
    lastCalledAt: timestamp('last_called_at', { withTimezone: true }).notNull().defaultNow(),
    state: text('state').notNull().default('open'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** The actor who marked it Handled. */
    doneBy: text('done_by'),
    via: text('via'),
    ...serviceProvenance(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('waiter_calls_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('waiter_calls', t),
    tableFk('waiter_calls', t),
    foreignKey({
      name: 'waiter_calls_sitting_fk',
      columns: [t.tenantId, t.sittingId],
      foreignColumns: [sittings.tenantId, sittings.id],
    }),
    // A second tap returns the open call.
    uniqueIndex('waiter_calls_open_table_unique')
      .on(t.tenantId, t.tableId)
      .where(sql`${t.state} = 'open'`),
    index('waiter_calls_venue_id_service_date_idx').on(t.venueId, t.serviceDate),
    check('waiter_calls_id_format', sql`${t.id} ~ '^wc_[0-9A-Za-z]+$'`),
    check('waiter_calls_state', sql`${t.state} in ('open', 'done', 'lapsed')`),
    check(
      'waiter_calls_kinds',
      sql`cardinality(${t.kinds}) >= 1 and ${t.kinds} <@ ${WAITER_CALL_KINDS}`,
    ),
    check('waiter_calls_done_pair', sql`(${t.state} = 'done') = (${t.doneAt} is not null)`),
    check(
      'waiter_calls_done_by',
      sql`${t.doneBy} is null or ${t.doneBy} ~ ${SERVICE_ACTOR_PATTERN}`,
    ),
    check('waiter_calls_via', sql`${t.via} is null or ${t.via} in ${VIA_VALUES}`),
    ...provenanceChecks('waiter_calls', t),
  ],
)

/**
 * An alert (`al_`; D120): something a person must see, with its repeat rules. `audience` is the
 * venue's staff or Restro's admin team.
 */
export const alerts = restro.table(
  'alerts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    audience: text('audience').notNull().default('venue'),
    /** What it is about: our id of a table, sent order, bar, instance or the venue. */
    subjectId: text('subject_id').notNull(),
    /** The permission needed to answer it (core's permission list). */
    permission: text('permission'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    nextRepeatAt: timestamp('next_repeat_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: text('done_by'),
    via: text('via'),
    /** *Backend*: the Telegram message to edit to "Done by …". */
    telegramMessageRef: text('telegram_message_ref'),
    ...serviceProvenance(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('alerts_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('alerts', t),
    index('alerts_open_idx').on(t.venueId, t.raisedAt).where(sql`${t.doneAt} is null`),
    index('alerts_venue_id_service_date_idx').on(t.venueId, t.serviceDate),
    check('alerts_id_format', sql`${t.id} ~ '^al_[0-9A-Za-z]+$'`),
    check('alerts_kind', sql`${t.kind} ~ ${NAME_PATTERN}`),
    check('alerts_audience', sql`${t.audience} in ('venue', 'restro')`),
    check('alerts_subject_id', sql`${t.subjectId} ~ '^[a-z]{2}_[0-9A-Za-z]+$'`),
    check('alerts_permission', sql`${t.permission} is null or ${t.permission} ~ ${NAME_PATTERN}`),
    check('alerts_details_object', sql`jsonb_typeof(${t.details}) = 'object'`),
    check('alerts_done_by', sql`${t.doneBy} is null or ${t.doneBy} ~ ${SERVICE_ACTOR_PATTERN}`),
    check('alerts_via', sql`${t.via} is null or ${t.via} in ${VIA_VALUES}`),
    ...provenanceChecks('alerts', t),
  ],
)

/**
 * A pause of ordering (`pa_`; D120, D122 §6): of a POS connection (an instance), the venue, a bar
 * or a table. The breaker's state lives on the active row, so a worker restart neither lifts nor
 * doubles it.
 */
export const pauses = restro.table(
  'pauses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    scope: text('scope').notNull(),
    /** Our id of what is paused: `in_`, `vn_`, `br_` or `tb_`. */
    targetId: text('target_id').notNull(),
    /** Why, from core's list (unconfirmed order, guard trip, refusal scope, staff…). */
    cause: text('cause').notNull(),
    /** A pause Restro started has no button and lifts by itself (D120). */
    restroStarted: boolean('restro_started').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedBy: text('lifted_by'),
    liftReason: text('lift_reason'),
    /** The breaker's good probes in a row, and when it probes next. */
    probeCount: integer('probe_count').notNull().default(0),
    nextProbeAt: timestamp('next_probe_at', { withTimezone: true }),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ...serviceProvenance(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('pauses_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('pauses', t),
    uniqueIndex('pauses_active_unique')
      .on(t.tenantId, t.scope, t.targetId, t.cause)
      .where(sql`${t.liftedAt} is null`),
    index('pauses_venue_id_service_date_idx').on(t.venueId, t.serviceDate),
    check('pauses_id_format', sql`${t.id} ~ '^pa_[0-9A-Za-z]+$'`),
    check('pauses_scope', sql`${t.scope} in ('connection', 'venue', 'bar', 'table')`),
    check(
      'pauses_target_matches_scope',
      sql`(${t.scope} = 'connection' and ${t.targetId} ~ '^in_[0-9A-Za-z]+$') or (${t.scope} = 'venue' and ${t.targetId} ~ '^vn_[0-9A-Za-z]+$') or (${t.scope} = 'bar' and ${t.targetId} ~ '^br_[0-9A-Za-z]+$') or (${t.scope} = 'table' and ${t.targetId} ~ '^tb_[0-9A-Za-z]+$')`,
    ),
    check('pauses_cause', sql`${t.cause} ~ ${NAME_PATTERN}`),
    check('pauses_lift_reason', sql`${t.liftReason} is null or ${t.liftReason} ~ ${NAME_PATTERN}`),
    check(
      'pauses_lifted_by',
      sql`${t.liftedBy} is null or ${t.liftedBy} ~ ${SERVICE_ACTOR_PATTERN}`,
    ),
    check('pauses_probe_count', sql`${t.probeCount} >= 0`),
    check('pauses_details_object', sql`jsonb_typeof(${t.details}) = 'object'`),
    ...provenanceChecks('pauses', t),
  ],
)

/**
 * One closed service day of a venue: its totals and the count of mismatches, written at its end
 * (D111's "then only as totals"); kept until the venue is purged.
 */
export const serviceDays = restro.table(
  'service_days',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Counts and minor-unit sums, checked with Zod in core. */
    totals: jsonb('totals').$type<Record<string, number>>().notNull().default({}),
    mismatches: integer('mismatches').notNull().default(0),
    /**
     * When Telegram accepted the day's end-of-night message (#179), set once by
     * `service_day.report_sent`. Null: not sent yet, so the hourly tick tries again while the day
     * is recent. Days closed before this column existed carry their `closed_at`.
     */
    reportSentAt: timestamp('report_sent_at', { withTimezone: true }),
    ...serviceProvenance(),
  },
  (t) => [
    primaryKey({ name: 'service_days_pk', columns: [t.tenantId, t.venueId, t.serviceDate] }),
    venueFk('service_days', t),
    check('service_days_totals_object', sql`jsonb_typeof(${t.totals}) = 'object'`),
    check('service_days_mismatches', sql`${t.mismatches} >= 0`),
    ...provenanceChecks('service_days', t),
  ],
)

/**
 * A person of the organisation who works at its venues (`sm_`; D122 §7): no account needed. The
 * PIN is generated by Restro, stored as `HMAC(pepper, tenant ‖ pin)` for lookup and sealed beside
 * it (D55) so the owner and Restro's admin team can see it; both are cleared on archiving.
 */
export const staffMembers = restro.table(
  'staff_members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The name the Log and Tonight show. Trimmed, 1–60 characters. */
    displayName: text('display_name').notNull(),
    /** The person's own sign-in, when they have one. */
    userId: text('user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    /** HMAC-SHA256 of the PIN, lower-case hex; unique in the organisation. */
    pinHmac: text('pin_hmac'),
    /** The PIN sealed with the worker's public key; only the worker opens it (D55). */
    pinSealed: text('pin_sealed'),
    pinSetAt: timestamp('pin_set_at', { withTimezone: true }),
    /** The Telegram user linked to this person, for "Done" in the venue's group. */
    telegramUserId: text('telegram_user_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Set on archiving: kept 18 months while `record` entries name the person. */
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('staff_members_tenant_id_id_unique').on(t.tenantId, t.id),
    uniqueIndex('staff_members_pin_hmac_unique')
      .on(t.tenantId, t.pinHmac)
      .where(sql`${t.pinHmac} is not null`),
    check('staff_members_id_format', sql`${t.id} ~ '^sm_[0-9A-Za-z]+$'`),
    check(
      'staff_members_display_name_length',
      sql`char_length(${t.displayName}) between 1 and 60 and ${t.displayName} = btrim(${t.displayName})`,
    ),
    check(
      'staff_members_pin_hmac_format',
      sql`${t.pinHmac} is null or ${t.pinHmac} ~ ${SHA256_PATTERN}`,
    ),
    check(
      'staff_members_pin_pair',
      sql`(${t.pinHmac} is null) = (${t.pinSealed} is null) and (${t.pinHmac} is null) = (${t.pinSetAt} is null)`,
    ),
    check('staff_members_archived_no_pin', sql`${t.archivedAt} is null or ${t.pinHmac} is null`),
    check(
      'staff_members_telegram_user_id',
      sql`${t.telegramUserId} is null or ${t.telegramUserId} ~ '^[0-9]{1,20}$'`,
    ),
    ...provenanceChecks('staff_members', t),
  ],
)

/**
 * A role at one venue (`rl_`; #55 §5): a name and permissions from core's fixed list. Default roles
 * (`default_kind` set) are read-only; a venue copies one to make its own.
 */
export const venueRoles = restro.table(
  'venue_roles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    name: text('name').notNull(),
    /** Permission keys, checked against core's list. */
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    defaultKind: text('default_kind'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('venue_roles_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('venue_roles', t),
    uniqueIndex('venue_roles_default_unique')
      .on(t.venueId, t.defaultKind)
      .where(sql`${t.defaultKind} is not null`),
    check('venue_roles_id_format', sql`${t.id} ~ '^rl_[0-9A-Za-z]+$'`),
    check(
      'venue_roles_name_length',
      sql`char_length(${t.name}) between 1 and 40 and ${t.name} = btrim(${t.name})`,
    ),
    check('venue_roles_permissions_array', sql`jsonb_typeof(${t.permissions}) = 'array'`),
    check(
      'venue_roles_default_kind',
      sql`${t.defaultKind} is null or ${t.defaultKind} in ('staff', 'manager', 'owner')`,
    ),
    ...provenanceChecks('venue_roles', t),
  ],
)

/** One role per staff member per venue. Ending it is an update (`ended_at`), never a delete. */
export const staffAssignments = restro.table(
  'staff_assignments',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    staffMemberId: text('staff_member_id').notNull(),
    venueId: text('venue_id').notNull(),
    roleId: text('role_id').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'staff_assignments_pk',
      columns: [t.tenantId, t.staffMemberId, t.venueId],
    }),
    venueFk('staff_assignments', t),
    foreignKey({
      name: 'staff_assignments_staff_member_fk',
      columns: [t.tenantId, t.staffMemberId],
      foreignColumns: [staffMembers.tenantId, staffMembers.id],
    }),
    foreignKey({
      name: 'staff_assignments_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [venueRoles.tenantId, venueRoles.id],
    }),
    index('staff_assignments_venue_id_idx').on(t.venueId),
    ...provenanceChecks('staff_assignments', t),
  ],
)

/**
 * A signed-in browser an owner marked as a shared device of one venue (`dv_`; D122 §7): there
 * every staff write asks a PIN, and the PIN's person's role decides.
 */
export const sharedDevices = restro.table(
  'shared_devices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    name: text('name').notNull(),
    /** The Better Auth session it belongs to (sessions are deleted on sign-out, so no key). */
    sessionId: text('session_id').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shared_devices_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('shared_devices', t),
    uniqueIndex('shared_devices_session_unique')
      .on(t.tenantId, t.sessionId)
      .where(sql`${t.revokedAt} is null`),
    check('shared_devices_id_format', sql`${t.id} ~ '^dv_[0-9A-Za-z]+$'`),
    check(
      'shared_devices_name_length',
      sql`char_length(${t.name}) between 1 and 40 and ${t.name} = btrim(${t.name})`,
    ),
    ...provenanceChecks('shared_devices', t),
  ],
)

/**
 * A staff account's installed device that takes Web Push alerts (D120, D122 §7). Staff devices
 * only: a guest's push identifier is never stored. Ended by an update (`revoked_at`).
 */
export const pushSubscriptions = restro.table(
  'push_subscriptions',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    /** SHA-256 of the endpoint, the row's key. */
    endpointHash: text('endpoint_hash').notNull(),
    /** The push service's endpoint URL. */
    endpoint: text('endpoint').notNull(),
    /** The browser's public key and auth secret for the payload encryption (RFC 8291). */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'push_subscriptions_pk', columns: [t.tenantId, t.endpointHash] }),
    index('push_subscriptions_user_id_idx').on(t.tenantId, t.userId),
    check('push_subscriptions_endpoint_hash', sql`${t.endpointHash} ~ ${SHA256_PATTERN}`),
    check(
      'push_subscriptions_endpoint',
      sql`${t.endpoint} ~ '^https://' and length(${t.endpoint}) <= 1024`,
    ),
    check(
      'push_subscriptions_keys',
      sql`${t.p256dh} ~ '^[A-Za-z0-9_-]{40,200}$' and ${t.auth} ~ '^[A-Za-z0-9_-]{16,64}$'`,
    ),
    ...provenanceChecks('push_subscriptions', t),
  ],
)

/**
 * Restro's admin team (D122 §7; design §8): the accounts that may act across venues as operators
 * (add roles, change rights, see PINs, lift any pause). Not tenant data. The app reads it; granting
 * or revoking is an operator task outside the app, never a write from app code.
 */
export const operators = restro.table(
  'operators',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Who granted it, free text kept short (an operator's name or a ticket). */
    grantedBy: text('granted_by').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [check('operators_granted_by_length', sql`char_length(${t.grantedBy}) between 1 and 120`)],
)

// --- Service data for paying (part 2, D127 §Records; design
// `docs/deliverables/2026-10-25-guest-payment-design.md` §7; ticket #104). Written only by
// `applyService`, like the ordering tables above, with the same provenance columns. A payment's
// amounts are integer minor units (rule 8). Never stored: card digits, a guest's phone, device or
// IP, or the payment handle itself (only its hash). Columns marked *backend* hold POS or provider
// references that never reach a guest (rule 3).

/** The states of a payment (D127 §The route; design §5): the route's steps and its final states. */
export const PAYMENT_STATES = [
  'requested',
  'priced',
  'awaiting_guest',
  'held',
  'queued',
  'isolated',
  'entered',
  'checked',
  'closed',
  'cancelling',
  'captured',
  'released',
  'unconfirmed',
  'stranded',
  'capture_failed',
] as const

/**
 * The states in which a payment may still hold the guest's email for the venue's electronic receipt
 * (D127, #186): up to and including `checked`, the state the close is attempted from. In any other
 * state the email is erased (trigger `payments_erase_receipt_email`, migration 0041).
 */
export const PAYMENT_EMAIL_STATES = [
  'requested',
  'priced',
  'awaiting_guest',
  'held',
  'queued',
  'isolated',
  'entered',
  'checked',
] as const

/** The final states: a payment in one is settled (design §5.1). */
export const PAYMENT_FINAL_STATES = [
  'captured',
  'released',
  'unconfirmed',
  'stranded',
  'capture_failed',
] as const

/** The outcomes of a payment step (design §5.1). */
export const PAYMENT_STEP_OUTCOMES = ['attempting', 'done', 'refused', 'unknown'] as const

/** The states of a venue's payment account. */
export const PAYMENT_ACCOUNT_STATES = [
  'connecting',
  'connected',
  'lost_access',
  'disconnected',
] as const

/**
 * Where a dispute on a payment stands, in the platform's words (#108): `open` while the guest's
 * bank asks or reviews, `won` once it closed with the venue keeping the money, `lost` once the
 * money went back to the guest's bank. Null on `payments.dispute` when there is none.
 */
export const PAYMENT_DISPUTE_STATES = ['open', 'won', 'lost'] as const

/**
 * What a provider's notice is about, in the platform's words (#108): the provider's web part maps
 * its own event types to these, so no provider event name reaches the platform. `account` is a
 * change to a venue's account (re-read the connection), `access_lost` is the venue taking Restro's
 * access away (#109). `other` has no
 * handler: the worker marks it handled and does nothing.
 */
export const PROVIDER_NOTICE_KINDS = [
  'payment',
  'refund',
  'dispute',
  'account',
  'access_lost',
  'other',
] as const

/** `'a', 'b'` for a SQL `in (...)` list of fixed words. */
const sqlWords = (words: readonly string[]) =>
  sql.raw(`(${words.map((word) => `'${word}'`).join(', ')})`)

/** A provider kind, as its package names itself (`sim`, and the first real provider's). */
const PROVIDER_KIND_PATTERN = sql.raw(`'^[a-z][a-z0-9-]{0,31}$'`)
/** A reference the provider gave (a payment, an account, an event): opaque and short. */
const PROVIDER_REF_PATTERN = sql.raw(`'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'`)
/**
 * A JSON path that finds a line of a payment step's `lines` that is not a POS reference (1 to 200
 * characters), a decimal quantity and a whole amount (`PaymentStepLinesSchema`).
 */
const PAYMENT_STEP_LINE_INVALID = sql.raw(
  `'$[*] ? (@.type() != "object" || !exists(@.pos) || !exists(@.quantity) || !exists(@.amountMinor)` +
    ` || @.pos.type() != "string" || !(@.pos like_regex "^.{1,200}$")` +
    ` || @.quantity.type() != "string"` +
    ` || !(@.quantity like_regex "^-?(0|[1-9][0-9]{0,14})([.][0-9]{1,6})?$")` +
    ` || @.amountMinor.type() != "number" || @.amountMinor.floor() != @.amountMinor)'`,
)

/**
 * A payment (`py_`) from a phone: lines of a table's bill paid by card (`on_bill`), or a pay-first
 * round paid before it reaches the POS (`pay_first`). The worker drives it through the route as
 * compare-and-sets on `state`; every POS and provider write is a `payment_steps` row first.
 */
export const payments = restro.table(
  'payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    /** The real table whose bill is paid. */
    tableId: text('table_id').notNull(),
    sittingId: text('sitting_id').notNull(),
    /** The table's bar at the start, whose queue it joins; null = the venue's queue (D124 §1). */
    barId: text('bar_id'),
    /** A pay-first payment's sent order. */
    sentOrderId: text('sent_order_id'),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    /** Why it was released or refused, a code from core's list; null otherwise. */
    reason: text('reason'),
    /** The sha-256 of the paying phone's payment handle; the handle itself is never stored. */
    handleHash: text('handle_hash').notNull(),
    /** The phone's action id (idempotency); cleared at the end of the service day. */
    actionId: text('action_id'),
    /** The total held: the POS's own line amounts plus the tip; null until priced. */
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    /** The tip inside the amount; 0 for none (D127). */
    tipMinor: bigint('tip_minor', { mode: 'number' }).notNull().default(0),
    /** What was captured, once captured: never above the amount held. */
    capturedMinor: bigint('captured_minor', { mode: 'number' }),
    /**
     * What the venue refunded in its own provider dashboard, as last read back from the provider
     * (#108): an absolute amount, never added up from notices; never above `captured_minor`.
     */
    refundedMinor: bigint('refunded_minor', { mode: 'number' }).notNull().default(0),
    /** A dispute on the payment, as last read back (`PAYMENT_DISPUTE_STATES`); null for none. */
    dispute: text('dispute'),
    /**
     * When the latest dispute was first read as open, when it was read closed (`won` or `lost`)
     * and the provider's answer-by date (#222; D122 §8). Set by `payment.observe` only.
     */
    disputeOpenedAt: timestamp('dispute_opened_at', { withTimezone: true }),
    disputeClosedAt: timestamp('dispute_closed_at', { withTimezone: true }),
    disputeDueAt: timestamp('dispute_due_at', { withTimezone: true }),
    /** ISO 4217, upper case. */
    currency: text('currency').notNull(),
    /** The phone must confirm by then (design §6: 2 minutes, extended while the bank asks). */
    confirmBy: timestamp('confirm_by', { withTimezone: true }),
    /** The provider's session ends then (design §6: 10 minutes). */
    sessionEndsAt: timestamp('session_ends_at', { withTimezone: true }),
    /** The wait for a free payment table ends then (design §6: 60 seconds from `held`). */
    queueEndsAt: timestamp('queue_ends_at', { withTimezone: true }),
    /** The payment table it owns, from `queued` until final and the table reads empty. */
    paymentTableId: text('payment_table_id'),
    providerKind: text('provider_kind').notNull(),
    /** *Backend*: the provider's id of the payment. */
    providerPaymentRef: text('provider_payment_ref'),
    /**
     * *Backend*: what the paying phone's card form needs (the provider's form values, e.g. a client
     * secret), only while `awaiting_guest`: set in the step that enters it, cleared in the one that
     * leaves it, served only to the phone holding the payment's handle (#110).
     */
    formValues: jsonb('form_values').$type<Record<string, unknown>>(),
    /** When the provider drops the hold uncaptured, as the provider reports it. */
    captureBefore: timestamp('capture_before', { withTimezone: true }),
    /** The fiscal receipt's number and the fiscal memory's, once the close or a read shows them. */
    receiptNumber: text('receipt_number'),
    fiscalMemoryNumber: text('fiscal_memory_number'),
    /** Dispute evidence read from the provider at capture: the bank's check and its code. */
    threeDsResult: text('three_ds_result'),
    authorisationCode: text('authorisation_code'),
    /**
     * When the venue's paper receipt became one to bring (#200): set at capture, whenever no
     * electronic receipt was sent (the receipt number is shown when the POS gave one). Null for any
     * other payment.
     */
    receiptToBringAt: timestamp('receipt_to_bring_at', { withTimezone: true }),
    /** When staff marked the paper receipt Brought, and the account that did (the shared device's own, or a person). */
    receiptBroughtAt: timestamp('receipt_brought_at', { withTimezone: true }),
    receiptBroughtBy: text('receipt_brought_by'),
    /**
     * *Backend*: the guest's email for the venue's electronic receipt (D127, #186), kept only until
     * the close: a trigger erases it in the update that leaves `PAYMENT_EMAIL_STATES` (the close,
     * a cancel, any final state), the check refuses it anywhere else, and a job erases it once the
     * payment is older than any payment can take. Never in a log, an event, a Log entry, a step or
     * a provider's metadata; never read by the guest page.
     */
    receiptEmail: text('receipt_email'),
    /** When it reached a final state. */
    settledAt: timestamp('settled_at', { withTimezone: true }),
    /** Set when it is final: 18 months on (D122 §8, D127 4.2); the purge only compares it. */
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payments_tenant_id_id_unique').on(t.tenantId, t.id),
    unique('payments_tenant_id_action_id_unique').on(t.tenantId, t.actionId),
    unique('payments_handle_hash_unique').on(t.handleHash),
    venueFk('payments', t),
    tableFk('payments', t),
    foreignKey({
      name: 'payments_sitting_fk',
      columns: [t.tenantId, t.sittingId],
      foreignColumns: [sittings.tenantId, sittings.id],
    }),
    foreignKey({
      name: 'payments_bar_fk',
      columns: [t.tenantId, t.barId],
      foreignColumns: [bars.tenantId, bars.id],
    }),
    foreignKey({
      name: 'payments_sent_order_fk',
      columns: [t.tenantId, t.sentOrderId],
      foreignColumns: [sentOrders.tenantId, sentOrders.id],
    }),
    foreignKey({
      name: 'payments_payment_table_fk',
      columns: [t.tenantId, t.paymentTableId],
      foreignColumns: [venueTables.tenantId, venueTables.id],
    }),
    // A provider's payment belongs to one payment of ours.
    uniqueIndex('payments_provider_payment_unique')
      .on(t.providerKind, t.providerPaymentRef)
      .where(sql`${t.providerPaymentRef} is not null`),
    // The recovery job, and "Being paid" on the table's state: payments that are not final.
    index('payments_open_idx').on(t.venueId, t.state).where(sql`${t.settledAt} is null`),
    index('payments_table_id_created_at_idx').on(t.tableId, t.createdAt.desc()),
    index('payments_retain_until_idx').on(t.retainUntil),
    // "Bring the receipt" on Tonight and the end of night: the receipts not marked Brought (#200).
    index('payments_receipt_open_idx')
      .on(t.venueId, t.serviceDate)
      .where(sql`${t.receiptToBringAt} is not null and ${t.receiptBroughtAt} is null`),
    check('payments_id_format', sql`${t.id} ~ '^py_[0-9A-Za-z]+$'`),
    check('payments_kind', sql`${t.kind} in ('on_bill', 'pay_first')`),
    check('payments_state', sql`${t.state} in ${sqlWords(PAYMENT_STATES)}`),
    check(
      'payments_pay_first_sent_order',
      sql`(${t.kind} = 'pay_first') = (${t.sentOrderId} is not null)`,
    ),
    check('payments_reason', sql`${t.reason} is null or ${t.reason} ~ ${NAME_PATTERN}`),
    check('payments_handle_hash', sql`${t.handleHash} ~ '^[0-9a-f]{64}$'`),
    check('payments_action_id', sql`${t.actionId} is null or ${t.actionId} ~ ${NAME_PATTERN}`),
    check(
      'payments_amounts',
      sql`${t.tipMinor} >= 0 and (${t.amountMinor} is null or ${t.amountMinor} >= ${t.tipMinor})`,
    ),
    check(
      'payments_captured_minor',
      sql`${t.capturedMinor} is null or (${t.amountMinor} is not null and ${t.capturedMinor} between 0 and ${t.amountMinor})`,
    ),
    check(
      'payments_refunded_minor',
      sql`${t.refundedMinor} >= 0 and ${t.refundedMinor} <= coalesce(${t.capturedMinor}, 0)`,
    ),
    check(
      'payments_dispute',
      sql`${t.dispute} is null or ${t.dispute} in ${sqlWords(PAYMENT_DISPUTE_STATES)}`,
    ),
    check(
      'payments_dispute_times',
      sql`(${t.disputeClosedAt} is null or ${t.disputeOpenedAt} is not null) and (${t.disputeDueAt} is null or ${t.disputeOpenedAt} is not null)`,
    ),
    check('payments_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('payments_provider_kind', sql`${t.providerKind} ~ ${PROVIDER_KIND_PATTERN}`),
    check(
      'payments_provider_payment_ref',
      sql`${t.providerPaymentRef} is null or ${t.providerPaymentRef} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    check(
      'payments_fiscal_numbers',
      sql`(${t.receiptNumber} is null or char_length(${t.receiptNumber}) between 1 and 64) and (${t.fiscalMemoryNumber} is null or char_length(${t.fiscalMemoryNumber}) between 1 and 64)`,
    ),
    check(
      'payments_evidence',
      sql`(${t.threeDsResult} is null or ${t.threeDsResult} ~ ${NAME_PATTERN}) and (${t.authorisationCode} is null or char_length(${t.authorisationCode}) between 1 and 64)`,
    ),
    check(
      'payments_receipt_brought',
      sql`(${t.receiptBroughtAt} is null) = (${t.receiptBroughtBy} is null) and (${t.receiptBroughtAt} is null or ${t.receiptToBringAt} is not null) and (${t.receiptBroughtBy} is null or ${t.receiptBroughtBy} ~ ${SERVICE_ACTOR_PATTERN}) and (${t.receiptToBringAt} is null or ${t.state} = 'captured')`,
    ),
    check(
      'payments_receipt_email',
      sql`${t.receiptEmail} is null or (char_length(${t.receiptEmail}) between 3 and 254 and ${t.state} in ${sqlWords(PAYMENT_EMAIL_STATES)})`,
    ),
    check(
      'payments_form_values',
      sql`${t.formValues} is null or (${t.state} = 'awaiting_guest' and jsonb_typeof(${t.formValues}) = 'object')`,
    ),
    check(
      'payments_settled',
      sql`(${t.settledAt} is not null) = (${t.state} in ${sqlWords(PAYMENT_FINAL_STATES)})`,
    ),
    ...provenanceChecks('payments', t),
  ],
)

/**
 * One refund the venue made in its provider's dashboard, as Restro read it back (#222, #261; D122
 * §8): one row per provider refund, matched by the provider's id (`provider_refund_ref`), with its
 * amount, when it was seen and on which service day. The storno is the venue's own work at the
 * till: "Storno done" records who and when (`storno_at`, `storno_by`). A refund the provider says
 * did not go through marks its row `failed_at`. Written only by `payment.observe` and the storno
 * commands; goes with its payment when the payment is purged.
 *
 * A row from before migration 0044 has no id: one row per rise of the old refund total. The first
 * reading by id gives it the id of the refund of its amount, if there is one (`reconcileRefunds`).
 */
export const paymentRefunds = restro.table(
  'payment_refunds',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    paymentId: text('payment_id').notNull(),
    /** *Backend*: the provider's id of this refund; null on a row from before migration 0044. */
    providerRefundRef: text('provider_refund_ref'),
    /** The refund's amount in minor units (rule 8); on an older row, the rise it was read as. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    /** When Restro first read it. */
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** The venue's service day it was seen on. */
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    /** Set when the provider says the refund did not go through. */
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /** When staff said the storno was made at the till, and the account that said so. */
    stornoAt: timestamp('storno_at', { withTimezone: true }),
    stornoBy: text('storno_by'),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payment_refunds_tenant_id_id_unique').on(t.tenantId, t.id),
    venueFk('payment_refunds', t),
    foreignKey({
      name: 'payment_refunds_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('payment_refunds_payment_idx').on(t.paymentId, t.seenAt),
    // One row per provider refund: a reading repeated, or two at once, can't make a second.
    uniqueIndex('payment_refunds_provider_ref_unique')
      .on(t.paymentId, t.providerRefundRef)
      .where(sql`${t.providerRefundRef} is not null`),
    // Tonight's storno to-dos: the refunds still waiting for a storno, whatever their day.
    index('payment_refunds_open_idx')
      .on(t.venueId, t.seenAt)
      .where(sql`${t.stornoAt} is null and ${t.failedAt} is null`),
    index('payment_refunds_day_idx').on(t.venueId, t.serviceDate),
    check('payment_refunds_id_format', sql`${t.id} ~ '^rf_[0-9A-Za-z]+$'`),
    check('payment_refunds_amount', sql`${t.amountMinor} > 0`),
    check(
      'payment_refunds_provider_ref',
      sql`${t.providerRefundRef} is null or ${t.providerRefundRef} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    check(
      'payment_refunds_storno',
      sql`(${t.stornoAt} is null) = (${t.stornoBy} is null) and (${t.stornoBy} is null or ${t.stornoBy} ~ ${SERVICE_ACTOR_PATTERN})`,
    ),
    ...provenanceChecks('payment_refunds', t),
  ],
)

/**
 * One picked line of a payment: what the guest saw and confirmed, and the POS line it is
 * (backend only). Written when the payment is priced; the last check compares the POS against it.
 */
export const paymentLines = restro.table(
  'payment_lines',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    paymentId: text('payment_id').notNull(),
    /** The line's place in the payment, from 1. */
    position: integer('position').notNull(),
    /** *Backend*: the POS line reference (rule 3); null for a pay-first line until entered. */
    posLineRef: text('pos_line_ref'),
    /** The quantity picked, an exact decimal (rule 8: never a float). */
    quantity: numeric('quantity', { precision: 21, scale: 6 }).notNull(),
    /** The POS's own amount for that quantity, never price × quantity (D127 3.2). */
    posAmountMinor: bigint('pos_amount_minor', { mode: 'number' }).notNull(),
    /** The name the guest saw (one language, as picked at pricing): the record of what was shown. */
    displayName: text('display_name').notNull(),
    /**
     * The line's name in every language of the menu (a `LocalizedText`), so each phone shows it in
     * its guest's language (#197); null is "Other item", worded by the shell (D75).
     */
    name: jsonb('name').$type<Record<string, string> | null>(),
    /**
     * What the POS closed this line for (#197): set by the last check from the lines it matched on
     * the payment table, at the POS's own amount, so the lines paid plus the tip are what was
     * captured. Null until checked, and for a line the POS dropped (a voided one): such a line was
     * not paid and is never shown as paid.
     */
    closedMinor: bigint('closed_minor', { mode: 'number' }),
    /** The quantity the POS closed (a pay-first round's line may close for fewer); set with `closed_minor`. */
    closedQuantity: numeric('closed_quantity', { precision: 21, scale: 6 }),
    /**
     * True while its payment claims it; the database clears it when the payment ends (`captured`,
     * `released`, `stranded` or `capture_failed`). An `unconfirmed` payment is settled but has not
     * ended: a manager's answer can still capture its card, so its lines stay claimed (0043). A POS
     * line is in one open payment at a time (D127 5.2): the unique index below refuses a second.
     */
    open: boolean('open').notNull().default(true),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'payment_lines_pk', columns: [t.tenantId, t.paymentId, t.position] }),
    venueFk('payment_lines', t),
    foreignKey({
      name: 'payment_lines_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    // "Being paid" per line: the POS lines in a venue's payments.
    index('payment_lines_pos_line_ref_idx')
      .on(t.venueId, t.posLineRef)
      .where(sql`${t.posLineRef} is not null`),
    uniqueIndex('payment_lines_open_line_unique')
      .on(t.tenantId, t.venueId, t.posLineRef)
      .where(sql`${t.open} and ${t.posLineRef} is not null`),
    check('payment_lines_position', sql`${t.position} >= 1`),
    check('payment_lines_quantity', sql`${t.quantity} > 0`),
    check(
      'payment_lines_closed',
      sql`(${t.closedMinor} is null) = (${t.closedQuantity} is null) and (${t.closedQuantity} is null or ${t.closedQuantity} > 0)`,
    ),
    check(
      'payment_lines_name',
      sql`${t.name} is null or (jsonb_typeof(${t.name}) = 'object' and ${t.name} <> '{}'::jsonb)`,
    ),
    check(
      'payment_lines_pos_line_ref',
      sql`${t.posLineRef} is null or char_length(${t.posLineRef}) between 1 and 255`,
    ),
    check('payment_lines_display_name', sql`char_length(${t.displayName}) between 1 and 200`),
    ...provenanceChecks('payment_lines', t),
  ],
)

/**
 * One POS or provider write of a payment, append-only (D127 3.9): recorded `attempting` before the
 * call, then a new row with the outcome. The recovery job resumes from the last one.
 */
export const paymentSteps = restro.table(
  'payment_steps',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    paymentId: text('payment_id').notNull(),
    /** The call, e.g. `createHold`, `isolateLines`, `payAndClose`, `capture`. */
    step: text('step').notNull(),
    outcome: text('outcome').notNull(),
    /**
     * The connector's or provider's answer in short: a code, never a raw response. *Backend*: on a
     * `payAndClose` `attempting` row, the POS reference of the bill it closes (rule 3).
     */
    answer: text('answer'),
    /** The idempotency key the call carried. */
    idempotencyKey: text('idempotency_key'),
    /**
     * *Backend*: on an `undoIsolate` `attempting` row only, the lines read on the payment table
     * before the move back (POS references, quantities, amounts; rule 3), so a later run can prove
     * them back on the real table (#153). Null on every other row.
     */
    lines: jsonb('lines'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    ...serviceProvenance(),
  },
  (t) => [
    venueFk('payment_steps', t),
    foreignKey({
      name: 'payment_steps_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('payment_steps_payment_id_seq_idx').on(t.paymentId, t.seq.desc()),
    check('payment_steps_step', sql`${t.step} ~ ${NAME_PATTERN}`),
    check('payment_steps_outcome', sql`${t.outcome} in ${sqlWords(PAYMENT_STEP_OUTCOMES)}`),
    check(
      'payment_steps_answer',
      sql`${t.answer} is null or char_length(${t.answer}) between 1 and 500`,
    ),
    check(
      'payment_steps_idempotency_key',
      sql`${t.idempotencyKey} is null or ${t.idempotencyKey} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    // `PaymentStepLinesSchema` as far as SQL goes: on a move back's `attempting` row only, 1 to
    // 500 lines, each a POS reference, a decimal quantity and a whole amount.
    check(
      'payment_steps_lines',
      sql`${t.lines} is null or (${t.step} = 'undoIsolate' and ${t.outcome} = 'attempting'
        and case when jsonb_typeof(${t.lines}) = 'array'
          then jsonb_array_length(${t.lines}) between 1 and 500
            and not jsonb_path_exists(${t.lines}, ${PAYMENT_STEP_LINE_INVALID})
          else false end)`,
    ),
    ...provenanceChecks('payment_steps', t),
  ],
)

/**
 * A venue's payment account at its provider (D125 §The venue's side; #109 writes it): which
 * provider, the account (backend only), and the connection as last read. The provider-side checks
 * of D125 2.3 are stored as read; the till-side ones (the card payment type, marked payment
 * tables) come from the venue's own data when the settings show what's missing.
 */
export const paymentAccounts = restro.table(
  'payment_accounts',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    venueId: text('venue_id').notNull(),
    providerKind: text('provider_kind').notNull(),
    /** *Backend*: the provider's id of the venue's account; null until the provider made one. */
    accountRef: text('account_ref'),
    /** The account's name as the provider shows it, for "Connected" in the settings. */
    accountName: text('account_name'),
    state: text('state').notNull(),
    /** The provider-side checks as last read (D125 2.3); core checks the keys with Zod. */
    checks: jsonb('checks').$type<Record<string, unknown>>().notNull().default({}),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    /**
     * Since when the provider's breaker pauses paying in the app at the venue (#112, D127 3.8), or
     * null while paying flows. Ordering never stops for it.
     */
    payingPausedAt: timestamp('paying_paused_at', { withTimezone: true }),
    /** The breaker's state (core's `BreakerStateSchema`), so a restarted worker restores it. */
    breaker: jsonb('breaker').$type<Record<string, unknown>>(),
    ...serviceProvenance(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'payment_accounts_pk', columns: [t.tenantId, t.venueId] }),
    check(
      'payment_accounts_breaker',
      sql`${t.breaker} is null or jsonb_typeof(${t.breaker}) = 'object'`,
    ),
    venueFk('payment_accounts', t),
    // A notice names the account and the worker finds its venue by it: an account is one venue's.
    uniqueIndex('payment_accounts_account_unique')
      .on(t.providerKind, t.accountRef)
      .where(sql`${t.accountRef} is not null`),
    check('payment_accounts_provider_kind', sql`${t.providerKind} ~ ${PROVIDER_KIND_PATTERN}`),
    check(
      'payment_accounts_account_ref',
      sql`${t.accountRef} is null or ${t.accountRef} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    check(
      'payment_accounts_account_name',
      sql`${t.accountName} is null or char_length(${t.accountName}) between 1 and 200`,
    ),
    check('payment_accounts_state', sql`${t.state} in ${sqlWords(PAYMENT_ACCOUNT_STATES)}`),
    check(
      'payment_accounts_connected_has_account',
      sql`${t.state} not in ('connected', 'lost_access') or ${t.accountRef} is not null`,
    ),
    check('payment_accounts_checks_object', sql`jsonb_typeof(${t.checks}) = 'object'`),
    ...provenanceChecks('payment_accounts', t),
  ],
)

/**
 * The provider's notices (D127 §Where things run; design §8): platform-level, with no venue and
 * no tenant. The notice route stores each event once by its id and queues a worker job; the
 * worker reads the object back from the provider and maps the account to its venue.
 */
export const providerNotices = restro.table(
  'provider_notices',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    providerKind: text('provider_kind').notNull(),
    /** The provider's event id. */
    eventId: text('event_id').notNull(),
    /** The provider's live/test flag; the route refuses one that doesn't match this environment. */
    live: boolean('live').notNull(),
    /** *Backend*: the account the event is about, or null for a platform event. */
    accountRef: text('account_ref'),
    /** The event's type as the provider names it. */
    type: text('type').notNull(),
    /** What it is about in the platform's words (`PROVIDER_NOTICE_KINDS`), which picks the handler. */
    kind: text('kind').notNull(),
    /** *Backend*: the object the event is about (a payment, a refund, a dispute), read back. */
    objectRef: text('object_ref'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    ...serviceProvenance(),
  },
  (t) => [
    unique('provider_notices_event_unique').on(t.providerKind, t.eventId),
    index('provider_notices_unhandled_idx').on(t.receivedAt).where(sql`${t.handledAt} is null`),
    check('provider_notices_provider_kind', sql`${t.providerKind} ~ ${PROVIDER_KIND_PATTERN}`),
    check('provider_notices_event_id', sql`${t.eventId} ~ ${PROVIDER_REF_PATTERN}`),
    check(
      'provider_notices_account_ref',
      sql`${t.accountRef} is null or ${t.accountRef} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    check('provider_notices_type', sql`${t.type} ~ ${NAME_PATTERN}`),
    check('provider_notices_kind', sql`${t.kind} in ${sqlWords(PROVIDER_NOTICE_KINDS)}`),
    check(
      'provider_notices_object_ref',
      sql`${t.objectRef} is null or ${t.objectRef} ~ ${PROVIDER_REF_PATTERN}`,
    ),
    check(
      'provider_notices_handled_after_received',
      sql`${t.handledAt} is null or ${t.handledAt} >= ${t.receivedAt}`,
    ),
    ...provenanceChecks('provider_notices', t),
  ],
)
