// Source plumbing that a change set cites: the configured integration and the tier-1 records a
// barsy write names (`sourceRecordId`). Rule 1 keeps writes to the document (nodes, values,
// links, placements, events) in apply(); these two tables are not the document, but the web app
// (the Integration tab) and the worker (the sync jobs) both write them, and only this folder may
// import the write side of the database.
//
// Exported as `@restro/core/apply`, never from `@restro/core` itself.

import { type DbPool, type Integration, integrations, sourceRecords } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { isScope, type Scope } from '../change-set'
import type { IntegrationKind } from '../connectors'
import { tillVenueLinks } from '../connectors/till-venues'
import { sha256Hex } from '../hash'
import { isId, newId } from '../ids'
import { lockTenantDocument } from './lock'
import { ProvisionError } from './provision'

/** The integration kinds a tenant can configure (defined with the connector data in core). */
export type { IntegrationKind }

/** The states of an integration (`integrations.status`). */
export const INTEGRATION_STATUSES = ['new', 'connected', 'error'] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

const MAX_STATUS_DETAIL_LENGTH = 500
const MAX_SEALED_LENGTH = 4096

function checkedHost(value: unknown): string {
  const host = typeof value === 'string' ? value.trim() : ''
  if (host === '' || host.length > 253 || /[\s/@]/.test(host)) {
    throw new ProvisionError('invalid_input', 'the host must be a bare host name')
  }
  return host
}

function checkedTenant(tenantId: string): void {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
}

function checkedSealed(value: string): string {
  if (value.length === 0 || value.length > MAX_SEALED_LENGTH || /\s/.test(value)) {
    throw new ProvisionError('invalid_input', 'the sealed credentials are not a sealed envelope')
  }
  return value
}

function checkedDetail(value: string | null): string | null {
  if (value === null) return null
  return value.length > MAX_STATUS_DETAIL_LENGTH
    ? `${value.slice(0, MAX_STATUS_DETAIL_LENGTH - 3)}...`
    : value
}

/** Most characters in an instance's name (`integrations.name`). */
export const MAX_INTEGRATION_NAME_LENGTH = 80

/** Refuses an empty, blank or overlong instance name; returns it trimmed. */
function checkedInstanceName(value: string): string {
  const name = value.trim()
  if (name === '' || name.length > MAX_INTEGRATION_NAME_LENGTH) {
    throw new ProvisionError(
      'invalid_input',
      `the instance name must be 1 to ${MAX_INTEGRATION_NAME_LENGTH} characters`,
    )
  }
  return name
}

/** What `createIntegration` needs. */
export interface CreateIntegrationInput {
  readonly kind: IntegrationKind
  /**
   * The instance's name in the admin (D81): what the owner calls this connection. Default:
   * "<kind> – <host>".
   */
  readonly name?: string
  /** The installation's host, e.g. `demo.barsyonline.com`. Bare: no scheme, path or user info. */
  readonly host: string
  /**
   * The credentials sealed with the worker's public key (`sealBarsyCredentials`, bound to this
   * tenant, integration and host), when the caller has them. Plain credentials never go through
   * here.
   */
  readonly credentialsSealed?: string
}

/** An integration row after `createIntegration`; `created` is false when it existed. */
export interface CreatedIntegration {
  /** The `in_` id that till sources name (`till:<id>`). */
  readonly id: string
  readonly kind: IntegrationKind
  readonly name: string
  readonly host: string
  readonly created: boolean
}

/**
 * Creates the tenant's integration for a host, or returns the one it has (matched by kind and
 * host among the instances that are not removed; an existing row is not changed,
 * `updateIntegration` does that). The row starts with status `new`. An instance that was removed
 * (`removeIntegration`) stays as it was: adding the same host again makes a new instance.
 *
 * Sealing binds the credentials to the integration id, so a caller that has the credentials
 * generates the id first: pass `id` (an `in_` id from `newId('in')`) together with the sealed
 * value.
 */
export async function createIntegration(
  pool: DbPool,
  tenantId: string,
  input: CreateIntegrationInput & { readonly id?: string },
): Promise<CreatedIntegration> {
  checkedTenant(tenantId)
  const host = checkedHost(input.host)
  if (input.id !== undefined && !isId('in', input.id)) {
    throw new ProvisionError('invalid_input', 'id must be an in_ id from newId("in")')
  }
  const sealed =
    input.credentialsSealed === undefined ? null : checkedSealed(input.credentialsSealed)
  const name = checkedInstanceName(input.name ?? `${input.kind} – ${host}`)
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [existing] = await tx
      .select({ id: integrations.id, name: integrations.name })
      .from(integrations)
      .where(
        and(
          eq(integrations.kind, input.kind),
          eq(integrations.host, host),
          isNull(integrations.removedAt),
        ),
      )
    if (existing) {
      return { id: existing.id, kind: input.kind, name: existing.name, host, created: false }
    }
    const id = input.id ?? newId('in')
    await tx
      .insert(integrations)
      .values({ id, tenantId, kind: input.kind, name, host, credentialsSealed: sealed })
    return { id, kind: input.kind, name, host, created: true }
  })
}

/** What `updateIntegration` may change; a field that is left out stays as it is. */
export interface UpdateIntegrationInput {
  /** The instance's name in the admin (D81). */
  readonly name?: string
  /** Changing the host invalidates the sealed credentials (they are bound to it): seal again. */
  readonly host?: string
  /** A new sealed envelope, or null to forget the credentials. */
  readonly credentialsSealed?: string | null
  /**
   * Merged into the stored config at the top level (`config || patch`): keys named here are
   * replaced, others stay. A key set to null is removed.
   */
  readonly config?: Readonly<Record<string, unknown>>
  readonly status?: IntegrationStatus
  /** Why the status is what it is: a code the web translates ("wrong_credentials"), or older text; null clears it. */
  readonly statusDetail?: string | null
  readonly lastCheckedAt?: Date
}

/**
 * Changes an integration of this tenant and returns the row, or null when the tenant has no such
 * integration. Only the named fields change; the row's `updated_at` follows by trigger.
 */
export async function updateIntegration(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  patch: UpdateIntegrationInput,
): Promise<Integration | null> {
  checkedTenant(tenantId)
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  if (patch.status !== undefined && !INTEGRATION_STATUSES.includes(patch.status)) {
    throw new ProvisionError(
      'invalid_input',
      `status must be one of ${INTEGRATION_STATUSES.join(', ')}`,
    )
  }
  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) set.name = checkedInstanceName(patch.name)
  if (patch.host !== undefined) set.host = checkedHost(patch.host)
  if (patch.credentialsSealed !== undefined) {
    set.credentialsSealed =
      patch.credentialsSealed === null ? null : checkedSealed(patch.credentialsSealed)
  }
  if (patch.status !== undefined) set.status = patch.status
  if (patch.statusDetail !== undefined) set.statusDetail = checkedDetail(patch.statusDetail)
  if (patch.lastCheckedAt !== undefined) set.lastCheckedAt = patch.lastCheckedAt
  if (patch.config !== undefined) {
    // jsonb concatenation replaces whole top-level keys; a key set to null is then removed. Only
    // the keys the caller named: `jsonb_strip_nulls` would also drop the nulls INSIDE other keys
    // (a cached category's `parent_id: null`), which breaks their schema. One statement, so
    // concurrent patches do not lose each other's keys.
    const entries = Object.entries(patch.config)
    const replaced = Object.fromEntries(entries.filter(([, value]) => value !== null))
    const removed = entries.filter(([, value]) => value === null).map(([key]) => key)
    const merged = sql`(${integrations.config} || ${JSON.stringify(replaced)}::jsonb)`
    set.config =
      removed.length === 0
        ? merged
        : sql`(${merged} - ARRAY[${sql.join(
            removed.map((key) => sql`${key}`),
            sql`, `,
          )}]::text[])`
  }
  if (Object.keys(set).length === 0) {
    throw new ProvisionError('invalid_input', 'there is nothing to change')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [row] = await tx
      .update(integrations)
      .set(set)
      .where(eq(integrations.id, integrationId))
      .returning()
    return row ?? null
  })
}

/** Why `removeIntegration` refused. */
export type RemoveIntegrationError =
  /** The tenant has no such instance, or it was removed already. */
  | 'unknown_integration'
  /** A venue still links to the instance (D81): move or delete those venues first. */
  | 'has_venues'

/** What `removeIntegration` answers. */
export type IntegrationRemoved =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RemoveIntegrationError }

/**
 * Removes an instance from Settings › Integrations (D81): sets `removed_at`, nothing else. The row
 * and its credentials are never erased (a removed instance's data is the purge job's later, D91),
 * it is hidden from the admin and the worker leaves it alone. Refused while any venue of ours
 * links to the instance (`has_venues`; a deleted venue has released its link, D76). The link check
 * and the update run in one transaction under the tenant's document lock, the same lock that
 * "Add as venue" and linking take, so a venue cannot be linked in between.
 */
export async function removeIntegration(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
): Promise<IntegrationRemoved> {
  checkedTenant(tenantId)
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [instance] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), isNull(integrations.removedAt)))
    if (instance === undefined) return { ok: false, error: 'unknown_integration' } as const
    const [linked] = await tx
      .select({ venueId: tillVenueLinks.venueId })
      .from(tillVenueLinks)
      .where(
        and(eq(tillVenueLinks.integrationId, integrationId), isNotNull(tillVenueLinks.venueId)),
      )
      .limit(1)
    if (linked !== undefined) return { ok: false, error: 'has_venues' } as const
    await tx
      .update(integrations)
      .set({ removedAt: new Date() })
      .where(eq(integrations.id, integrationId))
    return { ok: true } as const
  })
}

/** One tier-1 record to store: an object exactly as a source returned it. */
export interface SourceRecordInput {
  /**
   * The record's `sr_` id when the caller derives it from the content (barsy's mapping does:
   * the same content always has the same id). Without one a random id is drawn.
   */
  readonly id?: string
  /** `article`, `category`, … (the external type of the object). */
  readonly externalType: string
  readonly externalId: string
  /** `master`, or `venue:<vn_ id>` for an object that differs per venue. */
  readonly scope: Scope
  /** The exact text (lossless: barsy prices are floats on the wire); its SHA-256 is the content hash. */
  readonly raw: string
  /** Its parsed form. */
  readonly payload: unknown
}

/** What `appendSourceRecords` did with one record. */
export interface AppendedSourceRecord {
  /** The record's `sr_` id: the stored one when the content was known already. */
  readonly id: string
  readonly created: boolean
}

const EXISTENCE_BATCH = 500
const INSERT_BATCH = 100

/**
 * Stores tier-1 records of one integration, append-only. A record whose content is already
 * stored (same integration, type, external id, scope and content hash, whichever version is the
 * latest: an object that goes A, B, A reuses record A) is not stored again, and its existing id
 * is returned. The result has one entry per input, in order.
 *
 * A record that comes with an id derived from its content (barsy's mapping does this) counts as
 * stored when that id exists, since change sets cite the id; the insert is `on conflict do
 * nothing`, so two writers storing the same object cannot collide. Recency never comes from this table: the sync reads it from
 * `source_links.last_hash`.
 */
export async function appendSourceRecords(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  records: readonly SourceRecordInput[],
): Promise<AppendedSourceRecord[]> {
  checkedTenant(tenantId)
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  for (const record of records) {
    if (!isScope(record.scope)) {
      throw new ProvisionError('invalid_input', 'scope is master or venue:…')
    }
    if (record.id !== undefined && !isId('sr', record.id)) {
      throw new ProvisionError('invalid_input', 'a record id must be an sr_ id')
    }
  }
  if (records.length === 0) return []
  const prepared = records.map((record) => ({ record, contentHash: sha256Hex(record.raw) }))
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)

    // What is stored already, per external type (one indexed query per type and batch).
    const known = new Map<string, string>()
    const knownIds = new Set<string>()
    const key = (type: string, id: string, scope: string, hash: string) =>
      `${type}\u0000${id}\u0000${scope}\u0000${hash}`
    const byType = new Map<string, Set<string>>()
    for (const { record } of prepared) {
      const ids = byType.get(record.externalType) ?? new Set<string>()
      ids.add(record.externalId)
      byType.set(record.externalType, ids)
    }
    for (const [type, idSet] of byType) {
      const ids = [...idSet]
      for (let start = 0; start < ids.length; start += EXISTENCE_BATCH) {
        const rows = await tx
          .select({
            id: sourceRecords.id,
            externalId: sourceRecords.externalId,
            scope: sourceRecords.scope,
            contentHash: sourceRecords.contentHash,
          })
          .from(sourceRecords)
          .where(
            and(
              eq(sourceRecords.integrationId, integrationId),
              eq(sourceRecords.externalType, type),
              inArray(sourceRecords.externalId, ids.slice(start, start + EXISTENCE_BATCH)),
            ),
          )
        for (const row of rows) {
          const mapKey = key(type, row.externalId, row.scope, row.contentHash)
          if (!known.has(mapKey)) known.set(mapKey, row.id)
          knownIds.add(row.id)
        }
      }
    }

    const results: AppendedSourceRecord[] = []
    const toInsert: (typeof sourceRecords.$inferInsert)[] = []
    for (const { record, contentHash } of prepared) {
      const mapKey = key(record.externalType, record.externalId, record.scope, contentHash)
      // With an id the caller derived from the content, "stored" means that id exists: ops cite
      // the id, so a random-id row with the same content would not do. Without one, any row
      // with the same content will.
      const existing =
        record.id !== undefined
          ? knownIds.has(record.id)
            ? record.id
            : undefined
          : known.get(mapKey)
      if (existing !== undefined) {
        results.push({ id: existing, created: false })
        continue
      }
      const id = record.id ?? newId('sr')
      known.set(mapKey, id)
      knownIds.add(id)
      results.push({ id, created: true })
      toInsert.push({
        id,
        tenantId,
        integrationId,
        externalType: record.externalType,
        externalId: record.externalId,
        scope: record.scope,
        contentHash,
        raw: record.raw,
        payload: record.payload,
      })
    }
    for (let start = 0; start < toInsert.length; start += INSERT_BATCH) {
      await tx
        .insert(sourceRecords)
        .values(toInsert.slice(start, start + INSERT_BATCH))
        .onConflictDoNothing()
    }
    return results
  })
}
