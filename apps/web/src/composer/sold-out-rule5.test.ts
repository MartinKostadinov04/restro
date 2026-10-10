// Rule 5 for "sold out tonight" (brief S3-08, D46), across every layer a manager's mark passes
// through: for ANY sequence of marks, unmarks, attempts to write "on sale", barsy changes and
// service days, an item that barsy has off sale is never available in the snapshot, the live
// overlay, the guest's view model or the composer's view. And putting an item "back on sale" never
// makes it more available than barsy says: it is on sale exactly when barsy has it on sale and no
// mark of tonight is on it.
//
// The model is pure (no database): the writes go through the same checks `apply()` runs
// (`validateWrite` and the layer rules), the document is resolved the way the publisher and the
// composer resolve it (`snapshotEditions` / `liveEditions`), and the snapshot, the overlay and the
// shell's view model are the real ones. The database version of the same property, through the
// real `apply()`, is in packages/core/src/apply/sold-out.test.ts.
import {
  buildLiveOverlay,
  buildSnapshot,
  isLayer,
  type Layer,
  layerAllowedForSource,
  liveEditions,
  type MenuDocument,
  type MenuSnapshot,
  type NodeId,
  newId,
  resolve,
  type Scope,
  serviceDate,
  serviceEditionLayer,
  snapshotEditions,
  VENUE_MENU_TEMPLATE,
  validateWrite,
} from '@restro/core'
import { buildViewModel, type ViewItem, type ViewSection } from '@restro/shell'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildComposerView } from './view-model'

const venueId = newId('vn')
const integration = newId('in')
const menuId = newId('nd')
const sectionId = newId('nd')
const ITEMS = [newId('nd'), newId('nd'), newId('nd'), newId('nd')] as const
const HASH = 'a'.repeat(64)

type Row = MenuDocument['values'][number]

const row = (
  nodeId: NodeId,
  fieldKey: string,
  layer: Layer,
  value: unknown,
  scope: Scope,
): Row => ({
  nodeId,
  fieldKey,
  layer,
  scope,
  value,
  valueHash: HASH,
  source: layer === 'barsy' ? `barsy:${integration}` : 'manual',
  observedAt: '2026-10-09T10:00:00.000Z',
  basis: null,
  valid: true,
})

/** The nights the sequences move through: 23:00 on three consecutive evenings. */
const NIGHTS = [
  new Date('2026-10-09T20:00:00Z'),
  new Date('2026-10-10T20:00:00Z'),
  new Date('2026-10-11T20:00:00Z'),
]
const TIME_ZONE = 'Europe/Sofia'

type Step =
  | { kind: 'mark'; item: number; night: number }
  | { kind: 'unmark'; item: number; night: number }
  /** Somebody tries to write "on sale" into the service edition (a forged request). */
  | { kind: 'forceOnSale'; item: number; night: number }
  /** Barsy takes the item off sale, or puts it back. */
  | { kind: 'barsy'; item: number; forSale: boolean }
  /** The clock moves to another evening. */
  | { kind: 'goTo'; night: number }

const index = fc.integer({ min: 0, max: ITEMS.length - 1 })
const night = fc.integer({ min: 0, max: NIGHTS.length - 1 })
const step: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('mark' as const), item: index, night }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant('unmark' as const), item: index, night }), weight: 3 },
  {
    arbitrary: fc.record({ kind: fc.constant('forceOnSale' as const), item: index, night }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('barsy' as const),
      item: index,
      forSale: fc.boolean(),
    }),
    weight: 3,
  },
  { arbitrary: fc.record({ kind: fc.constant('goTo' as const), night }), weight: 2 },
)
const startingFlags = fc.tuple(...ITEMS.map(() => fc.boolean()))

function documentOf(rows: readonly Row[]): MenuDocument {
  const node = (
    id: NodeId,
    type: MenuDocument['nodes'][number]['type'],
    parentId: NodeId | null,
    sortKey: string | null,
  ) => ({ id, type, parentId, status: 'active' as const, revision: 1, sortKey })
  return {
    menu: {
      id: menuId,
      venueId,
      templateKey: 'venue-menu',
      templateVersion: 1,
      rootNodeId: menuId,
    },
    nodes: [
      node(menuId, 'menu', null, null),
      node(sectionId, 'section', menuId, 'a0'),
      ...ITEMS.map((id) => node(id, 'item', null, null)),
    ],
    placements: ITEMS.map((itemId, i) => ({ itemId, sectionId, sortKey: `a${i}` })),
    values: [...rows],
    links: ITEMS.map((id) => ({
      nodeId: id,
      source: `barsy:${integration}` as const,
      externalType: 'article',
      state: 'active' as const,
    })),
  }
}

const itemsOf = (sections: readonly ViewSection[]): ViewItem[] =>
  sections.flatMap((section) => [...section.items, ...itemsOf(section.sections)])

describe('rule 5 for sold out tonight', () => {
  it('no sequence of marks, unmarks and forged writes makes an item more available than barsy says', () => {
    fc.assert(
      fc.property(
        startingFlags,
        fc.array(step, { minLength: 1, maxLength: 20 }),
        (flags, steps) => {
          // The state of the document: barsy's flag per item, and the marks per night per item.
          const barsy = new Map<NodeId, boolean>(ITEMS.map((id, i) => [id, flags[i] ?? true]))
          const marks = new Set<string>() // `${item}|${night}`
          let current = 0
          let refusedForces = 0

          const rows = (): Row[] => [
            row(sectionId, 'title', 'manual', { bg_BG: 'Коктейли', en_US: 'Cocktails' }, 'master'),
            ...ITEMS.flatMap((id, i) => [
              row(id, 'name', 'barsy', { bg_BG: `Напитка ${i}`, en_US: `Drink ${i}` }, 'master'),
              row(
                id,
                'price',
                'barsy',
                { amount_minor: 800 + i, currency: 'EUR' },
                `venue:${venueId}`,
              ),
              row(id, 'for_sale', 'barsy', barsy.get(id), `venue:${venueId}`),
              row(id, 'visible', 'barsy', true, 'master'),
              row(id, 'allergens', 'barsy', [], 'master'),
            ]),
            ...[...marks].map((key) => {
              const [i, n] = key.split('|').map(Number) as [number, number]
              const day = serviceDate(NIGHTS[n] as Date, TIME_ZONE, '07:00')
              return row(ITEMS[i] as NodeId, 'for_sale', serviceEditionLayer(day), false, 'master')
            }),
          ]

          for (const s of steps) {
            if (s.kind === 'goTo') current = s.night
            else if (s.kind === 'barsy') barsy.set(ITEMS[s.item] as NodeId, s.forSale)
            else {
              const layer = serviceEditionLayer(
                serviceDate(NIGHTS[s.night] as Date, TIME_ZONE, '07:00'),
              )
              // The same gates apply() runs: the layer is a manual change set's to write, and
              // validateWrite passes only `false` for an `all_true` flag outside barsy.
              expect(isLayer(layer) && layerAllowedForSource('manual', layer)).toBe(true)
              const write = (value: unknown) => ({
                op: 'setField' as const,
                node: { id: ITEMS[s.item] as NodeId },
                fieldKey: 'for_sale',
                layer,
                scope: 'master' as const,
                value: value as never,
              })
              if (s.kind === 'mark') {
                expect(validateWrite(VENUE_MENU_TEMPLATE, 'item', write(false)).ok).toBe(true)
                marks.add(`${s.item}|${s.night}`)
              } else if (s.kind === 'unmark') {
                marks.delete(`${s.item}|${s.night}`) // a clearField: no value is written at all
              } else {
                // "On sale" is refused outright, so nothing is stored (and nothing changes).
                expect(validateWrite(VENUE_MENU_TEMPLATE, 'item', write(true)).ok).toBe(false)
                refusedForces += 1
              }
            }

            // --- what every layer says now -----------------------------------------------------
            const now = NIGHTS[current] as Date
            const day = serviceDate(now, TIME_ZONE, '07:00')
            const context = {
              venueScope: `venue:${venueId}` as const,
              locales: ['bg_BG', 'en_US'] as ('bg_BG' | 'en_US')[],
              now: now.toISOString(),
            }
            const document = documentOf(rows())
            const forSnapshot = resolve(VENUE_MENU_TEMPLATE, document, {
              ...context,
              edition: snapshotEditions(venueId),
            })
            const forLive = resolve(VENUE_MENU_TEMPLATE, document, {
              ...context,
              edition: liveEditions(venueId, day),
            })
            const snapshot: MenuSnapshot = buildSnapshot(forSnapshot, {
              template: VENUE_MENU_TEMPLATE,
              snapshotId: newId('sn'),
              version: 1,
              publishedAt: now.toISOString(),
              menuId,
              venueId,
              edition: ['master', ...snapshotEditions(venueId)],
              locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
              currency: 'EUR',
              assets: {},
              tagVocabulary: {},
            })
            const overlay = buildLiveOverlay(forLive, snapshot)
            const guests = buildViewModel(snapshot, overlay, {
              locale: 'bg_BG',
              now: now.toISOString(),
              timeZone: TIME_ZONE,
            })
            const guestItems = new Map(itemsOf(guests.sections).map((item) => [item.id, item]))
            const composer = buildComposerView({
              doc: document,
              resolved: forLive,
              displayLocale: 'bg_BG',
            })

            for (const [i, id] of ITEMS.entries()) {
              const barsyOff = barsy.get(id) === false
              const markedTonight = marks.has(`${i}|${current}`)
              const available = !barsyOff && !markedTonight
              const view = guestItems.get(id)

              // The snapshot knows barsy's flag and never a mark.
              expect(snapshot.items[id]?.availability.state, `snapshot ${i}`).toBe(
                barsyOff ? 'sold_out' : 'available',
              )
              // The overlay lists exactly what is off sale for any reason tonight.
              expect(Object.hasOwn(overlay.items, id), `overlay ${i}`).toBe(!available)
              // Guests: available only if barsy has it on sale and no mark of tonight is on it.
              expect(view?.state.code, `guest view ${i}`).toBe(available ? 'available' : 'sold_out')
              if (barsyOff) expect(view?.state.code).not.toBe('available')
              // The composer: barsy's flag is barsy's, a mark is ours, and they never get mixed up.
              const shown = composer.items[id]
              expect(shown?.offSale, `composer ${i}`).toBe(barsyOff ? 'barsy' : null)
              expect(shown?.soldOutTonight, `composer mark ${i}`).toBe(!barsyOff && markedTonight)
            }
          }
          expect(refusedForces).toBeGreaterThanOrEqual(0)
        },
      ),
      { numRuns: 120 },
    )
  }, 60_000)

  it('does not make the property vacuous: marks, forged writes and barsy changes all occur', () => {
    const seen = { mark: 0, unmark: 0, forceOnSale: 0, barsy: 0, goTo: 0 }
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 20 }), (steps) => {
        for (const s of steps) seen[s.kind] += 1
      }),
      { numRuns: 100, seed: 20261010 },
    )
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(20)
  })
})
