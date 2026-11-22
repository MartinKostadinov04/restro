// One Log row per sent order (S15): its newest step stands for it, the older ones fold under it.
import { describe, expect, it } from 'vitest'

import type { LogLineView } from '@/server/tonight/night-view'

import { foldOrderSteps } from './log-groups'

const line = (seq: number, kind: LogLineView['kind'], sentOrderId: string | null) =>
  ({ seq, kind, sentOrderId }) as LogLineView

describe('folding a sent order’s steps', () => {
  it('keeps one row per sent order at its newest step, the older steps under it', () => {
    const rows = foldOrderSteps([
      line(9, 'sent_order.state', 'so_a'),
      line(8, 'pause.started', null),
      line(7, 'sent_order.state', 'so_a'),
      line(6, 'sent_order.state', 'so_b'),
      line(5, 'sent_order.state', 'so_a'),
    ])
    expect(rows.map((row) => [row.line.seq, row.steps.map((step) => step.seq)])).toEqual([
      [9, [7, 5]],
      [8, []],
      [6, []],
    ])
  })

  it('leaves every other line as it is, even one that names a sent order', () => {
    const rows = foldOrderSteps([
      line(3, 'alert.raised', 'so_a'),
      line(2, 'sent_order.landed_late', 'so_a'),
      line(1, 'sent_order.state', 'so_a'),
    ])
    expect(rows.map((row) => [row.line.seq, row.steps.map((step) => step.seq)])).toEqual([
      [3, []],
      [2, [1]],
    ])
  })
})
