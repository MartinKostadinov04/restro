// The plan editor's data, as Settings › Reservations reads it (#397): plain types for the browser,
// taken from the page's own view so the editor never imports the service package.
import type { ReservationsView } from '@/server/settings/reservations-view'

/** Everything the editor draws. */
export type PlanRead = ReservationsView['plan']
/** One of the venue's plans. */
export type EditorPlan = PlanRead['plans'][number]
/** One spot with its numbers and how many bookings still hold it. */
export type EditorSpot = PlanRead['spots'][number]
/** One of the venue's own spot kinds. */
export type EditorKind = PlanRead['kinds'][number]
/** One of the venue's Tables a spot may name. */
export type EditorTable = PlanRead['tables'][number]
