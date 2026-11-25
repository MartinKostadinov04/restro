import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  BREAKER,
  type BreakerEvent,
  type BreakerState,
  BreakerStateSchema,
  breakerGate,
  closedBreaker,
  probeDue,
  stepBreaker,
} from './breaker'

const S = 1000
const MIN = 60 * S
/** The middle of the jitter: every gap exactly as written. */
const mid = () => 0.5

/** Runs events at their times and returns the last state and every action. */
function run(
  events: readonly (readonly [number, BreakerEvent])[],
  state: BreakerState = closedBreaker(),
  random = mid,
) {
  const actions: { at: number; kind: string; cause?: string; unstable?: boolean }[] = []
  let current = state
  for (const [at, event] of events) {
    const step = stepBreaker(current, event, at, random)
    current = step.state
    for (const action of step.actions) actions.push({ at, ...action })
  }
  return { state: current, actions }
}

const fail = { kind: 'call', ok: false } as const
const ok = { kind: 'call', ok: true, elapsedMs: 200 } as const
const good = { kind: 'probe', outcome: 'good', cause: null } as const
const bad = { kind: 'probe', outcome: 'bad', cause: null } as const

/** A connection that trips at 60 s with three failed calls and returns its state. */
function tripped(at = 0) {
  return run([
    [at, fail],
    [at + 30 * S, fail],
    [at + 60 * S, fail],
  ])
}

/** Probes whenever one is due, until `until`, answering each with `answer(at)`. */
function probeUntil(
  state: BreakerState,
  from: number,
  until: number,
  answer: (at: number) => BreakerEvent,
  random = mid,
) {
  const actions: { at: number; kind: string; cause?: string; unstable?: boolean }[] = []
  let current = state
  const probes: number[] = []
  for (let at = from; at <= until; at += S) {
    const ticked = stepBreaker(current, { kind: 'tick' }, at, random)
    current = ticked.state
    for (const action of ticked.actions) actions.push({ at, ...action })
    if (!probeDue(current, at)) continue
    probes.push(at)
    const step = stepBreaker(current, answer(at), at, random)
    current = step.state
    for (const action of step.actions) actions.push({ at, ...action })
  }
  return { state: current, actions, probes }
}

describe('what starts a connection pause', () => {
  it('pauses when no call has succeeded for 60 s with at least 3 attempts', () => {
    const { state, actions } = tripped()
    expect(actions).toEqual([
      { at: 60 * S, kind: 'pause', cause: 'pos_unreachable', unstable: false },
    ])
    expect(breakerGate(state, 60 * S)).toBe('paused')
  })

  it('does not pause on three quick failures, nor on a minute with one good call', () => {
    expect(
      run([
        [0, fail],
        [S, fail],
        [2 * S, fail],
      ]).actions,
    ).toEqual([])
    expect(
      run([
        [0, fail],
        [20 * S, fail],
        [40 * S, ok],
        [50 * S, fail],
        [70 * S, fail],
        [80 * S, fail],
      ]).actions,
    ).toEqual([])
  })

  it('pauses on the tick once a failing minute has passed', () => {
    const { actions } = run([
      [0, fail],
      [10 * S, fail],
      [20 * S, fail],
      [59 * S, { kind: 'tick' }],
      [60 * S, { kind: 'tick' }],
    ])
    expect(actions.map((a) => [a.at, a.kind])).toEqual([[60 * S, 'pause']])
  })

  it('pauses at once on a refusal scoped to the login or the venue', () => {
    const { state, actions } = run([[0, { kind: 'refused', cause: 'credentials' }]])
    expect(actions).toEqual([{ at: 0, kind: 'pause', cause: 'credentials', unstable: false }])
    // After a refusal the probes are gentle: 60 s, then 2 min, then 5 min.
    expect(state.open?.nextProbeAt).toBe(60 * S)
  })

  it('pauses at once when a probe finds training mode or the fiscal device out', () => {
    for (const cause of ['training_mode', 'fiscal_device']) {
      const { actions } = run([[0, { kind: 'probe', outcome: 'refused', cause }]])
      expect(actions).toEqual([{ at: 0, kind: 'pause', cause, unstable: false }])
    }
  })

  it('pauses on 3 Unconfirmed sent orders at different tables within 10 minutes', () => {
    const same = run([
      [0, { kind: 'unconfirmed', tableId: 'tb_1' }],
      [MIN, { kind: 'unconfirmed', tableId: 'tb_1' }],
      [2 * MIN, { kind: 'unconfirmed', tableId: 'tb_2' }],
    ])
    expect(same.actions).toEqual([])
    const spread = run([
      [0, { kind: 'unconfirmed', tableId: 'tb_1' }],
      [5 * MIN, { kind: 'unconfirmed', tableId: 'tb_2' }],
      [11 * MIN, { kind: 'unconfirmed', tableId: 'tb_3' }],
    ])
    expect(spread.actions).toEqual([])
    const three = run([
      [0, { kind: 'unconfirmed', tableId: 'tb_1' }],
      [5 * MIN, { kind: 'unconfirmed', tableId: 'tb_2' }],
      [9 * MIN, { kind: 'unconfirmed', tableId: 'tb_3' }],
    ])
    expect(three.actions).toEqual([
      { at: 9 * MIN, kind: 'pause', cause: 'unconfirmed_orders', unstable: false },
    ])
  })
})

describe('how it lifts', () => {
  it('probes at 15, 30, then every 60 s while failing, each with ±20 % jitter', () => {
    const paused = tripped().state
    const { probes } = probeUntil(paused, 60 * S, 60 * S + 5 * MIN, () => bad)
    const gaps = probes.map((at, i) => at - (i === 0 ? 60 * S : (probes[i - 1] as number)))
    expect(gaps.slice(0, 4)).toEqual([15 * S, 30 * S, 60 * S, 60 * S])

    const trip = [
      [0, fail],
      [30 * S, fail],
      [60 * S, fail],
    ] as const
    for (const [r, first] of [
      [0, 72 * S],
      [0.999, 78 * S],
    ] as const) {
      const state = run(trip, closedBreaker(), () => r).state
      const probes = probeUntil(
        state,
        60 * S,
        60 * S + 3 * MIN,
        () => bad,
        () => r,
      ).probes
      expect(Math.abs((probes[0] as number) - first)).toBeLessThanOrEqual(S)
    }
  })

  it('lifts after 3 good probes in a row, 15 s apart, never before 60 s', () => {
    const paused = tripped().state
    const { actions, probes } = probeUntil(paused, 60 * S, 60 * S + 3 * MIN, () => good)
    // 15 s, then 15 s, then 15 s: the third good probe is 45 s in, the minimum is 60 s.
    expect(probes.slice(0, 4)).toEqual([75 * S, 90 * S, 105 * S, 120 * S])
    expect(actions.filter((a) => a.kind === 'lift')).toEqual([{ at: 120 * S, kind: 'lift' }])
  })

  it('goes back to the failing gaps after one bad probe', () => {
    const paused = tripped().state
    let n = 0
    const { probes, actions } = probeUntil(paused, 60 * S, 60 * S + 3 * MIN, () =>
      n++ === 1 ? bad : good,
    )
    // good at 75, bad at 90, then 15 s again (step 4 restarts), good, good, good.
    expect(probes.slice(0, 5)).toEqual([75 * S, 90 * S, 105 * S, 120 * S, 135 * S])
    expect(actions.find((a) => a.kind === 'lift')?.at).toBe(135 * S)
  })

  it('backs off 60 s, 2 min, then 5 min after a refusal', () => {
    const paused = run([[0, { kind: 'refused', cause: 'period_closed' }]]).state
    const refusal = { kind: 'probe', outcome: 'refused', cause: 'period_closed' } as const
    const { probes } = probeUntil(paused, 0, 15 * MIN, () => refusal)
    expect(probes.slice(0, 4)).toEqual([MIN, 3 * MIN, 8 * MIN, 13 * MIN])
  })

  it('a good read-back while a probe is due counts as that probe', () => {
    const paused = tripped().state
    const counted = stepBreaker(paused, ok, 76 * S, mid).state
    expect(counted.open?.goodInRow).toBe(1)
    const early = stepBreaker(paused, ok, 70 * S, mid).state
    expect(early.open?.goodInRow).toBe(0)
    const slow = stepBreaker(paused, { kind: 'call', ok: true, elapsedMs: 4000 }, 76 * S, mid)
    expect(slow.state.open?.goodInRow).toBe(0)
  })

  it('never lifts on failed calls, slow calls or ticks', () => {
    const paused = tripped().state
    const slow = { kind: 'call', ok: true, elapsedMs: 5000 } as const
    const { actions } = run(
      Array.from(
        { length: 60 },
        (_, i) => [60 * S + i * 10 * S, [fail, slow, { kind: 'tick' } as const][i % 3]] as const,
      ) as unknown as readonly (readonly [number, BreakerEvent])[],
      paused,
    )
    expect(actions).toEqual([])
  })
})

describe('the five-minute watch after a lift', () => {
  function lifted() {
    const paused = tripped().state
    const run1 = probeUntil(paused, 60 * S, 120 * S, () => good)
    expect(run1.actions.at(-1)?.kind).toBe('lift')
    return run1.state
  }

  it('keeps probing every 15 s, then stops', () => {
    const { probes } = probeUntil(lifted(), 121 * S, 120 * S + 8 * MIN, () => good)
    expect(probes[0]).toBe(135 * S)
    expect(probes.at(-1)).toBeLessThan(120 * S + 5 * MIN)
    expect(probes.length).toBe(19)
  })

  it('pauses again at once on one Unconfirmed order', () => {
    const { actions } = run([[3 * MIN, { kind: 'unconfirmed', tableId: 'tb_1' }]], lifted())
    expect(actions).toEqual([
      { at: 3 * MIN, kind: 'pause', cause: 'unconfirmed_orders', unstable: false },
    ])
  })

  it('pauses again on 2 failed calls in a row, not on one', () => {
    expect(
      run(
        [
          [3 * MIN, fail],
          [3 * MIN + S, ok],
          [3 * MIN + 2 * S, fail],
        ],
        lifted(),
      ).actions,
    ).toEqual([])
    expect(
      run(
        [
          [3 * MIN, fail],
          [3 * MIN + S, fail],
        ],
        lifted(),
      ).actions,
    ).toEqual([{ at: 3 * MIN + S, kind: 'pause', cause: 'pos_unreachable', unstable: false }])
  })

  it('after the watch, one failure is only one failure', () => {
    expect(
      run(
        [
          [8 * MIN, fail],
          [8 * MIN + S, fail],
        ],
        lifted(),
      ).actions,
    ).toEqual([])
  })
})

describe('the third automatic pause within 30 minutes', () => {
  it('holds at least 10 minutes and says the connection is unstable', () => {
    let state = closedBreaker()
    const starts: number[] = []
    let at = 0
    for (let pause = 0; pause < 3; pause++) {
      const step = stepBreaker(state, { kind: 'refused', cause: 'credentials' }, at, mid)
      state = step.state
      starts.push(at)
      const action = step.actions[0]
      expect(action?.kind).toBe('pause')
      if (pause < 2) {
        expect(action).toMatchObject({ unstable: false })
        const lift = probeUntil(state, at, at + 10 * MIN, () => good)
        at = lift.actions.find((a) => a.kind === 'lift')?.at ?? Number.NaN
        state = lift.state
        at += 6 * MIN
        state = stepBreaker(state, { kind: 'tick' }, at, mid).state
      } else {
        expect(action).toMatchObject({ unstable: true })
      }
    }
    const held = probeUntil(state, at, at + 15 * MIN, () => good)
    expect(held.actions.find((a) => a.kind === 'lift')?.at).toBeGreaterThanOrEqual(at + 10 * MIN)
  })

  it('forgets pauses older than 30 minutes', () => {
    const state = BreakerStateSchema.parse({
      ...closedBreaker(),
      autoPauses: [0, 5 * MIN],
    })
    const step = stepBreaker(state, { kind: 'refused', cause: 'credentials' }, 31 * MIN, mid)
    expect(step.actions[0]).toMatchObject({ unstable: false })
  })
})

describe('after a write timeout', () => {
  it('holds the next order until a good probe, and asks for one at once', () => {
    const held = run([[10 * S, { kind: 'write_timeout' }]]).state
    expect(breakerGate(held, 10 * S)).toBe('hold')
    expect(probeDue(held, 10 * S)).toBe(true)
    const stillHeld = stepBreaker(held, bad, 10 * S, mid).state
    expect(breakerGate(stillHeld, 11 * S)).toBe('hold')
    const free = stepBreaker(stillHeld, good, 25 * S, mid).state
    expect(breakerGate(free, 25 * S)).toBe('open')
    expect(probeDue(free, 25 * S)).toBe(false)
  })
})

describe('the state', () => {
  it('round-trips through JSON (it lives on the pause row across a restart)', () => {
    const paused = probeUntil(tripped().state, 60 * S, 100 * S, () => good).state
    const restored = BreakerStateSchema.parse(JSON.parse(JSON.stringify(paused)))
    expect(restored).toEqual(paused)
  })

  it('never lifts without 3 good probes in a row and never before its hold (property)', () => {
    const event = fc.oneof(
      fc.constant(fail),
      fc.constant(ok),
      fc.constant(good),
      fc.constant(bad),
      fc.constant({ kind: 'write_timeout' } as const),
      fc.constant({ kind: 'tick' } as const),
      fc.constant({ kind: 'refused', cause: 'credentials' } as const),
      fc
        .constantFrom('tb_1', 'tb_2', 'tb_3')
        .map((tableId) => ({ kind: 'unconfirmed', tableId }) as const),
    )
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 40 * S }), event), { maxLength: 120 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (steps, r) => {
          let state = closedBreaker()
          let at = 0
          let goodInRow = 0
          for (const [gap, next] of steps) {
            at += gap
            const before = state
            const step = stepBreaker(state, next, at, () => r)
            state = step.state
            BreakerStateSchema.parse(state)
            const counted =
              before.open !== null &&
              ((next.kind === 'probe' && next.outcome === 'good') ||
                (next.kind === 'call' && next.ok && at >= before.open.nextProbeAt))
            if (before.open === null) goodInRow = 0
            else if (counted) goodInRow += 1
            else if (next.kind === 'probe' || next.kind === 'refused') goodInRow = 0
            for (const action of step.actions) {
              if (action.kind !== 'lift') continue
              expect(before.open).not.toBeNull()
              expect(goodInRow).toBeGreaterThanOrEqual(BREAKER.goodProbesToLift)
              expect(at).toBeGreaterThanOrEqual(before.open?.holdUntil ?? Number.POSITIVE_INFINITY)
            }
            if (step.actions.some((a) => a.kind === 'lift')) goodInRow = 0
          }
        },
      ),
    )
  })
})
