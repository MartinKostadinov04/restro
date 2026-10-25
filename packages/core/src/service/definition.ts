// The shape of one service command's definition: its schema, where it may come from, the
// permission it needs, how a repeat is recognised, and its handler. `commands.ts` lists them all;
// the engine reads only this shape, so a test can run the machinery with a definition of its own.

import type { KeyObject } from 'node:crypto'

import type { Venue } from '@restro/db'
import type { z } from 'zod'

import type { ServiceActor, ServiceOrigin, Via } from './context'
import type { LeaseTx } from './leases'
import type { LogEntryInput } from './log'
import type { Permission } from './permissions'
import type { ServiceResult } from './results'

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
  /** Appends a Log entry with this command's venue, day and provenance. */
  log(entry: LogEntryInput): Promise<void>
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
   * A settings change: a signed-in actor must have entered their password within
   * `FRESH_SIGN_IN_MINUTES` (D122 §7), or it is refused `sign_in_again`. Left out: not needed.
   */
  readonly freshSignIn?: boolean
  readonly idempotency: Idempotency
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
