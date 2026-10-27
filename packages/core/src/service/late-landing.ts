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
// - a line another sent order of the sitting holds is never this one's, and two candidates that
//   would take the same lines both stay unmatched (a guess is worse than the alert);
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
 * The POS lines other sent orders of the sitting already hold (their `matched_lines`, whatever the
 * state), and the orders that reached the POS without naming their lines (Added or Awaiting
 * approval by the write's own answer), with the time they were sent.
 */
async function othersOf(
  stx: ServiceTx,
  sittingId: string,
  candidates: ReadonlySet<string>,
): Promise<{ claimed: Set<string>; reached: Date[] }> {
  const rows = await stx.tx
    .select({
      id: sentOrders.id,
      state: sentOrders.state,
      sentAt: sentOrders.sentAt,
      matchedLines: sentOrders.matchedLines,
    })
    .from(sentOrders)
    .where(eq(sentOrders.sittingId, sittingId))
  const claimed = new Set<string>()
  const reached: Date[] = []
  for (const row of rows) {
    if (candidates.has(row.id)) continue
    for (const line of row.matchedLines ?? []) claimed.add(String(line))
    if ((row.state === 'added' || row.state === 'awaiting_approval') && row.sentAt !== null) {
      reached.push(row.sentAt)
    }
  }
  return { claimed, reached }
}

/**
 * Matches these candidates with a complete reading and records the ones that landed late. Returns
 * the ids it recorded. Where the sent order can't be told from another's, nothing is written:
 * - a line another sent order of the sitting already holds is not this one's (a later identical
 *   round that was confirmed must not be taken for the Unconfirmed one);
 * - where the POS marks no line of Restro's (`ownLineReference` off), a sent order that reached
 *   the POS after this one was sent leaves its lines indistinguishable, so this one is left;
 * - two candidates that would take the same lines both stay unmatched.
 */
export async function recordLateLandings(
  stx: ServiceTx,
  candidates: readonly SentOrder[],
  bills: readonly StoredBill[],
): Promise<string[]> {
  const first = candidates[0]
  if (first === undefined) return []
  const others = await othersOf(stx, first.sittingId, new Set(candidates.map((one) => one.id)))
  const after = linesOf(bills).filter((line) => !others.claimed.has(line.line))

  const landed = new Map<string, { bill: string | null; lines: readonly string[] }>()
  for (const sent of candidates) {
    const basis = LandingBasisSchema.safeParse(sent.landingBasis)
    if (!basis.success) continue
    if (
      !basis.data.capabilities.ownLineReference &&
      sent.sentAt !== null &&
      others.reached.some((at) => at.getTime() > (sent.sentAt as Date).getTime())
    ) {
      continue
    }
    const verdict = matchLanded({
      before: basis.data.before,
      after,
      sent: basis.data.sent,
      ref: sent.id,
      capabilities: basis.data.capabilities,
    })
    if (verdict.kind === 'landed') landed.set(sent.id, verdict)
  }
  const uses = new Map<string, number>()
  for (const verdict of landed.values()) {
    for (const line of verdict.lines) uses.set(line, (uses.get(line) ?? 0) + 1)
  }

  const recorded: string[] = []
  for (const sent of candidates) {
    const verdict = landed.get(sent.id)
    if (verdict === undefined) continue
    if (verdict.lines.some((line) => (uses.get(line) ?? 0) > 1)) continue
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
