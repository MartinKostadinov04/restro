// concludeVenuePull (brief CF-16): rule 6 per catalogue and per venue, with the CF-02 holds per
// scope. Examples first, then the fast-check properties the brief names:
//   - never conclude absence from an incomplete read, nor for an item outside the read catalogue;
//   - two venues on one catalogue with different roots: no item of the catalogue is concluded
//     absent because one venue's root does not hold it;
//   - rule 5 stays: nothing here brings an item back, shows it or touches a price.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { LinkStateName } from '../change-set'
import {
  type CatalogueItemLink,
  type ChildLink,
  concludeVenuePull,
  type ScopedLink,
  type ScopedPullEvidence,
} from './conclude-scopes'

const NOW = new Date('2026-10-11T12:00:00+03:00')
const START = new Date(NOW.getTime() - 60_000)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const link = (key: string, state: LinkStateName = 'active', changed = HOUR): ScopedLink => ({
  key,
  state,
  stateChangedAt: ago(changed),
  lastSeenAt: ago(2 * HOUR),
})
const item = (
  id: number,
  catalogueId: number | null = 72,
  state: LinkStateName = 'active',
): CatalogueItemLink => ({ ...link(`article:${id}`, state), catalogueId })
const child = (key: string, parent: number, state: LinkStateName = 'active'): ChildLink => ({
  ...link(key, state),
  parentKey: `article:${parent}`,
})
const keys = (...ids: number[]) => new Set(ids.map((id) => `article:${id}`))

/** Twenty items of catalogue 72, two sections, everything seen and shown: a quiet full pull. */
function evidence(overrides: Partial<ScopedPullEvidence> = {}): ScopedPullEvidence {
  const ids = Array.from({ length: 20 }, (_, index) => index + 1)
  return {
    pagesOk: [true, true, true],
    now: NOW,
    start: START,
    catalogue: {
      catalogueId: 72,
      items: ids.map((id) => item(id)),
      seen: keys(...ids),
      deletedSeen: new Set(),
    },
    venue: {
      sections: [link('category:1131'), link('category:1133')],
      sectionsSeen: new Set(['category:1131', 'category:1133']),
      shown: keys(...ids),
      inRoot: keys(...ids),
    },
    children: [],
    childrenSeen: new Set(),
    ...overrides,
  }
}

describe('concludeVenuePull: examples', () => {
  it('a quiet complete pull concludes nothing', () => {
    expect(concludeVenuePull(evidence())).toEqual({
      complete: true,
      moves: [],
      venueHides: [],
      held: [],
      raced: 0,
    })
  })

  it('an item the catalogue no longer lists goes missing; one only outside the root is hidden here', () => {
    const base = evidence()
    const result = concludeVenuePull(
      evidence({
        catalogue: {
          ...(base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>),
          seen: keys(...range(2, 20)),
        },
        venue: { ...base.venue, inRoot: keys(...range(3, 20)) },
      }),
    )
    expect(result.moves).toEqual([{ key: 'article:1', to: 'missing' }])
    expect(result.venueHides).toEqual(['article:2'])
    expect(result.held).toEqual([])
  })

  it('never touches an item of another catalogue, or of none known', () => {
    const base = evidence()
    const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
    const result = concludeVenuePull(
      evidence({
        catalogue: { ...catalogue, items: [...catalogue.items, item(500, 1), item(501, null)] },
      }),
    )
    expect(result.moves).toEqual([])
  })

  it('a missing item stays missing for the grace period, then goes deleted', () => {
    const base = evidence()
    const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
    const stale: CatalogueItemLink = { ...item(30, 72, 'missing'), stateChangedAt: ago(8 * DAY) }
    const fresh: CatalogueItemLink = { ...item(31, 72, 'missing'), stateChangedAt: ago(DAY) }
    const result = concludeVenuePull(
      evidence({ catalogue: { ...catalogue, items: [...catalogue.items, stale, fresh] } }),
    )
    expect(result.moves).toEqual([{ key: 'article:30', to: 'deleted' }])
  })

  it('the race guard: a link another run saw after this pull started is left alone', () => {
    const base = evidence()
    const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
    const late: CatalogueItemLink = { ...item(40), lastSeenAt: new Date(START.getTime() + 1) }
    const result = concludeVenuePull(
      evidence({ catalogue: { ...catalogue, items: [...catalogue.items, late] } }),
    )
    expect(result.moves).toEqual([])
    expect(result.raced).toBe(1)
  })

  it('options follow their combo: concluded when the combo was mapped here or is gone', () => {
    const base = evidence()
    const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
    const result = concludeVenuePull(
      evidence({
        catalogue: { ...catalogue, seen: keys(...range(2, 20)) },
        venue: { ...base.venue, inRoot: keys(...range(3, 20)) },
        children: [
          child('supplement_group:1:5', 1), // combo gone from the catalogue
          child('supplement_group:2:5', 2), // combo kept, outside this root: another venue's
          child('supplement_group:3:5', 3), // combo mapped here, group no longer listed
          child('supplement_group:3:6', 3), // combo mapped here, group listed
        ],
        childrenSeen: new Set(['supplement_group:3:6']),
      }),
    )
    expect(result.moves).toEqual([
      { key: 'article:1', to: 'missing' },
      { key: 'supplement_group:1:5', to: 'missing' },
      { key: 'supplement_group:3:5', to: 'missing' },
    ])
  })

  it('the venue’s sections go missing from the read of its root', () => {
    const base = evidence()
    const result = concludeVenuePull(
      evidence({ venue: { ...base.venue, sectionsSeen: new Set(['category:1131']) } }),
    )
    expect(result.moves).toEqual([{ key: 'category:1133', to: 'missing' }])
  })

  it('no catalogue known: nothing per catalogue; the venue still hides what its root dropped', () => {
    const base = evidence()
    const result = concludeVenuePull(
      evidence({ catalogue: null, venue: { ...base.venue, inRoot: keys(...range(2, 20)) } }),
    )
    expect(result.moves).toEqual([])
    expect(result.venueHides).toEqual(['article:1'])
  })

  describe('holds (CF-02, T62) per scope', () => {
    it('a catalogue read that would hide more than 30% holds everything, venue included', () => {
      const base = evidence()
      const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
      const result = concludeVenuePull(
        evidence({
          catalogue: { ...catalogue, seen: keys(...range(8, 20)) },
          venue: { ...base.venue, sectionsSeen: new Set(['category:1131']), inRoot: keys(9, 10) },
        }),
      )
      expect(result).toMatchObject({ moves: [], venueHides: [] })
      expect(result.held).toEqual([
        { scope: 'catalogue', what: 'items', reason: 'too_many_missing', wouldHide: 7, active: 20 },
      ])
    })

    it('an empty catalogue read holds', () => {
      const base = evidence()
      const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
      const result = concludeVenuePull(evidence({ catalogue: { ...catalogue, seen: new Set() } }))
      expect(result.held[0]).toMatchObject({ scope: 'catalogue', reason: 'empty_read' })
      expect(result.moves).toEqual([])
    })

    it('a venue whose root would hide most of its menu holds the venue only', () => {
      const base = evidence()
      const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
      const result = concludeVenuePull(
        evidence({
          catalogue: { ...catalogue, seen: keys(...range(2, 20)) },
          venue: { ...base.venue, sectionsSeen: new Set(['category:1131']), inRoot: keys(2, 3) },
        }),
      )
      // The catalogue still concludes: article 1 is gone from barsy.
      expect(result.moves).toEqual([{ key: 'article:1', to: 'missing' }])
      expect(result.venueHides).toEqual([])
      expect(result.held).toEqual([
        { scope: 'venue', what: 'items', reason: 'too_many_missing', wouldHide: 17, active: 20 },
      ])
    })

    it('a root read with no section holds the venue; a smaller root does not', () => {
      const base = evidence()
      const empty = concludeVenuePull(
        evidence({ venue: { ...base.venue, sectionsSeen: new Set() } }),
      )
      expect(empty.held).toEqual([
        { scope: 'venue', what: 'sections', reason: 'empty_read', wouldHide: 2, active: 2 },
      ])
      expect(empty.moves).toEqual([])
    })
  })

  it('an incomplete pull concludes nothing', () => {
    const base = evidence()
    const catalogue = base.catalogue as NonNullable<ScopedPullEvidence['catalogue']>
    const result = concludeVenuePull(
      evidence({
        pagesOk: [true, false],
        catalogue: { ...catalogue, seen: new Set() },
        venue: { ...base.venue, sectionsSeen: new Set(), inRoot: new Set() },
      }),
    )
    expect(result).toEqual({ complete: false, moves: [], venueHides: [], held: [], raced: 0 })
  })
})

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

// --- properties ------------------------------------------------------------------------------

const stateArb = fc.constantFrom<LinkStateName>('active', 'missing', 'deleted')
const idArb = fc.integer({ min: 1, max: 40 })
const catalogueArb = fc.constantFrom<number | null>(72, 72, 72, 1, null)

/** A random installation: item links in several catalogues, a read of catalogue 72, a venue. */
const caseArb = fc
  .record({
    items: fc.uniqueArray(fc.tuple(idArb, catalogueArb, stateArb, fc.nat({ max: 20 })), {
      selector: ([id]) => id,
      maxLength: 30,
    }),
    seen: fc.uniqueArray(idArb, { maxLength: 40 }),
    inRoot: fc.uniqueArray(idArb, { maxLength: 40 }),
    shown: fc.uniqueArray(idArb, { maxLength: 40 }),
    sections: fc.uniqueArray(fc.tuple(fc.integer({ min: 1, max: 10 }), stateArb), {
      selector: ([id]) => id,
      maxLength: 10,
    }),
    sectionsSeen: fc.uniqueArray(fc.integer({ min: 1, max: 10 }), { maxLength: 10 }),
    children: fc.uniqueArray(fc.tuple(fc.integer({ min: 1, max: 20 }), idArb, stateArb), {
      selector: ([id]) => id,
      maxLength: 15,
    }),
    childrenSeen: fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { maxLength: 20 }),
    pagesOk: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
    knownCatalogue: fc.boolean(),
  })
  .map((c): ScopedPullEvidence => {
    const seen = new Set(c.seen.map((id) => `article:${id}`))
    const inRoot = new Set(
      c.inRoot.filter((id) => seen.has(`article:${id}`)).map((id) => `article:${id}`),
    )
    const items = c.items.map(([id, catalogueId, state, days]) => ({
      ...item(id, catalogueId, state),
      stateChangedAt: ago(days * DAY),
    }))
    const active = new Set(items.filter((l) => l.state === 'active').map((l) => l.key))
    return {
      pagesOk: c.pagesOk,
      now: NOW,
      start: START,
      catalogue: c.knownCatalogue ? { catalogueId: 72, items, seen, deletedSeen: new Set() } : null,
      venue: {
        sections: c.sections.map(([id, state]) => link(`category:${id}`, state)),
        sectionsSeen: new Set(c.sectionsSeen.map((id) => `category:${id}`)),
        shown: new Set(c.shown.map((id) => `article:${id}`).filter((key) => active.has(key))),
        inRoot,
      },
      children: c.children.map(([id, parent, state]) => child(`supplement:${id}`, parent, state)),
      childrenSeen: new Set(c.childrenSeen.map((id) => `supplement:${id}`)),
    }
  })

describe('concludeVenuePull: properties (fast-check)', () => {
  it('an incomplete read concludes nothing, in any scope (rule 6)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const incomplete = { ...c, pagesOk: [...c.pagesOk, false] }
        const result = concludeVenuePull(incomplete)
        expect(result.complete).toBe(false)
        expect(result.moves).toEqual([])
        expect(result.venueHides).toEqual([])
      }),
    )
  })

  it('never moves an item link outside the read catalogue (another catalogue, or unknown)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const outside = new Set(
          (c.catalogue?.items ?? [])
            .filter((l) => l.catalogueId !== c.catalogue?.catalogueId)
            .map((l) => l.key),
        )
        for (const move of concludeVenuePull(c).moves) expect(outside.has(move.key)).toBe(false)
      }),
    )
  })

  it('without a catalogue read no item link moves at all; only options and sections may', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = concludeVenuePull({ ...c, catalogue: null })
        for (const move of result.moves) expect(move.key.startsWith('article:')).toBe(false)
      }),
    )
  })

  it('two venues, one catalogue, different roots: an item the catalogue lists is never concluded absent', () => {
    fc.assert(
      fc.property(caseArb, fc.uniqueArray(idArb, { maxLength: 40 }), (c, otherRoot) => {
        const listed = c.catalogue?.seen ?? new Set<string>()
        // The same read as seen from a second venue whose root holds other items.
        const other: ScopedPullEvidence = {
          ...c,
          venue: {
            ...c.venue,
            inRoot: new Set(
              otherRoot.map((id) => `article:${id}`).filter((key) => listed.has(key)),
            ),
          },
        }
        for (const result of [concludeVenuePull(c), concludeVenuePull(other)]) {
          for (const move of result.moves) expect(listed.has(move.key)).toBe(false)
        }
      }),
    )
  })

  it('rule 5: only moves to missing or deleted and hides of what the venue shows; nothing comes back', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = concludeVenuePull(c)
        for (const move of result.moves) expect(['missing', 'deleted']).toContain(move.to)
        for (const key of result.venueHides) {
          expect(c.venue.shown.has(key)).toBe(true)
          expect(c.venue.inRoot.has(key)).toBe(false)
        }
      }),
    )
  })

  it('a hold for a scope means no move and no hide for that scope', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = concludeVenuePull(c)
        if (result.held.some((hold) => hold.scope === 'catalogue')) {
          expect(result.moves).toEqual([])
          expect(result.venueHides).toEqual([])
        }
        if (result.held.some((hold) => hold.scope === 'venue')) {
          expect(result.venueHides).toEqual([])
          for (const move of result.moves) expect(move.key.startsWith('category:')).toBe(false)
        }
      }),
    )
  })

  it('does not depend on the order of the stored links', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const reversed: ScopedPullEvidence = {
          ...c,
          catalogue: c.catalogue && { ...c.catalogue, items: [...c.catalogue.items].reverse() },
          venue: { ...c.venue, sections: [...c.venue.sections].reverse() },
          children: [...c.children].reverse(),
        }
        expect(concludeVenuePull(reversed)).toEqual(concludeVenuePull(c))
      }),
    )
  })
})
