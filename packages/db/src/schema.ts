// Drizzle schema for every table Restro owns. All of them live in the Postgres schema `restro`
// (never `public`). Row-level security, the RLS helper and the app role's privileges are not
// expressible here: they live in the SQL migrations (migrations/0001_tenant_rls.sql) and in
// src/table-access.ts, whose header says how to add a table.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
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
     * Venue settings that are not columns of their own (S3-03). `theme` is the look of the guest
     * menu: `{brand: '#rrggbb', logo_asset_id: 'as_…' | null}`. core/apply validates and writes
     * it (`setVenueTheme`); the publisher turns it into the snapshot's theme.
     */
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Kept current by the `venues_touch_updated_at` trigger, whatever writes the row. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    host: text('host').notNull(),
    credentialsSealed: text('credentials_sealed'),
    status: text('status').notNull().default('new'),
    statusDetail: text('status_detail'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    config: jsonb('config').$type<IntegrationConfig>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('integrations_tenant_id_id_unique').on(t.tenantId, t.id),
    check('integrations_id_format', sql`${t.id} ~ '^in_[0-9A-Za-z]+$'`),
    check('integrations_kind', sql`${t.kind} in ('barsy')`),
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

/** A menu: one per venue (P47). Its id is its root node's id: a menu is its root node. */
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('menus_venue_id_unique').on(t.venueId),
    // Target of the composite foreign keys (tenant_id, menu_id) of the publish tables.
    unique('menus_tenant_id_id_unique').on(t.tenantId, t.id),
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
 */
export const events = restro.table(
  'events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
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
      sql`${t.op} in ('setField', 'clearField', 'createNode', 'setPlacement', 'removePlacement', 'moveNode', 'setNodeStatus', 'linkSource', 'unlinkSource', 'setLinkState')`,
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
    isPublic: boolean('is_public').notNull(),
    state: text('state').notNull().default('active'),
    /**
     * The QR code's random token (brief S3-07): 22 base62 characters from `crypto`, never derived
     * from a barsy id; null = no code. `/t/<token>` leads to the menu with this table's name.
     */
    qrToken: text('qr_token'),
    /** What the guest page calls the table when a manager has chosen a name; else `place_num`. */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('places_integration_id_bid_place_id_unique').on(t.integrationId, t.bid, t.placeId),
    unique('places_qr_token_unique').on(t.qrToken),
    foreignKey({
      name: 'places_barsy_venue_fk',
      columns: [t.tenantId, t.integrationId, t.bid],
      foreignColumns: [barsyVenues.tenantId, barsyVenues.integrationId, barsyVenues.bid],
    }),
    check('places_id_format', sql`${t.id} ~ '^tb_[0-9A-Za-z]+$'`),
    check('places_state', sql`${t.state} in ('active', 'missing', 'deleted')`),
    // The token file (`t/<token>.json`) holds a label of 1 to 40 characters.
    check(
      'places_label_length',
      sql`${t.label} is null or (char_length(${t.label}) between 1 and 40 and ${t.label} = btrim(${t.label}))`,
    ),
    // A token is URL-safe and opaque: the same shape as `TABLE_TOKEN_PATTERN` in @restro/core.
    check(
      'places_qr_token_format',
      sql`${t.qrToken} is null or ${t.qrToken} ~ '^[A-Za-z0-9_-]{8,128}$'`,
    ),
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
