// The guest API's one deep module (D121; design `2026-10-20-guest-api-design.md` §1–§8; ticket
// #75). The routes `GET /api/guest/state` and `POST /api/guest/actions` are thin adapters: they
// read the header and the body, call `guestState` or `guestAct`, and send what comes back. This
// module owns the order of the checks:
//
// 1. the code's shape, before the database (a wrong shape is `code_retired` at once);
// 2. the code's table, through the pinned lookup (`guestTableByCodeHash`), remembered for 30 s
//    as a hint only: the tenant it names is re-checked in every transaction against the code's
//    hash, so a re-issued or hidden code fails at once;
// 3. for a command: the action id's first answer, the tap's age, the code again, the table's rate
//    and the command itself, all inside `applyService`;
// 4. the answer: the server's view projected to what a phone may see (`GuestTableState`), run
//    through the forbidden-values walk (rule 3) before it leaves.
//
// Time alone changes the order too (an Undo closing, an idle order set aside): a read past the
// order's next change runs `order.tidy` first, so every phone sees it at its next poll (design §6,
// `next_change_at`). The web never calls a POS: opening the bill queues a fresh reading for the
// worker when the shared one is older than 15 s (`wantsFreshReading`, #74).

import { randomUUID } from 'node:crypto'

import { type DbPool, guestTableByCodeHash } from '@restro/db'

import { TABLE_TOKEN_PATTERN } from '../guest-files'
import type { LocalizedText } from '../locales'
import { hashTableCode } from '../qr'
import { orderFromRow, UNDO_WINDOW_MS } from '../table-order'
import { applyService } from './apply-service'
import { forbiddenPaths, wantsFreshReading } from './bill'
import type { ServiceContext } from './context'
import { readTableState, type TableStateRead, type TableStateUnchanged } from './read'
import type { ServiceResult } from './results'

/** The screens a phone polls from (design §6): the menu polls slower than the order and the bill. */
export const GUEST_VIEWS = ['menu', 'order', 'bill'] as const

/** One screen. */
export type GuestView = (typeof GUEST_VIEWS)[number]

/** The poll cadence (D121, design §6): 2 s on the order and the bill or while a Send is in flight. */
export const GUEST_POLL_MS = { fast: 2_000, menu: 10_000 } as const

/** How long a sent order that ended stays in the state (D122 §2: 15 minutes). */
const ENDED_SENT_ORDER_MS = 15 * 60_000

/** One line of the order as a phone sees it: no price, no name. */
export interface GuestOrderLine {
  readonly id: string
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly qty: number
  readonly note: string
  readonly rev: number
  /** Paid with the table's bill or before it is sent (pay first, part 2). */
  readonly mode: 'on_bill' | 'pay_first'
  /** The payment that holds the line, or null. */
  readonly held: string | null
}

/** What a phone may see of its table (design §3, with D122's words). */
export interface GuestTableState {
  readonly unchanged: false
  readonly version: number
  /** Milliseconds to the next poll. */
  readonly next: number
  readonly table: { readonly label: string }
  readonly ordering: { readonly state: 'on' | 'paused' | 'closed' }
  readonly order: {
    readonly lines: readonly GuestOrderLine[]
    /** Removed lines while their Undo lasts. */
    readonly removed: readonly {
      readonly id: string
      readonly itemId: string
      readonly optionIds: readonly string[]
      readonly qty: number
      readonly note: string
      readonly undoSeconds: number
    }[]
    /** The order set aside when it went idle ("Earlier order · Restore"), or null. */
    readonly earlier: {
      /** What `order.restore` names (milliseconds since the epoch). */
      readonly setAsideAt: number
      readonly setAsideAgoSeconds: number
      readonly lines: readonly Omit<GuestOrderLine, 'rev' | 'held'>[]
    } | null
  }
  /** The sitting's sent orders in flight or ended in the last 15 minutes, newest first. */
  readonly sentOrders: readonly {
    readonly id: string
    readonly state: 'sending' | 'awaiting_approval' | 'added' | 'not_sent' | 'unconfirmed'
    readonly reason: string | null
    readonly ref: string
  }[]
  /** The table's bill as the last complete reading showed it, or null. */
  readonly bill: {
    readonly readAgoSeconds: number
    readonly complete: boolean
    readonly currency: string | null
    readonly totalMinor: number
    readonly paidMinor: number
    readonly owedMinor: number
    readonly parts: readonly {
      readonly id: string
      readonly beingPaid: boolean
      readonly totalMinor: number
      readonly paidMinor: number
      readonly lines: readonly {
        readonly id: string
        /** Our item's name; null is "Other item", worded by the shell. */
        readonly name: LocalizedText | null
        readonly quantity: string
        readonly amountMinor: number
      }[]
    }[]
  } | null
}

/** "Nothing changed since your version." */
export interface GuestUnchanged {
  readonly unchanged: true
  readonly version: number
  readonly next: number
}

/** A command's answer as a phone gets it. */
export interface GuestCommandResult {
  readonly actionId: string | null
  readonly status: 'accepted' | 'rejected'
  readonly code: string | null
  /** What the command made or acted on (the line an add made). */
  readonly subjectId: string | null
  readonly ref: string | null
}

/** Why a guest is answered with no state at all. */
export type GuestRefusal = 'code_retired'

/** Thrown when an answer would carry a backend value: a bug, answered 500 and never sent. */
export class ForbiddenValueError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`a guest answer carries backend values at ${paths.join(', ')}`)
  }
}

/** Where a code leads, as the lookup said. */
interface CodeTarget {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
  readonly hash: string
}

/** How long the code → table memo trusts an answer (design §2: a hint only). */
const MEMO_MS = 30_000
const MEMO_SIZE = 4_000
const memo = new Map<string, { readonly target: CodeTarget | null; readonly until: number }>()

/** Forgets every remembered code (tests). */
export function forgetGuestCodes(): void {
  memo.clear()
}

async function targetOf(pool: DbPool, code: string): Promise<CodeTarget | null> {
  if (!TABLE_TOKEN_PATTERN.test(code)) return null
  const hash = await hashTableCode(code)
  const now = Date.now()
  const known = memo.get(hash)
  if (known !== undefined && known.until > now) return known.target
  const found = await guestTableByCodeHash(pool, hash)
  const target =
    found === null || found.state !== 'live'
      ? null
      : { tenantId: found.tenantId, venueId: found.venueId, tableId: found.tableId, hash }
  // Bounded: a full memo starts again (it is a hint, so forgetting costs one lookup each).
  if (memo.size >= MEMO_SIZE) memo.clear()
  memo.set(hash, { target, until: now + MEMO_MS })
  return target
}

const SENT_ORDER_STATES: Readonly<Record<string, GuestTableState['sentOrders'][number]['state']>> =
  {
    waiting: 'sending',
    sending: 'sending',
    checking: 'sending',
    awaiting_approval: 'awaiting_approval',
    added: 'added',
    not_sent: 'not_sent',
    unconfirmed: 'unconfirmed',
  }

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

/** The poll cadence for a screen: fast on the order and the bill, and while a Send is in flight. */
function cadence(view: GuestView, inFlight: boolean): number {
  return view === 'menu' && !inFlight ? GUEST_POLL_MS.menu : GUEST_POLL_MS.fast
}

/** The server's view of the table as a phone may see it (rule 3: our ids and names only). */
export function projectGuestState(read: TableStateRead, view: GuestView): GuestTableState {
  const now = read.now.getTime()
  const order =
    read.sitting === null || read.order === null
      ? null
      : orderFromRow({ ...read.order, earlier: read.order.earlier })
  const sentOrders = read.sentOrders.flatMap((sent) => {
    const state = SENT_ORDER_STATES[sent.state]
    if (state === undefined) return []
    const ended = sent.settledAt !== null && now - sent.settledAt.getTime() > ENDED_SENT_ORDER_MS
    return ended ? [] : [{ id: sent.id, state, reason: sent.reason, ref: sent.reference }]
  })
  const inFlight = sentOrders.some(
    (sent) => sent.state === 'sending' || sent.state === 'awaiting_approval',
  )
  const bill = read.bill
  return {
    unchanged: false,
    version: read.version,
    next: cadence(view, inFlight),
    table: { label: read.table.label },
    ordering: {
      state: read.sitting === null ? 'closed' : read.pauses.length > 0 ? 'paused' : 'on',
    },
    order: {
      lines: (order?.lines ?? [])
        .filter((line) => line.removedAt === null)
        .map((line) => ({
          id: line.id,
          itemId: line.itemId,
          optionIds: line.optionIds,
          qty: line.qty,
          note: line.note,
          rev: line.rev,
          // Nothing in the menu says an item is paid first yet: every line is on the bill.
          mode: 'on_bill' as const,
          held: line.heldBy,
        })),
      removed: (order?.lines ?? []).flatMap((line) =>
        line.removedAt === null || now - line.removedAt > UNDO_WINDOW_MS
          ? []
          : [
              {
                id: line.id,
                itemId: line.itemId,
                optionIds: line.optionIds,
                qty: line.qty,
                note: line.note,
                undoSeconds: seconds(UNDO_WINDOW_MS - (now - line.removedAt)),
              },
            ],
      ),
      earlier:
        order?.earlier == null
          ? null
          : {
              setAsideAt: order.earlier.at,
              setAsideAgoSeconds: seconds(now - order.earlier.at),
              lines: order.earlier.lines.map((line) => ({
                id: line.id,
                itemId: line.itemId,
                optionIds: line.optionIds,
                qty: line.qty,
                note: line.note,
                mode: 'on_bill' as const,
              })),
            },
    },
    sentOrders,
    bill:
      bill === null
        ? null
        : {
            readAgoSeconds: seconds(now - bill.readAt.getTime()),
            complete: bill.complete,
            currency: bill.currency,
            totalMinor: bill.totalMinor,
            paidMinor: bill.paidMinor,
            owedMinor: bill.owedMinor,
            parts: bill.bills.map((part) => ({
              id: part.id,
              beingPaid: part.beingPaid,
              totalMinor: part.totalMinor,
              paidMinor: part.paidMinor,
              lines: part.lines.map((line) => ({
                id: line.id,
                name: line.name,
                quantity: line.quantity,
                amountMinor: line.amountMinor,
              })),
            })),
          },
  }
}

/** Throws unless `answer` is free of every backend value the read knows of (rule 3). */
function walked<T>(answer: T, read: TableStateRead | null): T {
  const paths = forbiddenPaths(answer, read?.backendValues ?? new Set())
  if (paths.length > 0) throw new ForbiddenValueError(paths)
  return answer
}

/** What a read of the state needs from its caller. */
export interface GuestStateInput {
  /** The table code from the `Authorization: Table <code>` header. */
  readonly code: string
  /** The version the phone has, or undefined for the whole state. */
  readonly since?: number
  readonly view: GuestView
  /** The request's id, for the provenance of the changes time made. */
  readonly jobId?: string
  /** Queues a fresh reading of the table's bill (the web's job queue); errors are the caller's. */
  readonly queueReading?: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<void>
}

/** Reads a table's state for a phone. */
export async function guestState(
  pool: DbPool,
  input: GuestStateInput,
): Promise<
  | { readonly ok: true; readonly answer: GuestTableState | GuestUnchanged }
  | { readonly ok: false; readonly code: GuestRefusal }
> {
  const target = await targetOf(pool, input.code)
  if (target === null) return { ok: false, code: 'code_retired' }
  const read = (since?: number) =>
    readTableState(pool, {
      tenantId: target.tenantId,
      tableId: target.tableId,
      tableCodeHash: target.hash,
      ...(since === undefined ? {} : { since }),
    })

  let state: TableStateRead | TableStateUnchanged | null = await read(input.since)
  if (state === null) return { ok: false, code: 'code_retired' }
  if (state.nextChangeAt !== null && state.nextChangeAt.getTime() <= state.now.getTime()) {
    // Time made the change, not the guest: it runs as the system, like the worker's tick.
    await applyService(
      pool,
      { type: 'order.tidy', tableId: target.tableId },
      {
        tenantId: target.tenantId,
        venueId: target.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: input.jobId ?? `guest-read-${randomUUID()}`,
      },
    )
    state = await read(input.since)
    if (state === null) return { ok: false, code: 'code_retired' }
  }

  // A poll on the bill asks for a fresh reading on both paths: a reading that found the same bill
  // leaves the version, so most bill polls are answered unchanged.
  const open = state.unchanged ? state.open : state.sitting !== null
  const billReadAt = state.unchanged ? state.billReadAt : (state.bill?.readAt ?? null)
  if (
    input.view === 'bill' &&
    open &&
    input.queueReading !== undefined &&
    wantsFreshReading(billReadAt, state.now)
  ) {
    await input.queueReading({
      tenantId: target.tenantId,
      venueId: target.venueId,
      tableId: target.tableId,
    })
  }
  if (state.unchanged) {
    return {
      ok: true,
      answer: { unchanged: true, version: state.version, next: cadence(input.view, false) },
    }
  }
  return { ok: true, answer: walked(projectGuestState(state, input.view), state) }
}

function guestContext(target: CodeTarget, jobId: string | undefined): ServiceContext {
  return {
    tenantId: target.tenantId,
    venueId: target.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: jobId ?? `guest-${randomUUID()}`,
    tableCodeHash: target.hash,
  }
}

/** The answer a phone gets for a service result. */
export function guestResult(result: ServiceResult): GuestCommandResult {
  const lineId = result.details.lineId
  return {
    actionId: result.actionId,
    status: result.status === 'accepted' ? 'accepted' : 'rejected',
    code: result.status === 'refused' ? result.code : null,
    subjectId: typeof lineId === 'string' ? lineId : null,
    ref: result.status === 'accepted' ? result.ref : null,
  }
}

/** What a command needs from its caller. */
export interface GuestActInput {
  readonly code: string
  /** The guest's command as the shell's schema parsed it, renamed to the service's `type`. */
  readonly command: { readonly type: string; readonly actionId: string } & Record<string, unknown>
  /** Milliseconds since the guest's tap. */
  readonly ageMs: number
  readonly view: GuestView
  readonly jobId?: string
}

/**
 * The guest commands this module passes on, each with its tap's age. Any other kind the shell
 * knows (a Send, a waiter call, paying) is answered `not_built` until its ticket (#77 onwards).
 */
const GUEST_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'order.add',
  'order.change',
  'order.remove',
  'order.undo',
  'order.restore',
])

/** Applies one guest command and answers with the fresh state. */
export async function guestAct(
  pool: DbPool,
  input: GuestActInput,
): Promise<
  | {
      readonly ok: true
      readonly result: GuestCommandResult
      readonly state: GuestTableState | null
      /** Seconds the phone should wait before it tries again (a rate trip), or null. */
      readonly retryAfter: number | null
    }
  | { readonly ok: false; readonly code: GuestRefusal }
> {
  const target = await targetOf(pool, input.code)
  if (target === null) return { ok: false, code: 'code_retired' }
  if (!GUEST_COMMAND_TYPES.has(input.command.type)) {
    return {
      ok: true,
      result: {
        actionId: input.command.actionId,
        status: 'rejected',
        code: 'not_built',
        subjectId: null,
        ref: null,
      },
      state: null,
      retryAfter: null,
    }
  }
  const command = { ...input.command, tableId: target.tableId, ageMs: input.ageMs }
  const { result, state } = await applyService(pool, command, guestContext(target, input.jobId))
  if (result.status === 'refused' && result.code === 'code_retired') {
    return { ok: false, code: 'code_retired' }
  }
  const projected =
    state === null || state.unchanged ? null : walked(projectGuestState(state, input.view), state)
  return {
    ok: true,
    result: guestResult(result),
    state: projected,
    retryAfter: result.status === 'refused' && result.code === 'rate_limited' ? 10 : null,
  }
}
