// How the composer's view reads the sale state of an item (brief S3-08, D46), and the optimistic
// reducer for marking. The document is resolved the way the composer tab resolves it, with the
// live editions of a service day.
import {
  type Layer,
  liveEditions,
  type MenuDocument,
  type NodeId,
  newId,
  resolve,
  type Scope,
  serviceEditionLayer,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import { reduceView } from './reducer'
import { buildComposerView } from './view-model'

const venueId = newId('vn')
const integration = newId('in')
const HASH = 'a'.repeat(64)
const TONIGHT = '2026-10-09'
const YESTERDAY = '2026-10-08'

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
  source: layer === 'till' ? `till:${integration}` : 'manual',
  observedAt: '2026-10-09T10:00:00.000Z',
  basis: null,
  valid: true,
})

const ids = {
  menu: newId('nd'),
  section: newId('nd'),
  onSale: newId('nd'),
  markedTonight: newId('nd'),
  markedYesterday: newId('nd'),
  barsyOff: newId('nd'),
  barsyOffAndMarked: newId('nd'),
  manualOff: newId('nd'),
}
const ITEM_IDS = [
  ids.onSale,
  ids.markedTonight,
  ids.markedYesterday,
  ids.barsyOff,
  ids.barsyOffAndMarked,
  ids.manualOff,
]

const barsyItem = (id: NodeId, forSale: boolean): Row[] => [
  row(id, 'name', 'till', { bg_BG: 'Артикул', en_US: 'Item' }, 'master'),
  row(id, 'price', 'till', { amount_minor: 900, currency: 'EUR' }, `venue:${venueId}`),
  row(id, 'for_sale', 'till', forSale, `venue:${venueId}`),
  row(id, 'visible', 'till', true, 'master'),
  row(id, 'allergens', 'till', [], 'master'),
]

const document: MenuDocument = {
  menu: {
    id: ids.menu,
    venueId,
    templateKey: 'venue-menu',
    templateVersion: 1,
    rootNodeId: ids.menu,
  },
  nodes: [
    { id: ids.menu, type: 'menu', parentId: null, status: 'active', revision: 1, sortKey: null },
    {
      id: ids.section,
      type: 'section',
      parentId: ids.menu,
      status: 'active',
      revision: 1,
      sortKey: 'a0',
    },
    ...ITEM_IDS.map((id) => ({
      id,
      type: 'item' as const,
      parentId: null,
      status: 'active' as const,
      revision: 1,
      sortKey: null,
    })),
  ],
  placements: ITEM_IDS.map((itemId, index) => ({
    itemId,
    sectionId: ids.section,
    sortKey: `a${index}`,
  })),
  values: [
    row(ids.section, 'title', 'manual', { bg_BG: 'Коктейли' }, 'master'),
    ...barsyItem(ids.onSale, true),
    ...barsyItem(ids.markedTonight, true),
    row(ids.markedTonight, 'for_sale', serviceEditionLayer(TONIGHT), false, 'master'),
    ...barsyItem(ids.markedYesterday, true),
    row(ids.markedYesterday, 'for_sale', serviceEditionLayer(YESTERDAY), false, 'master'),
    ...barsyItem(ids.barsyOff, false),
    ...barsyItem(ids.barsyOffAndMarked, false),
    row(ids.barsyOffAndMarked, 'for_sale', serviceEditionLayer(TONIGHT), false, 'master'),
    ...barsyItem(ids.manualOff, true),
    // Not something the UI can write today; a row like this still must not read as "ours".
    row(ids.manualOff, 'for_sale', 'manual', false, 'master'),
  ],
  links: ITEM_IDS.filter((id) => id !== ids.manualOff).map((nodeId) => ({
    nodeId,
    source: `till:${integration}` as const,
    externalType: 'article',
    state: 'active' as const,
  })),
}

function viewFor(day: string) {
  const resolved = resolve(VENUE_MENU_TEMPLATE, document, {
    venueScope: `venue:${venueId}`,
    edition: liveEditions(venueId, day),
    locales: ['bg_BG', 'en_US'],
    now: '2026-10-09T21:00:00+03:00',
  })
  return buildComposerView({ doc: document, resolved, displayLocale: 'bg_BG' })
}

describe('the sale state in the composer view', () => {
  const view = viewFor(TONIGHT)
  const sale = (id: NodeId) => {
    const item = view.items[id]
    return { soldOutTonight: item?.soldOutTonight, offSale: item?.offSale }
  }

  it('is on sale when nothing says otherwise', () => {
    expect(sale(ids.onSale)).toEqual({ soldOutTonight: false, offSale: null })
  })

  it('reads a mark of tonight as ours, and a mark of an earlier evening as nothing', () => {
    expect(sale(ids.markedTonight)).toEqual({ soldOutTonight: true, offSale: null })
    expect(sale(ids.markedYesterday)).toEqual({ soldOutTonight: false, offSale: null })
    // The same document on the evening that mark belongs to.
    expect(viewFor(YESTERDAY).items[ids.markedYesterday]).toMatchObject({ soldOutTonight: true })
    expect(viewFor(YESTERDAY).items[ids.markedTonight]).toMatchObject({ soldOutTonight: false })
  })

  it("reads barsy's flag as barsy's, even with a mark of tonight under it", () => {
    expect(sale(ids.barsyOff)).toEqual({ soldOutTonight: false, offSale: 'till' })
    expect(sale(ids.barsyOffAndMarked)).toEqual({ soldOutTonight: false, offSale: 'till' })
  })

  it('reads any other layer\'s flag as "other", which is not ours to undo either', () => {
    expect(sale(ids.manualOff)).toEqual({ soldOutTonight: false, offSale: 'other' })
  })
})

describe('the optimistic reducer for marking', () => {
  const view = viewFor(TONIGHT)

  it('marks and unmarks the items it is given', () => {
    const marked = reduceView(view, { type: 'setSoldOut', itemIds: [ids.onSale], soldOut: true })
    expect(marked.items[ids.onSale]?.soldOutTonight).toBe(true)
    const unmarked = reduceView(marked, {
      type: 'setSoldOut',
      itemIds: [ids.onSale],
      soldOut: false,
    })
    expect(unmarked.items[ids.onSale]?.soldOutTonight).toBe(false)
    // Nothing else moved.
    expect(unmarked.items[ids.markedTonight]).toEqual(view.items[ids.markedTonight])
  })

  it('never changes an item that is off sale for another reason (rule 5)', () => {
    for (const id of [ids.barsyOff, ids.manualOff]) {
      for (const soldOut of [true, false]) {
        const next = reduceView(view, { type: 'setSoldOut', itemIds: [id], soldOut })
        expect(next.items[id], `${id} ${soldOut}`).toEqual(view.items[id])
      }
    }
  })
})
