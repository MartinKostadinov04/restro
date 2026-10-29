// Tonight's table commands, server side (#73; the screen is #85): open a table for phones, close
// it, Open all, Close all, New guests, and the owner's mark of a payment table. Every write is the
// service write path's (`applyService`), which checks the permission inside its own transaction
// (`tables.open_close`; `settings.payment_tables` with a sign-in of the last 15 minutes for the
// mark) and writes the Log entry; this file only says who is asking and shapes the answer.
// - The actor is the signed-in account, or on a shared device the person whose PIN was entered
//   (`identifyAtSharedDevice`): there every staff write needs a PIN, and that person's role decides.
// - The mark retires the table's code (a payment table has none, D122 §7): the worker's
//   `publish-table-tokens` job is queued to remove its files, as the Tables tab does.
// The answer is accepted with the service path's details, or refused with its code (D72); the
// screen words the code.
import {
  JOB_NAMES,
  type JobPayload,
  newId,
  type ProducedJobName,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  applyService,
  type RefusalCode,
  type ServiceActor,
  type ServiceResult,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

import { logError } from '../log'

/**
 * The Log entry an accepted write answered with (`undoEntry`): the Undo sends it back so core can
 * refuse it once the write is 30 seconds old or the thing was changed again (#219).
 */
export interface UndoToken {
  readonly entry: number
}

/** A table command Tonight sends; the venue is the scope's. */
export type TableCommand =
  | { readonly type: 'table.open'; readonly tableId: string; readonly undo?: UndoToken }
  | { readonly type: 'table.close'; readonly tableId: string; readonly undo?: UndoToken }
  | { readonly type: 'table.new_guests'; readonly tableId: string; readonly sittingId?: string }
  | { readonly type: 'tables.open_all' }
  | { readonly type: 'tables.undo_open_all'; readonly undo: UndoToken }
  | { readonly type: 'tables.close_all' }
  | { readonly type: 'table.resume'; readonly tableId: string }
  | {
      readonly type: 'sent_order.answer'
      readonly sentOrderId: string
      readonly answer: 'found' | 'not_found'
    }
  | { readonly type: 'waiter_call.done'; readonly waiterCallId: string }
  | { readonly type: 'receipt.brought'; readonly paymentId: string }
  | { readonly type: 'receipt.unbrought'; readonly paymentId: string; readonly undo?: UndoToken }
  | { readonly type: 'alert.done'; readonly alertId: string }
  | {
      readonly type: 'payment.answer'
      readonly paymentId: string
      readonly answering: 'close' | 'lines_not_back'
      readonly answer: 'receipt_printed' | 'no_receipt' | 'on_till' | 'not_on_till'
    }
  | { readonly type: 'ordering.pause'; readonly barId: string | null; readonly undo?: UndoToken }
  | { readonly type: 'ordering.lift'; readonly pauseId: string; readonly undo?: UndoToken }

/** Who acts at which venue. The tenant is the person's organisation, never the request's. */
export interface TonightScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: string
  /** The account, or the person a PIN named on a shared device. */
  readonly actor: ServiceActor
  /** When the account last entered its password: its session's start. */
  readonly signedInAt?: Date
}

/** What the mark needs besides the database: the queue (a fake in tests). */
export interface TonightServices {
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
}

/** Why a PIN did not name a person (`identifyStaffByPin`'s codes). */
export type PinRefusal = 'not_shared_device' | 'pin_wrong' | 'device_waiting'

/** Tonight's answer to a table command. */
export type TonightResult =
  | {
      readonly ok: true
      /** The service path's details: who opened the table and when, how many were opened. */
      readonly details: Extract<ServiceResult, { status: 'accepted' }>['details']
      /** For the mark: false when the retired code's files could not be queued for removal. */
      readonly queued?: boolean
    }
  | {
      readonly ok: false
      /** The service path's refusal code, a PIN's, `invalid` or `failed`. */
      readonly error: RefusalCode | PinRefusal | 'invalid' | 'failed' | (string & {})
      /** For `device_waiting`: how long the device waits before the next PIN. */
      readonly retryAfterSeconds?: number
      /** What the refusal says beside its code (the answer someone gave first, the state moved to). */
      readonly details?: Extract<ServiceResult, { status: 'refused' }>['details']
    }

function answer(result: ServiceResult): TonightResult {
  return result.status === 'accepted'
    ? { ok: true, details: result.details }
    : {
        ok: false,
        error: result.code,
        ...(Object.keys(result.details).length === 0 ? {} : { details: result.details }),
      }
}

async function run(scope: TonightScope, command: unknown): Promise<ServiceResult> {
  const { result } = await applyService(scope.pool, command, {
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    origin: 'staff',
    via: 'tonight',
    actor: scope.actor,
    jobId: newId('jb'),
    ...(scope.signedInAt === undefined ? {} : { signedInAt: scope.signedInAt }),
  })
  return result
}

/** Runs one of Tonight's table commands. */
export async function runTableCommand(
  scope: TonightScope,
  command: TableCommand,
): Promise<TonightResult> {
  return answer(await run(scope, command))
}

/**
 * Marks a table as a payment table, or takes the mark away (a settings change: the person's own
 * sign-in, never a PIN). The retired code's files are queued for removal; a failure to queue is
 * logged and reported as `queued: false` (the mark is saved; the file goes with the venue's next
 * token job).
 */
export async function markPaymentTable(
  scope: TonightScope,
  services: TonightServices,
  input: { readonly tableId: string; readonly isPaymentTable: boolean },
): Promise<TonightResult> {
  const result = await run(scope, { type: 'table.mark_payment', ...input })
  if (result.status !== 'accepted') return answer(result)
  // The retired files are named by the code's hash: they go to the job, never to the screen.
  const { retired: names, ...details } = result.details
  const retired = String(names ?? '')
    .split(',')
    .filter((name) => name !== '')
  if (retired.length === 0) return { ok: true, details }
  try {
    await services.enqueue(JOB_NAMES.publishTableTokens, {
      tenantId: scope.tenantId as TenantId,
      venueId: scope.venueId as VenueId,
      retired,
    })
    return { ok: true, details, queued: true }
  } catch (error) {
    logError('table_token_job_not_queued', error)
    return { ok: true, details, queued: false }
  }
}
