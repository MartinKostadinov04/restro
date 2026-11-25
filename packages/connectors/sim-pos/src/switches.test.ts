import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_SERVICE_CAPABILITIES } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { CAUTIOUS, capabilitiesOf, PROFILE_NAMES, PROFILES, switchesOf } from './switches'

const SRC = import.meta.dirname

describe('the switches (#51 design §2.4)', () => {
  it('each switch names its question (Q<n>), the one wire-format switch excepted', () => {
    const text = readFileSync(join(SRC, 'switches.ts'), 'utf8')
    const body = must(/export interface SimSwitches \{([\s\S]*?)\n\}/.exec(text)?.[1])
    const problems: string[] = []
    const names: string[] = []
    let comment = ''
    for (const line of body.split('\n')) {
      const field = /^\s*readonly (\w+):/.exec(line)
      if (field?.[1] === undefined) {
        comment += line
        continue
      }
      names.push(field[1])
      const cited = /\bQ\d+\b/.test(comment)
      if (!cited && !(field[1] === 'pricesAsJsonFloats' && /No question/.test(comment))) {
        problems.push(`${field[1]} names no question`)
      }
      comment = ''
    }
    expect(problems).toEqual([])
    expect(names.sort()).toEqual(Object.keys(CAUTIOUS).sort())
  })

  it("the two profiles exist; pilot is cautious with the payment route's two switches on", () => {
    expect(PROFILE_NAMES).toEqual(['cautious', 'pilot'])
    const changed = Object.keys(CAUTIOUS).filter(
      (key) =>
        JSON.stringify(PROFILES.pilot[key as keyof typeof CAUTIOUS]) !==
        JSON.stringify(CAUTIOUS[key as keyof typeof CAUTIOUS]),
    )
    expect(changed.sort()).toEqual(['closeWithPaymentType', 'moveLines'])
  })

  it("the verification's two switches: a bill-level charge on in pilot (Q37), training mode in the probe (Q27)", () => {
    expect(PROFILES.pilot.billTotalDiffersFromLines).toBe(true)
    expect(CAUTIOUS.trainingMode).toBe(false)
    expect(capabilitiesOf(switchesOf('cautious', { trainingMode: true })).trainingMode).toBe(true)
  })

  it('cautious declares the least, apart from adding to a staff-opened bill (D124 §3)', () => {
    const declared = Object.entries(capabilitiesOf(CAUTIOUS)).filter(([, on]) => on)
    expect(declared).toEqual([['addToStaffOpenedBill', true]])
    expect(Object.keys(capabilitiesOf(CAUTIOUS)).sort()).toEqual(
      Object.keys(NO_SERVICE_CAPABILITIES).sort(),
    )
  })

  it('refuses combinations no switch defines', () => {
    expect(() => switchesOf('cautious', { startsInTrainingMode: true })).toThrow()
    expect(() => switchesOf('cautious', { movePartialQuantity: true })).toThrow()
    expect(() => switchesOf('cautious', { rateLimit: { concurrent: 0, perSecond: 5 } })).toThrow()
  })
})

describe("D110's guard at the source (rule 7)", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'testing' ? [] : sources(path)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
    })

  it('the connector reaches POS writes only through the write module', () => {
    const connector = readFileSync(join(SRC, 'connector.ts'), 'utf8')
    expect(connector).not.toMatch(/'POST'|"POST"|\.post\(/)
    const posting = sources(SRC).filter((path) =>
      /\bclient\.post\(/.test(readFileSync(path, 'utf8')),
    )
    expect(posting.map((path) => path.slice(SRC.length + 1).replaceAll('\\', '/'))).toEqual([
      'write/index.ts',
    ])
  })
})

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}
