// "Did it land?" (D115, #77): after a write that answered `unknown`, the worker reads the table back
// and asks whether the round it sent is on the bill. The answer is one of three:
// - `landed`: the round is there, and nothing else makes that doubtful;
// - `absent`: the round is not there yet, and nothing else changed the bill;
// - `ambiguous`: something else changed the bill too, so Restro can't tell its round from staff's.
//   The sent order becomes Unconfirmed at once: never Added on a guess (D116).
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

import type { ServiceCapabilities } from './capabilities'
import type { PosRef } from './pos-ref'
import type { BillLine, TableBills } from './schemas'

/** One line Restro sent: the POS item and its quantity as decimal text. */
export interface SentLineShape {
  readonly item: PosRef
  readonly quantity: string
}

/** What a read-back concluded. */
export type LandedVerdict =
  | {
      readonly kind: 'landed'
      /** The POS bill the round joined, where the lines say. */
      readonly bill: PosRef | null
      /** The POS lines that are the round. */
      readonly lines: readonly PosRef[]
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous'; readonly reason: string }

/** A quantity without trailing zeros, so "2", "2.0" and "2.000" compare equal. */
function quantityKey(quantity: string): string {
  if (!quantity.includes('.')) return quantity
  const trimmed = quantity.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

function lineKey(item: PosRef | null, quantity: string): string {
  return `${item?.pos ?? ''}|${quantityKey(quantity)}`
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

interface PlacedLine {
  readonly bill: PosRef
  readonly line: BillLine
}

function linesOf(bills: TableBills): PlacedLine[] {
  return bills.bills.flatMap((bill) => bill.lines.map((line) => ({ bill: bill.ref, line })))
}

/** The bill the lines are on, when they are all on one. */
function billOf(lines: readonly PlacedLine[]): PosRef | null {
  const first = lines[0]
  if (first === undefined) return null
  return lines.every((placed) => placed.bill.pos === first.bill.pos) ? first.bill : null
}

/**
 * Compares the table before the write with the table now and says whether the round `sent`, sent
 * with reference `ref`, is on it.
 */
export function checkLanded(input: {
  readonly before: TableBills
  readonly after: TableBills
  readonly sent: readonly SentLineShape[]
  /** Restro's reference for the write (the sent order's id). */
  readonly ref: string
  readonly capabilities: Pick<ServiceCapabilities, 'ownLineReference' | 'whoEnteredLine'>
}): LandedVerdict {
  const { before, after, sent, ref, capabilities } = input
  const sentKeys = sent.map((line) => lineKey(line.item, line.quantity))
  const now = linesOf(after)

  if (capabilities.ownLineReference) {
    const ours = now.filter((placed) => placed.line.restroRef === ref)
    if (ours.length === 0) return { kind: 'absent' }
    const keys = ours.map((placed) => lineKey(placed.line.item, placed.line.quantity))
    return sameMultiset(keys, sentKeys)
      ? { kind: 'landed', bill: billOf(ours), lines: ours.map((placed) => placed.line.ref) }
      : { kind: 'ambiguous', reason: 'the lines with our reference are not the round we sent' }
  }

  const earlier = new Map(linesOf(before).map((placed) => [placed.line.ref.pos, placed]))
  const fresh = now.filter((placed) => !earlier.has(placed.line.ref.pos))

  if (capabilities.whoEnteredLine) {
    const ours = fresh.filter((placed) => placed.line.enteredBy === 'restro')
    if (ours.length === 0) return { kind: 'absent' }
    const keys = ours.map((placed) => lineKey(placed.line.item, placed.line.quantity))
    return sameMultiset(keys, sentKeys)
      ? { kind: 'landed', bill: billOf(ours), lines: ours.map((placed) => placed.line.ref) }
      : { kind: 'ambiguous', reason: "Restro's new lines are not the round we sent" }
  }

  // Nothing tells Restro's lines from staff's: the bill must be as it was, plus our round.
  const current = new Map(now.map((placed) => [placed.line.ref.pos, placed]))
  for (const [pos, was] of earlier) {
    const is = current.get(pos)
    if (
      is === undefined ||
      is.bill.pos !== was.bill.pos ||
      quantityKey(is.line.quantity) !== quantityKey(was.line.quantity) ||
      is.line.amountMinor !== was.line.amountMinor
    ) {
      return { kind: 'ambiguous', reason: 'a line on the bill changed or went' }
    }
  }
  if (fresh.length === 0) return { kind: 'absent' }
  const keys = fresh.map((placed) => lineKey(placed.line.item, placed.line.quantity))
  return sameMultiset(keys, sentKeys)
    ? { kind: 'landed', bill: billOf(fresh), lines: fresh.map((placed) => placed.line.ref) }
    : { kind: 'ambiguous', reason: 'other new lines are on the bill' }
}
