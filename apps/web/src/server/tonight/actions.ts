'use server'

// Tonight's table actions (#73; the screen is #85): thin wrappers. Each checks the input with Zod,
// finds who is asking (`requireTenant`: the tenant is the person's organisation, never the
// request's), that the venue is theirs, and on a shared device the person whose PIN came with the
// action; then it calls tables.ts, whose service write path checks the permission. The mark of a
// payment table is a settings change: it takes no PIN, only the person's own sign-in.
import { idSchema } from '@restro/core'
import { paymentWorkerJob, type ServiceActor } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { queuePaymentStep } from '../guest-api'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { requireTenant } from '../session'
import { identifyAtSharedDevice } from '../staff/service'
import { getVenue } from '../venues'
import { loadTableBill, type TableSheetBill } from './load'
import {
  markPaymentTable,
  runTableCommand,
  type TableCommand,
  type TonightResult,
  type TonightScope,
} from './tables'

const venueId = idSchema('vn')
const tableId = idSchema('tb')
/** A staff member's 4-digit PIN, entered on a shared device. */
const pin = z
  .string()
  .regex(/^\d{4}$/)
  .optional()

const OnTable = z.strictObject({ venueId, tableId, pin })
const NewGuests = z.strictObject({ venueId, tableId, sittingId: idSchema('st').optional(), pin })
const OnVenue = z.strictObject({ venueId, pin })
const MarkPayment = z.strictObject({ venueId, tableId, isPaymentTable: z.boolean() })

const INVALID: TonightResult = { ok: false, error: 'invalid' }
const NOT_FOUND: TonightResult = { ok: false, error: 'venue_missing' }

/**
 * Runs one action for a venue of the signed-in person's organisation, as the account or as the
 * person a PIN names, then refreshes the venue's pages.
 */
async function perform(
  input: { readonly venueId: string; readonly pin?: string | undefined },
  act: (scope: TonightScope) => Promise<TonightResult>,
): Promise<TonightResult> {
  try {
    const { organization, user, sessionId, signedInAt } = await requireTenant()
    // Another tenant's venue and a made-up id both come back as null (row-level security).
    const venue = await getVenue(organization.id, input.venueId)
    if (!venue) return NOT_FOUND
    let actor: ServiceActor = { kind: 'user', userId: user.id, sessionId }
    if (input.pin !== undefined) {
      const identity = await identifyAtSharedDevice({
        tenantId: organization.id,
        venueId: venue.id,
        userId: user.id,
        sessionId,
        pin: input.pin,
      })
      if (!identity.ok) {
        return identity.code === 'device_waiting'
          ? { ok: false, error: identity.code, retryAfterSeconds: identity.retryAfterSeconds }
          : { ok: false, error: identity.code }
      }
      actor = { kind: 'staff', staffMemberId: identity.staffMemberId, sessionId }
    }
    const result = await act({
      pool: getPool(),
      tenantId: organization.id,
      venueId: venue.id,
      actor,
      signedInAt,
    })
    if (result.ok) revalidatePath(`/venues/${venue.id}`)
    return result
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('tonight_table_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}

function command(scope: TonightScope, value: TableCommand): Promise<TonightResult> {
  return runTableCommand(scope, value)
}

/** Opens a table for phones; on an open table, says who opened it. */
export async function openTableAction(input: unknown): Promise<TonightResult> {
  const parsed = OnTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'table.open', tableId: parsed.data.tableId }),
  )
}

/** Closes a table for phones: its sitting ends, its unsent order goes. */
export async function closeTableAction(input: unknown): Promise<TonightResult> {
  const parsed = OnTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'table.close', tableId: parsed.data.tableId }),
  )
}

/** Ends the sitting shown (`sittingId`) and starts the next group's. */
export async function newGuestsAction(input: unknown): Promise<TonightResult> {
  const parsed = NewGuests.safeParse(input)
  if (!parsed.success) return INVALID
  const { tableId: table, sittingId } = parsed.data
  return perform(parsed.data, (scope) =>
    command(scope, {
      type: 'table.new_guests',
      tableId: table,
      ...(sittingId === undefined ? {} : { sittingId }),
    }),
  )
}

/** Opens every table phones may use. */
export async function openAllTablesAction(input: unknown): Promise<TonightResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) => command(scope, { type: 'tables.open_all' }))
}

/** Closes every table open for phones. */
export async function closeAllTablesAction(input: unknown): Promise<TonightResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) => command(scope, { type: 'tables.close_all' }))
}

/** Marks a table as a payment table, or takes the mark away (the person's own sign-in). */
export async function markPaymentTableAction(input: unknown): Promise<TonightResult> {
  const parsed = MarkPayment.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...mark } = parsed.data
  return perform({ venueId: venue }, (scope) =>
    markPaymentTable(scope, { enqueue: (name, data) => enqueueJob(name, data) }, mark),
  )
}

const OnCall = z.strictObject({ venueId, waiterCallId: idSchema('wc'), pin })
const OnPause = z.strictObject({ venueId, pauseId: idSchema('pa'), pin })
const OnBar = z.strictObject({ venueId, barId: idSchema('br').nullable(), pin })
const OnSentOrder = z.strictObject({
  venueId,
  sentOrderId: idSchema('so'),
  answer: z.enum(['found', 'not_found']),
  pin,
})
const OnTables = z.strictObject({ venueId, tableIds: z.array(tableId).min(1).max(200), pin })
const OnTableRead = z.strictObject({ venueId, tableId })

/** Marks a waiter call handled: no PIN, the device's account is named in the Log (D122 §7). */
export async function handleWaiterCallAction(input: unknown): Promise<TonightResult> {
  const parsed = OnCall.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'waiter_call.done', waiterCallId: parsed.data.waiterCallId }),
  )
}

/** Pauses ordering at every bar (`barId` null) or one. Only makes the menu more cautious. */
export async function pauseOrderingAction(input: unknown): Promise<TonightResult> {
  const parsed = OnBar.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'ordering.pause', barId: parsed.data.barId }),
  )
}

/** Lifts a pause staff started: a manager's PIN on a shared device. */
export async function liftOrderingAction(input: unknown): Promise<TonightResult> {
  const parsed = OnPause.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'ordering.lift', pauseId: parsed.data.pauseId }),
  )
}

/** Resumes a table whose guard paused it. */
export async function resumeTableAction(input: unknown): Promise<TonightResult> {
  const parsed = OnTable.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'table.resume', tableId: parsed.data.tableId }),
  )
}

/**
 * Staff's answer to a sent order the POS never confirmed, after looking at the bill: "Found on the
 * bill" or "Not on the bill". One command settles the order, lifts the table's pause and closes the
 * alert; on a shared device it names the person by their own PIN.
 */
export async function answerSentOrderAction(input: unknown): Promise<TonightResult> {
  const parsed = OnSentOrder.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, {
      type: 'sent_order.answer',
      sentOrderId: parsed.data.sentOrderId,
      answer: parsed.data.answer,
    }),
  )
}

/**
 * Undoes "Open all": closes the tables that were closed when it was pressed. Each is a
 * `table.close` of the same person, stopping at the first refusal.
 */
export async function undoOpenAllAction(input: unknown): Promise<TonightResult> {
  const parsed = OnTables.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, async (scope) => {
    let last: TonightResult = { ok: true, details: {} }
    for (const id of parsed.data.tableIds) {
      last = await command(scope, { type: 'table.close', tableId: id })
      if (!last.ok) return last
    }
    return last
  })
}

/** The bill of a table as last read, for its sheet (read-only). */
export async function tableBillAction(
  input: unknown,
): Promise<{ readonly ok: true; readonly bill: TableSheetBill | null } | { readonly ok: false }> {
  const parsed = OnTableRead.safeParse(input)
  if (!parsed.success) return { ok: false }
  try {
    const { organization } = await requireTenant()
    const venue = await getVenue(organization.id, parsed.data.venueId)
    if (!venue) return { ok: false }
    return {
      ok: true,
      bill: await loadTableBill({ tenantId: organization.id, tableId: parsed.data.tableId }),
    }
  } catch (error) {
    if (error instanceof Error && 'digest' in error) throw error
    logError('tonight_table_bill_failed', error)
    return { ok: false }
  }
}

const OnAlert = z.strictObject({ venueId, alertId: idSchema('al'), pin })
const OnPayment = z.strictObject({
  venueId,
  paymentId: idSchema('py'),
  answering: z.enum(['close', 'lines_not_back']),
  answer: z.enum(['receipt_printed', 'no_receipt', 'on_till', 'not_on_till']),
  pin,
})

/**
 * Marks an alert done: the acknowledgement of items stuck on a payment table, of a payment stopped
 * before closing and of the owners' money alerts (#115). The service path refuses a payment
 * question (`alert_needs_answer`), so a hidden button is not the only guard.
 */
export async function doneAlertAction(input: unknown): Promise<TonightResult> {
  const parsed = OnAlert.safeParse(input)
  if (!parsed.success) return INVALID
  return perform(parsed.data, (scope) =>
    command(scope, { type: 'alert.done', alertId: parsed.data.alertId }),
  )
}

/**
 * A manager's or owner's answer to a payment question (#115): "Receipt printed" / "No receipt", or
 * for a pay-first round "On the till" / "Not on the till". The answer moves the payment on, so the
 * worker is queued at once (`paymentWorkerJob`, #113) and does not wait for the recovery tick.
 */
export async function answerPaymentAction(input: unknown): Promise<TonightResult> {
  const parsed = OnPayment.safeParse(input)
  if (!parsed.success) return INVALID
  const { paymentId, answering, answer } = parsed.data
  return perform(parsed.data, async (scope) => {
    const result = await command(scope, { type: 'payment.answer', paymentId, answering, answer })
    if (!result.ok) return result
    const state = result.details.state
    if (typeof state === 'string') {
      const step = paymentWorkerJob({
        state,
        reason: typeof result.details.answer === 'string' ? result.details.answer : null,
      })
      if (step !== null) {
        try {
          await queuePaymentStep(
            { tenantId: scope.tenantId, venueId: scope.venueId, paymentId },
            step,
          )
        } catch (error) {
          // The answer is saved; the recovery tick picks the payment up within a minute.
          logError('payment_worker_not_queued', error)
        }
      }
    }
    return result
  })
}
