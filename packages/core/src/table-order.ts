// The table's shared order (D117, D121, D122 §2; ticket #75): one order per sitting that every
// phone at the table edits, and the one reducer both sides run on it. The service path applies an
// edit to the stored order under the order row's lock (`core/service/order.ts`); the guest page's
// host applies the same edit to its own copy at once, so the guest sees the tap before the answer
// (optimistic edits), and rolls back to the server's order when the answer is a refusal.
//
// - A line keeps no price and no name: the item, the chosen options, how many and a note.
// - Identical lines merge: the same item with the same options and the same note is one line,
//   "2 × Gin tonic". Only live lines that no payment holds merge.
// - Anyone at the table may change or remove any line (D117: no "who added it"). A line a payment
//   holds (`heldBy`, part 2) can't be changed, removed or merged into.
// - A removed line stays for `UNDO_WINDOW_MS` ("Removed · Undo"), then goes.
// - The order goes idle `ORDER_IDLE_MS` after its last edit or Send; an idle order moves aside as
//   the table's earlier order ("Earlier order · Restore"), one kept, until the sitting ends.
// - A new line's id is made from the add's action id (`orderLineIdFor`), so the phone's own copy
//   and the server's order name the line alike and a quick "+1" on a line just added finds it.
//
// Times are milliseconds since the epoch: the server passes the database's clock, the host its
// own. Pure: no I/O.

import { z } from 'zod'

import { idFromBytes, idSchema, newId, type OrderLineId } from './ids'

/** The limits of the order; the shell's `SERVICE_LIMITS` carries the same figures. */
export const ORDER_LIMITS = {
  /** Live lines in one order. */
  lines: 50,
  /** Quantity of one line. */
  quantity: 50,
  /** Chosen options on one line. */
  options: 32,
  /** A note, in characters. */
  note: 200,
} as const

/** How long "Removed · Undo" lasts (D117: a few seconds). */
export const UNDO_WINDOW_MS = 10_000

/**
 * How long a staff Undo on Tonight is accepted after the write it undoes (#219): the toast's 8
 * seconds, its pauses (Sonner holds it while the pointer is on it or the tab is hidden) and a slow
 * network. Checked by core, not the browser.
 */
export const STAFF_UNDO_WINDOW_MS = 30_000

/** The idle time after which an order nobody touched moves aside (D117: 30 minutes by default). */
export const ORDER_IDLE_MS = 30 * 60_000

/** An edit older than this since its tap is refused `stale_action` (D121, design §4). */
export const ORDER_EDIT_MAX_AGE_MS = 30_000

/** Order changes a table may make in one minute (D121, design §7). */
export const ORDER_CHANGES_PER_MINUTE = 60

/** One line of the order. */
export interface TableOrderLine {
  readonly id: string
  readonly itemId: string
  /** The chosen options, sorted. */
  readonly optionIds: readonly string[]
  readonly qty: number
  /** Trimmed; empty for none. */
  readonly note: string
  /** Rises with every change of the line, so a Send names the lines as the guest saw them. */
  readonly rev: number
  /** The payment that holds the line (part 2), or null. */
  readonly heldBy: string | null
  /** When the line was removed, or null while it is live. */
  readonly removedAt: number | null
}

/** The order set aside when it went idle. */
export interface EarlierOrder {
  readonly at: number
  readonly lines: readonly TableOrderLine[]
}

/** The table's order as both sides keep it. */
export interface TableOrderDraft {
  readonly lines: readonly TableOrderLine[]
  readonly earlier: EarlierOrder | null
  /** When the order goes idle, or null while it has no live line. */
  readonly idleExpiresAt: number | null
}

/** An order with nothing in it. */
export const EMPTY_TABLE_ORDER: TableOrderDraft = { lines: [], earlier: null, idleExpiresAt: null }

/** One edit of the order (the guest commands `order.add` … `order.restore`, less their envelope). */
export type OrderEdit =
  | {
      readonly type: 'order.add'
      readonly itemId: string
      readonly optionIds: readonly string[]
      readonly qty: number
      readonly note: string
    }
  | { readonly type: 'order.change'; readonly lineId: string; readonly delta: number }
  | { readonly type: 'order.remove'; readonly lineId: string }
  | { readonly type: 'order.undo'; readonly lineId: string }
  | { readonly type: 'order.restore'; readonly setAsideAt: number }

/**
 * Why an edit was refused:
 * - `order_changed`: the line is gone, already removed, or the earlier order isn't the one shown;
 * - `line_held`: a payment holds the line;
 * - `undo_expired`: the line was removed more than `UNDO_WINDOW_MS` ago;
 * - `order_full`: 50 live lines already;
 * - `quantity_limit`: the line would hold more than 50.
 */
export const ORDER_EDIT_REFUSALS = [
  'order_changed',
  'line_held',
  'undo_expired',
  'order_full',
  'quantity_limit',
] as const

/** One reason an edit was refused. */
export type OrderEditRefusal = (typeof ORDER_EDIT_REFUSALS)[number]

/** What an edit does to the order. */
export type OrderEditOutcome =
  | { readonly ok: true; readonly order: TableOrderDraft; readonly lineId: string | null }
  | { readonly ok: false; readonly code: OrderEditRefusal }

/** The key that makes two lines the same line: the item, its sorted options and its note. */
export function orderLineKey(line: {
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly note: string
}): string {
  return [line.itemId, [...line.optionIds].sort().join(','), line.note.trim()].join('|')
}

/** The bytes of a uuid (any version), or null for anything else. */
function uuidBytes(uuid: string): Uint8Array | null {
  const hex = uuid.replaceAll('-', '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * The id of the line an add makes: the add's action id as an `ol_` id, so the phone and the server
 * name the new line alike. A random id for anything that isn't a uuid.
 */
export function orderLineIdFor(actionId: string): OrderLineId {
  const bytes = uuidBytes(actionId)
  return bytes === null ? newId('ol') : idFromBytes('ol', bytes)
}

const live = (line: TableOrderLine) => line.removedAt === null

/** The live lines of an order. */
export function liveLines(order: TableOrderDraft): TableOrderLine[] {
  return order.lines.filter(live)
}

/** Adds `line` to `lines`, merged into the live, unheld line with its key where there is one. */
function mergeInto(
  lines: readonly TableOrderLine[],
  line: TableOrderLine,
): { readonly lines: TableOrderLine[]; readonly lineId: string } | OrderEditRefusal {
  const key = orderLineKey(line)
  const same = lines.find(
    (other) => live(other) && other.heldBy === null && orderLineKey(other) === key,
  )
  if (same !== undefined) {
    const qty = same.qty + line.qty
    if (qty > ORDER_LIMITS.quantity) return 'quantity_limit'
    return {
      lines: lines.map((other) => (other === same ? { ...other, qty, rev: other.rev + 1 } : other)),
      lineId: same.id,
    }
  }
  if (lines.filter(live).length >= ORDER_LIMITS.lines) return 'order_full'
  return { lines: [...lines, line], lineId: line.id }
}

/**
 * Applies one edit at `now`. `newLineId` names the line an add makes when it merges into none
 * (`orderLineIdFor(actionId)`). Every accepted edit restarts the idle time.
 */
export function applyOrderEdit(
  order: TableOrderDraft,
  edit: OrderEdit,
  context: { readonly now: number; readonly newLineId: string },
): OrderEditOutcome {
  const { now } = context
  const done = (
    lines: readonly TableOrderLine[],
    lineId: string | null,
    earlier = order.earlier,
  ) => ({
    ok: true as const,
    order: {
      lines,
      earlier,
      idleExpiresAt: lines.some(live) ? now + ORDER_IDLE_MS : null,
    },
    lineId,
  })
  const refuse = (code: OrderEditRefusal) => ({ ok: false as const, code })

  switch (edit.type) {
    case 'order.add': {
      const merged = mergeInto(order.lines, {
        id: context.newLineId,
        itemId: edit.itemId,
        optionIds: [...edit.optionIds].sort(),
        qty: edit.qty,
        note: edit.note.trim(),
        rev: 0,
        heldBy: null,
        removedAt: null,
      })
      return typeof merged === 'string' ? refuse(merged) : done(merged.lines, merged.lineId)
    }
    case 'order.change':
    case 'order.remove': {
      const line = order.lines.find((other) => other.id === edit.lineId)
      if (line === undefined || !live(line)) return refuse('order_changed')
      if (line.heldBy !== null) return refuse('line_held')
      const qty = edit.type === 'order.remove' ? 0 : line.qty + edit.delta
      if (qty > ORDER_LIMITS.quantity) return refuse('quantity_limit')
      const changed: TableOrderLine =
        qty <= 0 ? { ...line, removedAt: now } : { ...line, qty, rev: line.rev + 1 }
      return done(
        order.lines.map((other) => (other === line ? changed : other)),
        line.id,
      )
    }
    case 'order.undo': {
      const line = order.lines.find((other) => other.id === edit.lineId)
      if (line === undefined || line.removedAt === null) return refuse('order_changed')
      if (now - line.removedAt > UNDO_WINDOW_MS) return refuse('undo_expired')
      // Back as it was, merged into a line someone added meanwhile.
      const rest = order.lines.filter((other) => other !== line)
      const merged = mergeInto(rest, { ...line, removedAt: null, rev: line.rev + 1 })
      return typeof merged === 'string' ? refuse(merged) : done(merged.lines, merged.lineId)
    }
    case 'order.restore': {
      const earlier = order.earlier
      if (earlier === null || earlier.at !== edit.setAsideAt) return refuse('order_changed')
      let lines: TableOrderLine[] = [...order.lines]
      for (const line of earlier.lines) {
        const merged = mergeInto(lines, { ...line, heldBy: null, removedAt: null })
        if (typeof merged === 'string') return refuse(merged)
        lines = merged.lines
      }
      return done(lines, null, null)
    }
  }
}

/**
 * What time alone does to the order at `now`: removed lines past their Undo go, and an order idle
 * since `idleExpiresAt` moves aside as the earlier order (replacing the one before; lines a
 * payment holds stay). `changed` is false when nothing was due.
 */
export function tidyOrder(
  order: TableOrderDraft,
  now: number,
): { readonly order: TableOrderDraft; readonly changed: boolean } {
  let changed = false
  let lines = order.lines.filter((line) => {
    const gone = line.removedAt !== null && now - line.removedAt > UNDO_WINDOW_MS
    if (gone) changed = true
    return !gone
  })
  let earlier = order.earlier
  let idleExpiresAt = order.idleExpiresAt
  if (idleExpiresAt !== null && now >= idleExpiresAt) {
    changed = true
    const aside = lines.filter((line) => live(line) && line.heldBy === null)
    if (aside.length > 0) earlier = { at: now, lines: aside }
    lines = lines.filter((line) => !aside.includes(line))
    idleExpiresAt = null
  }
  return { order: changed ? { lines, earlier, idleExpiresAt } : order, changed }
}

/**
 * The next moment time alone changes the order (an Undo closing, the order going idle), or null.
 * A read of the table's state past it runs the change first (design §6, `next_change_at`).
 */
export function nextOrderChangeAt(order: TableOrderDraft): number | null {
  const moments = order.lines.flatMap((line) =>
    line.removedAt === null ? [] : [line.removedAt + UNDO_WINDOW_MS + 1],
  )
  if (order.idleExpiresAt !== null) moments.push(order.idleExpiresAt)
  return moments.length === 0 ? null : Math.min(...moments)
}

// ---------------------------------------------------------------------------------------------
// Stored: `table_orders.lines` and `earlier` (the service-data design §1)

const InstantSchema = z.iso.datetime({ offset: true })

/** One stored line: no price, no name; `removedAt` set while "Removed · Undo" shows. */
export const StoredOrderLineSchema = z.strictObject({
  id: idSchema('ol'),
  itemId: idSchema('nd'),
  optionIds: z.array(idSchema('nd')).max(ORDER_LIMITS.options),
  qty: z.int().min(1).max(ORDER_LIMITS.quantity),
  note: z.string().max(ORDER_LIMITS.note),
  rev: z.int().nonnegative(),
  heldBy: idSchema('py').nullable(),
  removedAt: InstantSchema.nullable(),
})

/** One stored line. */
export type StoredOrderLine = z.output<typeof StoredOrderLineSchema>

/** Stored lines, each checked; a line that fails its schema is dropped, never shown. */
function linesOf(stored: unknown): TableOrderLine[] {
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry) => {
    const parsed = StoredOrderLineSchema.safeParse(entry)
    if (!parsed.success) return []
    const line = parsed.data
    return [{ ...line, removedAt: line.removedAt === null ? null : Date.parse(line.removedAt) }]
  })
}

function storedLine(line: TableOrderLine): StoredOrderLine {
  return StoredOrderLineSchema.parse({
    ...line,
    removedAt: line.removedAt === null ? null : new Date(line.removedAt).toISOString(),
  })
}

/** The order of a `table_orders` row, from its stored columns. */
export function orderFromRow(row: {
  readonly lines: unknown
  readonly earlier: unknown
  readonly earlierAt: Date | null
  readonly idleExpiresAt: Date | null
}): TableOrderDraft {
  const earlierLines = linesOf(row.earlier)
  return {
    lines: linesOf(row.lines),
    earlier:
      row.earlierAt === null || earlierLines.length === 0
        ? null
        : { at: row.earlierAt.getTime(), lines: earlierLines },
    idleExpiresAt: row.idleExpiresAt?.getTime() ?? null,
  }
}

/** The stored columns of an order. */
export function orderToRow(order: TableOrderDraft): {
  readonly lines: StoredOrderLine[]
  readonly earlier: StoredOrderLine[] | null
  readonly earlierAt: Date | null
  readonly idleExpiresAt: Date | null
} {
  return {
    lines: order.lines.map(storedLine),
    earlier: order.earlier === null ? null : order.earlier.lines.map(storedLine),
    earlierAt: order.earlier === null ? null : new Date(order.earlier.at),
    idleExpiresAt: order.idleExpiresAt === null ? null : new Date(order.idleExpiresAt),
  }
}

// ---------------------------------------------------------------------------------------------
// Send (#77): the lines a Send takes out of the order, and the lines a sent order that was not
// sent gives back

/** One line a Send names: what the guest saw on the order. */
export interface SendRequestLine {
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly qty: number
  readonly note: string
}

/**
 * Takes the lines a Send names out of the order. The Send must name the order's live lines that
 * no payment holds and `keepBack` doesn't keep (#78: a sold-out line stays, greyed, and Send
 * offers "Send the other 4"), each once with its quantity: anything else is `order_changed`
 * (someone changed the order since the guest looked), and an order with no such line is
 * `order_empty`. The lines leave the order entirely (no Undo: they are on their way to the bar);
 * the idle time restarts.
 */
export function takeSentLines(
  order: TableOrderDraft,
  requested: readonly SendRequestLine[],
  now: number,
  keepBack: (line: TableOrderLine) => boolean = () => false,
):
  | {
      readonly ok: true
      readonly order: TableOrderDraft
      readonly lines: readonly TableOrderLine[]
    }
  | { readonly ok: false; readonly code: 'order_changed' | 'order_empty' } {
  const sendable = order.lines.filter(
    (line) => live(line) && line.heldBy === null && !keepBack(line),
  )
  if (sendable.length === 0) return { ok: false, code: 'order_empty' }
  if (requested.length === 0) return { ok: false, code: 'order_changed' }
  // Refused only when a line it sends changed or went (D117): every named line must be on the order
  // as the guest saw it. A line it does not name stays on the order, whatever happened to it.
  const left = [...sendable]
  const picked: TableOrderLine[] = []
  for (const line of requested) {
    const key = `${orderLineKey(line)}|${line.qty}`
    const at = left.findIndex((other) => `${orderLineKey(other)}|${other.qty}` === key)
    const found = left[at]
    if (found === undefined) return { ok: false, code: 'order_changed' }
    picked.push(found)
    left.splice(at, 1)
  }
  const lines = order.lines.filter((line) => !picked.includes(line))
  return {
    ok: true,
    order: {
      lines,
      earlier: order.earlier,
      idleExpiresAt: lines.some(live) ? now + ORDER_IDLE_MS : null,
    },
    // In the order's own order, as the round is entered.
    lines: sendable.filter((line) => picked.includes(line)),
  }
}

/**
 * The pay-first part of a Send (#113): each line the Send names for paying first must be one of
 * the live, unheld lines `payFirst` picks, with its quantity, each line once (else
 * `order_changed`); the others stay as they are, for a later "Pay". With `whole` (a "Send and
 * pay", whose bill part goes too) the Send must name every one of them. The named lines stay on the
 * order, held by the payment (`heldBy`), until it enters them on the POS (`dropHeldLines`) or ends
 * without (`releaseHeldLines`).
 */
export function holdPayFirstLines(
  order: TableOrderDraft,
  requested: readonly SendRequestLine[],
  payFirst: (line: TableOrderLine) => boolean,
  paymentId: string,
  whole = false,
):
  | {
      readonly ok: true
      readonly order: TableOrderDraft
      readonly lines: readonly TableOrderLine[]
    }
  | { readonly ok: false; readonly code: 'order_changed' | 'order_empty' } {
  const candidates = order.lines.filter(
    (line) => live(line) && line.heldBy === null && payFirst(line),
  )
  if (candidates.length === 0) return { ok: false, code: 'order_empty' }
  if (requested.length === 0) return { ok: false, code: 'order_changed' }
  const left = [...candidates]
  const picked: TableOrderLine[] = []
  for (const line of requested) {
    const key = `${orderLineKey(line)}|${line.qty}`
    const at = left.findIndex((candidate) => `${orderLineKey(candidate)}|${candidate.qty}` === key)
    const found = left[at]
    if (found === undefined) return { ok: false, code: 'order_changed' }
    picked.push(found)
    left.splice(at, 1)
  }
  if (whole && left.length > 0) return { ok: false, code: 'order_changed' }
  // In the order's own order, as the round is entered.
  const lines = candidates.filter((line) => picked.includes(line))
  return {
    ok: true,
    order: {
      ...order,
      lines: order.lines.map((line) =>
        lines.includes(line) ? { ...line, heldBy: paymentId, rev: line.rev + 1 } : line,
      ),
    },
    lines,
  }
}

/** The order without the lines `paymentId` holds: they are on the POS now, or may be (#113). */
export function dropHeldLines(
  order: TableOrderDraft,
  paymentId: string,
  now: number,
): TableOrderDraft {
  const lines = order.lines.filter((line) => line.heldBy !== paymentId)
  return {
    lines,
    earlier: order.earlier,
    idleExpiresAt: lines.some(live) ? (order.idleExpiresAt ?? now + ORDER_IDLE_MS) : null,
  }
}

/** The order with the lines `paymentId` held free again: the payment ended before the POS (#113). */
export function releaseHeldLines(order: TableOrderDraft, paymentId: string): TableOrderDraft {
  return {
    ...order,
    lines: order.lines.map((line) =>
      line.heldBy === paymentId ? { ...line, heldBy: null, rev: line.rev + 1 } : line,
    ),
  }
}

/**
 * Puts the lines of a sent order that was not sent back on the order (D116: "your lines are back,
 * Try again"), each merged into an identical live line where the merge stays within the quantity
 * limit, else as a line of its own. Never refused and never dropped: the limits bound what a guest
 * adds, not what comes back. A returned line keeps its id unless the order has one by that id.
 */
export function returnSentLines(
  order: TableOrderDraft,
  returned: readonly {
    readonly id: string
    readonly itemId: string
    readonly optionIds: readonly string[]
    readonly qty: number
    readonly note: string
  }[],
  now: number,
  newLineId: () => string,
): TableOrderDraft {
  let lines: TableOrderLine[] = [...order.lines]
  for (const back of returned) {
    const line: TableOrderLine = {
      id: lines.some((other) => other.id === back.id) ? newLineId() : back.id,
      itemId: back.itemId,
      optionIds: [...back.optionIds].sort(),
      qty: back.qty,
      note: back.note.trim(),
      rev: 0,
      heldBy: null,
      removedAt: null,
    }
    const merged = mergeInto(lines, line)
    lines = typeof merged === 'string' ? [...lines, line] : merged.lines
  }
  return {
    lines,
    earlier: order.earlier,
    idleExpiresAt: lines.some(live) ? now + ORDER_IDLE_MS : order.idleExpiresAt,
  }
}
