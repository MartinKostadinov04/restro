// One POS call through the instance's budget, bounded here (#77): its turn within
// `BUDGET_WAIT_MS`, then its own timeout. Shared by Send and the stock reads (#80).

import { BUDGET_WAIT_MS } from '@restro/core/service'

import type { Limiter } from '../sync/limiter'

/** How a bounded POS call ended. */
export type Bounded<T> =
  | { readonly kind: 'answered'; readonly value: T }
  /** No turn at the instance's budget within `BUDGET_WAIT_MS`: the call never left. */
  | { readonly kind: 'no_turn' }
  /** It left and outlived its timeout: it may still land. */
  | { readonly kind: 'late' }

/**
 * Runs a POS call through the instance's budget, bounded here: the connector gets the same
 * timeout in its context, but the slot lease must not rest on every connector keeping it.
 */
export async function bounded<T>(
  budget: Limiter,
  timeoutMs: number,
  call: () => Promise<T>,
): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let gaveUp = false
  const ended = new Promise<Bounded<T>>((resolve, reject) => {
    const giveUp = (as: Bounded<T>) => () => {
      gaveUp = true
      resolve(as)
    }
    timer = setTimeout(giveUp({ kind: 'no_turn' }), BUDGET_WAIT_MS)
    budget
      .run(async () => {
        if (gaveUp) return
        clearTimeout(timer)
        timer = setTimeout(giveUp({ kind: 'late' }), timeoutMs)
        resolve({ kind: 'answered', value: await call() })
      })
      .catch(reject)
  })
  try {
    return await ended
  } finally {
    clearTimeout(timer)
  }
}
