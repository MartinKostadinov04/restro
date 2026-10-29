// The read side of Tonight's other three screens (#86; plans
// `docs/deliverables/2026-10-27-tonight-{sent-orders,log,end-of-night}-plan.md`): the day's sent
// orders (list and one order's sheet), the Log, and the end of the night. Read-only on `withTenant`,
// no POS call (rule 4's spirit), our ids and public fields only (rule 3). What the actor holds
// decides what is read at all: a part the actor may not see is refused, never emptied.
//
// - sent orders: any role that sees Tonight (D122 §7). Bill amounts are shown; tips are not part
//   of a sent order.
// - the Log: `log.view`.
// - the end of the night: `night.view` (sections 1–3 and part 1's totals, no tips) or
//   `night.view_full` (all). Money lines of part 2 are carried only for `money.follow_up`.
//
// Times are `Date`s; the screen words them in the venue's zone.

import {
  alerts,
  authUser,
  bars,
  type DbPool,
  logEntries,
  pauses,
  payments,
  type ReadTx,
  sentOrderNotes,
  sentOrders,
  serviceDays,
  sharedDevices,
  staffMembers,
  venueRoles,
  venues,
  venueTables,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'

import { serviceDate } from '../service-day'
import type { ServiceActor } from './context'
import { resolveGrants } from './grants'
import type { LogKind } from './log'
import { isLogGroup, type LogGroup, logKindsOf } from './log-view'
import type { Permission } from './permissions'
import type { TonightRefusal } from './read'
import { sentOrderLinesOf } from './sent-lines'
import { type ServiceDayTotals, serviceDayTotals } from './service-day-close'

/** The states that never reached the bill: what "Not added" counts. */
export const NOT_ADDED_STATES = ['not_sent', 'unconfirmed'] as const

/** The reasons the answer to an Unconfirmed sent order leaves on it (`sent-order-answer.ts`). */
export const ANSWER_REASONS = { staff_found: 'found', staff_not_found: 'not_found' } as const

/** The most rows one read returns. */
export const MAX_ROWS = 2000

/** Rows to a page of the sent orders and the Log. */
export const PAGE_SIZE = 100

/** Who did a step, worded by the screen. */
export type Who =
  | { readonly kind: 'person'; readonly name: string }
  | { readonly kind: 'restro' }
  | { readonly kind: 'guest' }

/** The refusals of these reads. */
export type NightRefusal = TonightRefusal

export interface Reader {
  readonly venue: {
    readonly id: string
    readonly name: string
    readonly timezone: string
    readonly dayEndsAt: string
    readonly currency: string
  }
  readonly held: ReadonlySet<Permission>
  /** A shared device's own account: a person's PIN names who answers (D122 §7). */
  readonly device: boolean
  readonly today: string
}

/** Who is reading and where: what the screen needs beside the data. */
export interface NightAccess {
  readonly venue: Reader['venue']
  readonly permissions: readonly Permission[]
  readonly device: boolean
  /** The venue's current service day. */
  readonly today: string
}

export const accessOf = (reader: Reader): NightAccess => ({
  venue: reader.venue,
  permissions: [...reader.held],
  device: reader.device,
  today: reader.today,
})

export type Opened =
  | { readonly ok: true; readonly reader: Reader }
  | { readonly ok: false; readonly code: NightRefusal }

export interface ReadInput {
  readonly tenantId: string
  readonly venueId: string
  readonly actor: ServiceActor
  readonly now?: Date
}

/** The actor's grants at the venue, as `readTonight` checks them. */
export async function open(tx: ReadTx, input: ReadInput): Promise<Opened> {
  if (
    input.actor.kind !== 'user' &&
    input.actor.kind !== 'staff' &&
    input.actor.kind !== 'operator'
  ) {
    return { ok: false, code: 'origin_not_allowed' }
  }
  const [venue] = await tx.select().from(venues).where(eq(venues.id, input.venueId))
  if (venue === undefined) return { ok: false, code: 'venue_missing' }
  if (venue.archivedAt !== null) return { ok: false, code: 'venue_archived' }
  const grants = await resolveGrants(tx, input.tenantId, venue.id, input.actor, { quick: true })
  if (!grants.ok) return { ok: false, code: grants.code }
  if (grants.permissions.size === 0) return { ok: false, code: 'permission_denied' }
  return {
    ok: true,
    reader: {
      venue: {
        id: venue.id,
        name: venue.name,
        timezone: venue.timezone,
        dayEndsAt: String(venue.serviceDayEndsAt).slice(0, 5),
        currency: venue.currency,
      },
      held: grants.permissions,
      device: grants.device === true,
      today: serviceDate(input.now ?? new Date(), venue.timezone, venue.serviceDayEndsAt),
    },
  }
}

/** What the actor holds at the venue, for the tab bar to show only the screens they may open. */
export async function readNightAccess(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly access: NightAccess }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    return opened.ok ? ({ ok: true, access: accessOf(opened.reader) } as const) : opened
  })
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The day asked for, or today: a day that is not a date, or lies ahead, is today. */
export function dayOf(asked: string | undefined, today: string): string {
  return asked !== undefined && DAY.test(asked) && asked <= today ? asked : today
}

/** Escapes `%`, `_` and `\` so a search is text, not a pattern. */
function like(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Who the actors are: a person's name, Restro, or a guest's phone. */
export async function whoOf(tx: ReadTx, actors: readonly string[]): Promise<Map<string, Who>> {
  const named = new Map<string, Who>()
  const memberIds: string[] = []
  const accountIds: string[] = []
  for (const actor of new Set(actors)) {
    if (actor === 'guest') named.set(actor, { kind: 'guest' })
    else if (actor.startsWith('staff:')) memberIds.push(actor.slice(6))
    else if (actor.startsWith('user:')) accountIds.push(actor.slice(5))
    else named.set(actor, { kind: 'restro' })
  }
  if (memberIds.length > 0 || accountIds.length > 0) {
    const people = await tx
      .select({ id: staffMembers.id, userId: staffMembers.userId, name: staffMembers.displayName })
      .from(staffMembers)
      .where(
        or(
          memberIds.length > 0 ? inArray(staffMembers.id, memberIds) : undefined,
          accountIds.length > 0 ? inArray(staffMembers.userId, accountIds) : undefined,
        ),
      )
    for (const person of people) {
      named.set(`staff:${person.id}`, { kind: 'person', name: person.name })
      if (person.userId !== null) {
        const key = `user:${person.userId}`
        if (!named.has(key)) named.set(key, { kind: 'person', name: person.name })
      }
    }
    // A signed-in account that is no staff member (a shared device's account): its own name.
    const bare = accountIds.filter((id) => !named.has(`user:${id}`))
    if (bare.length > 0) {
      const users = await tx
        .select({ id: authUser.id, name: authUser.name })
        .from(authUser)
        .where(inArray(authUser.id, bare))
      for (const user of users) named.set(`user:${user.id}`, { kind: 'person', name: user.name })
    }
  }
  return named
}

export const RESTRO: Who = { kind: 'restro' }

// ───────────────────────────── sent orders ─────────────────────────────

/** One sent order as the list shows it. */
export interface SentOrderRow {
  readonly id: string
  readonly reference: string
  readonly tableId: string
  readonly table: string
  /** The table is named by its number only: the screen words it "Table 7". */
  readonly numbered: boolean
  /** Units on it (the sum of the quantities). */
  readonly itemCount: number
  readonly totalMinor: number
  readonly state: string
  readonly reason: string | null
  readonly createdAt: Date
  /** When Restro found an Unconfirmed one on the bill by itself (#135). */
  readonly landedAt: Date | null
  /** The staff answer to an Unconfirmed one, and who gave it. */
  readonly answer: {
    readonly answer: 'found' | 'not_found'
    readonly who: Who
    readonly via: string | null
  } | null
}

/** A page of the day's sent orders. */
export interface SentOrderPage {
  readonly day: string
  readonly rows: readonly SentOrderRow[]
  /** More rows match than were returned. */
  readonly hasMore: boolean
  /** The day's counts, whatever is searched. */
  readonly counts: {
    readonly all: number
    readonly notAdded: number
    readonly added: number
    readonly notSent: number
    readonly unconfirmed: number
  }
}

interface SentFilter {
  readonly day: string
  readonly search: string
  readonly notAddedOnly: boolean
  readonly limit: number
}

async function sentOrderPage(
  tx: ReadTx,
  reader: Reader,
  filter: SentFilter,
): Promise<SentOrderPage> {
  const { venue } = reader
  const q = filter.search.trim()
  const where = and(
    eq(sentOrders.venueId, venue.id),
    eq(sentOrders.serviceDate, filter.day),
    filter.notAddedOnly ? inArray(sentOrders.state, [...NOT_ADDED_STATES]) : undefined,
    q === ''
      ? undefined
      : or(
          ilike(sentOrders.reference, `${like(q)}%`),
          ilike(venueTables.number, `${like(q)}%`),
          ilike(venueTables.name, `%${like(q)}%`),
        ),
  )
  const limit = Math.min(Math.max(filter.limit, 1), MAX_ROWS)
  const found = await tx
    .select({
      id: sentOrders.id,
      reference: sentOrders.reference,
      tableId: sentOrders.tableId,
      tableName: venueTables.name,
      tableNumber: venueTables.number,
      lines: sentOrders.lines,
      totalMinor: sentOrders.totalMinor,
      state: sentOrders.state,
      reason: sentOrders.reason,
      createdAt: sentOrders.createdAt,
    })
    .from(sentOrders)
    .innerJoin(venueTables, eq(venueTables.id, sentOrders.tableId))
    .where(where)
    .orderBy(desc(sentOrders.createdAt), desc(sentOrders.id))
    .limit(limit + 1)
  const page = found.slice(0, limit)

  const ids = page.map((row) => row.id)
  const steps =
    ids.length === 0
      ? []
      : await tx
          .select({
            sentOrderId: logEntries.sentOrderId,
            kind: logEntries.kind,
            reason: logEntries.reason,
            at: logEntries.at,
            actor: logEntries.actor,
            via: logEntries.via,
          })
          .from(logEntries)
          .where(
            and(
              inArray(logEntries.sentOrderId, ids),
              inArray(logEntries.kind, ['sent_order.state', 'sent_order.landed_late']),
            ),
          )
          .orderBy(asc(logEntries.seq))
  const landed = new Map<string, Date>()
  const answered = new Map<string, (typeof steps)[number]>()
  for (const step of steps) {
    if (step.sentOrderId === null) continue
    if (step.kind === 'sent_order.landed_late') landed.set(step.sentOrderId, step.at)
    else if (step.reason !== null && Object.hasOwn(ANSWER_REASONS, step.reason)) {
      answered.set(step.sentOrderId, step)
    }
  }
  const names = await whoOf(
    tx,
    [...answered.values()].map((step) => step.actor),
  )

  const [count] = await tx
    .select({
      all: sql<string>`count(*)`,
      added: sql<string>`count(*) filter (where ${sentOrders.state} = 'added')`,
      notSent: sql<string>`count(*) filter (where ${sentOrders.state} = 'not_sent')`,
      unconfirmed: sql<string>`count(*) filter (where ${sentOrders.state} = 'unconfirmed')`,
    })
    .from(sentOrders)
    .where(and(eq(sentOrders.venueId, venue.id), eq(sentOrders.serviceDate, filter.day)))
  const notSent = Number(count?.notSent ?? 0)
  const unconfirmed = Number(count?.unconfirmed ?? 0)

  return {
    day: filter.day,
    rows: page.map((row) => {
      const step = answered.get(row.id)
      const reason = step?.reason ?? null
      return {
        id: row.id,
        reference: row.reference,
        tableId: row.tableId,
        table: row.tableName ?? row.tableNumber ?? '',
        numbered: row.tableName === null && row.tableNumber !== null,
        itemCount: sentOrderLinesOf(row.lines).reduce((sum, line) => sum + line.qty, 0),
        totalMinor: row.totalMinor,
        state: row.state,
        reason: row.reason,
        createdAt: row.createdAt,
        landedAt: landed.get(row.id) ?? null,
        answer:
          step === undefined || reason === null || !Object.hasOwn(ANSWER_REASONS, reason)
            ? null
            : {
                answer: ANSWER_REASONS[reason as keyof typeof ANSWER_REASONS],
                who: names.get(step.actor) ?? RESTRO,
                via: step.via,
              },
      }
    }),
    hasMore: found.length > limit,
    counts: {
      all: Number(count?.all ?? 0),
      notAdded: notSent + unconfirmed,
      added: Number(count?.added ?? 0),
      notSent,
      unconfirmed,
    },
  }
}

/**
 * The service day's sent orders, newest first. `day` other than today is for the end of the night
 * and needs `night.view`. The search matches a reference from its first character, or a table's
 * number or name; it covers the whole day, not only the rows returned.
 */
export async function readSentOrders(
  pool: DbPool,
  input: ReadInput & {
    readonly day?: string
    readonly search?: string
    readonly notAddedOnly?: boolean
    readonly limit?: number
  },
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly page: SentOrderPage }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const day = dayOf(input.day, reader.today)
    if (
      day !== reader.today &&
      !reader.held.has('night.view') &&
      !reader.held.has('night.view_full')
    ) {
      return { ok: false, code: 'permission_denied' } as const
    }
    const page = await sentOrderPage(tx, reader, {
      day,
      search: input.search ?? '',
      notAddedOnly: input.notAddedOnly === true,
      limit: input.limit ?? PAGE_SIZE,
    })
    return { ok: true, access: accessOf(reader), page } as const
  })
}

/** One step of a sent order, from the Log. */
export interface SentOrderStep {
  readonly at: Date
  readonly kind: 'sent_order.state' | 'sent_order.landed_late'
  readonly toState: string | null
  readonly reason: string | null
  readonly who: Who
  readonly via: string | null
}

/** Everything about one sent order (plan O4). */
export interface SentOrderDetail {
  readonly order: SentOrderRow
  readonly lines: readonly {
    readonly qty: number
    readonly name: string
    readonly optionNames: readonly string[]
    readonly unitMinor: number
    readonly note: string | null
  }[]
  readonly sentAt: Date | null
  readonly steps: readonly SentOrderStep[]
}

/** One sent order of the venue, with its lines, notes and steps; null when there is none. */
export async function readSentOrderDetail(
  pool: DbPool,
  input: ReadInput & { readonly sentOrderId: string },
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly detail: SentOrderDetail | null }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const [row] = await tx
      .select({
        id: sentOrders.id,
        serviceDate: sentOrders.serviceDate,
        lines: sentOrders.lines,
        sentAt: sentOrders.sentAt,
        reference: sentOrders.reference,
      })
      .from(sentOrders)
      .where(and(eq(sentOrders.id, input.sentOrderId), eq(sentOrders.venueId, reader.venue.id)))
    if (row === undefined) return { ok: true, access: accessOf(reader), detail: null } as const
    const page = await sentOrderPage(tx, reader, {
      day: row.serviceDate,
      search: row.reference,
      notAddedOnly: false,
      limit: MAX_ROWS,
    })
    const order = page.rows.find((candidate) => candidate.id === row.id)
    if (order === undefined) return { ok: true, access: accessOf(reader), detail: null } as const
    const noted = await tx
      .select({ lineId: sentOrderNotes.lineId, note: sentOrderNotes.note })
      .from(sentOrderNotes)
      .where(eq(sentOrderNotes.sentOrderId, row.id))
    const notes = new Map(noted.map((entry) => [entry.lineId, entry.note]))
    const stepRows = await tx
      .select({
        at: logEntries.at,
        kind: logEntries.kind,
        toState: logEntries.toState,
        reason: logEntries.reason,
        actor: logEntries.actor,
        via: logEntries.via,
      })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.sentOrderId, row.id),
          inArray(logEntries.kind, ['sent_order.state', 'sent_order.landed_late']),
        ),
      )
      .orderBy(asc(logEntries.seq))
    const names = await whoOf(
      tx,
      stepRows.map((step) => step.actor),
    )
    return {
      ok: true,
      access: accessOf(reader),
      detail: {
        order,
        lines: sentOrderLinesOf(row.lines).map((line) => ({
          qty: line.qty,
          name: line.name,
          optionNames: line.optionNames,
          unitMinor: line.unitMinor,
          note: notes.get(line.id) ?? null,
        })),
        sentAt: row.sentAt,
        steps: stepRows.map((step) => ({
          at: step.at,
          kind: step.kind as SentOrderStep['kind'],
          toState: step.toState,
          reason: step.reason,
          who: names.get(step.actor) ?? RESTRO,
          via: step.via,
        })),
      },
    } as const
  })
}

// ───────────────────────────────── the Log ─────────────────────────────────

/** One line of the Log, with everything its sentence needs; the screen words it. */
export interface LogLine {
  readonly seq: number
  readonly at: Date
  readonly kind: LogKind
  readonly tableId: string | null
  readonly table: string | null
  readonly numbered: boolean
  readonly sentOrderId: string | null
  readonly reference: string | null
  readonly paymentId: string | null
  readonly fromState: string | null
  readonly toState: string | null
  readonly reason: string | null
  readonly who: Who
  readonly via: string | null
  /** A pause's reach: the whole venue, one bar (by name), one table, or the POS connection. */
  readonly scope: {
    readonly kind: 'venue' | 'bar' | 'table' | 'connection'
    readonly name: string | null
  } | null
  /** A pause's cause (`staff`, `order_unconfirmed`, …). */
  readonly cause: string | null
  /** The staff member, role or device a settings entry is about, by name. */
  readonly subject: string | null
  /** A payment's amount without the tip, in minor units. */
  readonly amountMinor: number | null
  /** The sent orders a closed night held. */
  readonly sentOrdersOfDay: number | null
  /**
   * A waiter call entry's kinds (#180): the one a `waiter_call.called` entry added, or every kind
   * of the call in a Handled or lapsed entry; empty for any other entry.
   */
  readonly callKinds: readonly string[]
}

/** A page of the Log for one day. */
export interface LogPage {
  readonly day: string
  readonly today: boolean
  readonly rows: readonly LogLine[]
  readonly hasMore: boolean
  /** Service days with an entry, newest first, for the picker (the others are greyed). */
  readonly days: readonly string[]
}

/**
 * The kinds a waiter call's Log entry names (#180): the kind a `waiter_call.called` entry added,
 * every kind of the call in a Handled or lapsed one (comma-joined in the entry). An entry from before kinds were kept is the
 * plain call.
 */
function callKindsOf(kind: string, details: Record<string, unknown>): readonly string[] {
  if (!kind.startsWith('waiter_call.')) return []
  const asked = details[kind === 'waiter_call.called' ? 'kind' : 'kinds']
  const kinds = typeof asked === 'string' ? asked.split(',').filter((entry) => entry !== '') : []
  return kinds.length === 0 ? ['waiter'] : kinds
}

const detailText = (details: Record<string, unknown>, key: string): string | null => {
  const value = details[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The Log of one service day, newest first, for `log.view`. The kinds the venue never sees
 * (`lease.taken_over`) are left out. Search and the kind filter cover the whole day.
 */
export async function readLog(
  pool: DbPool,
  input: ReadInput & {
    readonly day?: string
    readonly search?: string
    readonly group?: string
    readonly limit?: number
  },
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly page: LogPage }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!reader.held.has('log.view')) return { ok: false, code: 'permission_denied' } as const
    const day = dayOf(input.day, reader.today)
    const group: LogGroup | null = isLogGroup(input.group) ? input.group : null
    const q = (input.search ?? '').trim()
    const limit = Math.min(Math.max(input.limit ?? PAGE_SIZE, 1), MAX_ROWS)
    const found = await tx
      .select({
        seq: logEntries.seq,
        at: logEntries.at,
        kind: logEntries.kind,
        tableId: logEntries.tableId,
        tableName: venueTables.name,
        tableNumber: venueTables.number,
        sentOrderId: logEntries.sentOrderId,
        reference: sentOrders.reference,
        paymentId: logEntries.paymentId,
        fromState: logEntries.fromState,
        toState: logEntries.toState,
        reason: logEntries.reason,
        actor: logEntries.actor,
        via: logEntries.via,
        details: logEntries.details,
        amountMinor: payments.amountMinor,
      })
      .from(logEntries)
      .leftJoin(venueTables, eq(venueTables.id, logEntries.tableId))
      .leftJoin(sentOrders, eq(sentOrders.id, logEntries.sentOrderId))
      .leftJoin(payments, eq(payments.id, logEntries.paymentId))
      .where(
        and(
          eq(logEntries.venueId, reader.venue.id),
          eq(logEntries.serviceDate, day),
          inArray(logEntries.kind, [...logKindsOf(group)]),
          q === ''
            ? undefined
            : or(
                ilike(sentOrders.reference, `${like(q)}%`),
                ilike(venueTables.number, `${like(q)}%`),
                ilike(venueTables.name, `%${like(q)}%`),
              ),
        ),
      )
      .orderBy(desc(logEntries.seq))
      .limit(limit + 1)
    const page = found.slice(0, limit)

    const pauseIds = page.flatMap((row) => {
      const id = detailText(row.details, 'pauseId')
      return id === null ? [] : [id]
    })
    const pauseRows =
      pauseIds.length === 0
        ? []
        : await tx
            .select({ id: pauses.id, scope: pauses.scope, targetId: pauses.targetId })
            .from(pauses)
            .where(inArray(pauses.id, pauseIds))
    const pauseOf = new Map(pauseRows.map((pause) => [pause.id, pause]))
    const barIds = [
      ...new Set([
        ...pauseRows.filter((pause) => pause.scope === 'bar').map((pause) => pause.targetId),
        ...page.flatMap((row) => {
          const id = detailText(row.details, 'barId')
          return id === null ? [] : [id]
        }),
      ]),
    ]
    const barNames = new Map<string, string>()
    if (barIds.length > 0) {
      for (const bar of await tx
        .select({ id: bars.id, name: bars.name })
        .from(bars)
        .where(inArray(bars.id, barIds))) {
        barNames.set(bar.id, bar.name)
      }
    }
    const subjectIds = {
      staff: [...new Set(page.flatMap((r) => detailText(r.details, 'staffMemberId') ?? []))],
      role: [...new Set(page.flatMap((r) => detailText(r.details, 'roleId') ?? []))],
      device: [...new Set(page.flatMap((r) => detailText(r.details, 'deviceId') ?? []))],
    }
    const subjectName = new Map<string, string>()
    if (subjectIds.staff.length > 0) {
      for (const member of await tx
        .select({ id: staffMembers.id, name: staffMembers.displayName })
        .from(staffMembers)
        .where(inArray(staffMembers.id, subjectIds.staff))) {
        subjectName.set(member.id, member.name)
      }
    }
    if (subjectIds.role.length > 0) {
      for (const role of await tx
        .select({ id: venueRoles.id, name: venueRoles.name })
        .from(venueRoles)
        .where(inArray(venueRoles.id, subjectIds.role))) {
        subjectName.set(role.id, role.name)
      }
    }
    if (subjectIds.device.length > 0) {
      for (const device of await tx
        .select({ id: sharedDevices.id, name: sharedDevices.name })
        .from(sharedDevices)
        .where(inArray(sharedDevices.id, subjectIds.device))) {
        subjectName.set(device.id, device.name)
      }
    }
    const names = await whoOf(
      tx,
      page.map((row) => row.actor),
    )

    const dayRows = await tx
      .selectDistinct({ day: logEntries.serviceDate })
      .from(logEntries)
      .where(eq(logEntries.venueId, reader.venue.id))
      .orderBy(desc(logEntries.serviceDate))
      .limit(60)

    return {
      ok: true,
      access: accessOf(reader),
      page: {
        day,
        today: day === reader.today,
        hasMore: found.length > limit,
        days: dayRows.map((row) => row.day),
        rows: page.map((row): LogLine => {
          const pause = pauseOf.get(detailText(row.details, 'pauseId') ?? '')
          const barId = pause?.scope === 'bar' ? pause.targetId : detailText(row.details, 'barId')
          const scopeText = detailText(row.details, 'scope') ?? pause?.scope ?? null
          const isPause = row.kind === 'pause.started' || row.kind === 'pause.lifted'
          const subjectKey =
            detailText(row.details, 'staffMemberId') ??
            detailText(row.details, 'roleId') ??
            detailText(row.details, 'deviceId')
          const sentOrdersOfDay = row.details.sentOrders
          return {
            seq: row.seq,
            at: row.at,
            kind: row.kind as LogKind,
            tableId: row.tableId,
            table: row.tableName ?? row.tableNumber ?? null,
            numbered: row.tableName === null && row.tableNumber !== null,
            sentOrderId: row.sentOrderId,
            reference: row.reference ?? null,
            paymentId: row.paymentId,
            fromState: row.fromState,
            toState: row.toState,
            reason: row.reason,
            who: names.get(row.actor) ?? RESTRO,
            via: row.via,
            scope: !isPause
              ? null
              : row.tableId !== null || scopeText === 'table'
                ? { kind: 'table', name: null }
                : scopeText === 'bar'
                  ? { kind: 'bar', name: barNames.get(barId ?? '') ?? null }
                  : scopeText === 'connection'
                    ? { kind: 'connection', name: null }
                    : { kind: 'venue', name: null },
            cause: row.kind === 'pause.started' ? row.reason : detailText(row.details, 'cause'),
            subject: subjectKey === null ? null : (subjectName.get(subjectKey) ?? null),
            amountMinor: row.amountMinor ?? null,
            sentOrdersOfDay: typeof sentOrdersOfDay === 'number' ? sentOrdersOfDay : null,
            callKinds: callKindsOf(row.kind, row.details),
          }
        }),
      },
    } as const
  })
}

// ───────────────────────────── the end of the night ─────────────────────────────

/** A problem the end of the night lists (section 1): an Unconfirmed sent order. */
export interface NightFixRow {
  readonly alertId: string | null
  readonly sentOrderId: string
  readonly reference: string
  readonly tableId: string
  readonly table: string
  readonly numbered: boolean
  readonly items: readonly {
    readonly name: string
    readonly options: readonly string[]
    readonly qty: number
  }[]
  /** When it was raised, for "N min ago". */
  readonly at: Date
  readonly sentAt: Date | null
  readonly billBeforeMinor: number | null
  readonly landedAt: Date | null
  /** Set once answered; an answered problem is listed on an earlier night only. */
  readonly answer: SentOrderRow['answer']
}

/** What part 2 fills in: carried only for `money.follow_up`, counted live or from the close. */
export interface NightMoney {
  readonly payments: number
  readonly capturedMinor: number
  readonly tipMinor: number
  /** Payments left `unconfirmed` and what they hold on cards (#115): answered after the close. */
  readonly paymentsUnconfirmed: number
  readonly unconfirmedMinor: number
}

/** The end of one service day. */
export interface NightRead {
  readonly day: string
  /** Service days with records, newest first, for the picker. */
  readonly days: readonly string[]
  readonly today: boolean
  readonly hasService: boolean
  /** The hour the service day ends (`HH:mm`, the venue's zone). */
  readonly dayEndsAt: string
  /** When the day was closed (`service_days`), or null while it runs or before the worker closes it. */
  readonly closedAt: Date | null
  /** `night.view_full`: tips, the CSV and part 2's manager sections. */
  readonly full: boolean
  readonly fix: readonly NightFixRow[]
  readonly sent: {
    readonly counts: SentOrderPage['counts']
    /** The ones that never reached the bill, newest first (the first page). */
    readonly notAdded: SentOrderPage
  }
  /** Part 1's totals: no payments, no tips. */
  readonly totals: Omit<
    ServiceDayTotals,
    'payments' | 'capturedMinor' | 'tipMinor' | 'paymentsUnconfirmed' | 'unconfirmedMinor'
  >
  readonly money: NightMoney | null
}

/** True when the actor may read the end of the night. */
export function canReadNight(held: ReadonlySet<Permission>): boolean {
  return held.has('night.view') || held.has('night.view_full')
}

/** The service day's totals: the closed day's, written once, else counted now. */
async function totalsOfDay(
  tx: ReadTx,
  venueId: string,
  day: string,
): Promise<{ readonly totals: ServiceDayTotals; readonly closedAt: Date | null }> {
  const [closed] = await tx
    .select({ totals: serviceDays.totals, closedAt: serviceDays.closedAt })
    .from(serviceDays)
    .where(and(eq(serviceDays.venueId, venueId), eq(serviceDays.serviceDate, day)))
  if (closed === undefined)
    return { totals: await serviceDayTotals(tx, venueId, day), closedAt: null }
  const live = await serviceDayTotals(tx, venueId, day)
  // A key an older close didn't write reads as 0; the live count fills no gap in a closed day.
  const stored = Object.fromEntries(
    Object.keys(live).map((key) => [key, Number(closed.totals[key] ?? 0)]),
  ) as unknown as ServiceDayTotals
  return { totals: stored, closedAt: closed.closedAt }
}

/** The end of the night for one service day (`day`, default today). */
export async function readNight(
  pool: DbPool,
  input: ReadInput & { readonly day?: string },
): Promise<
  | { readonly ok: true; readonly access: NightAccess; readonly night: NightRead }
  | { readonly ok: false; readonly code: NightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!canReadNight(reader.held)) return { ok: false, code: 'permission_denied' } as const
    const day = dayOf(input.day, reader.today)
    const today = day === reader.today
    const { venue } = reader

    const { totals, closedAt } = await totalsOfDay(tx, venue.id, day)
    const sent = await sentOrderPage(tx, reader, {
      day,
      search: '',
      notAddedOnly: true,
      // The ones that did not reach the bill always show, however many (plan §5 "Many").
      limit: MAX_ROWS,
    })

    // Section 1: an Unconfirmed sent order; on an earlier night also the ones answered since.
    const problems = await tx
      .select({
        id: sentOrders.id,
        reference: sentOrders.reference,
        tableId: sentOrders.tableId,
        tableName: venueTables.name,
        tableNumber: venueTables.number,
        lines: sentOrders.lines,
        billBeforeMinor: sentOrders.billBeforeMinor,
        sentAt: sentOrders.sentAt,
        createdAt: sentOrders.createdAt,
        state: sentOrders.state,
        reason: sentOrders.reason,
      })
      .from(sentOrders)
      .innerJoin(venueTables, eq(venueTables.id, sentOrders.tableId))
      .where(
        and(
          eq(sentOrders.venueId, venue.id),
          eq(sentOrders.serviceDate, day),
          today
            ? eq(sentOrders.state, 'unconfirmed')
            : or(
                eq(sentOrders.state, 'unconfirmed'),
                inArray(sentOrders.reason, Object.keys(ANSWER_REASONS)),
              ),
        ),
      )
      .orderBy(asc(sentOrders.createdAt), asc(sentOrders.id))
      .limit(MAX_ROWS)
    const problemIds = problems.map((row) => row.id)
    const alertRows =
      problemIds.length === 0
        ? []
        : await tx
            .select({ id: alerts.id, subjectId: alerts.subjectId, raisedAt: alerts.raisedAt })
            .from(alerts)
            .where(
              and(
                eq(alerts.venueId, venue.id),
                eq(alerts.kind, 'order_unconfirmed'),
                inArray(alerts.subjectId, problemIds),
              ),
            )
    const alertOf = new Map(alertRows.map((row) => [row.subjectId, row]))
    const steps =
      problemIds.length === 0
        ? []
        : await tx
            .select({
              sentOrderId: logEntries.sentOrderId,
              kind: logEntries.kind,
              reason: logEntries.reason,
              at: logEntries.at,
              actor: logEntries.actor,
              via: logEntries.via,
            })
            .from(logEntries)
            .where(
              and(
                inArray(logEntries.sentOrderId, problemIds),
                inArray(logEntries.kind, ['sent_order.state', 'sent_order.landed_late']),
              ),
            )
            .orderBy(asc(logEntries.seq))
    const landed = new Map<string, Date>()
    const answeredBy = new Map<string, (typeof steps)[number]>()
    for (const step of steps) {
      if (step.sentOrderId === null) continue
      if (step.kind === 'sent_order.landed_late') landed.set(step.sentOrderId, step.at)
      else if (step.reason !== null && Object.hasOwn(ANSWER_REASONS, step.reason)) {
        answeredBy.set(step.sentOrderId, step)
      }
    }
    const names = await whoOf(
      tx,
      [...answeredBy.values()].map((step) => step.actor),
    )
    const fix = problems.map((row): NightFixRow => {
      const step = answeredBy.get(row.id)
      const answer =
        row.state === 'unconfirmed' || step === undefined || step.reason === null
          ? null
          : {
              answer: ANSWER_REASONS[step.reason as keyof typeof ANSWER_REASONS],
              who: names.get(step.actor) ?? RESTRO,
              via: step.via,
            }
      return {
        alertId: alertOf.get(row.id)?.id ?? null,
        sentOrderId: row.id,
        reference: row.reference,
        tableId: row.tableId,
        table: row.tableName ?? row.tableNumber ?? '',
        numbered: row.tableName === null && row.tableNumber !== null,
        items: sentOrderLinesOf(row.lines).map((line) => ({
          name: line.name,
          options: line.optionNames,
          qty: line.qty,
        })),
        at: alertOf.get(row.id)?.raisedAt ?? row.createdAt,
        sentAt: row.sentAt,
        billBeforeMinor: row.billBeforeMinor,
        landedAt: landed.get(row.id) ?? null,
        answer,
      }
    })

    const {
      payments: paymentCount,
      capturedMinor,
      tipMinor,
      paymentsUnconfirmed,
      unconfirmedMinor,
      ...part1
    } = totals
    const dayList = await tx.execute<{ day: string }>(sql`
      select day::text as day from (
        select service_date as day from restro.service_days where venue_id = ${venue.id}
        union select service_date from restro.sent_orders where venue_id = ${venue.id}
      ) days order by day desc limit 60`)
    return {
      ok: true,
      access: accessOf(reader),
      night: {
        days: dayList.rows.map((row) => row.day),
        day,
        today,
        hasService:
          totals.sittings +
            totals.sentOrders +
            totals.waiterCalls +
            totals.alerts +
            totals.pauses +
            paymentCount >
          0,
        dayEndsAt: venue.dayEndsAt,
        closedAt,
        full: reader.held.has('night.view_full'),
        fix,
        sent: { counts: sent.counts, notAdded: sent },
        totals: part1,
        money: reader.held.has('money.follow_up')
          ? {
              payments: paymentCount,
              capturedMinor,
              tipMinor,
              paymentsUnconfirmed,
              unconfirmedMinor,
            }
          : null,
      },
    } as const
  })
}

// ──────────────────────── the message at the service day's close ────────────────────────

/** What the Telegram message at a day's close needs: counts and the problems, nothing personal. */
export interface NightReport {
  readonly venueName: string
  readonly day: string
  readonly settings: Record<string, unknown>
  readonly defaultLocale: string
  readonly sentOrders: number
  readonly added: number
  readonly notSent: number
  readonly unconfirmed: number
  /** Sent orders still Unconfirmed, with their table's name and number (the caller words it). */
  readonly fix: readonly {
    readonly reference: string
    readonly name: string | null
    readonly number: string | null
  }[]
}

/**
 * The report of a closed day, for the worker (no actor: it reads its own tenant's counts). Null
 * when the venue or the day's `service_days` row is gone.
 */
export async function readNightReport(
  pool: DbPool,
  input: {
    readonly tenantId: string
    readonly venueId: string
    readonly day: string
  },
): Promise<NightReport | null> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, input.venueId))
    if (venue === undefined) return null
    const [closed] = await tx
      .select({ totals: serviceDays.totals })
      .from(serviceDays)
      .where(and(eq(serviceDays.venueId, venue.id), eq(serviceDays.serviceDate, input.day)))
    if (closed === undefined) return null
    const rows = await tx
      .select({
        reference: sentOrders.reference,
        name: venueTables.name,
        number: venueTables.number,
      })
      .from(sentOrders)
      .innerJoin(venueTables, eq(venueTables.id, sentOrders.tableId))
      .where(
        and(
          eq(sentOrders.venueId, venue.id),
          eq(sentOrders.serviceDate, input.day),
          eq(sentOrders.state, 'unconfirmed'),
        ),
      )
      .orderBy(asc(sentOrders.createdAt), asc(sentOrders.id))
      .limit(MAX_ROWS)
    const count = (key: string) => Number(closed.totals[key] ?? 0)
    return {
      venueName: venue.name,
      day: input.day,
      settings: venue.settings,
      defaultLocale: venue.defaultLocale,
      sentOrders: count('sentOrders'),
      added: count('sentOrdersAdded'),
      notSent: count('sentOrdersNotSent'),
      unconfirmed: count('sentOrdersUnconfirmed'),
      fix: rows.map((row) => ({ reference: row.reference, name: row.name, number: row.number })),
    }
  })
}

// ───────────────────────────── the export of a date range ─────────────────────────────

/** The longest range an export may span in service days: 18 months of records, and a margin. */
export const MAX_EXPORT_DAYS = 600

/** What an export of a date range reads. */
export interface ExportDays {
  readonly access: NightAccess
  /** Service days of the range with at least one sent order, oldest first. */
  readonly sentDays: readonly string[]
  /** Service days of the range with at least one Log line the venue sees, oldest first. */
  readonly logDays: readonly string[]
}

/**
 * Which service days of `from`…`to` (both included) hold something to export (#87; plan
 * `2026-10-27-settings-alerts-export-plan.md` §B). Only a role that sees the Log and the whole end of
 * the night (`log.view` and `night.view_full`) may export; the screens' own readers then fill each
 * day. A day the venue no longer keeps simply has nothing: a wider range downloads what is held.
 */
export async function readExportDays(
  pool: DbPool,
  input: ReadInput & { readonly from: string; readonly to: string },
): Promise<
  | ({ readonly ok: true } & ExportDays)
  | { readonly ok: false; readonly code: NightRefusal | 'invalid_range' }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    if (!reader.held.has('log.view') || !reader.held.has('night.view_full')) {
      return { ok: false, code: 'permission_denied' } as const
    }
    const { from, to } = input
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (!DAY.test(from) || !DAY.test(to) || !(span >= 0 && span < MAX_EXPORT_DAYS)) {
      return { ok: false, code: 'invalid_range' } as const
    }
    const sent = await tx
      .selectDistinct({ day: sentOrders.serviceDate })
      .from(sentOrders)
      .where(
        and(
          eq(sentOrders.venueId, reader.venue.id),
          sql`${sentOrders.serviceDate} >= ${from} and ${sentOrders.serviceDate} <= ${to}`,
        ),
      )
      .orderBy(asc(sentOrders.serviceDate))
    const log = await tx
      .selectDistinct({ day: logEntries.serviceDate })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, reader.venue.id),
          inArray(logEntries.kind, [...logKindsOf(null)]),
          sql`${logEntries.serviceDate} >= ${from} and ${logEntries.serviceDate} <= ${to}`,
        ),
      )
      .orderBy(asc(logEntries.serviceDate))
    return {
      ok: true,
      access: accessOf(reader),
      sentDays: sent.map((row) => row.day),
      logDays: log.map((row) => row.day),
    } as const
  })
}
