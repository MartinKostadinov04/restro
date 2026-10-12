// The organisation's part of a guest address (D84): its slug, `auth_organization.slug`, unique
// platform-wide and Better Auth's to change (the organisation plugin's server API, called by the
// Organisation › General action). What is ours is the memory of its earlier slugs
// (`organization_slug_history`, a system table), so an old address keeps leading to the new one
// through the published redirect file `o/<old slug>.json` (the worker writes it from this table).
// Only this folder may import the write side of the database (rule 1's door).
//
// Also here: the organisation's other settings (`tenants.settings`), today the POS systems it
// chose in Settings › Integrations (`setOrganizationSystems`, D81).

import type { ReadTx } from '@restro/db'
import {
  authOrganization,
  type DbPool,
  integrations,
  organizationSlugHistory,
  tenants,
  withTenant,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { INTEGRATION_KINDS, type IntegrationKind } from '../connectors'
import { isOrganizationSlug } from '../guest-files'
import { isId } from '../ids'
import { lockTenantDocument } from './lock'
import { ProvisionError } from './provision'

/** The organisation's address parts as the files carry them. */
export interface OrganizationAddress {
  readonly organizationId: string
  readonly name: string
  readonly slug: string
  /** Its earlier slugs, oldest first, without the current one. */
  readonly oldSlugs: readonly string[]
}

/**
 * The organisation's current slug and its earlier ones, inside a transaction the caller owns
 * (the publisher's and the index writer's). Null when there is no such organisation.
 */
export async function organizationAddressIn(
  tx: ReadTx | WriteTx,
  organizationId: string,
): Promise<OrganizationAddress | null> {
  const [organization] = await tx
    .select({ name: authOrganization.name, slug: authOrganization.slug })
    .from(authOrganization)
    .where(eq(authOrganization.id, organizationId))
  if (organization === undefined) return null
  const history = await tx
    .select({ slug: organizationSlugHistory.slug })
    .from(organizationSlugHistory)
    .where(eq(organizationSlugHistory.organizationId, organizationId))
    .orderBy(asc(organizationSlugHistory.replacedAt), asc(organizationSlugHistory.slug))
  return {
    organizationId,
    name: organization.name,
    slug: organization.slug,
    oldSlugs: history.map((row) => row.slug).filter((slug) => slug !== organization.slug),
  }
}

/** `organizationAddressIn` in a read transaction of its own. */
export function organizationAddress(
  pool: DbPool,
  organizationId: string,
): Promise<OrganizationAddress | null> {
  if (!isId('tn', organizationId)) return Promise.resolve(null)
  return withTenant(pool, organizationId, (tx) => organizationAddressIn(tx, organizationId))
}

/** Why `recordOrganizationSlug` refused. */
export type OrganizationSlugError =
  | 'invalid_input'
  /** The slug belongs to another organisation (its current or an earlier one). */
  | 'slug_taken'

/** What `recordOrganizationSlug` answers. */
export type OrganizationSlugRecorded =
  | { readonly ok: true; readonly recorded: boolean }
  | { readonly ok: false; readonly error: OrganizationSlugError; readonly reason: string }

/**
 * Remembers that the organisation was called `previousSlug` before its slug changed, so the old
 * address redirects (D84). Called right after Better Auth has saved the new slug; recording the
 * same slug twice, or the organisation's current slug, writes nothing. A slug that an older entry
 * gives to ANOTHER organisation is refused (`slug_taken`): it is theirs to redirect.
 */
export async function recordOrganizationSlug(
  pool: DbPool,
  input: { readonly organizationId: string; readonly previousSlug: string },
): Promise<OrganizationSlugRecorded> {
  const { organizationId, previousSlug } = input
  if (!isId('tn', organizationId)) {
    return { ok: false, error: 'invalid_input', reason: 'organizationId must be a tn_ id' }
  }
  if (!isOrganizationSlug(previousSlug)) {
    return { ok: false, error: 'invalid_input', reason: 'the slug must be lower-case kebab-case' }
  }
  return withTenantWrite(pool, organizationId, async (tx) => {
    const [current] = await tx
      .select({ slug: authOrganization.slug })
      .from(authOrganization)
      .where(eq(authOrganization.id, organizationId))
    if (current === undefined) {
      throw new ProvisionError('tenant_missing', `there is no organisation ${organizationId}`)
    }
    if (current.slug === previousSlug) return { ok: true, recorded: false }
    const [existing] = await tx
      .select({ organizationId: organizationSlugHistory.organizationId })
      .from(organizationSlugHistory)
      .where(eq(organizationSlugHistory.slug, previousSlug))
    if (existing !== undefined) {
      if (existing.organizationId === organizationId) return { ok: true, recorded: false }
      return {
        ok: false,
        error: 'slug_taken',
        reason: `the address name ${JSON.stringify(previousSlug)} belongs to another organisation`,
      }
    }
    await tx.insert(organizationSlugHistory).values({ slug: previousSlug, organizationId })
    return { ok: true, recorded: true }
  })
}

/**
 * True when `slug` may become an organisation's slug: not another organisation's current one and
 * not one an organisation was called before (their old addresses keep redirecting, D84). The
 * organisation's own earlier slug may be taken back.
 */
export async function organizationSlugIsFree(
  pool: DbPool,
  organizationId: string,
  slug: string,
): Promise<boolean> {
  if (!isId('tn', organizationId) || !isOrganizationSlug(slug)) return false
  return withTenant(pool, organizationId, async (tx) => {
    const [current] = await tx
      .select({ id: authOrganization.id })
      .from(authOrganization)
      .where(eq(authOrganization.slug, slug))
    if (current !== undefined && current.id !== organizationId) return false
    const [earlier] = await tx
      .select({ organizationId: organizationSlugHistory.organizationId })
      .from(organizationSlugHistory)
      .where(eq(organizationSlugHistory.slug, slug))
    return earlier === undefined || earlier.organizationId === organizationId
  })
}

// --- the systems the organisation chose (adjustments I1, D81) ---------------------------------

/**
 * The POS systems an organisation chose in Settings › Integrations, stored as connector kinds in
 * `tenants.settings.systems`. Each chosen system gets its tab; an instance can only be added for a
 * chosen system, and a system that still has instances cannot be unchosen.
 */
const SystemsInput = z
  .array(z.enum(INTEGRATION_KINDS))
  .refine((list) => new Set(list).size === list.length)

/** The kinds in the order core lists them (`INTEGRATION_KINDS`), without duplicates. */
function canonicalSystems(kinds: Iterable<string>): IntegrationKind[] {
  const wanted = new Set(kinds)
  return INTEGRATION_KINDS.filter((kind) => wanted.has(kind))
}

/**
 * The systems the organisation chose, in core's order. A stored list that is not an array, or
 * names a kind this build does not know, counts for what it does hold (the known kinds), so a
 * hand-edited setting never breaks the page.
 */
export async function readOrganizationSystems(
  pool: DbPool,
  tenantId: string,
): Promise<IntegrationKind[]> {
  if (!isId('tn', tenantId)) return []
  return withTenant(pool, tenantId, async (tx) => {
    const [row] = await tx.select({ settings: tenants.settings }).from(tenants)
    const systems = row?.settings.systems
    return Array.isArray(systems)
      ? canonicalSystems(systems.filter((kind): kind is string => typeof kind === 'string'))
      : []
  })
}

/** Why `setOrganizationSystems` refused. */
export type OrganizationSystemsError =
  /** Not a list of known system kinds without duplicates. */
  | 'invalid_input'
  /** A system that still has instances (not removed ones) cannot be left out. */
  | 'has_instances'

/** What `setOrganizationSystems` answers. */
export type OrganizationSystemsSaved =
  | { readonly ok: true; readonly systems: readonly IntegrationKind[] }
  | { readonly ok: false; readonly error: OrganizationSystemsError }

/**
 * Saves the systems the organisation uses (`tenants.settings.systems`, a merge: the other settings
 * stay). Strict: only known connector kinds, each once. Leaving out a system that still has an
 * instance, one that is not removed, is refused (`has_instances`): remove the instances first.
 * The answer carries the saved list in core's order.
 */
export async function setOrganizationSystems(
  pool: DbPool,
  tenantId: string,
  systems: readonly string[],
): Promise<OrganizationSystemsSaved> {
  if (!isId('tn', tenantId)) {
    throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  }
  const parsed = SystemsInput.safeParse(systems)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const chosen = canonicalSystems(parsed.data)
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const inUse = await tx
      .selectDistinct({ kind: integrations.kind })
      .from(integrations)
      .where(isNull(integrations.removedAt))
    if (inUse.some((row) => !chosen.includes(row.kind as IntegrationKind))) {
      return { ok: false, error: 'has_instances' } as const
    }
    const updated = await tx
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ systems: chosen })}::jsonb` })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id })
    if (updated.length === 0) {
      throw new ProvisionError('tenant_missing', `there is no organisation ${tenantId}`)
    }
    return { ok: true, systems: chosen } as const
  })
}
