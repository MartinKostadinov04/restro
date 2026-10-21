// Source-record descriptors (doc "The internal data source", tier 1): every barsy object the
// mapping reads, described so S2-03 can store it as a `source_records` row. Till-layer writes
// cite the descriptor's id, so a value can always be traced back to the object it came from.
//
// The id is content-addressed. The same object with the same content is the same record (a
// repeated pull inserts nothing), and a changed object is a new version with a new id. If an
// object returns to an earlier content its id is the old one, and its row keeps its old fetch
// time: the current record of an object is the one its source link names (`last_hash`), never the
// newest by fetch time. Insert with `on conflict do nothing`.

import { canonicalJson, type IntegrationId, type Scope, sha256Hex } from '@restro/core'

import { deriveId } from './ids.ts'
import type { SourceExternalType, SourceRecordDescriptor } from './types.ts'

export function describeSource(
  integrationId: IntegrationId,
  externalType: SourceExternalType,
  externalId: string,
  scope: Scope,
  object: unknown,
): SourceRecordDescriptor {
  const raw = canonicalJson(object)
  const contentHash = sha256Hex(raw)
  return {
    id: deriveId('sr', integrationId, externalType, externalId, scope, contentHash),
    integrationId,
    externalType,
    externalId,
    scope,
    contentHash,
    raw,
    payload: JSON.parse(raw) as unknown,
  }
}
