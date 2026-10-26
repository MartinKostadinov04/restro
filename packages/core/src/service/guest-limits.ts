// The guest API's request limits kept in memory (D122 §4, design §7; ticket #76):
// - per phone, by the random value the page makes at load (never stored, forgotten within minutes,
//   so one person can't block the friends at their table): 30 additions a minute, one Send per
//   15 s, 10 Sends in 10 minutes, 5 location tries in 10 minutes;
// - per table code, by its hash: 20 requests a second, reads and commands together.
// The table's own 60 order changes a minute stay in the engine (counted from the order's ring), and
// D118's cap and pace at Send.
//
// Each window keeps the times of its recent hits, nothing else. The memory is bounded: past
// `MAX_KEYS` keys the expired ones go, and if that frees too little everything starts again (a
// limit forgotten costs at most one more window). One process each: with several web instances a
// phone gets each instance's allowance, which these limits accept.

/** One limit: at most `max` hits in any `windowMs`. */
export interface GuestLimit {
  readonly max: number
  readonly windowMs: number
}

/** The limits (D122 §4). */
export const GUEST_LIMITS = {
  /** Order additions (add, a raised quantity, restore) per phone. */
  additions: { max: 30, windowMs: 60_000 },
  /** One Send per 15 s per phone. */
  sendGap: { max: 1, windowMs: 15_000 },
  /** 10 Sends in 10 minutes per phone. */
  sends: { max: 10, windowMs: 10 * 60_000 },
  /** Requests that carry a position, per phone. */
  locationTries: { max: 5, windowMs: 10 * 60_000 },
  /** Every request of one table code. */
  codeRequests: { max: 20, windowMs: 1_000 },
} as const satisfies Record<string, GuestLimit>

/** The name of one limit. */
export type GuestLimitName = keyof typeof GUEST_LIMITS

/** How many keys the windows hold before they are swept. */
const MAX_KEYS = 50_000

/** A limit's answer: go, or wait this long. */
export type LimitAnswer =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterMs: number }

/** Sliding windows of hit times, keyed by limit and subject. */
export class GuestLimiter {
  private readonly hits = new Map<string, number[]>()

  /** `limits` other than D122's are for tests only. */
  constructor(private readonly limits: Record<GuestLimitName, GuestLimit> = GUEST_LIMITS) {}

  /**
   * Takes one hit from each named limit for `subject`, all or none: when any is full nothing is
   * counted and the answer says how long until the fullest frees a hit.
   */
  take(subject: string, names: readonly GuestLimitName[], now: number): LimitAnswer {
    let wait = 0
    const kept: [string, number[]][] = []
    for (const name of names) {
      const limit = this.limits[name]
      const key = `${name}:${subject}`
      const recent = (this.hits.get(key) ?? []).filter((at) => now - at < limit.windowMs)
      if (recent.length >= limit.max) {
        const oldest = recent[recent.length - limit.max] ?? now
        wait = Math.max(wait, oldest + limit.windowMs - now)
      }
      kept.push([key, recent])
    }
    if (wait > 0) {
      for (const [key, recent] of kept) this.store(key, recent, now)
      return { ok: false, retryAfterMs: wait }
    }
    for (const [key, recent] of kept) this.store(key, [...recent, now], now)
    return { ok: true }
  }

  /** Forgets everything (tests). */
  clear(): void {
    this.hits.clear()
  }

  private store(key: string, recent: number[], now: number): void {
    this.hits.set(key, recent)
    if (this.hits.size > MAX_KEYS) this.sweep(now)
  }

  /** Keeps the keys hit within the longest window; too many still, and it starts again. */
  private sweep(now: number): void {
    const longest = Math.max(...Object.values(this.limits).map((limit) => limit.windowMs))
    const fresh = [...this.hits].filter(([, times]) => {
      const last = times[times.length - 1]
      return last !== undefined && now - last < longest
    })
    this.hits.clear()
    if (fresh.length > MAX_KEYS / 2) return
    for (const [key, times] of fresh) this.hits.set(key, times)
  }
}
