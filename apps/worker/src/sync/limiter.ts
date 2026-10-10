// At most N calls in flight at once, the rest waiting in order. barsy allows two concurrent
// requests per installation, so every call to one installation goes through one limiter of 2,
// shared by all jobs of the process (`LimiterRegistry`).

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

/** How many requests one installation gets at the same time (data-architecture, path C). */
export const BARSY_CONCURRENCY = 2

export function createLimiter(limit: number): Limiter {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('limit must be a positive integer')
  let active = 0
  const waiting: (() => void)[] = []
  const release = () => {
    active -= 1
    waiting.shift()?.()
  }
  return {
    async run(task) {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
      active += 1
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

/** One limiter per installation host, created on first use. */
export class LimiterRegistry {
  readonly #limiters = new Map<string, Limiter>()
  readonly #limit: number

  constructor(limit: number = BARSY_CONCURRENCY) {
    this.#limit = limit
  }

  forHost(host: string): Limiter {
    let limiter = this.#limiters.get(host)
    if (!limiter) {
      limiter = createLimiter(this.#limit)
      this.#limiters.set(host, limiter)
    }
    return limiter
  }
}
