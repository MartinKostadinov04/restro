// The rounds of the table bill as the face draws them: exactly the host's `state.bill`, with one
// guard. A guest round that the host's state lists twice (its own record, and the echo of the
// `order.send` the guest made) is drawn once, matched by the `actionId` of the command (and a
// round id that repeats is drawn once as well). The face never adds a round of its own.

import type { BillRoundView, BillView, ViewText } from '@restro/shell'

/** The rounds of the bill, each once, in the host's order. */
export function distinctRounds(bill: BillView | null): readonly BillRoundView[] {
  if (bill === null) return []
  const ids = new Set<string>()
  const actions = new Set<string>()
  const rounds: BillRoundView[] = []
  for (const round of bill.rounds) {
    if (ids.has(round.id)) continue
    if (round.actionId !== null && actions.has(round.actionId)) continue
    ids.add(round.id)
    if (round.actionId !== null) actions.add(round.actionId)
    rounds.push(round)
  }
  return rounds
}

/** Texts with a key each: the texts themselves, numbered when the same text comes twice. */
export function keyed(
  texts: readonly ViewText[],
): { readonly key: string; readonly text: ViewText }[] {
  const seen = new Map<string, number>()
  return texts.map((text) => {
    const count = (seen.get(text.text) ?? 0) + 1
    seen.set(text.text, count)
    return { key: `${text.text}#${count}`, text }
  })
}
