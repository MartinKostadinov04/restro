// The service commands (design §2.1; spec #64 Implementation Decisions 3): one Zod-checked union,
// each command with the origins it may come from, the permission it needs and how a repeat is
// recognised. A command is a stub, refused `not_built`, until its ticket gives it a handler and
// the rest of its payload: the machinery around them (origins, permissions, provenance, locks,
// idempotency, the Log, the version) is real and runs for each of them. Built so far: the
// table-code commands (#70), the floor reading's worker steps (#71), the roles, staff, PINs and
// shared devices (#72), tables open for phones with their sittings (#73), the readings of a
// table's bill with the sitting's end by a reading (#74), the table's shared order (#75), Send and
// a sent order's way to the POS (#77), a payment's refund and dispute as read back after a
// provider's notice (#108), the waiter call with its Handled and its lapse (#81), the notice of an
// item out of stock in the POS (#80), paying on the bill up to a held card (#110), and the alerts'
// lifecycle: Done, what was sent to whom, the pauses kept as alerts and the staff devices for Web
// Push (#83).
//
// A guest command's `tableId` is never the phone's word: the guest API resolves the table code
// and puts the table it found into the command (D121).

import { z } from 'zod'

import { idSchema } from '../ids'
import { ORDER_EDIT_MAX_AGE_MS, ORDER_LIMITS } from '../table-order'
import {
  AlertDeliveredSchema,
  AlertSuppressedSchema,
  alertDelivered,
  alertDone,
  alertSuppressed,
  PushExpireSchema,
  PushRevokeSchema,
  PushSubscribeSchema,
  pushExpire,
  pushRevoke,
  pushSubscribe,
  syncPauseAlerts,
} from './alerts'
import { closeAtClosingHour } from './closing-hour'
import { type CommandDefinition, type CommandHandler, defineCommand } from './definition'
import { tableReturned, tableVanished } from './floor-pause'
import { editOrder, type OrderEditCommand, tidyTableOrder } from './order'
import {
  liftOrdering,
  pauseConnection,
  pauseOrdering,
  resumeTable,
  sweepPauses,
  transitionPause,
} from './pauses'
import {
  payCancel,
  paymentCheck,
  paymentHoldCreated,
  paymentPrice,
  paymentSettle,
  paymentStep,
  payReturned,
  payStart,
} from './pay'
import { paymentObserve } from './payment-observe'
import { preOpeningAlert } from './pre-opening'
import { recordReading } from './readings'
import { sendOrder } from './send'
import { SENT_ORDER_COMMANDS } from './sent-order'
import {
  closeAllTables,
  closeTable,
  markPaymentTable,
  newGuests,
  openAllTables,
  openTable,
} from './sittings'
import {
  addStaff,
  archiveRole,
  archiveStaff,
  assignStaff,
  copyRole,
  DeviceNameSchema,
  DisplayNameSchema,
  linkStaffAccount,
  MAX_REVEALED_PINS,
  markSharedDevice,
  PermissionListSchema,
  RoleNameSchema,
  RoleRefSchema,
  renameStaff,
  resetPin,
  revealPins,
  revokeSharedDevice,
  unassignStaff,
  updateRole,
} from './staff'
import { stockNotice } from './stock'
import { MAX_REVEALED_CODES, reissueTableCode, revealTableCodes } from './table-codes'
import { callWaiter, lapseWaiterCall, waiterCallDone } from './waiter-call'

const tableId = idSchema('tb')
const actionId = z.uuid()
const staffMemberId = idSchema('sm')

/** Milliseconds since the guest's tap (D121): the guest API copies it from the request. */
const ageMs = z
  .int()
  .nonnegative()
  .max(24 * 60 * 60_000)
const lineId = idSchema('ol')

/** A guest edit of the table's order (the guest API's, #75): remembered in the ring, 30 s old at most. */
function orderEdit<T extends string, F extends z.ZodRawShape>(type: T, fields: F) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId, actionId, ageMs, ...fields }),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    maxAgeMs: ORDER_EDIT_MAX_AGE_MS,
    // The generic shape loses each edit's fields; the schema above is the edit's own.
    handle: (stx, command) => editOrder(stx, command as unknown as OrderEditCommand),
  })
}

/** A staff action on one table. */
function staffOnTable<T extends string>(
  type: T,
  permission: 'tables.open_close' | 'tables.resume' | 'settings.codes',
  handle: CommandHandler<{ readonly type: T; readonly tableId: string }> | null = null,
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId }),
    origins: ['staff'],
    permission,
    idempotency: 'by_nature',
    handle,
  })
}

/** A staff action on the whole venue. */
function staffOnVenue<T extends string>(
  type: T,
  permission: 'tables.open_close',
  handle: CommandHandler<{ readonly type: T }>,
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type) }),
    origins: ['staff'],
    permission,
    idempotency: 'by_nature',
    handle,
  })
}

/**
 * A change to the venue's roles, staff, PINs or shared devices (#72): `settings.roles`, with the
 * password entered within the last 15 minutes (D122 §7). A repeat makes the change again, or finds
 * it made and changes nothing.
 */
function rolesChange<T extends string, F extends z.ZodRawShape>(
  type: T,
  fields: F,
  handle: CommandHandler<z.infer<z.ZodObject<F & { type: z.ZodLiteral<T> }>>>,
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), ...fields }),
    origins: ['staff'],
    permission: 'settings.roles',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle,
  })
}

/** A worker step. */
function workerStep<T extends string, F extends z.ZodRawShape>(type: T, fields: F) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), ...fields }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: null,
  })
}

/** Every service command by type, with the ticket that builds it. */
export const SERVICE_COMMANDS = {
  // Guest (the guest API, D121).
  // #75: the table's shared order. Identical lines merge; a change below 1 removes the line, with
  // Undo for a few seconds; Restore brings the earlier order back, merged.
  'order.add': orderEdit('order.add', {
    itemId: idSchema('nd'),
    optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
    qty: z.int().min(1).max(ORDER_LIMITS.quantity),
    note: z.string().max(ORDER_LIMITS.note),
  }),
  'order.change': orderEdit('order.change', {
    lineId,
    delta: z
      .int()
      .min(-ORDER_LIMITS.quantity)
      .max(ORDER_LIMITS.quantity)
      .refine((delta) => delta !== 0),
  }),
  'order.remove': orderEdit('order.remove', { lineId }),
  'order.undo': orderEdit('order.undo', { lineId }),
  'order.restore': orderEdit('order.restore', { setAsideAt: z.int().nonnegative() }),
  // #75: what time alone changes (an Undo closing, an idle order set aside), run by the guest API
  // before it answers a read past the order's next change, and by the worker's minute tick.
  // What time alone changes (an Undo closing, an idle order set aside): the worker's minute tick,
  // and the guest API before it answers a read past the order's next change. Never a guest's own
  // command (it has no action id): both run it as the system.
  'order.tidy': defineCommand({
    schema: z.strictObject({ type: z.literal('order.tidy'), tableId }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: tidyTableOrder,
  }),
  // #77: Send. The lines are the order's as the guest saw them; a repeat gets the sent order the
  // action made. A deliberate repeat after the duplicate warning is a new action naming the sent
  // order it repeats (#78).
  'order.send': defineCommand({
    schema: z.strictObject({
      type: z.literal('order.send'),
      tableId,
      actionId,
      ageMs,
      confirmDuplicateOf: idSchema('so').optional(),
      lines: z
        .array(
          z.strictObject({
            itemId: idSchema('nd'),
            optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
            qty: z.int().min(1).max(ORDER_LIMITS.quantity),
            note: z.string().max(ORDER_LIMITS.note),
          }),
        )
        .min(1)
        .max(ORDER_LIMITS.lines),
    }),
    origins: ['guest'],
    permission: null,
    idempotency: 'sent_order',
    maxAgeMs: ORDER_EDIT_MAX_AGE_MS,
    handle: sendOrder,
  }),
  // #110: paying on the bill, from Pay to a held card. The phone names its payment by the handle's
  // hash, which the guest API makes; the handle itself never reaches the engine.
  'pay.start': payStart(),
  'pay.returned': payReturned(),
  'pay.cancel': payCancel(),
  // #81: a second tap returns the open call. Not located; no text, no identity.
  'waiter.call': defineCommand({
    schema: z.strictObject({ type: z.literal('waiter.call'), tableId, actionId, ageMs }),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    maxAgeMs: ORDER_EDIT_MAX_AGE_MS,
    handle: callWaiter,
  }),

  // Staff (Tonight, D122 §7).
  // #73: open for phones, the sitting and its end by staff. "Open" on an open table says who
  // opened it; "New guests" names the sitting it ends, so a repeat after the new group sat down
  // changes nothing.
  'table.open': staffOnTable('table.open', 'tables.open_close', openTable),
  'table.close': staffOnTable('table.close', 'tables.open_close', closeTable),
  'table.new_guests': defineCommand({
    schema: z.strictObject({
      type: z.literal('table.new_guests'),
      tableId,
      sittingId: idSchema('st').optional(),
    }),
    origins: ['staff'],
    permission: 'tables.open_close',
    idempotency: 'by_nature',
    handle: newGuests,
  }),
  'tables.open_all': staffOnVenue('tables.open_all', 'tables.open_close', openAllTables),
  'tables.close_all': staffOnVenue('tables.close_all', 'tables.open_close', closeAllTables),
  // #73: a payment table (D122 §7, §8) is a menu-side mark (core/apply hides the table and retires
  // its code), run here for the permission and the `record` Log entry. A settings change: the
  // person's own sign-in of the last 15 minutes.
  'table.mark_payment': defineCommand({
    schema: z.strictObject({
      type: z.literal('table.mark_payment'),
      tableId,
      isPaymentTable: z.boolean(),
    }),
    origins: ['staff'],
    permission: 'settings.payment_tables',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: markPaymentTable,
  }),
  // #79: staff lift a table's Unconfirmed or guard pause; pause all bars or one; a manager lifts.
  'table.resume': staffOnTable('table.resume', 'tables.resume', resumeTable),
  'ordering.pause': pauseOrdering(),
  'ordering.lift': liftOrdering(),
  // #83: Done in Tonight or from the venue's Telegram group (`via`), and what the worker sends.
  'alert.done': defineCommand({
    schema: z.strictObject({ type: z.literal('alert.done'), alertId: idSchema('al') }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: alertDone,
  }),
  'alert.delivered': defineCommand({
    schema: AlertDeliveredSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: alertDelivered,
  }),
  'alert.suppressed': defineCommand({
    schema: AlertSuppressedSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: alertSuppressed,
  }),
  'alerts.sync_pauses': defineCommand({
    schema: z.strictObject({ type: z.literal('alerts.sync_pauses') }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: syncPauseAlerts,
  }),
  // #83: a signed-in account's installed device for Web Push (D122 §7).
  'push.subscribe': defineCommand({
    schema: PushSubscribeSchema,
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: pushSubscribe,
  }),
  'push.revoke': defineCommand({
    schema: PushRevokeSchema,
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: pushRevoke,
  }),
  // The push service said the device is gone (404 or 410): the worker ends it.
  'push.expire': defineCommand({
    schema: PushExpireSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: pushExpire,
  }),
  'waiter_call.done': defineCommand({
    // #81
    schema: z.strictObject({ type: z.literal('waiter_call.done'), waiterCallId: idSchema('wc') }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: waiterCallDone,
  }),
  // #70: the one writer of `tables.code_generation`. A repeat issues yet another code, which is
  // what a manager pressing "new code" twice asks for.
  'table_code.reissue': defineCommand({
    schema: z.strictObject({ type: z.literal('table_code.reissue'), tableId }),
    origins: ['staff'],
    permission: 'settings.codes',
    idempotency: 'by_nature',
    handle: reissueTableCode,
  }),
  // #70: the admin sees its tables' codes again (a page of thumbnails, a sticker); the worker's
  // reveal endpoint opens the sealed copies once this is accepted.
  'table_code.reveal': defineCommand({
    schema: z.strictObject({
      type: z.literal('table_code.reveal'),
      tableIds: z.array(tableId).min(1).max(MAX_REVEALED_CODES),
    }),
    origins: ['staff'],
    permission: 'settings.codes',
    idempotency: 'by_nature',
    handle: revealTableCodes,
  }),
  // #72: roles. A default role is named by its kind (`staff`, `manager`, `owner`).
  'role.copy': rolesChange(
    'role.copy',
    { fromRoleId: RoleRefSchema, name: RoleNameSchema },
    copyRole,
  ),
  'role.update': rolesChange(
    'role.update',
    {
      roleId: idSchema('rl'),
      name: RoleNameSchema.optional(),
      permissions: PermissionListSchema.optional(),
    },
    updateRole,
  ),
  'role.archive': rolesChange('role.archive', { roleId: idSchema('rl') }, archiveRole),
  // #72: staff members and their assignment at this venue.
  'staff.add': rolesChange(
    'staff.add',
    { displayName: DisplayNameSchema, roleId: RoleRefSchema },
    addStaff,
  ),
  'staff.rename': rolesChange(
    'staff.rename',
    { staffMemberId, displayName: DisplayNameSchema },
    renameStaff,
  ),
  'staff.assign': rolesChange(
    'staff.assign',
    { staffMemberId, roleId: RoleRefSchema },
    assignStaff,
  ),
  'staff.unassign': rolesChange('staff.unassign', { staffMemberId }, unassignStaff),
  'staff.archive': rolesChange('staff.archive', { staffMemberId }, archiveStaff),
  'staff.link_account': rolesChange(
    'staff.link_account',
    {
      staffMemberId,
      userId: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
        .nullable(),
    },
    linkStaffAccount,
  ),
  // #72: PINs. "New PIN" draws another; seeing PINs again is the worker's reveal endpoint, which
  // opens the sealed copies once this is accepted. Both need a fresh sign-in.
  'pin.reset': rolesChange('pin.reset', { staffMemberId }, resetPin),
  'pin.reveal': rolesChange(
    'pin.reveal',
    { staffMemberIds: z.array(staffMemberId).min(1).max(MAX_REVEALED_PINS) },
    revealPins,
  ),
  // #72: shared devices (the signed-in session marks itself; revoking is done from another).
  'device.mark_shared': rolesChange(
    'device.mark_shared',
    { name: DeviceNameSchema },
    markSharedDevice,
  ),
  'device.revoke': rolesChange('device.revoke', { deviceId: idSchema('dv') }, revokeSharedDevice),

  // Worker (D122 §9: readings, sent orders, pauses, sittings, notices, sweeps, the day's end).
  // The floor reading (#71): a vanished table pauses its sitting, a returned one lifts the pause.
  'floor.table_vanished': tableVanished(),
  'floor.table_returned': tableReturned(),
  // #74: a reading of the table's bill, which ends the sitting when it shows the bill closed.
  'reading.record': recordReading(),
  // #77: a sent order's way to the POS: the slot, each state, and the sweep of a dead worker's.
  ...SENT_ORDER_COMMANDS,
  // #79: the breaker pauses a POS connection, probes it and lifts it.
  'connection.pause': pauseConnection(),
  'pause.transition': transitionPause(),
  // #80: Tonight's notice of an item the POS says ran out, and its end when the item is back.
  'notice.record': stockNotice(),
  // #108: a refund or a dispute, read back from the provider after its notice.
  'payment.observe': paymentObserve(),
  // #110: the worker's steps from `requested` to `held`, each a compare-and-set on the payment.
  'payment.price': paymentPrice(),
  'payment.hold_created': paymentHoldCreated(),
  'payment.check': paymentCheck(),
  'payment.settle': paymentSettle(),
  'payment.step': paymentStep(),
  // #81: a call nobody answered in the venue's time, or whose sitting ended, lapses.
  'waiter_call.lapse': defineCommand({
    schema: z.strictObject({ type: z.literal('waiter_call.lapse'), waiterCallId: idSchema('wc') }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: lapseWaiterCall,
  }),
  // #79: the minute tick lifts the Unconfirmed table pauses older than 15 minutes.
  sweep: sweepPauses(),
  // #82: at the venue's closing hour the minute tick closes every table for phones.
  'hours.close_tables': defineCommand({
    schema: z.strictObject({ type: z.literal('hours.close_tables') }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: closeAtClosingHour,
  }),
  // #82: a failed pre-opening check alerts the venue's staff and Restro's admin team, once a night.
  'hours.pre_opening_alert': preOpeningAlert(),
  'service_day.close': workerStep('service_day.close', {
    serviceDate: z.iso.date(),
  }), // #84
} as const satisfies Record<string, CommandDefinition>

/** One command type. */
export type ServiceCommandType = keyof typeof SERVICE_COMMANDS

/** One service command, as its schema parses it. */
export type ServiceCommand = {
  [K in ServiceCommandType]: z.infer<(typeof SERVICE_COMMANDS)[K]['schema']>
}[ServiceCommandType]

const schemas = Object.values(SERVICE_COMMANDS).map((definition) => definition.schema)

/** The whole union, for callers that check a command before they pass it on. */
export const ServiceCommandSchema = z.discriminatedUnion(
  'type',
  schemas as unknown as [(typeof schemas)[number], ...(typeof schemas)[number][]],
)
