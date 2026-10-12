// Provisioning: creating a tenant row and a venue row. Rule 1 (one write path): only code under
// packages/core/src/apply/ may import the write side of @restro/db, so the web app's sign-up and
// seed flows create tenants and venues through here. Stage 2's `apply()` will sit next to this
// file and share its transaction helper.
//
// This module is exported as `@restro/core/apply`, never from `@restro/core` itself: it pulls in
// the database driver, and pure consumers (the shell, the faces, client components) must not.

import {
  type DbPool,
  menus,
  nodes,
  tenants,
  tombstones,
  type Venue,
  venueSlugHistory,
  venues,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, isNull } from 'drizzle-orm'

import { isVenueSlug } from '../guest-files'
import { isId, type NodeId, newId } from '../ids'
import { LOCALES, type Locale } from '../locales'
import { CURRENCIES, type Currency } from '../money'
import { newPublicId } from '../public-id'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { lockTenantDocument } from './lock'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why a provisioning call was refused. */
export type ProvisionErrorCode =
  | 'invalid_input'
  /** The venue's tenant has no `tenants` row yet (provision the tenant first). */
  | 'tenant_missing'
  /** The tenant has no venue with this id (`provisionMenu`, `renameVenueSlug`, `renameVenue`, …). */
  | 'venue_missing'
  /** The venue was deleted (archived, D76): every writer of one venue refuses it (`lockLiveVenue`). */
  | 'venue_archived'
  /** Another venue of the organisation holds this address name (D84; one name per organisation). */
  | 'slug_taken'

/** Thrown by the provisioning and venue-lifecycle writers for input or state they refuse. */
export class ProvisionError extends Error {
  override name = 'ProvisionError'
  readonly code: ProvisionErrorCode

  constructor(code: ProvisionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

const MAX_NAME_LENGTH = 200
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function checkedName(name: unknown, what: string): string {
  if (typeof name !== 'string') throw new ProvisionError('invalid_input', `${what} must be text`)
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new ProvisionError('invalid_input', `${what} must not be empty`)
  if ([...trimmed].length > MAX_NAME_LENGTH) {
    throw new ProvisionError(
      'invalid_input',
      `${what} is longer than ${MAX_NAME_LENGTH} characters`,
    )
  }
  return trimmed
}

/** What `provisionTenant` needs. */
export interface ProvisionTenantInput {
  /** The tenant id, produced by `newId('tn')`: the auth organisation id *is* the tenant id. */
  readonly tenantId: string
  readonly name: string
}

/** The tenant row after `provisionTenant`; `created` is false when it already existed. */
export interface ProvisionedTenant {
  readonly id: string
  readonly name: string
  readonly created: boolean
}

/**
 * Creates the `restro.tenants` row for a tenant (inside a write transaction scoped to that
 * tenant, so row-level security lets the app role insert exactly this row). Idempotent: calling
 * it again for an existing tenant changes nothing and reports `created: false`.
 */
export async function provisionTenant(
  pool: DbPool,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  if (!isId('tn', input.tenantId)) {
    throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id from newId("tn")')
  }
  const name = checkedName(input.name, 'the tenant name')
  const tenantId = input.tenantId
  return withTenantWrite(pool, tenantId, async (tx) => {
    const inserted = await tx
      .insert(tenants)
      .values({ id: tenantId, name })
      .onConflictDoNothing()
      .returning({ id: tenants.id, name: tenants.name })
    const row = inserted[0]
    if (row) return { id: row.id, name: row.name, created: true }
    const existing = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants)
    const current = existing[0]
    if (!current) {
      throw new ProvisionError('invalid_input', 'the tenant row could not be created or read')
    }
    return { id: current.id, name: current.name, created: false }
  })
}

/** What `provisionVenue` needs; everything but `name` and `slug` has the database's default. */
export interface ProvisionVenueInput {
  readonly name: string
  /**
   * The readable part of the public address `/m/<slug>-<code>`; lower-case kebab-case. Not unique
   * and editable later (`renameVenueSlug`): the venue's random public code finds the menu (D68).
   */
  readonly slug: string
  /** IANA time zone; default `Europe/Sofia`. */
  readonly timezone?: string
  /** `HH:MM`, local time at which the service day ends (D45); default `07:00`. */
  readonly serviceDayEndsAt?: string
  readonly currency?: Currency
  readonly defaultLocale?: Locale
  readonly enabledLocales?: readonly Locale[]
}

/** Postgres error code of the failure inside a Drizzle error (Drizzle wraps the driver error). */
function pgErrorOf(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  if (typeof current === 'object' && current !== null) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown }
    return {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof constraint === 'string' ? { constraint } : {}),
    }
  }
  return {}
}

/** A venue's input after `checkedVenue`: every default filled in, every rule checked. */
interface CheckedVenue {
  readonly name: string
  readonly slug: string
  readonly timezone: string
  readonly serviceDayEndsAt: string
  readonly currency: Currency
  readonly defaultLocale: Locale
  readonly enabledLocales: Locale[]
}

/** Refuses a malformed name, slug, time zone, currency or locale list before the database is touched. */
function checkedVenue(tenantId: string, input: ProvisionVenueInput): CheckedVenue {
  if (!isId('tn', tenantId)) {
    throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  }
  const name = checkedName(input.name, 'the venue name')
  if (!isVenueSlug(input.slug)) {
    throw new ProvisionError('invalid_input', 'the venue slug must be lower-case kebab-case')
  }
  const timezone = input.timezone ?? 'Europe/Sofia'
  if (!isTimeZone(timezone)) {
    throw new ProvisionError('invalid_input', 'the time zone must be an IANA time zone')
  }
  const serviceDayEndsAt = input.serviceDayEndsAt ?? '07:00'
  if (!CLOCK_TIME_PATTERN.test(serviceDayEndsAt)) {
    throw new ProvisionError('invalid_input', 'the service day end must be HH:MM')
  }
  const currency = input.currency ?? 'EUR'
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    throw new ProvisionError(
      'invalid_input',
      `the currency must be one of ${CURRENCIES.join(', ')}`,
    )
  }
  const defaultLocale = input.defaultLocale ?? 'bg_BG'
  const enabledLocales = [...(input.enabledLocales ?? ['bg_BG', 'en_US'])]
  const unknownLocales = [defaultLocale, ...enabledLocales].filter(
    (locale) => !(LOCALES as readonly string[]).includes(locale),
  )
  if (unknownLocales.length > 0) {
    throw new ProvisionError('invalid_input', `unknown locale(s): ${unknownLocales.join(', ')}`)
  }
  if (new Set(enabledLocales).size !== enabledLocales.length || enabledLocales.length === 0) {
    throw new ProvisionError(
      'invalid_input',
      'enabled locales must be a non-empty list without repeats',
    )
  }
  if (!enabledLocales.includes(defaultLocale)) {
    throw new ProvisionError(
      'invalid_input',
      'the default locale must be one of the enabled locales',
    )
  }
  return {
    name,
    slug: input.slug,
    timezone,
    serviceDayEndsAt,
    currency,
    defaultLocale,
    enabledLocales,
  }
}

/** Inserts the venue row, with a fresh id and a fresh public code. */
/**
 * A public code no purged venue ever had (D83: a tombstoned code is never reissued, so an old
 * sticker or link can never open another venue's menu). Drawn again on the rare hit.
 */
async function freshPublicId(tx: WriteTx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newPublicId()
    const [taken] = await tx
      .select({ value: tombstones.value })
      .from(tombstones)
      .where(and(eq(tombstones.kind, 'public_code'), eq(tombstones.value, code)))
    if (taken === undefined) return code
  }
  throw new Error('could not draw a public code that was never purged')
}

async function insertVenueRow(tx: WriteTx, tenantId: string, venue: CheckedVenue): Promise<Venue> {
  const [row] = await tx
    .insert(venues)
    .values({ id: newId('vn'), tenantId, publicId: await freshPublicId(tx), ...venue })
    .returning()
  if (!row) throw new ProvisionError('invalid_input', 'the venue row was not created')
  return row
}

/** Whether `error` is the clash of a drawn public code with a taken one. */
function isPublicIdClash(error: unknown): boolean {
  const { code, constraint } = pgErrorOf(error)
  return code === '23505' && constraint === 'venues_public_id_unique'
}

/** Whether `error` is the clash of an address name with another venue of the organisation (D84). */
function isSlugClash(error: unknown): boolean {
  const { code, constraint } = pgErrorOf(error)
  return code === '23505' && constraint === 'venues_tenant_id_slug_unique'
}

/** The refusal for a taken address name. */
function slugTaken(slug: string, cause: unknown): ProvisionError {
  return new ProvisionError(
    'slug_taken',
    `another venue of the organisation already has the address name ${JSON.stringify(slug)}`,
    cause === null ? undefined : { cause },
  )
}

/**
 * The venue the organisation's address-name history reserves `slug` for (an earlier name of
 * that venue, D84), or null when no venue was called so before.
 */
async function reservedBy(tx: WriteTx, slug: string): Promise<string | null> {
  const [row] = await tx
    .select({ venueId: venueSlugHistory.venueId })
    .from(venueSlugHistory)
    .where(eq(venueSlugHistory.slug, slug))
  return row?.venueId ?? null
}

/**
 * Creates a venue (a club) for an existing tenant, with a fresh `vn_` id and a fresh public code,
 * and returns the row. Refuses a malformed name, slug, time zone, currency or locale list before
 * touching the database; a missing tenant row comes back as a `ProvisionError`.
 *
 * The public code (`public_id`, D68) is what finds the venue's menu: 12 random characters, unique
 * across all tenants and permanent. Row-level security hides other tenants' venues, so no query
 * could tell whether a drawn code is free: the unique index decides (`venues_public_id_unique`),
 * and on a clash a new code is drawn once more (a second clash among 36^12 codes is a bug, and
 * throws). The slug is only decoration: any number of venues may share one.
 */
export async function provisionVenue(
  pool: DbPool,
  tenantId: string,
  input: ProvisionVenueInput,
): Promise<Venue> {
  const checked = checkedVenue(tenantId, input)
  const insertVenue = () =>
    withTenantWrite(pool, tenantId, async (tx) => {
      // An earlier name of a venue of the organisation keeps redirecting to it (D84).
      if ((await reservedBy(tx, checked.slug)) !== null) throw slugTaken(checked.slug, null)
      return insertVenueRow(tx, tenantId, checked)
    })

  try {
    try {
      return await insertVenue()
    } catch (error) {
      // The drawn code is taken: the failed transaction is rolled back, so draw once more.
      if (!isPublicIdClash(error)) throw error
      return await insertVenue()
    }
  } catch (error) {
    if (error instanceof ProvisionError) throw error
    if (isSlugClash(error)) throw slugTaken(checked.slug, error)
    const { code } = pgErrorOf(error)
    if (code === '23503') {
      throw new ProvisionError('tenant_missing', 'the tenant has no row yet: provision it first', {
        cause: error,
      })
    }
    throw error
  }
}

/**
 * `provisionVenue` inside a transaction the caller owns, for a write that must create the venue
 * and something else together or not at all (CF-09b: "Add as venue" makes the venue, its menu and
 * the link in one go). The same checks and the same public code; a clash of the code is redrawn
 * once inside a savepoint, since the failed insert would otherwise spoil the whole transaction.
 * A missing tenant row is left to the caller (its foreign key fails the transaction).
 */
export async function provisionVenueIn(
  tx: WriteTx,
  tenantId: string,
  input: ProvisionVenueInput,
): Promise<Venue> {
  const checked = checkedVenue(tenantId, input)
  // An address name a venue of the organisation was called before keeps redirecting to that
  // venue (D84): it is not free for a new one.
  if ((await reservedBy(tx, checked.slug)) !== null) throw slugTaken(checked.slug, null)
  const attempt = () => tx.transaction((inner) => insertVenueRow(inner, tenantId, checked))
  try {
    return await attempt()
  } catch (error) {
    if (isSlugClash(error)) throw slugTaken(checked.slug, error)
    if (!isPublicIdClash(error)) throw error
    return await attempt()
  }
}

/** What `renameVenueSlug` did. */
export interface RenamedVenueSlug {
  readonly venueId: string
  readonly slug: string
  /** The venue's public code, which a rename never changes. */
  readonly publicId: string
  /** False when the venue already had this slug (nothing was written). */
  readonly changed: boolean
}

/**
 * Changes a venue's address name (D84; before D68's readable part). The public code stays, so
 * every link ever printed or shared keeps finding the menu, and the old name is remembered
 * (`venue_slug_history`), so `/m/<organisation>/<old name>` leads to the new one once the
 * organisation's index is written again (the caller queues it). Refuses a malformed slug
 * (`invalid_input`), a venue the tenant does not have (`venue_missing`), a deleted one
 * (`venue_archived`) and a name another venue of the organisation has or had (`slug_taken`); a
 * venue may take one of its own earlier names back. The same slug again writes nothing.
 */
export async function renameVenueSlug(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  slug: string,
): Promise<RenamedVenueSlug> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  if (!isVenueSlug(slug)) {
    throw new ProvisionError('invalid_input', 'the venue slug must be lower-case kebab-case')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    const { venue } = locked
    if (venue.slug === slug) return { venueId, slug, publicId: venue.publicId, changed: false }
    const reserved = await reservedBy(tx, slug)
    if (reserved !== null && reserved !== venueId) throw slugTaken(slug, null)
    await tx.update(venues).set({ slug }).where(eq(venues.id, venueId))
    // The old name redirects to this venue from now on. A name the venue held before is in the
    // history for it already (no other venue can hold or reserve it): nothing to add then.
    await tx
      .insert(venueSlugHistory)
      .values({ tenantId, venueId, slug: venue.slug })
      .onConflictDoNothing({ target: [venueSlugHistory.tenantId, venueSlugHistory.slug] })
    return { venueId, slug, publicId: venue.publicId, changed: true }
  }).catch((error: unknown) => {
    if (isSlugClash(error)) throw slugTaken(slug, error)
    throw error
  })
}

/** A venue's menu after `provisionMenu`; `created` is false when it already existed. */
export interface ProvisionedMenu {
  /** The menu's id, which is its root node's id. */
  readonly id: NodeId
  readonly venueId: string
  readonly templateKey: string
  readonly templateVersion: number
  readonly rootNodeId: NodeId
  readonly created: boolean
}

/**
 * Creates the venue's menu (one per venue, P47): a root node of type `menu` and the `menus` row
 * pinning `VENUE_MENU_TEMPLATE` (`venue-menu@1`). Idempotent: for a venue that has its menu it
 * changes nothing and returns that menu with `created: false`. Refuses a venue the tenant does
 * not have (`venue_missing`). The menu starts empty: sections and values come through `apply()`.
 */
export async function provisionMenu(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<ProvisionedMenu> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  return withTenantWrite(pool, tenantId, (tx) => provisionMenuIn(tx, tenantId, venueId))
}

/** `provisionMenu` inside a transaction the caller owns (see `provisionVenueIn`). */
export async function provisionMenuIn(
  tx: WriteTx,
  tenantId: string,
  venueId: string,
): Promise<ProvisionedMenu> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  await lockTenantDocument(tx, tenantId)
  const locked = await lockLiveVenue(tx, venueId)
  if (locked.refused !== null) {
    throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
  }
  const [existing] = await tx
    .select()
    .from(menus)
    .where(and(eq(menus.venueId, venueId), isNull(menus.deletedAt)))
    .orderBy(menus.sortKey, menus.id)
    .limit(1)
  if (existing) {
    await adoptLiveMenu(tx, venueId, existing.id)
    return {
      id: existing.id as NodeId,
      venueId: existing.venueId,
      templateKey: existing.templateKey,
      templateVersion: existing.templateVersion,
      rootNodeId: existing.rootNodeId as NodeId,
      created: false,
    }
  }
  const rootNodeId = newId('nd')
  await tx.insert(nodes).values({ id: rootNodeId, tenantId, nodeType: 'menu', parentId: null })
  const menu = {
    id: rootNodeId,
    venueId,
    templateKey: VENUE_MENU_TEMPLATE.key,
    templateVersion: VENUE_MENU_TEMPLATE.version,
    rootNodeId,
  }
  await tx.insert(menus).values({ ...menu, tenantId })
  await adoptLiveMenu(tx, venueId, rootNodeId)
  return { ...menu, created: true }
}

/**
 * Makes `menuId` the venue's live menu when it has none yet (`venues.live_menu_id`, D88): a
 * venue's first menu is live by default. A venue that already chose one is left alone.
 */
async function adoptLiveMenu(tx: WriteTx, venueId: string, menuId: string): Promise<void> {
  await tx
    .update(venues)
    .set({ liveMenuId: menuId })
    .where(and(eq(venues.id, venueId), isNull(venues.liveMenuId)))
}
