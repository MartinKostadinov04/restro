// The engine behind `applyService` (design §2.1, §2.3, §2.4; D72, D117, D122 §9). One command runs
// as one short tenant transaction, in this order:
// 1. the command's schema and its origin, and for a settings change a fresh sign-in, before the
//    database is asked;
// 2. `lock_timeout` 2 s and `statement_timeout` 5 s, then the venue locked `FOR SHARE` and live;
// 3. the table, where the command names one;
// 4. the permission, read in the same transaction;
// 5. `not_built` for a command whose ticket hasn't built it;
// 6. the repeat check: the order row's ring of action ids, or the sent order made by the same
//    action id; a repeat gets the first answer;
// 7. the handler, inside a savepoint, so a refusal rolls its writes back;
// 8. the version of every table the handler touched rises once, and an order edit's answer goes
//    into the ring.
// The answer is always accepted or refused with a code (D72). Nothing here, and nothing a handler
// gets, can call a POS or a payment provider: the transaction holds row locks for milliseconds.

import type { KeyObject } from 'node:crypto'

import { type DbPool, sentOrders, tableOrders, venueTables } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'

import { lockLiveVenue } from '../apply/venue-lock'
import { serviceDate } from '../service-day'
import { findInRing, pushToRing } from './action-ring'
import {
  isFreshSignIn,
  provenanceOf,
  type ServiceContext,
  ServiceContextSchema,
  viaOf,
} from './context'
import type { CommandRegistry, ServiceTx } from './definition'
import { resolveGrants } from './grants'
import { appendLogEntry } from './log'
import { isSettingsPermission } from './permissions'
import { accepted, refused, type ServiceResult } from './results'
import { RowLocks } from './rows'

/** How long a service write waits for a row lock before it answers `busy` (design §2.3). */
export const SERVICE_LOCK_TIMEOUT = '2s'
/** How long one statement of a service write may run. */
export const SERVICE_STATEMENT_TIMEOUT = '5s'

/** Postgres's `lock_not_available` (a `lock_timeout`) and `query_canceled` (a statement timeout). */
const BUSY_CODES = new Set(['55P03', '57014'])

/** A refusal thrown inside the transaction to roll it back; caught by `executeCommand`. */
class Refusal extends Error {
  constructor(readonly result: ServiceResult) {
    super(result.status === 'refused' ? result.code : 'refused')
  }
}

/** A handler's refusal thrown to roll its savepoint back. */
class HandlerRefusal extends Error {
  constructor(readonly result: ServiceResult) {
    super('handler refused')
  }
}

/** The Postgres error code anywhere in the error's cause chain (Drizzle wraps driver errors). */
export function postgresCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = current.cause
  }
  return null
}

/** What a caller may hand the engine beside the context: keys from its environment. */
export interface ServiceOptions {
  /**
   * The worker's public seal key (`SEAL_PUBLIC_KEY`), for the commands that issue a table code or
   * a PIN.
   */
  readonly sealPublicKey?: KeyObject | string
  /** The PIN pepper (`STAFF_PIN_PEPPER`), for the commands that issue a PIN. */
  readonly pinPepper?: string
  /** The bill-id key (`BILL_ID_KEY`), for recording a reading of a table's bill (#74). */
  readonly billIdKey?: string
}

/** What the command carries that the engine reads: its type, table and action id, when it has them. */
interface Envelope {
  readonly type: string
  readonly tableId?: string
  readonly actionId?: string
}

/**
 * Runs one command against a registry. `applyService` passes the real one; tests pass their own
 * definitions to drive the machinery. A context that doesn't parse is the caller's bug and
 * throws; a command that doesn't parse is the phone's and is refused `invalid_command`.
 */
export async function executeCommand(
  pool: DbPool,
  registry: CommandRegistry,
  input: unknown,
  contextInput: ServiceContext,
  options: ServiceOptions = {},
): Promise<ServiceResult> {
  const context = ServiceContextSchema.parse(contextInput)
  const rawActionId =
    typeof input === 'object' && input !== null && 'actionId' in input ? input.actionId : null
  const echoedActionId =
    typeof rawActionId === 'string' && /^[0-9a-f-]{36}$/i.test(rawActionId) ? rawActionId : null

  const type =
    typeof input === 'object' && input !== null && 'type' in input ? String(input.type) : ''
  const definition = Object.hasOwn(registry, type) ? registry[type] : undefined
  if (definition === undefined) {
    return refused(echoedActionId, 'invalid_command', { reason: 'unknown_type' })
  }
  const parsed = definition.schema.safeParse(input)
  if (!parsed.success) return refused(echoedActionId, 'invalid_command')
  const command = parsed.data as Envelope
  const actionId = command.actionId ?? null

  if (!definition.origins.includes(context.origin)) {
    return refused(actionId, 'origin_not_allowed')
  }
  if (
    definition.permission !== null &&
    isSettingsPermission(definition.permission) &&
    context.actor.kind === 'staff'
  ) {
    return refused(actionId, 'own_sign_in_required')
  }

  const provenance = provenanceOf(context)
  const via = viaOf(context)
  const now = context.now ?? new Date()
  if (definition.freshSignIn === true && !isFreshSignIn(context.signedInAt, now)) {
    return refused(actionId, 'sign_in_again')
  }

  try {
    return await withTenantWrite(pool, context.tenantId, async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = '${SERVICE_LOCK_TIMEOUT}'`))
      await tx.execute(sql.raw(`set local statement_timeout = '${SERVICE_STATEMENT_TIMEOUT}'`))

      const live = await lockLiveVenue(tx, context.venueId, 'share')
      if (live.refused !== null) throw new Refusal(refused(actionId, live.refused))
      const venue = live.venue

      if (command.tableId !== undefined) {
        const [table] = await tx
          .select({ id: venueTables.id })
          .from(venueTables)
          .where(and(eq(venueTables.id, command.tableId), eq(venueTables.venueId, venue.id)))
        if (table === undefined) throw new Refusal(refused(actionId, 'table_missing'))
      }

      const grants = await resolveGrants(tx, context.tenantId, venue.id, context.actor)
      if (!grants.ok) throw new Refusal(refused(actionId, grants.code))
      if (definition.permission !== null && !grants.permissions.has(definition.permission)) {
        throw new Refusal(refused(actionId, 'permission_denied'))
      }

      if (definition.handle === null) throw new Refusal(refused(actionId, 'not_built'))

      const rows = new RowLocks(tx, context.tenantId, venue.id, provenance)
      const day = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
      const stx: ServiceTx = {
        tx,
        tenantId: context.tenantId,
        venueId: venue.id,
        provenance,
        rows,
        venue,
        serviceDate: day,
        now,
        origin: context.origin,
        via,
        actor: context.actor,
        permissions: grants.permissions,
        sealPublicKey: options.sealPublicKey ?? null,
        pinPepper: options.pinPepper ?? null,
        billIdKey: options.billIdKey ?? null,
        log: (entry) =>
          appendLogEntry(
            tx,
            { tenantId: context.tenantId, venueId: venue.id, serviceDate: day, provenance, via },
            entry,
          ),
      }

      // The repeat check. An order edit and a Send lock the table's order first: both change it.
      const ring = definition.idempotency === 'order_ring'
      if (ring || definition.idempotency === 'sent_order') {
        if (command.tableId === undefined || actionId === null) {
          throw new Error(`${type}: ${definition.idempotency} needs a tableId and an actionId`)
        }
        const order = await rows.tableOrder(command.tableId)
        if (order === null) throw new Refusal(refused(actionId, 'table_not_open'))
        const first = ring
          ? findInRing(order.recentActions, actionId)
          : await sentOrderAnswer(tx, actionId)
        if (first !== null) return first
      }

      await tx.execute(sql`savepoint service_command`)
      let result: ServiceResult
      try {
        result = await definition.handle(stx, parsed.data)
        if (result.status === 'refused') throw new HandlerRefusal(result)
        await tx.execute(sql`release savepoint service_command`)
      } catch (error) {
        if (!(error instanceof HandlerRefusal)) throw error
        await tx.execute(sql`rollback to savepoint service_command`)
        rows.discardTouches()
        result = error.result
      }

      const versions = await rows.bumpTouched()
      if (ring && command.tableId !== undefined && actionId !== null) {
        const order = rows.heldOrder(command.tableId)
        if (order !== null) {
          const version = versions.get(command.tableId) ?? order.version
          await tx
            .update(tableOrders)
            .set({
              recentActions: pushToRing(order.recentActions, { actionId, result, version }),
              ...provenance,
              updatedAt: sql`now()`,
            })
            .where(eq(tableOrders.id, order.id))
        }
      }
      return result
    })
  } catch (error) {
    if (error instanceof Refusal) return error.result
    const code = postgresCode(error)
    if (code !== null && BUSY_CODES.has(code)) return refused(actionId, 'busy')
    throw error
  }
}

/** The answer a Send with this action id got: the sent order it made, or null. */
async function sentOrderAnswer(tx: WriteTx, actionId: string): Promise<ServiceResult | null> {
  const [sent] = await tx
    .select({ id: sentOrders.id, reference: sentOrders.reference })
    .from(sentOrders)
    .where(eq(sentOrders.actionId, actionId))
  if (sent === undefined) return null
  return accepted(actionId, { ref: sent.reference, details: { sentOrderId: sent.id } })
}
