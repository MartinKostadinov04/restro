// One Log row per sent order (S15): a phone's order writes a line for each step ("Waiting",
// "Sending", "Added"), and a person reading the Log at 03:00 wants the order once, with where it
// stands now. The newest line of a sent order stands for it, where that line is; its older steps
// fold under it and open on a tap. Only the lines loaded are folded: "Show earlier" reads more.
import type { LogLineView } from '@/server/tonight/night-view'

/** The kinds that are steps of one sent order. */
const STEP_KINDS: ReadonlySet<LogLineView['kind']> = new Set([
  'sent_order.state',
  'sent_order.landed_late',
])

/** One row of the Log: a line, and the older steps of the same sent order (newest first). */
export interface LogItem {
  readonly line: LogLineView
  readonly steps: readonly LogLineView[]
}

/** The Log's lines (newest first) as rows: each sent order's steps under its newest line. */
export function foldOrderSteps(lines: readonly LogLineView[]): LogItem[] {
  const items: { line: LogLineView; steps: LogLineView[] }[] = []
  const byOrder = new Map<string, { line: LogLineView; steps: LogLineView[] }>()
  for (const line of lines) {
    const order = STEP_KINDS.has(line.kind) ? line.sentOrderId : null
    const head = order === null ? undefined : byOrder.get(order)
    if (head !== undefined) {
      head.steps.push(line)
      continue
    }
    const item = { line, steps: [] }
    items.push(item)
    if (order !== null) byOrder.set(order, item)
  }
  return items
}
