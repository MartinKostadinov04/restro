// R15 Features (brief SH-03): every clause of the rule, the fail-closed defaults, and a property:
// whatever the snapshot, the platform and the context say, a service is never on without all four
// of its conditions, and the filter control is never on without chips.

import {
  CALL_WAITER_KINDS,
  type CallWaiterKind,
  DEFAULT_GUEST_FEATURES,
  type GuestFeatures,
  type MenuSnapshot,
} from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { fixture } from '../testing'
import { buildViewModel } from './build'
import { CHANNELS, INTERACTIVE_CHANNELS, type ShellContextInput } from './context'
import { SERVICE_KINDS, type ViewFeatures, viewFeatures } from './features'
import type { ViewModel } from './view-model'

const NOW = '2026-10-07T20:30:00+03:00'
const TABLE = 'fixture-table-token'

const ALL_ON: GuestFeatures = {
  filters: true,
  call_waiter: { enabled: true, kinds: [...CALL_WAITER_KINDS] },
  bill: true,
  ordering: true,
  pay: true,
}

const ALL_SUPPORTED = { callWaiter: true, bill: true, ordering: true, pay: true } as const

/** A menu with filter chips (tags and dietary labels), and one without. */
const WITH_CHIPS = fixture('features-on').snapshot
const WITHOUT_CHIPS = fixture('no-images').snapshot

/** A snapshot with the given features (undefined removes them: an old snapshot). */
function withFeatures(base: MenuSnapshot, features: GuestFeatures | undefined): MenuSnapshot {
  const { features: _dropped, ...rest } = base
  return features === undefined ? rest : { ...rest, features }
}

/** Everything the platform and the table allow, unless the test says otherwise. */
function build(snapshot: MenuSnapshot, context: Partial<ShellContextInput> = {}): ViewModel {
  return buildViewModel(snapshot, null, {
    locale: 'en_US',
    now: NOW,
    tableToken: TABLE,
    orderingEnabled: true,
    capabilities: { ...ALL_SUPPORTED },
    ...context,
  })
}

const OFF: ViewFeatures = {
  filters: false,
  callWaiter: null,
  bill: false,
  ordering: false,
  pay: false,
}

describe('R15: the shell’s names come from core', () => {
  it('re-exports the request kinds, without a second list', () => {
    expect(SERVICE_KINDS).toBe(CALL_WAITER_KINDS)
    expect(SERVICE_KINDS).toEqual([
      'waiter',
      'bill',
      'ice',
      'water',
      'glasses',
      'clean_table',
      'terminal',
    ])
  })
})

describe('R15: fail-closed defaults', () => {
  it('shows only the filters of a snapshot with no features (published before D71)', () => {
    const snapshot = withFeatures(WITH_CHIPS, undefined)
    expect(snapshot.features).toBeUndefined()
    expect(build(snapshot).features).toEqual({ ...OFF, filters: true })
  })

  it('uses core’s defaults: filters on, every service off', () => {
    expect(DEFAULT_GUEST_FEATURES.filters).toBe(true)
    const view = build(withFeatures(WITH_CHIPS, DEFAULT_GUEST_FEATURES))
    expect(view.features).toEqual({ ...OFF, filters: true })
  })

  it('shows no service when the host says nothing about the platform', () => {
    const view = buildViewModel(WITH_CHIPS, null, {
      locale: 'en_US',
      now: NOW,
      tableToken: TABLE,
      orderingEnabled: true,
    })
    expect(view.features).toEqual({ ...OFF, filters: true })
  })

  it('refuses a capability it does not know, and a value that is not a boolean', () => {
    const context = { locale: 'en_US', now: NOW } as const
    expect(() =>
      buildViewModel(WITH_CHIPS, null, { ...context, capabilities: { kiosk: true } as never }),
    ).toThrow()
    expect(() =>
      buildViewModel(WITH_CHIPS, null, { ...context, capabilities: { bill: 'yes' } as never }),
    ).toThrow()
  })
})

describe('R15: filters', () => {
  it('is on when the venue left filters on and the menu has chips', () => {
    expect(build(withFeatures(WITH_CHIPS, ALL_ON)).features.filters).toBe(true)
  })

  it('is off when the venue switched filters off, though the menu has chips', () => {
    const view = build(withFeatures(WITH_CHIPS, { ...ALL_ON, filters: false }))
    expect(view.filters.tags.length + view.filters.dietary.length).toBeGreaterThan(0)
    expect(view.features.filters).toBe(false)
  })

  it('is off when the menu has no chips, though the venue left filters on', () => {
    const view = build(withFeatures(WITHOUT_CHIPS, ALL_ON))
    expect(view.filters).toEqual({ tags: [], dietary: [] })
    expect(view.features.filters).toBe(false)
  })

  it('needs one kind of chip only, tags or dietary labels', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON))
    expect(view.filters.tags.length).toBeGreaterThan(0)
    expect(view.filters.dietary.length).toBeGreaterThan(0)
    expect(viewFeatures({ ...inputs(), chips: 1 }).filters).toBe(true)
    expect(viewFeatures({ ...inputs(), chips: 0 }).filters).toBe(false)
  })

  it('does not depend on the channel, the table or the platform', () => {
    for (const channel of CHANNELS) {
      const view = build(withFeatures(WITH_CHIPS, ALL_ON), {
        channel,
        tableToken: null,
        capabilities: {},
      })
      expect(view.features.filters, channel).toBe(true)
    }
  })
})

/** Inputs for `viewFeatures` with every condition met. */
function inputs() {
  return {
    features: ALL_ON,
    capabilities: { ...ALL_SUPPORTED },
    interactive: true,
    tableToken: TABLE as string | null,
    chips: 2,
    orderingEnabled: true,
  }
}

describe('R15: a service needs all four conditions', () => {
  const services = ['callWaiter', 'bill', 'ordering', 'pay'] as const
  const switches: Record<(typeof services)[number], (features: GuestFeatures) => GuestFeatures> = {
    callWaiter: (f) => ({ ...f, call_waiter: { ...f.call_waiter, enabled: false } }),
    bill: (f) => ({ ...f, bill: false }),
    ordering: (f) => ({ ...f, ordering: false }),
    pay: (f) => ({ ...f, pay: false }),
  }
  const on = (view: ViewModel, service: (typeof services)[number]) =>
    service === 'callWaiter' ? view.features.callWaiter !== null : view.features[service]

  it('are all on when every condition holds', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON))
    expect(view.features).toEqual({
      filters: true,
      callWaiter: { kinds: [...CALL_WAITER_KINDS] },
      bill: true,
      ordering: true,
      pay: true,
    })
  })

  it.each(services)('%s is off when the venue switched it off', (service) => {
    const view = build(withFeatures(WITH_CHIPS, switches[service](ALL_ON)))
    expect(on(view, service)).toBe(false)
    for (const other of services.filter((name) => name !== service)) {
      expect(on(view, other), other).toBe(true)
    }
  })

  it.each(services)('%s is off when the platform does not support it', (service) => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON), {
      capabilities: { ...ALL_SUPPORTED, [service]: false },
    })
    expect(on(view, service)).toBe(false)
    for (const other of services.filter((name) => name !== service)) {
      expect(on(view, other), other).toBe(true)
    }
  })

  it('are off on a channel a guest cannot touch', () => {
    for (const channel of CHANNELS) {
      const view = build(withFeatures(WITH_CHIPS, ALL_ON), { channel })
      const interactive = INTERACTIVE_CHANNELS.includes(channel)
      expect(view.features.callWaiter !== null, channel).toBe(interactive)
      expect(view.features.bill, channel).toBe(interactive)
      expect(view.features.ordering, channel).toBe(interactive)
      expect(view.features.pay, channel).toBe(interactive)
    }
  })

  it('treat the kiosk like the phone', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON), { channel: 'kiosk' })
    expect(view.features).toMatchObject({ bill: true, ordering: true, pay: true })
  })

  it('are off without a confirmed table token', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON), { tableToken: null })
    expect(view.features).toEqual({ ...OFF, filters: true })
  })
})

describe('R15: call a waiter', () => {
  const asking = (kinds: CallWaiterKind[], enabled = true): GuestFeatures => ({
    ...ALL_ON,
    call_waiter: { enabled, kinds },
  })

  it('offers the kinds the venue allows', () => {
    const view = build(withFeatures(WITH_CHIPS, asking(['water', 'bill'])))
    expect(view.features.callWaiter).toEqual({ kinds: ['bill', 'water'] })
  })

  it('keeps the vocabulary’s order whatever the order stored', () => {
    const view = build(withFeatures(WITH_CHIPS, asking(['terminal', 'waiter', 'glasses'])))
    expect(view.features.callWaiter?.kinds).toEqual(['waiter', 'glasses', 'terminal'])
  })

  it('is off when no kind is allowed, though the venue switched it on', () => {
    expect(build(withFeatures(WITH_CHIPS, asking([]))).features.callWaiter).toBeNull()
  })

  it('is off when the venue switched it off, whatever kinds are stored', () => {
    const view = build(withFeatures(WITH_CHIPS, asking(['waiter'], false)))
    expect(view.features.callWaiter).toBeNull()
  })
})

describe('R15: ordering and R11', () => {
  it('also needs R11’s ordering.enabled', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON), { orderingEnabled: false })
    expect(view.ordering.enabled).toBe(false)
    expect(view.features.ordering).toBe(false)
    // The other services do not depend on R11's switch.
    expect(view.features.bill).toBe(true)
  })

  it('leaves R11 as it was: the venue’s switch does not touch ordering.enabled or order.controls', () => {
    const items = (view: ViewModel) => view.sections.flatMap((section) => section.items)
    const off = build(withFeatures(WITH_CHIPS, { ...ALL_ON, ordering: false }))
    const on = build(withFeatures(WITH_CHIPS, ALL_ON))
    expect(off.features.ordering).toBe(false)
    expect(on.features.ordering).toBe(true)
    expect(off.ordering).toEqual(on.ordering)
    expect(off.ordering.enabled).toBe(true)
    expect(items(off).map((item) => item.order)).toEqual(items(on).map((item) => item.order))
    expect(items(on).some((item) => item.order.controls)).toBe(true)
  })

  it('is not turned on by R11 alone', () => {
    const view = build(withFeatures(WITH_CHIPS, ALL_ON), {
      capabilities: { ...ALL_SUPPORTED, ordering: false },
    })
    expect(view.ordering.enabled).toBe(true)
    expect(view.features.ordering).toBe(false)
  })
})

describe('R15: determinism', () => {
  it('gives equal features for equal inputs', () => {
    const snapshot = withFeatures(WITH_CHIPS, ALL_ON)
    expect(build(snapshot).features).toEqual(build(structuredClone(snapshot)).features)
  })
})

describe('R15 property: nothing is on without its conditions', () => {
  const kinds = fc.subarray([...CALL_WAITER_KINDS])
  const features = fc.record({
    filters: fc.boolean(),
    call_waiter: fc.record({ enabled: fc.boolean(), kinds }),
    bill: fc.boolean(),
    ordering: fc.boolean(),
    pay: fc.boolean(),
  })
  const capabilities = fc.record({
    callWaiter: fc.boolean(),
    bill: fc.boolean(),
    ordering: fc.boolean(),
    pay: fc.boolean(),
  })
  const context = fc.record({
    channel: fc.constantFrom(...CHANNELS),
    tableToken: fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: null }),
    orderingEnabled: fc.boolean(),
  })

  it('holds for any snapshot features, capabilities, context and menu', () => {
    fc.assert(
      fc.property(
        fc.option(features, { nil: undefined }),
        fc.option(capabilities, { nil: undefined }),
        context,
        fc.boolean(),
        (stored, supported, ctx, chips) => {
          const snapshot = withFeatures(chips ? WITH_CHIPS : WITHOUT_CHIPS, stored)
          const view = buildViewModel(snapshot, null, {
            locale: 'en_US',
            now: NOW,
            ...ctx,
            ...(supported === undefined ? {} : { capabilities: supported }),
          })
          const venue = stored ?? DEFAULT_GUEST_FEATURES
          const platform = supported ?? {
            callWaiter: false,
            bill: false,
            ordering: false,
            pay: false,
          }
          const reachable = INTERACTIVE_CHANNELS.includes(ctx.channel) && ctx.tableToken !== null
          const shown = view.features

          if (shown.callWaiter !== null) {
            expect(venue.call_waiter.enabled).toBe(true)
            expect(platform.callWaiter).toBe(true)
            expect(reachable).toBe(true)
            expect(shown.callWaiter.kinds.length).toBeGreaterThan(0)
            for (const kind of shown.callWaiter.kinds) {
              expect(venue.call_waiter.kinds).toContain(kind)
            }
          }
          if (shown.bill) {
            expect(venue.bill && platform.bill && reachable).toBe(true)
          }
          if (shown.pay) {
            expect(venue.pay && platform.pay && reachable).toBe(true)
          }
          if (shown.ordering) {
            expect(venue.ordering && platform.ordering && reachable).toBe(true)
            expect(view.ordering.enabled).toBe(true)
          }
          if (shown.filters) {
            expect(venue.filters).toBe(true)
            expect(view.filters.tags.length + view.filters.dietary.length).toBeGreaterThan(0)
          }
        },
      ),
      { numRuns: 500 },
    )
  })
})
