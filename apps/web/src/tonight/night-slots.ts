// Where part 2 (#115) fills the end of the night (plan `2026-10-27-tonight-end-of-night-plan.md`
// §3). Part 1 draws sections 1 (To fix), 2 (Sent orders) and 7 (Totals); part 2 fills the rows
// of To fix and Totals, and its own sections 3–6 (payments, money alerts and their answers,
// refunds and pending stornos, disputes). Nothing of that is built here: the page takes these
// slots and draws what they hold, in the plan's order, and an empty slot draws nothing.
//
// Who may see a part 2 section is decided here, not by the part that fills it: payments are for
// `night.view` (staff, without tips); the rest are for `night.view_full`. A section the role may
// not see is not rendered at all, never greyed (plan §5 "Roles").
import type { ReactNode } from 'react'

/** The part 2 sections, in the page's order. */
export const NIGHT_SECTION_ACCESS = {
  payments: 'night.view',
  money_alerts: 'night.view_full',
  refunds: 'night.view_full',
  disputes: 'night.view_full',
} as const

/** One part 2 section. */
export type NightSectionId = keyof typeof NIGHT_SECTION_ACCESS

/** A part 2 section: its jump-link label and its content (a whole section with its heading). */
export interface NightSectionSlot {
  readonly id: NightSectionId
  readonly label: string
  readonly node: ReactNode
}

/** What part 2 hands the page. */
export interface NightSlots {
  /** More rows in "To fix" (a payment captured with no receipt number, …). */
  readonly fix: ReactNode
  /** Sections 3–6, in order, whichever it has. */
  readonly sections: readonly NightSectionSlot[]
  /** More rows in "Totals" (payments, captured, tips: `money.follow_up` only). */
  readonly totals: ReactNode
}

/** Nothing from part 2 yet. */
export const NO_SLOTS: NightSlots = { fix: null, sections: [], totals: null }

/** The part 2 sections a role may see: manager-only ones are dropped for staff. */
export function visibleSections(
  sections: readonly NightSectionSlot[],
  full: boolean,
): readonly NightSectionSlot[] {
  return sections.filter(
    (section) =>
      section.node !== null && (full || NIGHT_SECTION_ACCESS[section.id] === 'night.view'),
  )
}
