// The service commands (design §2.1; spec #64 Implementation Decisions 3): one Zod-checked union,
// each command with the origins it may come from, the permission it needs and how a repeat is
// recognised. A command is a stub, refused `not_built`, until its ticket gives it a handler and
// the rest of its payload: the machinery around them (origins, permissions, provenance, locks,
// idempotency, the Log, the version) is real and runs for each of them. Built so far: the
// table-code commands (#70).
//
// A guest command's `tableId` is never the phone's word: the guest API resolves the table code
// and puts the table it found into the command (D121).

import { z } from 'zod'

import { idSchema } from '../ids'
import { type CommandDefinition, defineCommand } from './definition'
import { tableReturned, tableVanished } from './floor-pause'
import { MAX_REVEALED_CODES, reissueTableCode, revealTableCodes } from './table-codes'

const tableId = idSchema('tb')
const actionId = z.uuid()

/** A guest edit of the table's order (the guest API's, #75). */
function orderEdit<T extends string>(type: T) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId, actionId }),
    origins: ['guest'],
    permission: null,
    idempotency: 'order_ring',
    handle: null,
  })
}

/** A staff action on one table. */
function staffOnTable<T extends string>(
  type: T,
  permission: 'tables.open_close' | 'tables.resume' | 'settings.codes',
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type), tableId }),
    origins: ['staff'],
    permission,
    idempotency: 'by_nature',
    handle: null,
  })
}

/** A staff action on the whole venue. */
function staffOnVenue<T extends string>(
  type: T,
  permission: 'tables.open_close' | 'settings.roles',
) {
  return defineCommand({
    schema: z.strictObject({ type: z.literal(type) }),
    origins: ['staff'],
    permission,
    idempotency: 'by_nature',
    handle: null,
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
  'order.add': orderEdit('order.add'), // #75
  'order.change': orderEdit('order.change'), // #75
  'order.remove': orderEdit('order.remove'), // #75
  'order.undo': orderEdit('order.undo'), // #75
  'order.restore': orderEdit('order.restore'), // #75
  'order.send': defineCommand({
    // #77; a deliberate repeat after the duplicate warning is a new action (#78).
    schema: z.strictObject({ type: z.literal('order.send'), tableId, actionId }),
    origins: ['guest'],
    permission: null,
    idempotency: 'sent_order',
    handle: null,
  }),
  'waiter.call': defineCommand({
    // #81: a second tap returns the open call.
    schema: z.strictObject({ type: z.literal('waiter.call'), tableId, actionId }),
    origins: ['guest'],
    permission: null,
    idempotency: 'by_nature',
    handle: null,
  }),

  // Staff (Tonight, D122 §7).
  'table.open': staffOnTable('table.open', 'tables.open_close'), // #73
  'table.close': staffOnTable('table.close', 'tables.open_close'), // #73
  'table.new_guests': staffOnTable('table.new_guests', 'tables.open_close'), // #73
  'tables.open_all': staffOnVenue('tables.open_all', 'tables.open_close'), // #73
  'tables.close_all': staffOnVenue('tables.close_all', 'tables.open_close'), // #73
  'table.resume': staffOnTable('table.resume', 'tables.resume'), // #79
  'ordering.pause': defineCommand({
    // #79: all bars, or one.
    schema: z.strictObject({ type: z.literal('ordering.pause'), barId: idSchema('br').nullable() }),
    origins: ['staff'],
    permission: 'ordering.pause',
    idempotency: 'by_nature',
    handle: null,
  }),
  'ordering.lift': defineCommand({
    // #79
    schema: z.strictObject({ type: z.literal('ordering.lift'), pauseId: idSchema('pa') }),
    origins: ['staff'],
    permission: 'ordering.lift',
    idempotency: 'by_nature',
    handle: null,
  }),
  'alert.done': defineCommand({
    // #83
    schema: z.strictObject({ type: z.literal('alert.done'), alertId: idSchema('al') }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: null,
  }),
  'waiter_call.done': defineCommand({
    // #81
    schema: z.strictObject({ type: z.literal('waiter_call.done'), waiterCallId: idSchema('wc') }),
    origins: ['staff'],
    permission: 'alerts.answer',
    idempotency: 'by_nature',
    handle: null,
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
  'roles.change': staffOnVenue('roles.change', 'settings.roles'), // #72
  'staff.change': staffOnVenue('staff.change', 'settings.roles'), // #72

  // Worker (D122 §9: readings, sent orders, pauses, sittings, notices, sweeps, the day's end).
  // The floor reading (#71): a vanished table pauses its sitting, a returned one lifts the pause.
  'floor.table_vanished': tableVanished(),
  'floor.table_returned': tableReturned(),
  'reading.record': workerStep('reading.record', { tableId }), // #74
  'sitting.end': workerStep('sitting.end', { tableId }), // #74
  'sent_order.transition': workerStep('sent_order.transition', {
    sentOrderId: idSchema('so'),
  }), // #77
  'pause.transition': workerStep('pause.transition', { pauseId: idSchema('pa') }), // #79
  'notice.record': workerStep('notice.record', {}), // #80
  sweep: workerStep('sweep', {}), // #75, #79, #81
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
