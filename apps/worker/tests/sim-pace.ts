// The login's per-second budget on the simulated POS's manual clock: a wait for room moves that
// clock, so a test never really sleeps and its short timeouts are not eaten by real seconds.

import type { ManualClock } from '@restro/sim-pos'

import { InstanceBudgets } from '../src/jobs/floor'

export function simBudgets(simClock: ManualClock): InstanceBudgets {
  return new InstanceBudgets({
    clock: {
      now: () => simClock.now().getTime(),
      sleep: async (ms) => {
        simClock.advance(Math.ceil(ms))
      },
    },
  })
}
