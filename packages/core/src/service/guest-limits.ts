// The guest API's request limits kept in memory (D122 §4, design §7; ticket #76):
// - per phone, by the random value the page makes at load (never stored, forgotten within minutes,
//   so one person can't block the friends at their table): 30 additions a minute, one Send per
//   15 s, 10 Sends in 10 minutes, 5 location tries in 10 minutes, one Pay per 15 s and 5 in 10
//   minutes (#110), and one payment that isn't final (`openPayment`);
// - a Send counts only when it goes out (RR-26): `guestAct` takes its hits first, so two Sends at
//   once still can't both pass, and gives them back when the Send is refused, or when the phone's
//   last Send came back Not sent. A failed human check spends none of them: it has its own limit,
//   `humanFails`, taken before siteverify;
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
  /** One Pay per 15 s per phone (design §9). */
  payGap: { max: 1, windowMs: 15_000 },
  /** 5 Pays in 10 minutes per phone. */
  pays: { max: 5, windowMs: 10 * 60_000 },
  /**
   * Failed human checks at Send per phone: as many as the 10 Sends in 10 minutes that used to stop
   * them, now that a refused Send spends no Send (RR-26).
   */
  humanFails: { max: 10, windowMs: 10 * 60_000 },
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

/** The sent order a phone's last Send made, and the time its hits were taken at. */
export interface LastSend {
  readonly sentOrderId: string
  readonly at: number
}

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

  /**
   * Gives back the hits `take` made at `at`, because what they were for did not happen. Gives back
   * nothing when they are gone already, so a second give-back of the same hits frees no other.
   */
  giveBack(subject: string, names: readonly GuestLimitName[], at: number): void {
    for (const name of names) {
      const key = `${name}:${subject}`
      const times = this.hits.get(key)
      const index = times?.lastIndexOf(at) ?? -1
      if (times !== undefined && index >= 0) {
        this.hits.set(
          key,
          times.filter((_, position) => position !== index),
        )
      }
    }
  }

  /** The phone's last Send that went out, and when its hits were taken, by the phone's key. */
  private readonly lastSends = new Map<string, LastSend | null>()

  /** The sent order this phone's last Send made, or null. */
  lastSend(subject: string): LastSend | null {
    return this.lastSends.get(subject) ?? null
  }

  /** Remembers the phone's last Send; whether it came back is read from the database. */
  setLastSend(subject: string, send: LastSend): void {
    // Bounded like the windows: forgetting one costs a phone at most one wait of 15 s.
    if (this.lastSends.size >= MAX_KEYS) this.lastSends.clear()
    this.lastSends.set(subject, send)
  }

  /** Forgets the phone's last Send: its hits were given back. */
  forgetLastSend(subject: string): void {
    this.lastSends.set(subject, null)
  }

  /** The phone's payment that may not be final yet, by the phone's key (design §9: one each). */
  private readonly payments = new Map<string, string>()

  /** The payment this phone started last, while it may still be open. */
  openPayment(subject: string): string | null {
    return this.payments.get(subject) ?? null
  }

  /** Remembers the phone's latest payment; whether it is final is read from the database. */
  setOpenPayment(subject: string, paymentId: string): void {
    // Bounded like the windows: forgetting one costs a phone at most a second open payment.
    if (this.payments.size >= MAX_KEYS) this.payments.clear()
    this.payments.set(subject, paymentId)
  }

  /** Forgets everything (tests). */
  clear(): void {
    this.hits.clear()
    this.lastSends.clear()
    this.payments.clear()
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
