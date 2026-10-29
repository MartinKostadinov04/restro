// The engine behind `applyService` (design §2.1, §2.3, §2.4; D72, D117, D122 §9). One command runs
// as one short tenant transaction, in this order:
// 1. the command's schema and its origin, and for a settings change a fresh sign-in, before the
//    database is asked;
// 2. `lock_timeout` 2 s and `statement_timeout` 5 s, then the venue locked `FOR SHARE` and live;
// 3. the table, where the command names one, and for a guest the table code it came with: the
//    code must still be the table's and the table must still have a guest page (`code_retired`);
//    for a located guest command, the sitting its location pass names must still be the table's
//    open sitting (`location_needed`, #76);
// 4. the permission, read in the same transaction;
// 5. `not_built` for a command whose ticket hasn't built it;
// 6. the repeat check: the order row's ring of action ids, or the sent order made by the same
//    action id; a repeat gets the first answer. Then the tap's age (`stale_action`) and, for an
//    order edit, the table's rate (`rate_limited`, 60 a minute): neither goes into the ring, and a
//    rate trip writes its Log entry and its alert to Restro's admin team (#75);
// 7. the handler, inside a savepoint, so a refusal rolls its writes back, except the ones it set
//    aside for its refusal (`keepOnRefusal`: a guard trip's pause and Log entry, #78);
// 8. the version of every table the handler touched rises once, and an order edit's answer goes
//    into the ring.
// The answer is always accepted or refused with a code (D72). Nothing here, and nothing a handler
// gets, can call a POS or a payment provider: the transaction holds row locks for milliseconds.

import type { KeyObject } from 'node:crypto'

import {
  areas,
  type DbPool,
  payments,
  sentOrders,
  sittings,
  tableOrders,
  venueTables,
} from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'

import { lockLiveVenue } from '../apply/venue-lock'
import { serviceDate } from '../service-day'
import { ORDER_CHANGES_PER_MINUTE } from '../table-order'
import { actionsSince, findInRing, pushToRing } from './action-ring'
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
import { tripOrderRate } from './order-rate'
import { isSettingsPermission } from './permissions'
import { accepted, refused, type ServiceResult } from './results'
import { RowLocks } from './rows'
import type { SendMenu } from './send-menu'
import { UNDO_AT_KEY, UNDO_ENTRY_KEY, undoExpired } from './undo'

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
  /** The table's menu for a Send (`loadSendMenu`), read before the transaction (#77). */
  readonly sendMenu?: SendMenu
}

/** What the command carries that the engine reads: its type, table and action id, when it has them. */
interface Envelope {
  readonly type: string
  readonly tableId?: string
  readonly actionId?: string
  /** Milliseconds since the guest's tap, for a command with a `maxAgeMs`. */
  readonly ageMs?: number
  /** For a staff Undo: the Log entry of the write it undoes (#219). */
  readonly undo?: { readonly entry: number }
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
  const needed = definition.permissionOf?.(parsed.data) ?? definition.permission
  if (needed !== null && isSettingsPermission(needed) && context.actor.kind === 'staff') {
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

      const live = await lockLiveVenue(tx, context.venueId, definition.venueLock ?? 'share')
      if (live.refused !== null) throw new Refusal(refused(actionId, live.refused))
      const venue = live.venue

      if (command.tableId !== undefined) {
        const [table] = await tx
          .select({ id: venueTables.id })
          .from(venueTables)
          .where(and(eq(venueTables.id, command.tableId), eq(venueTables.venueId, venue.id)))
        if (table === undefined) throw new Refusal(refused(actionId, 'table_missing'))
      }
      if (context.tableCodeHash !== undefined) {
        const guestPage =
          command.tableId === undefined
            ? []
            : await tx
                .select({ id: venueTables.id })
                .from(venueTables)
                .innerJoin(areas, eq(areas.id, venueTables.areaId))
                .where(
                  and(
                    eq(venueTables.id, command.tableId),
                    eq(venueTables.qrCodeHash, context.tableCodeHash),
                    isNull(venueTables.archivedAt),
                    eq(venueTables.isPaymentTable, false),
                    eq(venueTables.hidden, false),
                    eq(areas.hidden, false),
                    isNull(areas.archivedAt),
                  ),
                )
        if (guestPage.length === 0) throw new Refusal(refused(actionId, 'code_retired'))
      }
      if (context.sittingId !== undefined) {
        // A located command (#76): its pass names a sitting, which must still be the table's open
        // one. Checked here, under the venue's lock, so a sitting ended since the pass was read
        // stops it.
        const [open] =
          command.tableId === undefined
            ? []
            : await tx
                .select({ id: sittings.id })
                .from(sittings)
                .where(and(eq(sittings.tableId, command.tableId), isNull(sittings.endedAt)))
        if (open?.id !== context.sittingId) {
          throw new Refusal(refused(actionId, 'location_needed'))
        }
      }

      const grants = await resolveGrants(tx, context.tenantId, venue.id, context.actor, {
        quick: definition.quickOnSharedDevice === true,
      })
      if (!grants.ok) throw new Refusal(refused(actionId, grants.code))
      if (needed !== null && !grants.permissions.has(needed)) {
        throw new Refusal(refused(actionId, 'permission_denied'))
      }

      if (definition.handle === null) throw new Refusal(refused(actionId, 'not_built'))

      const rows = new RowLocks(tx, context.tenantId, venue.id, provenance)
      const day = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
      let clock: Promise<Date> | null = null
      const dbNow = (): Promise<Date> => {
        clock ??= tx
          .execute<{ ms: string }>(sql`select floor(extract(epoch from now()) * 1000)::text as ms`)
          .then((result) => new Date(Number(result.rows[0]?.ms)))
        return clock
      }
      const kept: (() => Promise<void>)[] = []
      let logged: { readonly seq: number; readonly at: Date } | null = null
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
        consentVersion: context.consentVersion ?? null,
        sendMenu: options.sendMenu ?? null,
        dbNow,
        log: async (entry) => {
          logged = await appendLogEntry(
            tx,
            { tenantId: context.tenantId, venueId: venue.id, serviceDate: day, provenance, via },
            entry,
          )
        },
        lastLogged: () => logged,
        keepOnRefusal: (write) => {
          kept.push(write)
        },
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
          : await sentOrderAnswer(stx, command.tableId, actionId, payFirstHandleOf(command))
        if (first !== null) return first
      }
      if (
        definition.maxAgeMs !== undefined &&
        command.ageMs !== undefined &&
        command.ageMs > definition.maxAgeMs
      ) {
        throw new Refusal(refused(actionId, 'stale_action'))
      }
      if (ring && command.tableId !== undefined) {
        const order = rows.heldOrder(command.tableId)
        const minuteAgo = new Date((await dbNow()).getTime() - 60_000)
        if (
          order !== null &&
          actionsSince(order.recentActions, minuteAgo) >= ORDER_CHANGES_PER_MINUTE
        ) {
          // Committed: the trip's Log entry and alert stay, and the refusal is not remembered.
          await tripOrderRate(stx, command.tableId, order.sittingId)
          return refused(actionId, 'rate_limited', { perMinute: ORDER_CHANGES_PER_MINUTE })
        }
      }

      // A staff Undo with its token (#219): too old is refused before anything is read or written.
      const undo = command.undo
      if (undo !== undefined && (await undoExpired(stx, undo))) {
        throw new Refusal(refused(actionId, 'undo_expired'))
      }

      await tx.execute(sql`savepoint service_command`)
      let result: ServiceResult
      try {
        result = await definition.handle(stx, parsed.data)
        if (result.status === 'refused') throw new HandlerRefusal(result)
        // Changed again since the write it undoes: rolled back with the handler's writes, so the
        // newer change stands.
        if (undo !== undefined && (await definition.undoStale?.(stx, parsed.data, undo.entry))) {
          throw new HandlerRefusal(refused(actionId, 'undo_stale'))
        }
        await tx.execute(sql`release savepoint service_command`)
      } catch (error) {
        if (!(error instanceof HandlerRefusal)) throw error
        await tx.execute(sql`rollback to savepoint service_command`)
        rows.discardTouches()
        result = error.result
        for (const write of kept) await write()
      }

      // The token of a write Tonight offers an Undo for: the Log entry it wrote and its time.
      const written = logged as { readonly seq: number; readonly at: Date } | null
      if (
        result.status === 'accepted' &&
        definition.undoable === true &&
        via === 'tonight' &&
        written !== null
      ) {
        result = {
          ...result,
          details: {
            ...result.details,
            [UNDO_ENTRY_KEY]: written.seq,
            [UNDO_AT_KEY]: written.at.toISOString(),
          },
        }
      }

      const versions = await rows.bumpTouched()
      if (ring && command.tableId !== undefined && actionId !== null) {
        const order = rows.heldOrder(command.tableId)
        if (order !== null) {
          const version = versions.get(command.tableId) ?? order.version
          await tx
            .update(tableOrders)
            .set({
              recentActions: pushToRing(order.recentActions, {
                actionId,
                result,
                version,
                at: (await dbNow()).toISOString(),
              }),
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
async function sentOrderAnswer(
  stx: ServiceTx,
  tableId: string,
  actionId: string,
  handleHash: string | null,
): Promise<ServiceResult | null> {
  // An action id another table's Send used gets nothing of it: no ids, no handle (as `pay.start`).
  const elsewhere = [
    ...(await stx.tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.actionId, actionId), ne(payments.tableId, tableId)))),
    ...(await stx.tx
      .select({ id: sentOrders.id })
      .from(sentOrders)
      .where(and(eq(sentOrders.actionId, actionId), ne(sentOrders.tableId, tableId)))),
  ]
  if (elsewhere.length > 0) return refused(actionId, 'invalid_command')
  const [sent] = await stx.tx
    .select({ id: sentOrders.id, reference: sentOrders.reference })
    .from(sentOrders)
    .where(and(eq(sentOrders.actionId, actionId), eq(sentOrders.tableId, tableId)))
  // A Send with pay-first lines made a payment under the same action id (#113), with or without
  // an on-the-bill sent order. The phone that repeats never got the first answer (or lost it), so
  // the handle it holds now is the new one: the hash is replaced, as `pay.start` does.
  const [payment] = await stx.tx
    .select({ id: payments.id, state: payments.state, sentOrderId: payments.sentOrderId })
    .from(payments)
    .where(
      and(
        eq(payments.actionId, actionId),
        eq(payments.kind, 'pay_first'),
        eq(payments.tableId, tableId),
      ),
    )
  if (sent === undefined && payment === undefined) return null
  if (payment !== undefined && handleHash !== null) {
    stx.rows.claim('payment', [payment.id])
    await stx.tx
      .update(payments)
      .set({ handleHash, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(payments.id, payment.id))
  }
  let reference = sent?.reference ?? null
  if (reference === null && payment?.sentOrderId != null) {
    const [own] = await stx.tx
      .select({ reference: sentOrders.reference })
      .from(sentOrders)
      .where(eq(sentOrders.id, payment.sentOrderId))
    reference = own?.reference ?? null
  }
  return accepted(actionId, {
    ...(reference === null ? {} : { ref: reference }),
    details: {
      ...(sent === undefined ? {} : { sentOrderId: sent.id }),
      ...(payment === undefined ? {} : { paymentId: payment.id, state: payment.state }),
    },
  })
}

/** The handle hash of a Send's pay-first part, or null (#113). */
function payFirstHandleOf(command: object): string | null {
  const part = (command as { readonly payFirst?: unknown }).payFirst
  if (typeof part !== 'object' || part === null || !('handleHash' in part)) return null
  return typeof part.handleHash === 'string' ? part.handleHash : null
}
