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

/**
 * The tests' write timeout. It is a real wall-clock timer (the simulated POS's connector aborts the
 * call with `setTimeout`), so it must be longer than a call can take on a busy machine: at 300 ms a
 * close answered after 400 ms, as a CI runner that is closing a database beside it can, read as a
 * write timeout with an unknown outcome and failed tests that expect the call to land. A fault that
 * hangs a call does cost this much real time, once per hung call.
 */
export const TEST_WRITE_TIMEOUT_MS = 2_000
