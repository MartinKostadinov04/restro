import { describe, expect, it } from 'vitest'

import { idleGap } from './poll-cadence'

describe('idleGap (P25)', () => {
  it('doubles from the served gap up to 15 s', () => {
    let gap = 0
    const steps: number[] = []
    for (let i = 0; i < 6; i++) {
      gap = idleGap(gap, 2_000)
      steps.push(gap)
    }
    expect(steps).toEqual([2_000, 4_000, 8_000, 15_000, 15_000, 15_000])
    // The menu's slower gap is already near the cap.
    expect(idleGap(0, 10_000)).toBe(10_000)
    expect(idleGap(10_000, 10_000)).toBe(15_000)
  })
})
