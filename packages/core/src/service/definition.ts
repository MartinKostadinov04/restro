// The shape of one service command's definition: its schema, where it may come from, the
// permission it needs, how a repeat is recognised, and its handler. `commands.ts` lists them all;
// the engine reads only this shape, so a test can run the machinery with a definition of its own.

import type { KeyObject } from 'node:crypto'

import type { Venue } from '@restro/db'
import type { z } from 'zod'

import type { VenueLockStrength } from '../apply/venue-lock'
import type { ServiceActor, ServiceOrigin, Via } from './context'
import type { LeaseTx } from './leases'
import type { LogEntryInput, LogKind } from './log'
import type { Permission } from './permissions'
import type { ServiceResult } from './results'
import type { SendMenu } from './send-menu'

/**
 * How a repeated command is recognised (design §2.4):
 * - `order_ring`: an edit of the table's order; its action id is looked up in the order row's
 *   ring of 64 and the first answer is returned.
 * - `sent_order`: a Send; its action id is unique on `sent_orders`, so a repeat finds the sent
 *   order it made all service day.
 * - `by_nature`: a staff action that returns the current state when repeated ("Open" on an open
 *   table says who opened it).
 * - `by_state`: a worker step decided under its row lock from the current state, so a repeated
 *   job changes nothing.
 */
export type Idempotency = 'order_ring' | 'sent_order' | 'by_nature' | 'by_state'

/** What a handler gets: the transaction, the venue, the provenance, the row locks, the Log. */
export interface ServiceTx extends LeaseTx {
  /** The venue, locked `FOR SHARE` and live. */
  readonly venue: Venue
  /** The venue's service day at `now`. */
  readonly serviceDate: string
  /** The caller's clock, for decisions made in memory. Deadlines use the database's `now()`. */
  readonly now: Date
  readonly origin: ServiceOrigin
  readonly via: Via
  /** Who acts, as the caller resolved it and the engine checked it. */
  readonly actor: ServiceActor
  /** What the actor holds at the venue (empty for guests and the worker). */
  readonly permissions: ReadonlySet<Permission>
  /** The worker's public seal key, when the caller passed one (a new table code is sealed). */
  readonly sealPublicKey: KeyObject | string | null
  /** The PIN pepper, when the caller passed one (a new PIN's HMAC is keyed with it). */
  readonly pinPepper: string | null
  /** The bill-id key, when the caller passed one (a reading's `rd_` and `bn_` ids, #74). */
  readonly billIdKey: string | null
  /**
   * The location consent version of a located guest command (D119, #76): what a sent order
   * records. Null for any other command.
   */
  readonly consentVersion: string | null
  /**
   * The table's menu with tonight's sold-out marks, which the guest API read before a Send (#77);
   * null for any other command.
   */
  readonly sendMenu: SendMenu | null
  /** The database's clock, read once per command: the clock of deadlines (Undo, idle). */
  dbNow(): Promise<Date>
  /** Appends a Log entry with this command's venue, day and provenance. */
  log(entry: LogEntryInput): Promise<void>
  /**
   * The last Log entry of one of these kinds this command appended (its place and time), or null
   * when it logged none of them.
   */
  lastLogged(kinds: readonly LogKind[]): { readonly seq: number; readonly at: Date } | null
  /**
   * Sets writes aside for the handler's refusal: they run after its savepoint is rolled back, in
   * the same transaction, so what a refusal leaves behind (a guard trip's pause, Log entry and
   * alert, #78) is kept while the rest of the handler's writes are not. Never run when the handler
   * accepts.
   */
  keepOnRefusal(write: () => Promise<void>): void
}

/**
 * Decides one command and writes its outcome. A handler locks its rows through `stx.rows` in the
 * fixed order, decides in memory, then writes. When it refuses, every write it made is rolled
 * back (a savepoint), so a refusal never leaves half a change. It never calls a POS or a payment
 * provider: those calls are worker jobs outside any transaction.
 */
export type CommandHandler<C> = {
  // Method syntax makes the parameter bivariant, so a definition typed by its own schema fits the
  // registry's `CommandDefinition`; the engine passes only what that schema parsed.
  handle(stx: ServiceTx, command: C): Promise<ServiceResult>
}['handle']

/** One command's definition. */
export interface CommandDefinition<S extends z.ZodType = z.ZodType> {
  /** A strict object with a literal `type`. */
  readonly schema: S
  readonly origins: readonly ServiceOrigin[]
  /** What a staff actor must hold; null for guest and worker commands. */
  readonly permission: Permission | null
  /**
   * For a command whose parts need different rights (`pay_first.set`: the venue's choices and a
   * table's): the permission this command needs, which replaces `permission` (kept as the
   * command's usual one). Left out: `permission`.
   */
  permissionOf?(command: z.infer<S>): Permission
  /**
   * How hard the engine locks the venue row for the command. `update` is for a command that
   * rewrites `venues.settings` (a read-modify-write): two of them queue instead of both holding
   * the shared lock and deadlocking on the upgrade. Left out: `share`.
   */
  readonly venueLock?: VenueLockStrength
  /**
   * A settings change: a signed-in actor must have entered their password within
   * `FRESH_SIGN_IN_MINUTES` (D122 §7), or it is refused `sign_in_again`. Left out: not needed.
   */
  readonly freshSignIn?: boolean
  /**
   * A quick answer: the shared device's own account may run it without a PIN, holding what the
   * Staff default role holds (D122 §7, Martin 10-26: the Log names the device's account). Left
   * out: the device asks for a person's PIN (`pin_required`).
   */
  readonly quickOnSharedDevice?: boolean
  readonly idempotency: Idempotency
  /**
   * A staff write whose Undo Tonight offers (#219): when it came via Tonight and logged an entry
   * of one of these kinds, the accepted answer carries `undoEntry` (the last such entry's `seq`)
   * and `undoAt` (its time), which the inverse command sends back as its `undo` token. A write
   * that logged none of them (a repeat that found it done) has no token and so no Undo. The kind
   * is the one that says the thing the Undo reverses was done, never just the last entry.
   */
  readonly undoable?: { readonly kinds: readonly LogKind[] }
  /**
   * For an inverse command that takes an `undo` token: whether the thing it touched changed after
   * the token's entry. Run after the handler wrote, under the handler's own locks, so a change
   * committed meanwhile is seen or waited for; true rolls the handler back and the answer is
   * `undo_stale`. Use `changedSince`, which leaves out this command's own entries.
   */
  undoStale?(stx: ServiceTx, command: z.infer<S>, entry: number): Promise<boolean>
  /**
   * The oldest a command may be, in milliseconds since the guest's tap (its `ageMs`): an older one
   * is refused `stale_action` after the repeat check, so a phone back from a lost signal never
   * lands an old tap (D121). Left out: no limit.
   */
  readonly maxAgeMs?: number
  /** The handler, or null while the command is not built (refused `not_built`). */
  readonly handle: CommandHandler<z.infer<S>> | null
}

/** Builds a definition, with its handler typed by its schema. */
export function defineCommand<S extends z.ZodType>(
  definition: CommandDefinition<S>,
): CommandDefinition<S> {
  return definition
}

/** Every definition by command type. */
export type CommandRegistry = Readonly<Record<string, CommandDefinition>>
