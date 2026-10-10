import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { LINK_STATES, LINK_TRANSITIONS, type LinkStateName } from '../change-set'
import {
  concludeFullPull,
  type FullPullEvidence,
  MISSING_TO_DELETED_AFTER_DAYS,
  type PulledLink,
} from './conclude-full-pull'

const NOW = new Date('2026-10-09T12:00:00+03:00')
const HOUR = 60 * 60 * 1000
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR)
const link = (key: string, state: LinkStateName, hoursAgo = 1): PulledLink => ({
  key,
  state,
  stateChangedAt: ago(hoursAgo),
})

function evidence(overrides: Partial<FullPullEvidence> = {}): FullPullEvidence {
  return {
    pagesOk: [true, true],
    seen: new Set(),
    links: [],
    deletedSeen: new Set(),
    now: NOW,
    ...overrides,
  }
}

describe('concludeFullPull: a complete pull', () => {
  it('moves absent active links to missing and brings seen ones back', () => {
    const result = concludeFullPull(
      evidence({
        seen: new Set(['article:2', 'article:3', 'article:4', 'article:99']),
        links: [
          link('article:1', 'active'),
          link('article:2', 'active'),
          link('article:3', 'missing'),
          link('article:4', 'deleted', 24 * 400),
        ],
      }),
    )
    expect(result).toEqual({
      complete: true,
      changes: [
        { key: 'article:1', to: 'missing' },
        { key: 'article:3', to: 'active' },
        { key: 'article:4', to: 'active' },
      ],
    })
  })

  it('deletes a link missing for 7 days or more, not one day earlier; a deleted absent link stays', () => {
    const days = MISSING_TO_DELETED_AFTER_DAYS
    expect(days).toBe(7)
    const result = concludeFullPull(
      evidence({
        links: [
          link('a', 'missing', 24 * days),
          link('b', 'missing', 24 * days - 1),
          link('c', 'missing', 24 * days + 5),
          link('d', 'deleted', 24 * 100),
        ],
      }),
    )
    expect(result.changes).toEqual([
      { key: 'a', to: 'deleted' },
      { key: 'c', to: 'deleted' },
    ])
    const custom = concludeFullPull(
      evidence({ links: [link('b', 'missing', 25)], missingToDeletedAfterDays: 1 }),
    )
    expect(custom.changes).toEqual([{ key: 'b', to: 'deleted' }])
  })

  it('deletes what the source reports deleted (delete_flag), from active or missing', () => {
    const result = concludeFullPull(
      evidence({
        deletedSeen: new Set(['x', 'y', 'z', 'unknown']),
        links: [link('x', 'active'), link('y', 'missing'), link('z', 'deleted')],
      }),
    )
    expect(result.changes).toEqual([
      { key: 'x', to: 'deleted' },
      { key: 'y', to: 'deleted' },
    ])
  })
})

describe('concludeFullPull: an incomplete pull concludes nothing about absence (rule 6)', () => {
  const links = [
    link('active-absent', 'active'),
    link('missing-old', 'missing', 24 * 30),
    link('missing-seen', 'missing'),
    link('deleted-seen', 'deleted'),
    link('flagged', 'active'),
  ]
  const seen = new Set(['missing-seen', 'deleted-seen'])
  const deletedSeen = new Set(['flagged'])

  it.each([
    ['one failed page', [true, false, true]],
    ['every page failed', [false]],
    ['no page at all', []],
  ])('%s: only seen links come back; nothing goes missing or deleted', (_, pagesOk) => {
    expect(concludeFullPull(evidence({ pagesOk, links, seen, deletedSeen }))).toEqual({
      complete: false,
      changes: [
        { key: 'deleted-seen', to: 'active' },
        { key: 'missing-seen', to: 'active' },
      ],
    })
  })
})

describe('concludeFullPull: caller bugs throw (the pull then concludes nothing)', () => {
  it('refuses a duplicate key, a key both seen and reported deleted, and bad numbers', () => {
    expect(() =>
      concludeFullPull(evidence({ links: [link('a', 'active'), link('a', 'missing')] })),
    ).toThrow(TypeError)
    expect(() =>
      concludeFullPull(evidence({ seen: new Set(['a']), deletedSeen: new Set(['a']) })),
    ).toThrow(/both seen and reported deleted/)
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => concludeFullPull(evidence({ missingToDeletedAfterDays: days }))).toThrow(
        TypeError,
      )
    }
    expect(() => concludeFullPull(evidence({ now: new Date('nope') }))).toThrow(TypeError)
  })
})

// --- properties ---------------------------------------------------------------------------

const KEYS = Array.from({ length: 10 }, (_, index) => `article:${index}`)

interface Case {
  readonly pagesOk: boolean[]
  readonly links: PulledLink[]
  readonly seen: string[]
  readonly deletedSeen: string[]
  readonly days: number | undefined
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    pagesOk: fc.array(fc.boolean(), { maxLength: 6 }),
    links: fc.uniqueArray(
      fc.record({
        key: fc.constantFrom(...KEYS),
        state: fc.constantFrom(...LINK_STATES),
        // From two days in the future (clock skew) to 20 days ago.
        hoursAgo: fc.integer({ min: -48, max: 24 * 20 }),
      }),
      { selector: (entry) => entry.key, maxLength: KEYS.length },
    ),
    // Each key: not mentioned, seen, or reported deleted (the mapper's intents never overlap).
    verdicts: fc.array(fc.constantFrom('none', 'seen', 'deleted'), {
      minLength: KEYS.length,
      maxLength: KEYS.length,
    }),
    days: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  })
  .map(({ pagesOk, links, verdicts, days }) => ({
    pagesOk,
    links: links.map((entry) => link(entry.key, entry.state, entry.hoursAgo)),
    seen: KEYS.filter((_, index) => verdicts[index] === 'seen'),
    deletedSeen: KEYS.filter((_, index) => verdicts[index] === 'deleted'),
    days,
  }))

const run = (c: Case, order: (keys: string[]) => string[] = (keys) => keys) =>
  concludeFullPull({
    pagesOk: c.pagesOk,
    links: c.links,
    seen: new Set(order(c.seen)),
    deletedSeen: new Set(order(c.deletedSeen)),
    now: NOW,
    ...(c.days === undefined ? {} : { missingToDeletedAfterDays: c.days }),
  })

/** The links after the changes are applied (a moved link's state_changed_at becomes now). */
function applied(c: Case, changes: readonly { key: string; to: LinkStateName }[]): PulledLink[] {
  const moves = new Map(changes.map((change) => [change.key, change.to]))
  return c.links.map((entry) => {
    const to = moves.get(entry.key)
    return to === undefined ? entry : { key: entry.key, state: to, stateChangedAt: NOW }
  })
}

describe('concludeFullPull properties (fast-check)', () => {
  it('any failed page ⇒ no link ever moves to missing or deleted', () => {
    fc.assert(
      fc.property(caseArb, fc.nat(), (c, at) => {
        const pagesOk = [...c.pagesOk]
        pagesOk.splice(at % (pagesOk.length + 1), 0, false)
        const result = run({ ...c, pagesOk })
        expect(result.complete).toBe(false)
        for (const change of result.changes) expect(change.to).toBe('active')
      }),
      { numRuns: 300 },
    )
  })

  it('complete is true exactly when there is a page and every page succeeded', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        expect(run(c).complete).toBe(c.pagesOk.length > 0 && c.pagesOk.every(Boolean))
      }),
      { numRuns: 300 },
    )
  })

  it('a seen key never ends missing', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const after = applied(c, run(c).changes)
        for (const entry of after) {
          if (c.seen.includes(entry.key)) expect(entry.state).not.toBe('missing')
        }
      }),
      { numRuns: 300 },
    )
  })

  it('every change is a move of the Link lifecycle, on a known link, sorted by key', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { changes } = run(c)
        const states = new Map(c.links.map((entry) => [entry.key, entry.state]))
        const keys = changes.map((change) => change.key)
        expect(keys).toEqual([...keys].sort())
        expect(new Set(keys).size).toBe(keys.length)
        for (const change of changes) {
          const from = states.get(change.key)
          expect(from).toBeDefined()
          expect(LINK_TRANSITIONS[from as LinkStateName]).toContain(change.to)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('the output does not depend on the order of the links or of the seen sets', () => {
    fc.assert(
      fc.property(caseArb, fc.integer(), (c, seed) => {
        const shuffle = <T>(items: readonly T[]): T[] => {
          const copy = [...items]
          let state = seed
          for (let i = copy.length - 1; i > 0; i -= 1) {
            state = (state * 1103515245 + 12345) & 0x7fffffff
            const j = state % (i + 1)
            ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
          }
          return copy
        }
        expect(run({ ...c, links: shuffle(c.links) }, shuffle)).toEqual(run(c))
      }),
      { numRuns: 300 },
    )
  })

  it('applying the result twice changes nothing', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const first = run(c)
        const second = run({ ...c, links: applied(c, first.changes) })
        expect(second.changes).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})
