// The bad-code limiter of `/t/<code>` (D122 §9, ticket #70): a guard against guessing table codes.
// A code carries at least 128 random bits, so guessing cannot succeed; the limiter keeps a network
// from trying at volume. Counts per network over a sliding 10 minutes:
//   - 20 wrong codes: Turnstile is required (`turnstile`);
//   - 50 wrong codes: the network is blocked for 15 minutes (`blocked`, a 429), logged once.
// The numbers are D122's. A wrong code is one that is malformed or has no published file.
//
// The network is the client's address as the edge saw it (`clientNetwork`): Cloudflare's
// `CF-Connecting-IP` (Cloudflare sets it and overwrites one a client sends), else `X-Real-IP` (set
// by Railway's edge), else the LAST `X-Forwarded-For` entry (the one our own proxy appended; the
// first is whatever the client claimed). An IPv6 address counts by its /64, the block one
// subscriber gets, as Cloudflare's own rate limiting does. The address is never logged.
//
// State lives in this process (one web instance at pilot scale, stack.md), bounded to the 10,000
// networks seen last: an attacker with more networks than that only resets the oldest counts. A
// second instance would need a shared store (open question in the PR).

/** D122's numbers. */
export const BAD_CODE_LIMITS = {
  /** The sliding window wrong codes are counted over. */
  windowMs: 10 * 60_000,
  /** From this many wrong codes in the window, Turnstile is required. */
  turnstileAfter: 20,
  /** At this many wrong codes in the window, the network is blocked. */
  blockAfter: 50,
  /** How long a block lasts. */
  blockMs: 15 * 60_000,
  /** How many networks are remembered (the least recently seen are forgotten first). */
  maxNetworks: 10_000,
} as const

export type BadCodeLimits = { readonly [K in keyof typeof BAD_CODE_LIMITS]: number }

/** What a network may do now. */
export type BadCodeVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'turnstile' }
  | { readonly kind: 'blocked'; readonly retryAfterSeconds: number }

interface NetworkState {
  /** When each wrong code in the window came, oldest first (at most `blockAfter`). */
  wrong: number[]
  /** Until when the network is blocked, or 0. */
  blockedUntil: number
}

const OK: BadCodeVerdict = { kind: 'ok' }

export class BadCodeLimiter {
  private readonly networks = new Map<string, NetworkState>()

  constructor(
    private readonly limits: BadCodeLimits = BAD_CODE_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** What the network may do before its code is looked up. */
  check(network: string): BadCodeVerdict {
    const state = this.networks.get(network)
    return state === undefined ? OK : this.verdict(state, this.now())
  }

  /**
   * Counts a wrong code. `turnstileNow` and `blockedNow` are true only for the code that crossed
   * that line, so the caller logs (and later alerts) once each time.
   */
  recordWrong(network: string): {
    readonly verdict: BadCodeVerdict
    readonly turnstileNow: boolean
    readonly blockedNow: boolean
  } {
    const at = this.now()
    const state = this.touch(network)
    if (state.blockedUntil > at) {
      return { verdict: this.verdict(state, at), turnstileNow: false, blockedNow: false }
    }
    this.prune(state, at)
    state.wrong.push(at)
    const turnstileNow = state.wrong.length === this.limits.turnstileAfter
    const blockedNow = state.wrong.length >= this.limits.blockAfter
    if (blockedNow) {
      state.blockedUntil = at + this.limits.blockMs
      state.wrong = []
    }
    return { verdict: this.verdict(state, at), turnstileNow, blockedNow }
  }

  /** How many networks are remembered (tests). */
  get size(): number {
    return this.networks.size
  }

  private verdict(state: NetworkState, at: number): BadCodeVerdict {
    if (state.blockedUntil > at) {
      return { kind: 'blocked', retryAfterSeconds: Math.ceil((state.blockedUntil - at) / 1000) }
    }
    this.prune(state, at)
    return state.wrong.length >= this.limits.turnstileAfter ? { kind: 'turnstile' } : OK
  }

  private prune(state: NetworkState, at: number): void {
    const from = at - this.limits.windowMs
    let first = 0
    while (first < state.wrong.length && (state.wrong[first] ?? 0) <= from) first += 1
    if (first > 0) state.wrong = state.wrong.slice(first)
  }

  /** The network's state, moved to the newest end; the oldest network goes when the map is full. */
  private touch(network: string): NetworkState {
    const state = this.networks.get(network) ?? { wrong: [], blockedUntil: 0 }
    this.networks.delete(network)
    this.networks.set(network, state)
    if (this.networks.size > this.limits.maxNetworks) {
      const oldest = this.networks.keys().next().value
      if (oldest !== undefined) this.networks.delete(oldest)
    }
    return state
  }
}

/** An IPv4 address as it is; an IPv6 address by its first four groups (/64). */
export function networkOf(address: string): string {
  const ip = address.trim().replace(/^\[|\](:\d+)?$/g, '')
  if (!ip.includes(':')) return ip
  // An IPv4 address written as IPv6 (`::ffff:203.0.113.7`) is the IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped?.[1] !== undefined) return mapped[1]
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === '' ? [] : tail.split(':')
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/** The network a request comes from (see the top of this file), or `unknown`. */
export function clientNetwork(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)
  const address =
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    forwarded?.trim() ||
    ''
  return address === '' ? 'unknown' : networkOf(address)
}

/** The limiter of this process. */
export const badCodes = new BadCodeLimiter()
