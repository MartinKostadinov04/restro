import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  currentPlan,
  driftBetween,
  expectedSeconds,
  listSpecs,
  planShards,
  specFilesInList,
  TIMINGS_FILE,
  timingsFromReports,
} from './e2e-shards.mjs'

const seconds = (entries: Record<string, number>) => new Map(Object.entries(entries))

describe('planShards', () => {
  it('cuts the files, in order, where the time is shared best', () => {
    const specs = ['a', 'b', 'c', 'd', 'e', 'f']
    const plan = planShards(specs, seconds({ a: 60, b: 10, c: 10, d: 10, e: 25, f: 25 }), 3)
    expect(plan).toEqual([['a'], ['b', 'c', 'd'], ['e', 'f']])
  })

  it('does not let files with no time of their own take a shard each', () => {
    const specs = ['a', 'b', 'c', 'd']
    const plan = planShards(specs, seconds({ a: 0, b: 0, c: 100, d: 100 }), 2)
    expect(plan).toEqual([['a', 'b', 'c'], ['d']])
  })

  it('gives every spec to exactly one shard, in the order it came in', () => {
    const specs = Array.from({ length: 23 }, (_, index) => `s${String(index).padStart(2, '0')}`)
    const times = seconds(Object.fromEntries(specs.map((spec, index) => [spec, (index * 7) % 31])))
    for (const total of [1, 2, 4, 7, 23]) {
      const plan = planShards(specs, times, total)
      expect(plan).toHaveLength(total)
      expect(plan.every((shard) => shard.length > 0)).toBe(true)
      expect(plan.flat()).toEqual(specs)
    }
  })

  it('refuses a plan with fewer specs than shards', () => {
    expect(() => planShards(['a'], seconds({ a: 1 }), 2)).toThrow(/cannot fill/)
  })
})

describe('expectedSeconds', () => {
  it('counts a spec nobody has timed at the median of the others', () => {
    const { seconds: times, unmeasured } = expectedSeconds(['a', 'b', 'c', 'new'], {
      a: 10,
      b: 50,
      c: 30,
    })
    expect(times.get('new')).toBe(30)
    expect(unmeasured).toEqual(['new'])
  })
})

describe('timingsFromReports', () => {
  const result = (start: string, duration: number, status = 'passed') => ({
    startTime: start,
    duration,
    status,
  })
  const report = (...files: [string, ReturnType<typeof result>[]][]) => ({
    suites: files.map(([file, results]) => ({
      file,
      specs: [{ tests: results.map((one) => ({ results: [one] })) }],
    })),
  })

  it('times a file up to the start of the next one, so its hooks count', () => {
    const one = report(
      [
        'a.spec.ts',
        [result('2026-01-01T00:00:00.000Z', 1000), result('2026-01-01T00:00:02.000Z', 1000)],
      ],
      ['b.spec.ts', [result('2026-01-01T00:00:10.000Z', 5000)]],
    )
    expect(timingsFromReports([one])).toEqual({ 'a.spec.ts': 10, 'b.spec.ts': 5 })
  })

  it('leaves out a file that only skips, and takes the median of several reports', () => {
    const run = (hook: number) =>
      report(
        ['a.spec.ts', [result('2026-01-01T00:00:00.000Z', 1000)]],
        ['skips.spec.ts', [result('2026-01-01T00:00:01.000Z', 0, 'skipped')]],
        [
          'b.spec.ts',
          [result(`2026-01-01T00:00:${String(10 + hook).padStart(2, '0')}.000Z`, 1000)],
        ],
      )
    expect(timingsFromReports([run(0), run(2), run(8)])).toEqual({
      'a.spec.ts': 12,
      'b.spec.ts': 1,
    })
  })
})

describe('the check against what Playwright collects', () => {
  const list = {
    suites: [
      { file: 'a.spec.ts', specs: [{ tests: [] }] },
      {
        file: 'sub/b.spec.ts',
        specs: [],
        suites: [{ file: 'sub/b.spec.ts', specs: [{ tests: [] }] }],
      },
    ],
  }

  it('reads the files out of a --list json report, nested ones too', () => {
    expect(specFilesInList(list)).toEqual(['a.spec.ts', 'sub/b.spec.ts'])
  })

  it('is quiet when the plan and Playwright agree', () => {
    expect(driftBetween(['a.spec.ts', 'sub/b.spec.ts'], ['a.spec.ts', 'sub/b.spec.ts'])).toEqual([])
  })

  it('names a spec Playwright runs that no shard would', () => {
    expect(driftBetween(['a.spec.ts'], ['a.spec.ts', 'sub/b.spec.ts'])).toEqual([
      'sub/b.spec.ts: Playwright runs it, but no shard is planned to',
    ])
  })

  it('names a planned file Playwright does not collect', () => {
    expect(driftBetween(['a.spec.ts', 'typo.spec.ts'], ['a.spec.ts'])).toEqual([
      'typo.spec.ts: planned, but Playwright does not collect it',
    ])
  })
})

describe('the end-to-end suite as committed', () => {
  const specs = listSpecs()

  it('has a time for every spec, so the plan is the one that was measured', () => {
    const { seconds: measured } = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'))
    const missing = specs.filter((spec) => measured[spec] === undefined)
    // The plan still runs such a spec (at the median time); this is the reminder to time it.
    expect(
      missing,
      `No time yet for ${missing.join(', ')}: add each to scripts/e2e-shard-timings.json (a rough number of seconds will do until the next refresh, see scripts/e2e-shards.mjs).`,
    ).toEqual([])
  })

  it('runs every spec file in exactly one of the four shards', () => {
    expect(specs.length).toBeGreaterThan(40)
    expect(currentPlan(4).shards.flat()).toEqual(specs)
  })

  it('keeps the four shards within a fifth of each other', () => {
    const { shards, seconds: times } = currentPlan(4)
    const minutes = shards.map((files) =>
      files.reduce((sum, file) => sum + (times.get(file) ?? 0), 0),
    )
    const mean = minutes.reduce((sum, value) => sum + value, 0) / minutes.length
    expect(Math.max(...minutes)).toBeLessThan(mean * 1.2)
  })
})
