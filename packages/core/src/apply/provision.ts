// Provisioning: creating a tenant row and a venue row. Rule 1 (one write path): only code under
// packages/core/src/apply/ may import the write side of @restro/db, so the web app's sign-up and
// seed flows create tenants and venues through here. Stage 2's `apply()` will sit next to this
// file and share its transaction helper.
//
// This module is exported as `@restro/core/apply`, never from `@restro/core` itself: it pulls in
// the database driver, and pure consumers (the shell, the faces, client components) must not.

import { type DbPool, menus, nodes, tenants, type Venue, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'

import { isId, type NodeId, newId } from '../ids'
import { LOCALES, type Locale } from '../locales'
import { CURRENCIES, type Currency } from '../money'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { lockTenantDocument } from './lock'

/** Why a provisioning call was refused. */
export type ProvisionErrorCode =
  | 'invalid_input'
  /** The venue's tenant has no `tenants` row yet (provision the tenant first). */
  | 'tenant_missing'
  /** The tenant already has a venue with this slug. */
  | 'slug_taken'
  /** The tenant has no venue with this id (`provisionMenu`). */
  | 'venue_missing'

/** Thrown by `provisionTenant` and `provisionVenue` for input or state they refuse. */
export class ProvisionError extends Error {
  override name = 'ProvisionError'
  readonly code: ProvisionErrorCode

  constructor(code: ProvisionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** Venue slugs: lower-case kebab-case, 1 to 63 characters (`demo-club`). */
export const VENUE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 63
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
  /** Unique per tenant; lower-case kebab-case. */
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

/**
 * Creates a venue (a club) for an existing tenant, with a fresh `vn_` id, and returns the row.
 * Refuses a malformed name, slug, time zone, currency or locale list before touching the
 * database; a taken slug and a missing tenant row come back as `ProvisionError`s.
 */
export async function provisionVenue(
  pool: DbPool,
  tenantId: string,
  input: ProvisionVenueInput,
): Promise<Venue> {
  if (!isId('tn', tenantId)) {
    throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  }
  const name = checkedName(input.name, 'the venue name')
  if (
    typeof input.slug !== 'string' ||
    input.slug.length > MAX_SLUG_LENGTH ||
    !VENUE_SLUG_PATTERN.test(input.slug)
  ) {
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

  try {
    return await withTenantWrite(pool, tenantId, async (tx) => {
      const [venue] = await tx
        .insert(venues)
        .values({
          id: newId('vn'),
          tenantId,
          name,
          slug: input.slug,
          timezone,
          serviceDayEndsAt,
          currency,
          defaultLocale,
          enabledLocales,
        })
        .returning()
      if (!venue) throw new ProvisionError('invalid_input', 'the venue row was not created')
      return venue
    })
  } catch (error) {
    if (error instanceof ProvisionError) throw error
    const { code, constraint } = pgErrorOf(error)
    if (code === '23505' && constraint === 'venues_tenant_id_slug_unique') {
      throw new ProvisionError('slug_taken', `this tenant already has a venue "${input.slug}"`, {
        cause: error,
      })
    }
    if (code === '23503') {
      throw new ProvisionError('tenant_missing', 'the tenant has no row yet: provision it first', {
        cause: error,
      })
    }
    throw error
  }
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
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId))
    if (!venue) throw new ProvisionError('venue_missing', `this tenant has no venue ${venueId}`)
    const [existing] = await tx.select().from(menus).where(eq(menus.venueId, venueId))
    if (existing) {
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
    return { ...menu, created: true }
  })
}
