// Opaque, kind-prefixed ids (CLAUDE.md "Ids"; doc "Identity and linking"). Never sequential,
// never derived from a barsy id: `kind_` + 22 base62 characters encoding 128 random bits. The
// one exception is a reading's bill and line ids (#74): 128 bits of a keyed HMAC of the tenant
// and the POS row (`idFromBytes`), so they stay the same across readings and still reveal
// nothing about the POS id without the key.

import { z } from 'zod'

/**
 * Id kinds: `nd` node, `as` asset, `sn` snapshot, `tb` table, `tn` tenant, `vn` venue,
 * `tp` template, `cs` change set, `ev` event, `jb` job run, `in` integration, `us` user,
 * `sr` source record, `tg` tag (a venue-defined tag of the guest menu, D60), `ar` area (a hall
 * or other group of tables, D95). Ordering (D122 §9, D124): `br` bar, `st` sitting, `to` table
 * order, `ol` order line, `so` sent order, `wc` waiter call, `al` alert, `pa` pause, `rl` venue
 * role, `sm` staff member, `dv` shared device. Paying (D127): `py` payment. Readings (#74): `rd`
 * one POS bill of a table's reading, `bn` one line of it.
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
  'ar',
  'br',
  'st',
  'to',
  'ol',
  'so',
  'wc',
  'al',
  'pa',
  'rl',
  'sm',
  'dv',
  'py',
  'rd',
  'bn',
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
/** Id of a table of a venue (`tables`); never a till's own id for it (rule 3). */
export type TableId = Id<'tb'>
/** Id of an area of a venue (`areas`, D95): a hall or any other group of tables. */
export type AreaId = Id<'ar'>
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
/** Id of a bar of a venue (`bars`, D124 §1): where a table's orders are made. */
export type BarId = Id<'br'>
/** Id of a sitting: one group of guests at a table, from opening to its end (D122 §4). */
export type SittingId = Id<'st'>
/** Id of a table's shared order (D117). */
export type TableOrderId = Id<'to'>
/** Id of one line of a table's order, kept when the line is sent. */
export type OrderLineId = Id<'ol'>
/** Id of a sent order; also the key Restro sends where the POS deduplicates (rule 9). */
export type SentOrderId = Id<'so'>
/** Id of a guest's call for a waiter. */
export type WaiterCallId = Id<'wc'>
/** Id of an alert (D120). */
export type AlertId = Id<'al'>
/** Id of a pause of ordering (D120). */
export type PauseId = Id<'pa'>
/** Id of a role at a venue. */
export type VenueRoleId = Id<'rl'>
/** Id of a staff member of an organisation (D122 §7). */
export type StaffMemberId = Id<'sm'>
/** Id of a shared device of a venue (D122 §7). */
export type SharedDeviceId = Id<'dv'>
/** Id of a payment from a phone (D127); also the key of its provider calls' idempotency. */
export type PaymentId = Id<'py'>
/** Id of one POS bill of a table's reading (#74): stable across readings, never the POS's id. */
export type BillId = Id<'rd'>
/** Id of one line of a POS bill of a table's reading (#74), stable across readings. */
export type BillLineId = Id<'bn'>

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
  return base62Body(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)))
}

/** 22 base62 characters encoding the first 16 bytes. */
function base62Body(bytes: Uint8Array): string {
  if (bytes.length < RANDOM_BYTES) throw new TypeError(`an id needs ${RANDOM_BYTES} bytes`)
  let value = 0n
  for (const byte of bytes.subarray(0, RANDOM_BYTES)) value = (value << 8n) | BigInt(byte)
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
 * An id made from the first 16 bytes given: for ids that must stay the same for the same thing,
 * where the bytes are a keyed HMAC (a reading's bill and line ids, #74). Never pass raw POS data.
 */
export function idFromBytes<K extends IdKind>(kind: K, bytes: Uint8Array): Id<K> {
  if (!isIdKind(kind)) throw new TypeError(`unknown id kind: ${String(kind)}`)
  return `${kind}_${base62Body(bytes)}`
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
