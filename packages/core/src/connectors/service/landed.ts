// "Did it land?" (D115, #77): after a write that answered `unknown`, the worker reads the table back
// and asks whether the round it sent is on the bill. The answer is one of three:
// - `landed`: the round is there, and nothing else makes that doubtful;
// - `absent`: the round is not there yet, and nothing else changed the bill;
// - `ambiguous`: something else changed the bill too, so Restro can't tell its round from staff's.
//   The sent order becomes Unconfirmed at once: never Added on a guess (D116).
//
// The rules (what makes a line Restro's, per what the POS declares) are `matchLanded`'s, on plain
// text, so the later reading that finds an Unconfirmed round (#135, `service/late-landing.ts`)
// applies the very same ones. This file hands it the connector's `TableBills`, and keeps what the
// match needs of the reading before for that later reading (`landingBasisOf`).
//
// Pure: no I/O. Quantities are compared as decimal text, never as floats (rule 8).

import {
  type BeforeLine,
  type LandingBasis,
  type MatchLine,
  matchLanded,
  type SentLine,
} from '../../landing-match'
import type { ServiceCapabilities } from './capabilities'
import { type PosRef, posRef } from './pos-ref'
import type { ClosedBill, TableBills } from './schemas'

export type { LandingBasis } from '../../landing-match'

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

type MatchedCapabilities = Pick<ServiceCapabilities, 'ownLineReference' | 'whoEnteredLine'>

function linesNow(bills: TableBills): MatchLine[] {
  return bills.bills.flatMap((bill) =>
    bill.lines.map((line) => ({
      bill: bill.ref.pos,
      line: line.ref.pos,
      item: line.item?.pos ?? null,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
      enteredBy: line.enteredBy,
      restroRef: line.restroRef,
    })),
  )
}

function linesBefore(bills: TableBills): BeforeLine[] {
  return bills.bills.flatMap((bill) =>
    bill.lines.map((line) => ({
      bill: bill.ref.pos,
      line: line.ref.pos,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    })),
  )
}

function sentLines(sent: readonly SentLineShape[]): SentLine[] {
  return sent.map((line) => ({ item: line.item.pos, quantity: line.quantity }))
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
  readonly capabilities: MatchedCapabilities
}): LandedVerdict {
  const verdict = matchLanded({
    before: linesBefore(input.before),
    after: linesNow(input.after),
    sent: sentLines(input.sent),
    ref: input.ref,
    capabilities: input.capabilities,
  })
  if (verdict.kind !== 'landed') return verdict
  return {
    kind: 'landed',
    bill: verdict.bill === null ? null : posRef(verdict.bill),
    lines: verdict.lines.map((line) => posRef(line)),
  }
}

/**
 * What a sent order keeps of the reading before its write, so a later reading can still be matched
 * after the worker is gone (#135): only what `checkLanded` compares.
 */
export function landingBasisOf(input: {
  readonly before: TableBills
  readonly sent: readonly SentLineShape[]
  readonly capabilities: MatchedCapabilities
}): LandingBasis {
  return {
    capabilities: {
      ownLineReference: input.capabilities.ownLineReference,
      whoEnteredLine: input.capabilities.whoEnteredLine,
    },
    sent: sentLines(input.sent),
    before: linesBefore(input.before),
  }
}

/**
 * D127's third proof of a close: the bill the close was sent for, now closed, for the amount, and
 * carrying a receipt number or one of Restro's references (`refs`: what Restro put on this table's
 * rounds and this payment's lines; a line may carry another outside app's). Anything else proves
 * nothing: no closed bill (an empty payment table may be a waiter's move), another total, or a
 * closed bill with neither mark. Answers the receipt number to keep, if any.
 */
export function closeProof(
  bill: ClosedBill | null,
  close: { readonly refs: ReadonlySet<string>; readonly amountMinor: number },
): { readonly receiptNumber: string | null } | null {
  if (bill === null || bill.totalMinor !== close.amountMinor) return null
  if (bill.receiptNumber !== null) return { receiptNumber: bill.receiptNumber }
  return bill.restroRefs.some((ref) => close.refs.has(ref)) ? { receiptNumber: null } : null
}
