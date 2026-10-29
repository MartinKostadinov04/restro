// Fault plans (#51 design §2.6). A plan is a list of rules: from the n-th call of a method (or of
// any read, any write, any call), optionally of one login, apply a fault. Plans are deterministic.
// Chaos mode draws faults at a rate from a seeded random source and prints its seed, so a failing
// soak run can be replayed with the same seed.

import type { SimMethod } from './calls'
import { type Random, seededRandom } from './random'

/** The refusals a fault can force (Q33's rights among them). */
export type ForcedRefusal =
  | 'bill_closed'
  | 'bill_locked'
  | 'no_rights'
  | 'busy'
  | 'article_unknown'
  | 'sold_out'
  | 'credentials'

export type SimFault =
  /** Times out before landing: nothing applies and the answer never comes. */
  | { readonly kind: 'hang' }
  /** Lands, then times out: the call applies and the answer never comes (D115's central case). */
  | { readonly kind: 'landsThenHangs' }
  /** Only a prefix of the rows lands, then it times out. Needs `addIsAllOrNothing` off (Q15). */
  | { readonly kind: 'landsPartly'; readonly rows?: number }
  /** Lands after `lateLandingMs` on the engine's clock; the answer never comes. */
  | { readonly kind: 'landsLate' }
  /** The call fails with an error answer (500). */
  | { readonly kind: 'fail' }
  /** A partial read: a list answers one item fewer than its stated total. */
  | { readonly kind: 'dropItem' }
  /** A definite refusal, whatever the state. */
  | { readonly kind: 'refuse'; readonly code: ForcedRefusal; readonly line?: number }
  /** A slow answer: a fixed delay, or one drawn from the plan's seeded source. */
  | { readonly kind: 'slow'; readonly ms: number | { readonly min: number; readonly max: number } }
  /** The calling login goes offline from this call on (every call fails until it is back). */
  | { readonly kind: 'loginOffline' }
  /**
   * A waiter's round slips in on the call's bill before the call: `identical` copies the call's
   * own rows (or the bill's first row), else one row of the first article.
   */
  | { readonly kind: 'waiterRoundSlipsIn'; readonly identical: boolean }
  /** A waiter voids the last row of the call's bill before the call. */
  | { readonly kind: 'waiterVoidsLine' }
  /** A waiter closes the call's bill (or the named one) in cash before the call. */
  | { readonly kind: 'waiterClosesBill'; readonly bill?: string }
  /** The fiscal printer fails on this call (a close). */
  | { readonly kind: 'noReceipt' }

export type FaultKind = SimFault['kind']

export interface FaultRule {
  /** Which calls count: a method, any read, any write, or any call. */
  readonly on: SimMethod | 'read' | 'write' | 'any'
  /** The first matching call it applies to (1-based, counted from when the rule was added). */
  readonly from?: number
  /** How many matching calls it applies to from then on. Default 1; `Infinity` for all. */
  readonly times?: number
  /** Only calls of this login count. */
  readonly login?: string
  readonly fault: SimFault
}

export interface ChaosOptions {
  readonly seed: number
  /** The chance of a fault on any call, in [0, 1]. */
  readonly rate: number
  /** The faults to draw from. */
  readonly faults: readonly SimFault[]
  /** Where the seed is printed. Default: the console. */
  readonly print?: (line: string) => void
}

interface ActiveRule {
  readonly rule: FaultRule
  seen: number
  applied: number
}

export interface CallFacts {
  readonly method: SimMethod
  readonly read: boolean
  readonly login: string
}

export class FaultPlan {
  #rules: ActiveRule[] = []
  #chaos: { readonly options: ChaosOptions; readonly random: Random } | null = null

  add(...rules: readonly FaultRule[]): void {
    for (const rule of rules) this.#rules.push({ rule, seen: 0, applied: 0 })
  }

  /** Switches chaos on and prints its seed. */
  chaos(options: ChaosOptions): void {
    if (!(options.rate >= 0 && options.rate <= 1)) throw new Error('chaos rate is in [0, 1]')
    if (options.faults.length === 0) throw new Error('chaos needs faults to draw from')
    const print = options.print ?? ((line: string) => console.info(line))
    print(`sim-pos chaos seed ${options.seed}`)
    this.#chaos = { options, random: seededRandom(options.seed) }
  }

  get chaosSeed(): number | null {
    return this.#chaos?.options.seed ?? null
  }

  clear(): void {
    this.#rules = []
    this.#chaos = null
  }

  /** The faults for this call: every rule that matches it, in the order added, then chaos. */
  next(call: CallFacts): SimFault[] {
    const faults: SimFault[] = []
    for (const active of this.#rules) {
      const { rule } = active
      if (!matches(rule, call)) continue
      active.seen += 1
      if (active.seen >= (rule.from ?? 1) && active.applied < (rule.times ?? 1)) {
        active.applied += 1
        faults.push(rule.fault)
      }
    }
    if (this.#chaos !== null) {
      const { options, random } = this.#chaos
      if (random.next() < options.rate) {
        const fault = options.faults[random.int(0, options.faults.length - 1)]
        if (fault !== undefined) faults.push(fault)
      }
    }
    return faults
  }

  /** A slow fault's delay in milliseconds: fixed, or drawn from the seeded source. */
  delayOf(fault: Extract<SimFault, { kind: 'slow' }>, fallback: Random): number {
    if (typeof fault.ms === 'number') return fault.ms
    return (this.#chaos?.random ?? fallback).int(fault.ms.min, fault.ms.max)
  }
}

function matches(rule: FaultRule, call: CallFacts): boolean {
  if (rule.login !== undefined && rule.login !== call.login) return false
  if (rule.on === 'any') return true
  if (rule.on === 'read') return call.read
  if (rule.on === 'write') return !call.read
  return rule.on === call.method
}
