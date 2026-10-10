import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decide, isFrozen, OVERRIDE_LABEL, sofiaTime } from './freeze-window.mjs'

// All instants are written in UTC (the trailing Z) so the tests do not depend on the
// machine's own time zone. The local Sofia time is in the comment on each row.
// Europe/Sofia is UTC+3 in summer (EEST) and UTC+2 in winter (EET).
// 2026 clock changes: Sun 29 March 04:00 -> clocks forward; Sun 25 October 04:00 -> back.

const frozen = (iso: string) => isFrozen(new Date(iso))

describe('freeze window edges (summer time, UTC+3)', () => {
  it('Thu 17:59 passes, Thu 18:00 is frozen', () => {
    expect(frozen('2026-10-08T14:59:00Z')).toBe(false) // Thu 17:59
    expect(frozen('2026-10-08T15:00:00Z')).toBe(true) // Thu 18:00
  })

  it('Mon 07:59 is frozen, Mon 08:00 passes', () => {
    expect(frozen('2026-10-12T04:59:00Z')).toBe(true) // Mon 07:59
    expect(frozen('2026-10-12T05:00:00Z')).toBe(false) // Mon 08:00
  })

  it('Wed 23:00 passes', () => {
    expect(frozen('2026-10-07T20:00:00Z')).toBe(false) // Wed 23:00
  })

  it('Wednesday night into Thursday morning is not frozen', () => {
    expect(frozen('2026-10-07T21:30:00Z')).toBe(false) // Thu 00:30
    expect(frozen('2026-10-08T04:59:00Z')).toBe(false) // Thu 07:59
  })

  it('Thursday night into Friday morning is frozen until 08:00', () => {
    expect(frozen('2026-10-08T20:59:00Z')).toBe(true) // Thu 23:59
    expect(frozen('2026-10-08T21:00:00Z')).toBe(true) // Fri 00:00
    expect(frozen('2026-10-09T04:59:00Z')).toBe(true) // Fri 07:59
    expect(frozen('2026-10-09T05:00:00Z')).toBe(false) // Fri 08:00
  })

  it('Friday daytime passes and Friday evening freezes', () => {
    expect(frozen('2026-10-09T14:59:00Z')).toBe(false) // Fri 17:59
    expect(frozen('2026-10-09T15:00:00Z')).toBe(true) // Fri 18:00
  })

  it('Saturday follows the same pattern', () => {
    expect(frozen('2026-10-10T04:59:00Z')).toBe(true) // Sat 07:59
    expect(frozen('2026-10-10T05:00:00Z')).toBe(false) // Sat 08:00
    expect(frozen('2026-10-10T14:59:00Z')).toBe(false) // Sat 17:59
    expect(frozen('2026-10-10T15:00:00Z')).toBe(true) // Sat 18:00
  })

  it('Sunday follows the same pattern, and the freeze runs into Monday', () => {
    expect(frozen('2026-10-11T04:59:00Z')).toBe(true) // Sun 07:59
    expect(frozen('2026-10-11T05:00:00Z')).toBe(false) // Sun 08:00
    expect(frozen('2026-10-11T14:59:00Z')).toBe(false) // Sun 17:59
    expect(frozen('2026-10-11T15:00:00Z')).toBe(true) // Sun 18:00
    expect(frozen('2026-10-11T21:00:00Z')).toBe(true) // Mon 00:00
  })

  it('Monday and Tuesday daytime pass, Tuesday small hours pass', () => {
    expect(frozen('2026-10-12T09:00:00Z')).toBe(false) // Mon 12:00
    expect(frozen('2026-10-12T21:00:00Z')).toBe(false) // Tue 00:00
    expect(frozen('2026-10-13T00:30:00Z')).toBe(false) // Tue 03:30
  })
})

describe('freeze window across clock changes', () => {
  it('uses Sofia local time after summer time ends (a fixed +3 offset would be wrong)', () => {
    // Thu 22 Oct is still summer time (UTC+3).
    expect(frozen('2026-10-22T14:59:00Z')).toBe(false) // Thu 17:59
    expect(frozen('2026-10-22T15:00:00Z')).toBe(true) // Thu 18:00
    // Thu 29 Oct is winter time (UTC+2): 15:00Z is only 17:00 local.
    expect(frozen('2026-10-29T15:00:00Z')).toBe(false) // Thu 17:00
    expect(frozen('2026-10-29T15:59:00Z')).toBe(false) // Thu 17:59
    expect(frozen('2026-10-29T16:00:00Z')).toBe(true) // Thu 18:00
  })

  it('moves the Monday morning edge with the clock change in October', () => {
    // Mon 26 Oct is winter time: 08:00 local is 06:00Z.
    expect(frozen('2026-10-26T05:59:00Z')).toBe(true) // Mon 07:59
    expect(frozen('2026-10-26T06:00:00Z')).toBe(false) // Mon 08:00
  })

  it('handles the Sunday the clocks go back (25 October, UTC+2 by the evening)', () => {
    expect(frozen('2026-10-25T15:59:00Z')).toBe(false) // Sun 17:59
    expect(frozen('2026-10-25T16:00:00Z')).toBe(true) // Sun 18:00
  })

  it('moves the Monday morning edge with the clock change in March', () => {
    // Mon 30 Mar is summer time: 08:00 local is 05:00Z.
    expect(frozen('2026-03-30T04:59:00Z')).toBe(true) // Mon 07:59
    expect(frozen('2026-03-30T05:00:00Z')).toBe(false) // Mon 08:00
  })

  it('moves the Thursday evening edge with the clock change in March', () => {
    // Thu 26 Mar is winter time (UTC+2); Thu 2 Apr is summer time (UTC+3).
    expect(frozen('2026-03-26T15:59:00Z')).toBe(false) // Thu 17:59
    expect(frozen('2026-03-26T16:00:00Z')).toBe(true) // Thu 18:00
    expect(frozen('2026-04-02T14:59:00Z')).toBe(false) // Thu 17:59
    expect(frozen('2026-04-02T15:00:00Z')).toBe(true) // Thu 18:00
  })

  it('reads the weekday in Sofia, not in UTC', () => {
    // 21:30Z on Wednesday is already Thursday 00:30 in Sofia.
    expect(sofiaTime(new Date('2026-10-07T21:30:00Z'))).toEqual({ weekday: 4, hour: 0, minute: 30 })
  })
})

describe('decide', () => {
  const thursdayEvening = new Date('2026-10-08T15:00:00Z') // Thu 18:00, frozen
  const wednesdayNight = new Date('2026-10-07T20:00:00Z') // Wed 23:00, open

  it('blocks a frozen time without the override label', () => {
    const result = decide({ now: thursdayEvening, labels: [] })
    expect(result.allowed).toBe(false)
    expect(result.message).toContain('Thu 18:00 Europe/Sofia')
  })

  it('ignores unrelated labels', () => {
    expect(decide({ now: thursdayEvening, labels: ['bug', 'urgent'] }).allowed).toBe(false)
  })

  it('lets a frozen time through with the override label', () => {
    expect(decide({ now: thursdayEvening, labels: [OVERRIDE_LABEL] }).allowed).toBe(true)
  })

  it('allows an open time with or without the label', () => {
    expect(decide({ now: wednesdayNight, labels: [] }).allowed).toBe(true)
    expect(decide({ now: wednesdayNight, labels: [OVERRIDE_LABEL] }).allowed).toBe(true)
  })
})

describe('command line', () => {
  const script = fileURLToPath(new URL('./freeze-window.mjs', import.meta.url))

  function run(now: string, labels: string[]) {
    return spawnSync(process.execPath, [script], {
      env: { ...process.env, FREEZE_NOW: now, PR_LABELS: JSON.stringify(labels) },
      encoding: 'utf8',
    })
  }

  it('exits 1 inside the freeze window without the label', () => {
    const result = run('2026-10-08T15:00:00Z', [])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error')
  })

  it('exits 0 inside the freeze window with the label', () => {
    expect(run('2026-10-08T15:00:00Z', [OVERRIDE_LABEL]).status).toBe(0)
  })

  it('exits 0 outside the freeze window', () => {
    expect(run('2026-10-07T20:00:00Z', []).status).toBe(0)
  })
})
