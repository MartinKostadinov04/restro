// Opaque, kind-prefixed ids (CLAUDE.md "Ids"; doc "Identity and linking"). Never sequential,
// never derived from a barsy id: `kind_` + 22 base62 characters encoding 128 random bits.

import { z } from 'zod'

/**
 * Id kinds: `nd` node, `as` asset, `sn` snapshot, `tb` table, `tn` tenant, `vn` venue,
 * `tp` template, `cs` change set, `ev` event, `jb` job run, `in` integration, `us` user,
 * `sr` source record, `tg` tag (a venue-defined tag of the guest menu, D60).
 */
export const ID_KINDS = [
  'nd',
  'as',
  'sn',
  'tb',
  'tn',
  'vn',
  'tp',
  'cs',
  'ev',
  'jb',
  'in',
  'us',
  'sr',
  'tg',
] as const

/** One of the id kind prefixes. */
export type IdKind = (typeof ID_KINDS)[number]

/** An id of one kind, e.g. `nd_4a1…` (the type checks the prefix only; use `isId` for the rest). */
export type Id<K extends IdKind> = `${K}_${string}`

/** Id of a node (menu, section, item, modifier group, option, special). */
export type NodeId = Id<'nd'>
/** Id of an asset (image or file in the asset store). */
export type AssetId = Id<'as'>
/** Id of a published snapshot. */
export type SnapshotId = Id<'sn'>
/** Id of a table (barsy place) — never the barsy `place_id`. */
export type TableId = Id<'tb'>
/** Id of a tenant (= the auth organisation). */
export type TenantId = Id<'tn'>
/** Id of a venue. */
export type VenueId = Id<'vn'>
/** Id of a stored template version. */
export type TemplateId = Id<'tp'>
/** Id of a change set. */
export type ChangeSetId = Id<'cs'>
/** Id of an event row. */
export type EventId = Id<'ev'>
/** Id of a job run (a barsy pull, an import, a publish). */
export type JobId = Id<'jb'>
/** Id of an integration (one configured barsy installation). */
export type IntegrationId = Id<'in'>
/** Id of a user who can sign in to the admin. */
export type UserId = Id<'us'>
/** Id of a source record (one raw object exactly as a source returned it). */
export type SourceRecordId = Id<'sr'>
/** Id of a venue-defined tag (D60); the snapshot's `tags` vocabulary is keyed by it. */
export type TagId = Id<'tg'>

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const RANDOM_BYTES = 16
/** 62^22 > 2^128, so 22 base62 characters hold any 16-byte value. */
const BODY_LENGTH = 22
const ID_PATTERN = /^([a-z]{2})_([0-9A-Za-z]{22})$/

function isIdKind(value: unknown): value is IdKind {
  return typeof value === 'string' && (ID_KINDS as readonly string[]).includes(value)
}

/** 22 base62 characters from 16 bytes of `crypto.getRandomValues` (128 random bits). */
function randomBase62Body(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES))
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let body = ''
  for (let i = 0; i < BODY_LENGTH; i++) {
    body = BASE62[Number(value % 62n)] + body
    value /= 62n
  }
  return body
}

/** Creates a new id: `kind_` + 22 base62 characters from 16 bytes of `crypto.getRandomValues`. */
export function newId<K extends IdKind>(kind: K): Id<K> {
  if (!isIdKind(kind)) throw new TypeError(`unknown id kind: ${String(kind)}`)
  return `${kind}_${randomBase62Body()}`
}

/**
 * A new table QR token (brief S3-07): 22 base62 characters, 128 random bits, no prefix. It takes
 * no input on purpose: a token is never derived from a barsy id, a table id or anything else
 * (rule 3), so it can only be guessed by trying all 2^128 of them.
 */
export function newTableToken(): string {
  return randomBase62Body()
}

/** True if `value` is an id of `kind`: the prefix, an underscore and exactly 22 base62 chars. */
export function isId<K extends IdKind>(kind: K, value: unknown): value is Id<K> {
  if (typeof value !== 'string') return false
  const match = ID_PATTERN.exec(value)
  return match !== null && match[1] === kind
}

/** Zod schema accepting only ids of `kind`. */
export function idSchema<K extends IdKind>(kind: K): z.ZodType<Id<K>> {
  return z.custom<Id<K>>((value) => isId(kind, value), { message: `expected a ${kind}_ id` })
}
