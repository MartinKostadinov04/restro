// "The name shown is the till's own" (D75): the one test the composer's rows and the item sheet
// share. Pure.
//
// The sync writes the till's own name in the till layer when the till has no public name. Two
// things must hold for guests to see it: the node's stored name is such a fallback (the
// connector's `readNameFallbackNodeIds`, from the stored source records), and the resolver still
// takes that text from the till in some language. A name typed here is an override (it wins over
// the till's), so its language no longer reads `till` and the warning goes. A translation the
// manual layer adds in a language the till has no text for does not take the warning away: the
// till's own name is still shown in the language it has.
import type { ResolvedField } from '@restro/core'

/** True if some language of the resolved name takes its text from the till. */
export function tillTextShown(field: Pick<ResolvedField, 'locales'> | undefined): boolean {
  return Object.values(field?.locales ?? {}).some((locale) => locale.provenance === 'till')
}
