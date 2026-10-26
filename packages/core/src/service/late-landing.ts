// The late landing of an Unconfirmed sent order (D115, D116, D122 §4; ticket #135). A sent order the
// read-back could not confirm ends Unconfirmed and is never sent again. The table goes on being
// read on its usual schedule (#74), and `reading.record` hands every complete reading here:
//
// - the candidates are the open sitting's Unconfirmed sent orders of the venue's current service
//   day that still hold their `landing_basis` (the reading before the write, kept by the move to
//   Sending); they are locked before the reading's row (`lock-order.ts`);
// - each is matched with the rules of the worker's read-back (`matchLanded`): Restro's reference,
//   or who entered the line, or else the same item and quantity with nothing else on the bill
//   changed. An incomplete reading never reaches this (rule 6); an ambiguous or absent result
//   writes nothing and the next reading tries again;
// - a match writes the matched POS lines and bill on the sent order (backend), one Log entry
//   (`sent_order.landed_late`) and clears the basis, so it is never written twice. That is also
//   the night's mismatch row: an Unconfirmed sent order that holds matched lines is one Restro
//   found on the bill afterwards (the end-of-night page, #86, lists it apart from the ones still
//   unfound);
// - it never changes the state back to Added and never resends: staff settle it from the alert
//   (#83, #85).
//
// Matching stops with the service day: a candidate of another day is left alone, and
// `service_day.close` clears the basis, so the day's totals are written once and need no rewrite.

import { sentOrders } from '@restro/db'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { LandingBasisSchema, type MatchLine, matchLanded } from '../landing-match'
import type { StoredBill } from './bill'
import type { ServiceTx } from './definition'
import type { SentOrder } from './rows'

/**
 * The Unconfirmed sent orders of the table's open sitting that may still land late, locked (oldest
 * first). A last group's order is not matched against the next group's bill.
 */
export async function lockLateCandidates(
  stx: ServiceTx,
  tableId: string,
  sittingId: string,
): Promise<SentOrder[]> {
  const found = await stx.tx
    .select({ id: sentOrders.id })
    .from(sentOrders)
    .where(
      and(
        eq(sentOrders.tableId, tableId),
        eq(sentOrders.sittingId, sittingId),
        eq(sentOrders.state, 'unconfirmed'),
        eq(sentOrders.serviceDate, stx.serviceDate),
        isNotNull(sentOrders.landingBasis),
        isNull(sentOrders.matchedLines),
      ),
    )
  if (found.length === 0) return []
  const locked = await stx.rows.sentOrders(found.map((row) => row.id))
  return [...locked.values()]
    .filter((sent) => sent.state === 'unconfirmed' && sent.matchedLines === null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
}

function linesOf(bills: readonly StoredBill[]): MatchLine[] {
  return bills.flatMap((bill) =>
    bill.lines.map((line) => ({
      bill: bill.pos,
      line: line.pos,
      item: line.itemPos,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
      enteredBy: line.enteredBy,
      restroRef: line.restroRef,
    })),
  )
}

/**
 * Matches these candidates with a complete reading and records the ones that landed late. Returns
 * the ids it recorded.
 */
export async function recordLateLandings(
  stx: ServiceTx,
  candidates: readonly SentOrder[],
  bills: readonly StoredBill[],
): Promise<string[]> {
  const recorded: string[] = []
  const taken = new Set<string>()
  for (const sent of candidates) {
    const basis = LandingBasisSchema.safeParse(sent.landingBasis)
    if (!basis.success) continue
    const verdict = matchLanded({
      before: basis.data.before,
      after: linesOf(bills).filter((line) => !taken.has(line.line)),
      sent: basis.data.sent,
      ref: sent.id,
      capabilities: basis.data.capabilities,
    })
    if (verdict.kind !== 'landed') continue
    for (const line of verdict.lines) taken.add(line)
    await stx.tx
      .update(sentOrders)
      .set({
        matchedLines: [...verdict.lines],
        ...(verdict.bill === null ? {} : { posBillRef: verdict.bill }),
        landingBasis: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(sentOrders.id, sent.id))
    await stx.log({
      kind: 'sent_order.landed_late',
      sentOrderId: sent.id,
      tableId: sent.tableId,
      sittingId: sent.sittingId,
      details: { lines: verdict.lines.length },
    })
    recorded.push(sent.id)
  }
  return recorded
}
