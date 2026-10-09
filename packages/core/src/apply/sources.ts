// Source plumbing that a change set cites: the configured integration and the tier-1 record a
// barsy write names (`sourceRecordId`). Rule 1 keeps writes to the document (nodes, values,
// links, placements, events) in apply(); these two tables are not the document, and until the
// sync jobs of S2-03 write them for real, the dev seed needs a way in that stays inside
// core/apply (only this folder may import the write side of the database).
//
// Exported as `@restro/core/apply`, never from `@restro/core` itself.

import { type DbPool, integrations, sourceRecords } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, desc, eq } from 'drizzle-orm'
import { isScope, type Scope } from '../change-set'
import { sha256Hex } from '../hash'
import { isId, newId } from '../ids'
import { lockTenantDocument } from './lock'
import { ProvisionError } from './provision'

/** The integration kinds a tenant can configure. */
export type IntegrationKind = 'barsy'

/** What `provisionIntegration` needs. */
export interface ProvisionIntegrationInput {
  readonly kind: IntegrationKind
  /** The installation's host, e.g. `demo.barsyonline.com`. No credentials go through here. */
  readonly host: string
}

/** An integration row after `provisionIntegration`; `created` is false when it existed. */
export interface ProvisionedIntegration {
  /** The `in_` id that sources name (`barsy:<id>`). */
  readonly id: string
  readonly kind: IntegrationKind
  readonly host: string
  readonly created: boolean
}

/**
 * Creates the tenant's integration for a host, or returns the one it has (matched by kind and
 * host). The row starts with status `new` and no credentials: connecting it, and storing sealed
 * credentials, is the Integration tab's job (S2-05).
 */
export async function provisionIntegration(
  pool: DbPool,
  tenantId: string,
  input: ProvisionIntegrationInput,
): Promise<ProvisionedIntegration> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  if (host === '' || host.length > 253 || /[\s/@]/.test(host)) {
    throw new ProvisionError('invalid_input', 'the host must be a bare host name')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.kind, input.kind), eq(integrations.host, host)))
    if (existing) return { id: existing.id, kind: input.kind, host, created: false }
    const id = newId('in')
    await tx.insert(integrations).values({ id, tenantId, kind: input.kind, host })
    return { id, kind: input.kind, host, created: true }
  })
}

/** What `recordSource` needs: one object exactly as a source returned it. */
export interface RecordSourceInput {
  readonly integrationId: string
  /** `article`, `category`, … (the external type of the object). */
  readonly externalType: string
  readonly externalId: string
  /** `master`, or `venue:<vn_ id>` for an object that differs per venue. */
  readonly scope: Scope
  /** The exact response slice (lossless), kept as text. */
  readonly raw: string
  /** Its parsed form. */
  readonly payload: unknown
}

/**
 * Stores a tier-1 record, or returns the latest one when its content is the same (a new row only
 * when the content hash changes: the table is append-only). Returns its `sr_` id, which barsy
 * writes cite.
 */
export async function recordSource(
  pool: DbPool,
  tenantId: string,
  input: RecordSourceInput,
): Promise<{ id: string; created: boolean }> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isScope(input.scope)) throw new ProvisionError('invalid_input', 'scope is master or venue:…')
  const contentHash = sha256Hex(input.raw)
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [latest] = await tx
      .select({ id: sourceRecords.id, contentHash: sourceRecords.contentHash })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.integrationId, input.integrationId),
          eq(sourceRecords.externalType, input.externalType),
          eq(sourceRecords.externalId, input.externalId),
          eq(sourceRecords.scope, input.scope),
        ),
      )
      .orderBy(desc(sourceRecords.fetchedAt), desc(sourceRecords.id))
      .limit(1)
    if (latest?.contentHash === contentHash) return { id: latest.id, created: false }
    const id = newId('sr')
    await tx.insert(sourceRecords).values({
      id,
      tenantId,
      integrationId: input.integrationId,
      externalType: input.externalType,
      externalId: input.externalId,
      scope: input.scope,
      contentHash,
      raw: input.raw,
      payload: input.payload,
    })
    return { id, created: true }
  })
}
