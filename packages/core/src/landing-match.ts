// "Is this round on the bill?", on plain text (D115, D116; #77, #135). The rules live here once, for
// the two places that ask:
// - the worker's read-back right after a write that timed out (`connectors/service/landed.ts`,
//   which hands it the connector's `TableBills`);
// - the late landing of an Unconfirmed sent order, found by a later reading of the table in the
//   service path (`service/late-landing.ts`), which can't import the connector side
//   (`no-outbound.test.ts`) and holds only what `LandingBasis` kept of the reading before.
// POS references are plain text here, so the module sits beside `quantity.ts`, importable from both.
//
// How a line is known to be Restro's depends on what the POS declares:
// - `ownLineReference`: the line carries Restro's reference (the sent order's id) back;
// - `whoEnteredLine`: the line says Restro's POS user entered it; only lines that appeared after
//   the before-read count;
// - neither: only lines that appeared after the before-read count, and only when nothing else
//   changed the bill in between (no line gone or changed, no bill closed, no other new line). A
//   waiter's identical round in that window makes it `ambiguous`, never `landed`.
//
// Pure: no I/O. Quantities are compared as decimal text, never as floats (rule 8).

import { z } from 'zod'

import { DecimalQuantitySchema } from './quantity'

/** One line of the table now, as the match reads it. */
export interface MatchLine {
  /** *Backend*: the POS bill the line is on. */
  readonly bill: string
  /** *Backend*: the POS's line. */
  readonly line: string
  /** *Backend*: the POS's item, or null for a line with no item. */
  readonly item: string | null
  readonly quantity: string
  /** The POS's own line total, signed. */
  readonly amountMinor: number
  readonly enteredBy: 'restro' | 'staff' | null
  /** *Backend*: Restro's own reference read back, where the POS keeps one. */
  readonly restroRef: string | null
}

/** What the match needs of one line of the reading before the write. */
export interface BeforeLine {
  readonly bill: string
  readonly line: string
  readonly quantity: string
  readonly amountMinor: number
}

/** One line Restro sent: the POS item and its quantity as decimal text. */
export interface SentLine {
  readonly item: string
  readonly quantity: string
}

/** What the POS declares, as far as the match depends on it. */
export interface MatchCapabilities {
  readonly ownLineReference: boolean
  readonly whoEnteredLine: boolean
}

const PosIdSchema = z.string().min(1).max(200)

/**
 * What a sent order keeps of the reading before its write, for a later reading to be matched
 * against it after the worker has gone (`sent_orders.landing_basis`, #135): the round as the POS
 * takes it, what the POS declares, and only the part of each line the match compares. *Backend*:
 * it holds POS ids and never leaves the database.
 */
export const LandingBasisSchema = z.strictObject({
  capabilities: z.strictObject({ ownLineReference: z.boolean(), whoEnteredLine: z.boolean() }),
  sent: z.array(z.strictObject({ item: PosIdSchema, quantity: DecimalQuantitySchema })).max(200),
  before: z
    .array(
      z.strictObject({
        bill: PosIdSchema,
        line: PosIdSchema,
        quantity: DecimalQuantitySchema,
        amountMinor: z.int(),
      }),
    )
    .max(2_000),
})
export type LandingBasis = z.output<typeof LandingBasisSchema>

/** What a match concluded. */
export type MatchVerdict =
  | {
      readonly kind: 'landed'
      /** The POS bill the round joined, where the lines say. */
      readonly bill: string | null
      /** The POS lines that are the round. */
      readonly lines: readonly string[]
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous'; readonly reason: string }

/** A quantity without trailing zeros, so "2", "2.0" and "2.000" compare equal. */
function quantityKey(quantity: string): string {
  if (!quantity.includes('.')) return quantity
  const trimmed = quantity.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

function lineKey(item: string | null, quantity: string): string {
  return `${item ?? ''}|${quantityKey(quantity)}`
}

/** True when the two lists hold the same keys the same number of times. */
function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const key of b) {
    const left = counts.get(key) ?? 0
    if (left === 0) return false
    counts.set(key, left - 1)
  }
  return true
}

/** The bill the lines are on, when they are all on one. */
function billOf(lines: readonly MatchLine[]): string | null {
  const first = lines[0]
  if (first === undefined) return null
  return lines.every((placed) => placed.bill === first.bill) ? first.bill : null
}

/**
 * Compares the table before the write with the table now and says whether the round `sent`, sent
 * with reference `ref`, is on it.
 */
export function matchLanded(input: {
  readonly before: readonly BeforeLine[]
  readonly after: readonly MatchLine[]
  readonly sent: readonly SentLine[]
  /** Restro's reference for the write (the sent order's id). */
  readonly ref: string
  readonly capabilities: MatchCapabilities
}): MatchVerdict {
  const { before, after: now, sent, ref, capabilities } = input
  const sentKeys = sent.map((line) => lineKey(line.item, line.quantity))
  const landed = (ours: readonly MatchLine[]): MatchVerdict => ({
    kind: 'landed',
    bill: billOf(ours),
    lines: ours.map((placed) => placed.line),
  })

  if (capabilities.ownLineReference) {
    const ours = now.filter((placed) => placed.restroRef === ref)
    if (ours.length === 0) return { kind: 'absent' }
    const keys = ours.map((placed) => lineKey(placed.item, placed.quantity))
    return sameMultiset(keys, sentKeys)
      ? landed(ours)
      : { kind: 'ambiguous', reason: 'the lines with our reference are not the round we sent' }
  }

  const earlier = new Map(before.map((placed) => [placed.line, placed]))
  const fresh = now.filter((placed) => !earlier.has(placed.line))

  if (capabilities.whoEnteredLine) {
    const ours = fresh.filter((placed) => placed.enteredBy === 'restro')
    if (ours.length === 0) return { kind: 'absent' }
    const keys = ours.map((placed) => lineKey(placed.item, placed.quantity))
    return sameMultiset(keys, sentKeys)
      ? landed(ours)
      : { kind: 'ambiguous', reason: "Restro's new lines are not the round we sent" }
  }

  // Nothing tells Restro's lines from staff's: the bill must be as it was, plus our round.
  const current = new Map(now.map((placed) => [placed.line, placed]))
  for (const [pos, was] of earlier) {
    const is = current.get(pos)
    if (
      is === undefined ||
      is.bill !== was.bill ||
      quantityKey(is.quantity) !== quantityKey(was.quantity) ||
      is.amountMinor !== was.amountMinor
    ) {
      return { kind: 'ambiguous', reason: 'a line on the bill changed or went' }
    }
  }
  if (fresh.length === 0) return { kind: 'absent' }
  const keys = fresh.map((placed) => lineKey(placed.item, placed.quantity))
  return sameMultiset(keys, sentKeys)
    ? landed(fresh)
    : { kind: 'ambiguous', reason: 'other new lines are on the bill' }
}
