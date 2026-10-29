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
// item out of stock in the POS (#80), paying on the bill up to a held card (#110), the alerts'
// lifecycle: Done, what was sent to whom, the pauses kept as alerts and the staff devices for Web
// Push (#83), the closing hour and the pre-opening check (#82), and the end of a service day
// (#84), staff's answer to an Unconfirmed sent order (#85), and connecting a venue's payment
// account (#109).
//
// A guest command's `tableId` is never the phone's word: the guest API resolves the table code
// and puts the table it found into the command (D121).

import { logEntries } from '@restro/db'
import { inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { ORDER_EDIT_MAX_AGE_MS, ORDER_LIMITS } from '../table-order'
import { CALL_WAITER_KINDS } from '../theme'
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
import { markNightReportSent } from './night-report-sent'
import { editOrder, type OrderEditCommand, tidyTableOrder } from './order'
import {
  AlertChangesSchema,
  OrderingChangesSchema,
  setAlertSettings,
  setOrderingRules,
  TelegramLinkSchema,
  telegramLink,
} from './owner-settings'
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
  paymentHoldUnknown,
  paymentPrice,
  paymentSettle,
  paymentStep,
  payReturned,
  payStart,
  TipSchema,
} from './pay'
import { PAY_FIRST_COMMANDS } from './pay-first'
import { payFirstPermissionOf, SetPayFirstSchema, setPayFirst } from './pay-first-settings'
import { PAY_ROUTE_COMMANDS } from './pay-route'
import { payingBreaker } from './paying-pause'
import { SetPayingSchema, setPayingChoices } from './paying-settings'
import {
  accountLost,
  accountObserved,
  accountStarted,
  CONNECT_PERMISSION,
  ConnectSchema,
  connectAccount,
  DisconnectSchema,
  DomainSchema,
  disconnectAccount,
  domainRegistered,
  LostSchema,
  ObservedSchema,
  ReturnSchema,
  returnFromProvider,
  StartedSchema,
  TickCheckSchema,
  tickCheck,
} from './payment-connection'
import { paymentObserve } from './payment-observe'
import { preOpeningAlert } from './pre-opening'
import { recordReading } from './readings'
import { receiptBrought, receiptUnbrought } from './receipt-brought'
import { sendOrder } from './send'
import { SENT_ORDER_COMMANDS } from './sent-order'
import { sentOrderAnswer } from './sent-order-answer'
import { closeServiceDay } from './service-day-close'
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
  linkStaffTelegram,
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
import { changedSince, UndoTokenSchema } from './undo'
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

/** One line of a Send as the phone saw it. */
const SendLineSchema = z.strictObject({
  itemId: idSchema('nd'),
  optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
  qty: z.int().min(1).max(ORDER_LIMITS.quantity),
  note: z.string().max(ORDER_LIMITS.note),
})

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
  quickOnSharedDevice = false,
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId }),
    origins: ['staff'],
    permission,
    idempotency: 'by_nature',
    ...(quickOnSharedDevice ? { quickOnSharedDevice } : {}),
    handle,
  })
}

/**
 * Open and close, each the other's Undo in Tonight (#219): the write answers with an undo token,
 * and the inverse takes it back. With a token it is refused `undo_stale` when the table's sitting
 * began or ended again since (by anyone, `new_guests`, the closing hour or a reading too).
 */
function openOrClose<T extends 'table.open' | 'table.close'>(
  type: T,
  handle: CommandHandler<{ readonly type: T; readonly tableId: string }>,
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId, undo: UndoTokenSchema.optional() }),
    origins: ['staff'],
    permission: 'tables.open_close',
    idempotency: 'by_nature',
    quickOnSharedDevice: true,
    undoable: true,
    undoStale: (stx, command, entry) =>
      changedSince(
        stx,
        entry,
        sql`${logEntries.tableId} = ${command.tableId}
          and ${inArray(logEntries.kind, ['sitting.opened', 'sitting.ended'])}`,
      ),
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
    schema: z
      .strictObject({
        type: z.literal('order.send'),
        tableId,
        actionId,
        ageMs,
        confirmDuplicateOf: idSchema('so').optional(),
        /** The lines for the bill; empty when the Send has pay-first lines only. */
        lines: z.array(SendLineSchema).max(ORDER_LIMITS.lines),
        /**
         * The lines the guest pays for first (#113), with the tip; the guest API adds the hash of
         * the payment handle it hands the phone.
         */
        payFirst: z
          .strictObject({
            lines: z.array(SendLineSchema).min(1).max(ORDER_LIMITS.lines),
            tip: TipSchema,
            handleHash: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .optional(),
      })
      .refine((command) => command.lines.length > 0 || command.payFirst !== undefined),
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
  // #81, #180: one open call per table: a later request is added to it. Not located; no text, no
  // identity.
  'waiter.call': defineCommand({
    schema: z.strictObject({
      type: z.literal('waiter.call'),
      tableId,
      actionId,
      kind: z.enum(CALL_WAITER_KINDS),
      ageMs,
    }),
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
  'table.open': openOrClose('table.open', openTable),
  'table.close': openOrClose('table.close', closeTable),
  'table.new_guests': defineCommand({
    schema: z.strictObject({
      type: z.literal('table.new_guests'),
      tableId,
      sittingId: idSchema('st').optional(),
    }),
    origins: ['staff'],
    permission: 'tables.open_close',
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: newGuests,
  }),
  // Open all answers with an undo token too: its Undo is `table.close` per table (#219).
  'tables.open_all': defineCommand({
    schema: z.strictObject({ type: z.literal('tables.open_all') }),
    origins: ['staff'],
    permission: 'tables.open_close',
    idempotency: 'by_nature',
    undoable: true,
    handle: openAllTables,
  }),
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
  // #85: staff settle an Unconfirmed sent order: "Found on the bill" or "Not on the bill".
  'sent_order.answer': sentOrderAnswer(),
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
    quickOnSharedDevice: true,
    idempotency: 'by_nature',
    handle: waiterCallDone,
  }),
  // #200: staff mark a captured payment's paper receipt Brought (no PIN on a shared device), and
  // Undo it.
  'receipt.brought': receiptBrought(),
  'receipt.unbrought': receiptUnbrought(),
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
  // #87: the owner's hours and ordering rules, and who gets alerts: each a settings change (own
  // sign-in of the last 15 minutes) that merges into the venue's ordering settings and is one
  // `record` Log entry. An empty `changes` changes nothing: it only checks the right.
  'settings.ordering_set': defineCommand({
    schema: z.strictObject({
      type: z.literal('settings.ordering_set'),
      changes: OrderingChangesSchema,
    }),
    origins: ['staff'],
    permission: 'settings.guards',
    // Rewrites `venues.settings` read-modify-write: queue on the row instead of upgrading a shared lock.
    venueLock: 'update',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setOrderingRules,
  }),
  'settings.alerts_set': defineCommand({
    schema: z.strictObject({
      type: z.literal('settings.alerts_set'),
      changes: AlertChangesSchema,
    }),
    origins: ['staff'],
    permission: 'settings.alerts',
    // Rewrites `venues.settings` read-modify-write: queue on the row instead of upgrading a shared lock.
    venueLock: 'update',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setAlertSettings,
  }),
  // #109: connecting the venue's payment account (D125 2.2): a permission of its own and a sign-in of
  // the last 15 minutes. The return reads the account back, which needs the right but no new
  // sign-in (the provider's hosted form can take longer than 15 minutes).
  'payment_account.connect': defineCommand({
    schema: ConnectSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: connectAccount,
  }),
  'payment_account.return': defineCommand({
    schema: ReturnSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    idempotency: 'by_nature',
    handle: returnFromProvider,
  }),
  'payment_account.disconnect': defineCommand({
    schema: DisconnectSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: disconnectAccount,
  }),
  // #116: the smallest card payment and the venue's legal details (#198), by the same right.
  'settings.paying_set': defineCommand({
    schema: SetPayingSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    // Rewrites `venues.settings` read-modify-write: queue on the row instead of upgrading a shared lock.
    venueLock: 'update',
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setPayingChoices,
  }),
  // #216: pay first. The venue's choices (Paying) need the right to connect payments, an area's or a
  // table's (Tables & QR) the right to mark payment tables. A settings change, serialised on the
  // venue's row: two saves of different tables both stay.
  'pay_first.set': defineCommand({
    schema: SetPayFirstSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    permissionOf: payFirstPermissionOf,
    // Rewrites `venues.settings` read-modify-write: queue on the row instead of upgrading a shared lock.
    venueLock: 'update',

    freshSignIn: true,
    idempotency: 'by_nature',
    handle: setPayFirst,
  }),
  'payment_account.tick': defineCommand({
    schema: TickCheckSchema,
    origins: ['staff'],
    permission: CONNECT_PERMISSION,
    freshSignIn: true,
    idempotency: 'by_nature',
    handle: tickCheck,
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
  // #87: a person's Telegram id (who may press Done in the venue's group); the owner can only
  // unlink here (`null`). Only the worker's `telegram.link` sets an id, once the person pressed Start
  // on the signed link the owner made for them.
  'staff.link_telegram': rolesChange(
    'staff.link_telegram',
    { staffMemberId, telegramUserId: z.null() },
    linkStaffTelegram,
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
  // #112: a hold whose outcome is unknown is released, never sent again with its key.
  'payment.hold_unknown': paymentHoldUnknown(),
  // #112: the payment provider's breaker pauses paying in the app at a venue, never ordering.
  'paying.breaker': payingBreaker(),
  'payment.step': paymentStep(),
  // #111: the route after the hold: the queue, the turn, the move, the last check, the close, the
  // capture, the undo, and a manager's answer to an unconfirmed close.
  ...PAY_ROUTE_COMMANDS,
  // #113: a pay-first round entered on a payment table, and its check before the close.
  ...PAY_FIRST_COMMANDS,
  // #109: what the provider answered about a venue's account: its account, a reading, the access
  // lost, the guest domain registered. A provider notice only nudges the worker to read.
  'payment_account.started': defineCommand({
    schema: StartedSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: accountStarted,
  }),
  'payment_account.observed': defineCommand({
    schema: ObservedSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: accountObserved,
  }),
  'payment_account.lost': defineCommand({
    schema: LostSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: accountLost,
  }),
  'payment_account.domain': defineCommand({
    schema: DomainSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: domainRegistered,
  }),
  // #87: the Telegram poller heard the bot added to a group by the owner's link, removed from it,
  // or a person pressing Start on theirs. The signed link is the authority, checked by the worker.
  'telegram.link': defineCommand({
    schema: TelegramLinkSchema,
    origins: ['worker'],
    permission: null,
    // Rewrites `venues.settings` read-modify-write: queue on the row instead of upgrading a shared lock.
    venueLock: 'update',
    idempotency: 'by_state',
    handle: telegramLink,
  }),
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
  // #84: an ended service day's retention, its cleared action ids and its totals.
  'service_day.close': defineCommand({
    schema: z.strictObject({ type: z.literal('service_day.close'), serviceDate: z.iso.date() }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: closeServiceDay,
  }),
  // #179: Telegram accepted a closed day's end-of-night message; the hourly tick stops sending it.
  'service_day.report_sent': defineCommand({
    schema: z.strictObject({
      type: z.literal('service_day.report_sent'),
      serviceDate: z.iso.date(),
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: markNightReportSent,
  }),
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
