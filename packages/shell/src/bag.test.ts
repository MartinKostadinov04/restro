import { addMinor, multiplyMinor } from '@restro/core'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type GroupSpec, type ItemSpec, snapshotFromSpec } from '../testing'
import {
  type BagDraft,
  type BagLine,
  bagEstimate,
  bagReducer,
  draftPrice,
  groupValid,
  lineKey,
  needsChoices,
  orderLines,
  resolveBag,
  selectedOptionIds,
  selectionOf,
  selectionValid,
  toggleOption,
} from './bag'
import { buildViewModel } from './build'
import { SERVICE_LIMITS } from './services'
import type { ViewItem, ViewModel, ViewModifierGroup } from './view-model'

const en = (text: string) => ({ en_US: text })

const ALL_ON = {
  locale: 'en_US',
  now: '2026-10-07T20:30:00+03:00',
  orderingEnabled: true,
  tableToken: 'test-table-token',
  capabilities: { callWaiter: true, bill: true, ordering: true, pay: true },
} as const

/** A view model with ordering on, one section holding the items. */
function viewOf(items: readonly ItemSpec[], context: Record<string, unknown> = {}): ViewModel {
  const snapshot = snapshotFromSpec({
    locales: { default: 'en_US', available: ['en_US'] },
    sections: [{ title: en('Menu'), items }],
  })
  return buildViewModel(snapshot, null, { ...ALL_ON, ...context } as never)
}

const group = (name: string, min: number, max: number, deltas: (number | null)[]): GroupSpec => ({
  name: en(name),
  min,
  max,
  options: deltas.map((delta, index) => ({ name: en(`${name} ${index + 1}`), delta })),
})

const itemsOf = (view: ViewModel): ViewItem[] =>
  view.sections.flatMap((section) => [...section.items])
const itemNamed = (view: ViewModel, name: string): ViewItem => {
  const found = itemsOf(view).find((item) => item.name.text === name)
  if (found === undefined) throw new Error(`no item ${name}`)
  return found
}

const nd = (n: number) => `nd_${String(n).padStart(22, '0')}` as const
const draft = (itemId: `nd_${string}`, extra: Partial<BagDraft> = {}): BagDraft => ({
  itemId,
  qty: 1,
  optionIds: [],
  note: '',
  ...extra,
})
const add = (bag: readonly BagLine[], line: BagDraft) => bagReducer(bag, { type: 'add', line })

describe('bagReducer', () => {
  it('adds a line with a key, and merges the same item, options and note into one line', () => {
    let bag = add([], draft(nd(1)))
    bag = add(bag, draft(nd(1)))
    expect(bag).toHaveLength(1)
    expect(bag[0]?.qty).toBe(2)
    expect(bag[0]?.key).toBe(lineKey(draft(nd(1))))
  })

  it('keeps a different option, a different note and a different item apart', () => {
    let bag = add([], draft(nd(1)))
    bag = add(bag, draft(nd(1), { optionIds: [nd(9)] }))
    bag = add(bag, draft(nd(1), { note: 'no onion' }))
    bag = add(bag, draft(nd(2)))
    expect(bag.map((line) => line.qty)).toEqual([1, 1, 1, 1])
    expect(new Set(bag.map((line) => line.key)).size).toBe(4)
  })

  it('treats options as a set (order and repeats do not matter) and ignores spaces around a note', () => {
    let bag = add([], draft(nd(1), { optionIds: [nd(3), nd(2), nd(3)], note: '  no onion ' }))
    bag = add(bag, draft(nd(1), { optionIds: [nd(2), nd(3)], note: 'no onion' }))
    expect(bag).toHaveLength(1)
    expect(bag[0]).toMatchObject({ qty: 2, optionIds: [nd(2), nd(3)], note: 'no onion' })
  })

  it('keeps no name and no price in a line', () => {
    const [line] = add([], draft(nd(1)))
    expect(Object.keys(line ?? {}).sort()).toEqual(['itemId', 'key', 'note', 'optionIds', 'qty'])
  })

  it('changes a quantity by a step, and drops the line at zero', () => {
    let bag = add([], draft(nd(1), { qty: 2 }))
    const key = bag[0]?.key ?? ''
    bag = bagReducer(bag, { type: 'qty', key, delta: 1 })
    expect(bag[0]?.qty).toBe(3)
    bag = bagReducer(bag, { type: 'qty', key, delta: -2 })
    expect(bag[0]?.qty).toBe(1)
    expect(bagReducer(bag, { type: 'qty', key, delta: -1 })).toEqual([])
    expect(bagReducer(bag, { type: 'qty', key: 'no such line', delta: 5 })).toEqual(bag)
  })

  it('spends the lines the host accepted and keeps what the guest added meanwhile', () => {
    const sent = add(add([], draft(nd(1), { qty: 2 })), draft(nd(2)))
    // While the order was with the host, the guest added one more of the first dish and a third dish.
    const meanwhile = add(add(sent, draft(nd(1))), draft(nd(3)))
    const left = bagReducer(meanwhile, { type: 'spend', lines: sent })
    expect(left.map((line) => [line.itemId, line.qty])).toEqual([
      [nd(1), 1],
      [nd(3), 1],
    ])
    // Spending the whole bag empties it, and spending what is not there changes nothing.
    expect(bagReducer(sent, { type: 'spend', lines: sent })).toEqual([])
    expect(bagReducer(sent, { type: 'spend', lines: [] })).toEqual(sent)
    const gone = bagReducer(sent, { type: 'remove', key: sent[0]?.key ?? '' })
    expect(bagReducer(gone, { type: 'spend', lines: sent }).map((line) => line.itemId)).toEqual([])
    // A line the guest lowered meanwhile is not spent below zero.
    const fewer = bagReducer(sent, { type: 'qty', key: sent[0]?.key ?? '', delta: -1 })
    expect(bagReducer(fewer, { type: 'spend', lines: sent })).toEqual([])
  })

  it('removes a line and clears the bag', () => {
    const bag = add(add([], draft(nd(1))), draft(nd(2)))
    const key = bag[0]?.key ?? ''
    expect(bagReducer(bag, { type: 'remove', key }).map((line) => line.itemId)).toEqual([nd(2)])
    expect(bagReducer(bag, { type: 'clear' })).toEqual([])
  })

  it('replaces a line where it stands', () => {
    let bag = add(add(add([], draft(nd(1))), draft(nd(2))), draft(nd(3)))
    const key = bag[1]?.key ?? ''
    bag = bagReducer(bag, {
      type: 'replace',
      key,
      line: draft(nd(2), { qty: 4, note: 'well done' }),
    })
    expect(bag.map((line) => line.itemId)).toEqual([nd(1), nd(2), nd(3)])
    expect(bag[1]).toMatchObject({ qty: 4, note: 'well done' })
    expect(bag[1]?.key).toBe(lineKey(draft(nd(2), { note: 'well done' })))
  })

  it('merges an edited line into the line it has become equal to', () => {
    let bag = add(add([], draft(nd(1), { qty: 2 })), draft(nd(1), { note: 'spicy', qty: 3 }))
    const key = bag[1]?.key ?? ''
    bag = bagReducer(bag, { type: 'replace', key, line: draft(nd(1), { qty: 1 }) })
    expect(bag).toHaveLength(1)
    expect(bag[0]).toMatchObject({ itemId: nd(1), qty: 3, note: '' })
  })

  it('adds the replacement when the line to replace is gone', () => {
    const bag = bagReducer([], { type: 'replace', key: 'gone', line: draft(nd(1)) })
    expect(bag.map((line) => line.itemId)).toEqual([nd(1)])
  })

  it('never lets a quantity pass 50, a note pass 200 characters or the bag pass 50 lines', () => {
    let bag = add([], draft(nd(1), { qty: 49 }))
    bag = add(bag, draft(nd(1), { qty: 49 }))
    expect(bag[0]?.qty).toBe(SERVICE_LIMITS.quantity)
    bag = bagReducer(bag, { type: 'qty', key: bag[0]?.key ?? '', delta: 10 })
    expect(bag[0]?.qty).toBe(SERVICE_LIMITS.quantity)
    expect(add([], draft(nd(1), { qty: 500 }))[0]?.qty).toBe(SERVICE_LIMITS.quantity)
    expect(add([], draft(nd(1), { qty: 0 }))[0]?.qty).toBe(1)
    expect(add([], draft(nd(1), { qty: 2.9 }))[0]?.qty).toBe(2)
    expect(add([], draft(nd(1), { note: 'x'.repeat(300) }))[0]?.note).toHaveLength(
      SERVICE_LIMITS.note,
    )

    let full: readonly BagLine[] = []
    for (let n = 1; n <= SERVICE_LIMITS.lines + 5; n++) full = add(full, draft(nd(n)))
    expect(full).toHaveLength(SERVICE_LIMITS.lines)
    expect(add(full, draft(nd(1)))[0]?.qty).toBe(2) // an existing line can still grow
  })

  it('does not change the bag it was given', () => {
    const bag = add([], draft(nd(1)))
    const copy = JSON.stringify(bag)
    bagReducer(bag, { type: 'qty', key: bag[0]?.key ?? '', delta: 1 })
    bagReducer(bag, { type: 'remove', key: bag[0]?.key ?? '' })
    bagReducer(bag, { type: 'clear' })
    expect(JSON.stringify(bag)).toBe(copy)
  })

  it('turns the bag into the lines of an order.send command, with no price', () => {
    const bag = add(
      add([], draft(nd(1), { qty: 2, optionIds: [nd(5)], note: 'hot' })),
      draft(nd(2)),
    )
    expect(orderLines(bag)).toEqual([
      { itemId: nd(1), optionIds: [nd(5)], qty: 2, note: 'hot' },
      { itemId: nd(2), optionIds: [], qty: 1, note: '' },
    ])
  })
})

describe('the choices of a dish', () => {
  const view = viewOf([
    {
      name: en('Bowl'),
      groups: [group('Size', 1, 1, [null, 250]), group('Extras', 0, 2, [180, 120, 150])],
    },
    { name: en('Plain') },
    { name: en('Platter'), groups: [group('Sauces', 2, 3, [null, null, null])] },
  ])
  const bowl = itemNamed(view, 'Bowl')
  const [size, extras] = bowl.modifierGroups as [ViewModifierGroup, ViewModifierGroup]
  const platter = itemNamed(view, 'Platter')
  const sauces = platter.modifierGroups[0] as ViewModifierGroup

  it('checks a group against its minimum, its maximum (0 = no limit) and "required"', () => {
    expect(groupValid(size, [])).toBe(false)
    expect(groupValid(size, [size.options[0]?.id ?? ''])).toBe(true)
    expect(
      groupValid(
        size,
        size.options.map((option) => option.id),
      ),
    ).toBe(false)
    expect(groupValid(extras, [])).toBe(true)
    expect(
      groupValid(
        extras,
        extras.options.map((option) => option.id),
      ),
    ).toBe(false) // 3 > max 2
    expect(groupValid(sauces, [])).toBe(false)
    expect(groupValid(sauces, [sauces.options[0]?.id ?? ''])).toBe(false) // 1 < min 2
    expect(
      groupValid(
        sauces,
        sauces.options.map((option) => option.id),
      ),
    ).toBe(true)
    // A maximum of 0 means no limit (the delivery's rule, kept).
    expect(
      groupValid(
        { ...extras, max: 0 },
        extras.options.map((option) => option.id),
      ),
    ).toBe(true)
    // A group that is `required` needs at least one pick even when its minimum says 0.
    expect(groupValid({ ...extras, required: true, min: 0 }, [])).toBe(false)
  })

  it('checks every group of a dish', () => {
    const pickedSize = size.options[0]?.id ?? ''
    expect(selectionValid(bowl.modifierGroups, {})).toBe(false)
    expect(selectionValid(bowl.modifierGroups, { [size.id]: [pickedSize] })).toBe(true)
    expect(selectionValid(itemNamed(view, 'Plain').modifierGroups, {})).toBe(true)
  })

  it('toggles an option: on, off, replaced in a pick-one group, ignored at the maximum', () => {
    const [first, second, third] = extras.options.map((option) => option.id)
    expect(toggleOption(extras, [], first ?? '')).toEqual([first])
    expect(toggleOption(extras, [first ?? ''], second ?? '')).toEqual([first, second])
    expect(toggleOption(extras, [first ?? '', second ?? ''], third ?? '')).toEqual([first, second])
    expect(toggleOption(extras, [first ?? '', second ?? ''], first ?? '')).toEqual([second])
    const [small, large] = size.options.map((option) => option.id)
    expect(toggleOption(size, [small ?? ''], large ?? '')).toEqual([large])
    expect(toggleOption(size, [small ?? ''], small ?? '')).toEqual([])
    // No maximum (0): anything goes.
    const all = sauces.options.map((option) => option.id)
    expect(toggleOption({ ...sauces, max: 0 }, all.slice(0, 2), all[2] ?? '')).toEqual(all)
  })

  it('knows when a dish needs a choice before it can go in the bag', () => {
    expect(needsChoices(bowl)).toBe(true)
    expect(needsChoices(platter)).toBe(true)
    expect(needsChoices(itemNamed(view, 'Plain'))).toBe(false)
    expect(needsChoices({ ...bowl, modifierGroups: [extras] })).toBe(false)
  })

  it('goes from a selection to option ids (in group order) and back', () => {
    const picks = {
      [extras.id]: [extras.options[2]?.id ?? '', extras.options[0]?.id ?? ''],
      [size.id]: [size.options[1]?.id ?? ''],
    }
    const ids = selectedOptionIds(bowl.modifierGroups, picks)
    expect(ids).toEqual([size.options[1]?.id, extras.options[0]?.id, extras.options[2]?.id])
    expect(selectionOf(bowl.modifierGroups, ids)).toEqual({
      [size.id]: [size.options[1]?.id],
      [extras.id]: [extras.options[0]?.id, extras.options[2]?.id],
    })
    expect(selectionOf(bowl.modifierGroups, [nd(999)])).toEqual({})
  })
})

describe('the estimate', () => {
  it('is nothing for an empty bag', () => {
    const view = viewOf([{ name: en('Soup'), price: 700 }])
    const estimate = bagEstimate(view, [])
    expect(estimate.count).toBe(0)
    expect(estimate.total).toMatchObject({ minor: 0, currency: 'EUR' })
    expect(resolveBag(view, []).canSend).toBe(false)
  })

  it('is the unit price plus the options, times the quantity, added up', () => {
    const view = viewOf([
      {
        name: en('Bowl'),
        price: 1000,
        groups: [group('Size', 1, 1, [null, 250]), group('Extras', 0, 3, [180, 120])],
      },
      { name: en('Soup'), price: 700 },
    ])
    const bowl = itemNamed(view, 'Bowl')
    const [size, extras] = bowl.modifierGroups as [ViewModifierGroup, ViewModifierGroup]
    const large = size.options[1]?.id as `nd_${string}`
    const avocado = extras.options[0]?.id as `nd_${string}`
    const egg = extras.options[1]?.id as `nd_${string}`
    let bag = add([], draft(bowl.id, { qty: 2, optionIds: [large, avocado, egg] })) // (1000+250+180+120) × 2
    bag = add(bag, draft(itemNamed(view, 'Soup').id, { qty: 3 })) // 700 × 3
    const estimate = bagEstimate(view, bag)
    expect(estimate.count).toBe(5)
    expect(estimate.total.minor).toBe(3100 + 2100)
    expect(estimate.total.text).toBe('€52.00')
    const resolved = resolveBag(view, bag)
    expect(resolved.lines.map((line) => line.unit?.minor)).toEqual([1550, 700])
    expect(resolved.lines.map((line) => line.total?.minor)).toEqual([3100, 2100])
    expect(resolved.canSend).toBe(true)
  })

  it('does not count the cheapest choice twice for an item priced "from"', () => {
    // Core stores price 800 and price_from 900 (800 + the cheapest Size, +100): the view shows 900.
    const view = viewOf([
      { name: en('Pizza'), price: 800, priceFrom: 900, groups: [group('Size', 1, 1, [100, 250])] },
    ])
    const pizza = itemNamed(view, 'Pizza')
    expect(pizza.price).toMatchObject({ minor: 900, from: true })
    const [small, large] = (pizza.modifierGroups[0]?.options ?? []).map(
      (option) => option.id as `nd_${string}`,
    )
    expect(
      bagEstimate(view, add([], draft(pizza.id, { optionIds: [small as `nd_${string}`] }))).total
        .minor,
    ).toBe(900)
    expect(
      bagEstimate(view, add([], draft(pizza.id, { optionIds: [large as `nd_${string}`], qty: 2 })))
        .total.minor,
    ).toBe(2100)
  })

  it('prices a dish while the guest is still choosing (draftPrice)', () => {
    const view = viewOf([
      {
        name: en('Pizza'),
        price: 800,
        priceFrom: 900,
        groups: [group('Size', 1, 1, [100, 250]), group('Extras', 0, 2, [50, 70])],
      },
    ])
    const pizza = itemNamed(view, 'Pizza')
    const [size, extras] = pizza.modifierGroups as [ViewModifierGroup, ViewModifierGroup]
    const [small, large] = size.options.map((option) => option.id)
    const [cheese] = extras.options.map((option) => option.id)
    // Nothing chosen yet: the "from" price. Choosing moves it.
    expect(draftPrice(view, pizza, [], 1)?.minor).toBe(900)
    expect(draftPrice(view, pizza, [], 2)?.minor).toBe(1800)
    expect(draftPrice(view, pizza, [cheese ?? ''], 1)?.minor).toBe(950)
    expect(draftPrice(view, pizza, [small ?? ''], 1)?.minor).toBe(900)
    expect(draftPrice(view, pizza, [large ?? ''], 1)?.minor).toBe(1050)
    expect(draftPrice(view, pizza, [large ?? '', cheese ?? ''], 3)?.minor).toBe(3300)
    // A complete line costs what the bag says it costs.
    const bag = add([], draft(pizza.id, { qty: 3, optionIds: [large, cheese] as `nd_${string}`[] }))
    expect(resolveBag(view, bag).total.minor).toBe(3300)
    // Nothing for an option the dish does not offer, or an unusable quantity.
    expect(draftPrice(view, pizza, [nd(999)], 1)).toBeNull()
    expect(draftPrice(view, pizza, [], 1.5)).toBeNull()
    expect(draftPrice(view, pizza, [], -1)).toBeNull()
  })

  it('equals core money arithmetic for any menu and bag (property)', () => {
    const itemArbitrary = fc.record({
      price: fc.integer({ min: 0, max: 5_000_000 }),
      deltas: fc.array(fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null }), {
        minLength: 1,
        maxLength: 4,
      }),
      required: fc.boolean(),
    })
    fc.assert(
      fc.property(
        fc.array(itemArbitrary, { minLength: 1, maxLength: 6 }),
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.integer({ min: 1, max: 50 })), {
          minLength: 1,
          maxLength: 8,
        }),
        (specs, picks) => {
          const view = viewOf(
            specs.map((spec, index) => {
              // `priceFrom` as core computes it: the price plus the cheapest delta of a required group.
              const cheapest = Math.min(...spec.deltas.map((delta) => delta ?? 0))
              return {
                name: en(`Item ${index}`),
                price: spec.price,
                ...(spec.required && cheapest > 0 ? { priceFrom: spec.price + cheapest } : {}),
                groups: [group('Choice', spec.required ? 1 : 0, 1, spec.deltas)],
              }
            }),
          )
          const items = itemsOf(view)
          let bag: readonly BagLine[] = []
          let expected = 0n
          for (const [itemPick, optionPick, qty] of picks) {
            const index = itemPick % items.length
            const item = items[index]
            const spec = specs[index]
            if (item === undefined || spec === undefined) continue
            const options = item.modifierGroups[0]?.options ?? []
            const optionIndex = spec.required
              ? optionPick % options.length
              : optionPick % (options.length + 1)
            const option = options[optionIndex]
            bag = add(
              bag,
              draft(item.id, { qty, optionIds: option === undefined ? [] : [option.id] }),
            )
          }
          for (const line of bag) {
            const index = items.findIndex((item) => item.id === line.itemId)
            const spec = specs[index]
            const options = items[index]?.modifierGroups[0]?.options ?? []
            const delta = options.findIndex((option) => option.id === line.optionIds[0])
            const unit =
              BigInt(spec?.price ?? 0) + BigInt(delta < 0 ? 0 : (spec?.deltas[delta] ?? 0))
            expected += unit * BigInt(line.qty)
          }
          const estimate = bagEstimate(view, bag)
          expect(BigInt(estimate.total.minor)).toBe(expected)
          // And it is core's own arithmetic, line by line.
          const resolved = resolveBag(view, bag)
          const sum = resolved.lines.reduce(
            (total, line) => addMinor(total, line.total?.minor ?? 0),
            0,
          )
          expect(estimate.total.minor).toBe(sum)
          for (const line of resolved.lines) {
            expect(line.total?.minor).toBe(multiplyMinor(line.unit?.minor ?? 0, line.line.qty))
          }
          expect(estimate.count).toBe(bag.reduce((n, line) => n + line.qty, 0))
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('a line that can no longer be ordered', () => {
  const specs: ItemSpec[] = [
    { name: en('Soup'), price: 700 },
    { name: en('Bowl'), price: 1000, groups: [group('Size', 1, 1, [null, 250])] },
    { name: en('Steak'), price: 2400 },
  ]
  const view = viewOf(specs)
  const soup = itemNamed(view, 'Soup')
  const bowl = itemNamed(view, 'Bowl')
  const steak = itemNamed(view, 'Steak')
  const large = bowl.modifierGroups[0]?.options[1]?.id as `nd_${string}`
  const bag = add(
    add(add([], draft(soup.id, { qty: 2 })), draft(bowl.id, { optionIds: [large] })),
    draft(steak.id),
  )

  it('is sendable while everything is on the menu', () => {
    const resolved = resolveBag(view, bag)
    expect(resolved.canSend).toBe(true)
    expect(resolved.lines.every((line) => line.available)).toBe(true)
    expect(resolved.total.minor).toBe(1400 + 1250 + 2400)
  })

  it('is flagged and blocks sending when its item sold out (R5, R11), and is left out of the total', () => {
    const soldOut = viewOf(
      specs.map((spec) => (spec.name.en_US === 'Steak' ? { ...spec, soldOut: true } : spec)),
    )
    // The fixture numbers its ids in order, so the same specs give the same ids and the bag still points at them.
    const resolved = resolveBag(soldOut, bag)
    const flagged = resolved.lines.filter((line) => !line.available)
    expect(flagged.map((line) => line.item)).toEqual([null])
    // The menu no longer draws it (D131); the order still names it.
    expect(flagged.map((line) => line.hidden?.name.text)).toEqual(['Steak'])
    expect(flagged[0]?.unit).toBeNull()
    expect(flagged[0]?.total).toBeNull()
    expect(resolved.canSend).toBe(false)
    expect(resolved.total.minor).toBe(1400 + 1250)
    expect(resolved.count).toBe(4) // the unavailable line still counts as a thing in the bag
    // Removing it unblocks the bag.
    const key = flagged[0]?.line.key ?? ''
    expect(resolveBag(soldOut, bagReducer(bag, { type: 'remove', key })).canSend).toBe(true)
  })

  it('is flagged when ordering controls are off for the item (an ask-waiter item, R11)', () => {
    const asked = viewOf(
      specs.map((spec) => (spec.name.en_US === 'Soup' ? { ...spec, askWaiter: true } : spec)),
    )
    const resolved = resolveBag(asked, bag)
    expect(resolved.lines.find((line) => line.item?.name.text === 'Soup')?.available).toBe(false)
    expect(resolved.canSend).toBe(false)
  })

  it('is flagged for the whole bag when ordering is off for the venue', () => {
    const off = viewOf(specs, { orderingEnabled: false })
    expect(resolveBag(off, bag).lines.every((line) => !line.available)).toBe(true)
    expect(resolveBag(off, bag).canSend).toBe(false)
  })

  it('is flagged when the item left the view', () => {
    const fewer = viewOf(specs.slice(0, 2))
    const resolved = resolveBag(fewer, bag)
    const gone = resolved.lines.find((line) => line.line.itemId === steak.id)
    expect(gone).toMatchObject({ item: null, unit: null, total: null, available: false })
    expect(resolved.canSend).toBe(false)
  })

  it('is flagged when a chosen option left the view', () => {
    const noLarge = viewOf(
      specs.map((spec) =>
        spec.groups === undefined ? spec : { ...spec, groups: [group('Size', 1, 1, [null])] },
      ),
    )
    const resolved = resolveBag(noLarge, bag)
    expect(resolved.lines.find((line) => line.item?.name.text === 'Bowl')?.available).toBe(false)
    expect(resolved.canSend).toBe(false)
  })

  it('is flagged when the choices it has no longer satisfy the dish', () => {
    // The Bowl line was added without a Size, which the dish now requires.
    const unsized = add([], draft(bowl.id))
    const resolved = resolveBag(view, unsized)
    expect(resolved.lines[0]?.available).toBe(false)
    expect(resolved.canSend).toBe(false)
  })

  it('is flagged when the item has no price', () => {
    const free = viewOf([{ name: en('Water'), price: null }])
    const water = itemNamed(free, 'Water')
    const resolved = resolveBag(free, add([], draft(water.id)))
    expect(resolved.lines[0]?.available).toBe(false)
  })

  it('cannot be sent when the bag is empty', () => {
    expect(resolveBag(view, []).canSend).toBe(false)
  })
})
