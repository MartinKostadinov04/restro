// Part 2's side of the end of the night (#115): the one place that builds what fills the slots of
// `night-slots.ts`. Part 1 ships it empty: no payment logic lives in this ticket. #115 replaces the
// body with the rows of To fix, the sections 3–6 and the money totals, read from its own tables,
// each as a server-rendered node; the page already draws, orders and permission-filters them.
import type { Frame, NightView } from '@/server/tonight/night-view'

import { type NightSlots, NO_SLOTS } from './night-slots'

export function nightSlots(_night: NightView, _frame: Frame): NightSlots {
  return NO_SLOTS
}
