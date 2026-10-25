'use server'

// Tonight's table actions (#73; the screen is #85): thin wrappers. Each checks the input with Zod,
// finds who is asking (`requireTenant`: the tenant is the person's organisation, never the
// request's), that the venue is theirs, and on a shared device the person whose PIN came with the
// action; then it calls tables.ts, whose service write path checks the permission. The mark of a
// payment table is a settings change: it takes no PIN, only the person's own sign-in.
import { idSchema } from '@restro/core'
import type { ServiceActor } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '../db'
import { enqueueJob } from '../jobs'
import { logError } from '../log'
import { requireTenant } from '../session'
import { identifyAtSharedDevice } from '../staff/service'
import { getVenue } from '../venues'
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
