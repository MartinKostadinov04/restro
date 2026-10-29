// The scenario files (#71): each loads by name and checks out, Demo Bar has what #51 design §6
// says it has, the menu names only articles the POS sells, and each named scenario does what its
// description says once built into an engine.

import type { ServiceContext } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createSimPosConnector } from './connector'
import { ManualClock } from './engine/clock'
import { billTotal } from './engine/engine'
import {
  buildEngine,
  DEFAULT_SCENARIO_NAME,
  listScenarioNames,
  loadScenarioFile,
  ScenarioFileError,
  scenarioSwitches,
} from './scenario-file'
import { inProcessTransport } from './testing'

const TIMINGS = {
  probeBudgetMs: 200,
  readTimeoutMs: 300,
  writeTimeoutMs: 300,
  readBackWindowMs: 1000,
}

describe('scenario files', () => {
  it('lists demo-bar and the three named scenarios', () => {
    expect(listScenarioNames()).toEqual(
      expect.arrayContaining(['demo-bar', 'quiet-night', 'busy-friday', 'payment-trouble']),
    )
    expect(listScenarioNames()).toContain(DEFAULT_SCENARIO_NAME)
  })

  it.each(listScenarioNames())('%s loads, resolves and builds an engine', (name) => {
    const resolved = loadScenarioFile(name)
    expect(resolved.name).toBe(name)
    expect(() => buildEngine(resolved, { clock: new ManualClock(), print: () => {} })).not.toThrow()
  })

  it('refuses a name that is not a scenario, and one that names a path', () => {
    expect(() => loadScenarioFile('no-such-night')).toThrow(ScenarioFileError)
    expect(() => loadScenarioFile('../package')).toThrow(ScenarioFileError)
  })

  it('refuses a switch the simulator does not have, one of the wrong type and a combination it does not define', () => {
    expect(() => scenarioSwitches('pilot', { noSuchSwitch: true }, 'x')).toThrow(ScenarioFileError)
    expect(() => scenarioSwitches('pilot', { readsTableBar: 'yes' }, 'x')).toThrow(
      ScenarioFileError,
    )
    expect(() => scenarioSwitches('pilot', { startsInTrainingMode: true }, 'x')).toThrow(
      ScenarioFileError,
    )
    expect(scenarioSwitches('pilot', { readsTableBar: true }, 'x').readsTableBar).toBe(true)
  })
})

describe('Demo Bar', () => {
  const demo = loadScenarioFile('demo-bar')
  const { scenario } = demo

  it('has two bars, twelve tables and four payment tables', () => {
    expect(scenario.bars.map((bar) => bar.name)).toEqual(['Main bar', 'Upstairs'])
    expect(scenario.tables.filter((table) => !table.payment)).toHaveLength(12)
    const payment = scenario.tables.filter((table) => table.payment)
    expect(payment).toHaveLength(4)
    for (const bar of scenario.bars) {
      expect(scenario.tables.filter((t) => t.bar === bar.id && !t.payment)).toHaveLength(6)
      expect(payment.filter((t) => t.bar === bar.id)).toHaveLength(2)
    }
  })

  it('sells about thirty articles, with a tip article and odd prices', () => {
    expect(scenario.articles.length).toBeGreaterThanOrEqual(28)
    expect(scenario.articles.length).toBeLessThanOrEqual(34)
    expect(scenario.articles.some((article) => article.tip)).toBe(true)
    expect(scenario.articles.some((article) => article.priceMinor % 10 === 5)).toBe(true)
  })

  it('reads the bars and uses one login for every bar (so the floor shows both)', () => {
    expect(demo.switches.readsTableBar).toBe(true)
    expect(demo.switches.oneLoginPerBar).toBe(false)
    expect(demo.profile).toBe('pilot')
  })

  it('varies its id shapes (numbers, text with spaces, uuids)', () => {
    const ids = [...scenario.tables.map((t) => t.id), ...scenario.bars.map((b) => b.id)]
    expect(ids.some((id) => /^\d+$/.test(id))).toBe(true)
    expect(ids.some((id) => id.includes(' '))).toBe(true)
    expect(ids.some((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id))).toBe(true)
  })

  it('has a menu that sells only articles the POS has, each once', () => {
    const menu = demo.menu
    if (menu === null) throw new Error('demo-bar has no menu')
    const sold = menu.sections.flatMap((section) => section.items.map((item) => item.article))
    const known = new Set(scenario.articles.map((article) => article.id))
    expect(sold.every((article) => known.has(article))).toBe(true)
    expect(new Set(sold).size).toBe(sold.length)
    // Every catalogue article but the tip is on the menu.
    expect(sold.length).toBe(scenario.articles.filter((article) => !article.tip).length)
  })

  it('has one item with required options, a pay-first item and a sold-out item', () => {
    const items = demo.menu?.sections.flatMap((section) => section.items) ?? []
    expect(items.filter((item) => item.optionGroups?.some((group) => group.min >= 1))).toHaveLength(
      1,
    )
    expect(items.some((item) => item.payment === 'pay_first')).toBe(true)
    expect(items.some((item) => item.soldOut === true)).toBe(true)
  })
})

describe('quiet-night', () => {
  it("has Table 7 open with Maria's 46.00 EUR bill and nothing else", () => {
    const engine = buildEngine(loadScenarioFile('quiet-night'), { clock: new ManualClock() })
    const open = engine.state.bills.filter((bill) => bill.state === 'open')
    expect(open).toHaveLength(1)
    const [bill] = open
    expect(engine.state.tables.find((t) => t.id === bill?.table)?.number).toBe('7')
    expect(bill?.openedBy).toBe('maria')
    expect(bill && billTotal(bill)).toBe(4600)
  })
})

describe('busy-friday', () => {
  it('has a bill on every table and a replayable chaos seed', () => {
    const printed: string[] = []
    const resolved = loadScenarioFile('busy-friday')
    const engine = buildEngine(resolved, {
      clock: new ManualClock(),
      print: (line) => printed.push(line),
    })
    const open = new Set(engine.state.bills.filter((b) => b.state === 'open').map((b) => b.table))
    const living = engine.state.tables.filter((table) => !table.payment)
    expect(living.every((table) => open.has(table.id))).toBe(true)
    expect(engine.faults.chaosSeed).toBe(resolved.chaos?.seed)
    expect(printed.join('\n')).toContain(String(resolved.chaos?.seed))
  })

  it('has a bill-level charge (Q37) and a half portion (half-up rounding)', () => {
    const engine = buildEngine(loadScenarioFile('busy-friday'), {
      clock: new ManualClock(),
      print: () => {},
    })
    const charged = engine.state.bills.find((bill) => bill.chargeMinor > 0)
    expect(charged).toBeDefined()
    // 0.5 x 8.95 = 4.475 -> 4.48 (half-up).
    const half = engine.state.bills
      .flatMap((bill) => bill.rows)
      .find((row) => row.article === '2501' && row.quantity === 500)
    expect(half?.amountMinor).toBe(448)
  })
})

describe('payment-trouble', () => {
  it('starts with a waiter round about to slip into a move, a close with no receipt and a locked bill', () => {
    const engine = buildEngine(loadScenarioFile('payment-trouble'), { clock: new ManualClock() })
    const locked = engine.state.bills.filter((bill) => bill.lockedBy !== null)
    expect(locked).toHaveLength(1)
    expect(engine.state.articles.find((a) => a.id === '2105')?.soldOut).toBe(true)
    // The slipping round fires on the first move: one row more than the call put there.
    const bill = engine.state.bills.find((b) => b.rows.some((r) => r.article === '2007'))
    expect(bill).toBeDefined()
  })
})

describe('the connector reads the Demo Bar floor from a scenario', () => {
  it('lists both bars and all sixteen tables, complete, with the bar of each', async () => {
    const clock = new ManualClock()
    const resolved = loadScenarioFile('quiet-night')
    const engine = buildEngine(resolved, { clock })
    const login = engine.apiLogins()[0]
    if (login === undefined) throw new Error('no API login')
    const connector = createSimPosConnector({
      transport: inProcessTransport(engine),
      login: { user: login.id, password: login.password },
      switches: engine.switches,
    })
    const ctx: ServiceContext = { now: () => clock.now(), timings: TIMINGS }
    const reading = await connector.readFloor(ctx)
    if (!reading.complete) throw new Error(`incomplete: ${reading.reason}`)
    expect(reading.value.bars.map((bar) => bar.name)).toEqual(['Main bar', 'Upstairs'])
    expect(reading.value.tables).toHaveLength(16)
    expect(reading.value.tables.every((table) => table.bar !== null)).toBe(true)
    expect(reading.value.tables.find((table) => table.name === '7')?.area).toBe('Upstairs')
  })
})
