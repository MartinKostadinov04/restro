// What a waiter call asked for, worded for staff and the owner (#180): the venue's list order,
// joined with commas ("Ice, Water"). The words are the `tonight` messages `ck_<kind>`.
import { type CallWaiterKind, isCallWaiterKind } from '@restro/core'

/** The translator of the `tonight` messages. */
type Say = (key: string) => string

/** "Ice, Water" for the kinds of a call; a kind the list no longer holds is left out. */
export function callKindsText(say: Say, kinds: readonly string[]): string {
  return kinds
    .filter((kind): kind is CallWaiterKind => isCallWaiterKind(kind))
    .map((kind) => say(`ck_${kind}`))
    .join(', ')
}
