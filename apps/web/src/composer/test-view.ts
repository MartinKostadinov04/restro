// A small hand-made composer view for the unit tests of this folder. Not part of the app.
//
//   Cocktails (a0)                 Negroni, Spritz
//     Classics (a0)                Daiquiri
//       Stirred (a0)               (empty)
//   Beer (a1)                      Lager, Stout
//   Unsorted:                      Water

import { type NodeId, newId, type TagColor, type TagId } from '@restro/core'

import { SAMPLE_TILL_LABEL } from '@/fields/samples'

import type { ComposerItem, ComposerSection, ComposerTag, ComposerView } from './view-model'

const section = (
  id: NodeId,
  parentId: NodeId | null,
  sortKey: string,
  childIds: NodeId[] = [],
  extra: Partial<ComposerSection> = {},
): ComposerSection => ({
  id,
  parentId,
  title: `Section ${sortKey}`,
  origin: 'till',
  hidden: false,
  shown: true,
  sortKey,
  childIds,
  issues: [],
  nameFromTill: false,
  layout: 'vertical',
  ...extra,
})

const item = (id: NodeId, name: string, extra: Partial<ComposerItem> = {}): ComposerItem => ({
  id,
  name,
  price: { amount_minor: 850, currency: 'EUR' },
  origin: 'till',
  hiddenBy: null,
  shown: true,
  issues: [],
  tags: [],
  dietary: [],
  soldOutTonight: false,
  offSale: null,
  nameFromTill: false,
  reviewFields: [],
  ...extra,
})

const tag = (id: TagId, name: string, color: TagColor, archived = false): ComposerTag => ({
  id,
  name,
  label: { bg_BG: name },
  color,
  archived,
})

export interface TestView {
  readonly view: ComposerView
  readonly ids: {
    readonly menu: NodeId
    readonly cocktails: NodeId
    readonly classics: NodeId
    readonly stirred: NodeId
    readonly beer: NodeId
    readonly negroni: NodeId
    readonly spritz: NodeId
    readonly daiquiri: NodeId
    readonly lager: NodeId
    readonly stout: NodeId
    readonly water: NodeId
    /** The venue's tags: Signature, Spicy, Local and an archived one. */
    readonly signature: TagId
    readonly spicy: TagId
    readonly local: TagId
    readonly old: TagId
  }
}

/** The view above, with fresh ids each time. */
export function makeTestView(): TestView {
  const ids = {
    menu: newId('nd'),
    cocktails: newId('nd'),
    classics: newId('nd'),
    stirred: newId('nd'),
    beer: newId('nd'),
    negroni: newId('nd'),
    spritz: newId('nd'),
    daiquiri: newId('nd'),
    lager: newId('nd'),
    stout: newId('nd'),
    water: newId('nd'),
    signature: newId('tg'),
    spicy: newId('tg'),
    local: newId('tg'),
    old: newId('tg'),
  }
  const view: ComposerView = {
    menuId: ids.menu,
    rootIds: [ids.cocktails, ids.beer],
    sections: {
      [ids.cocktails]: section(ids.cocktails, null, 'a0', [ids.classics]),
      [ids.classics]: section(ids.classics, ids.cocktails, 'a0', [ids.stirred]),
      [ids.stirred]: section(ids.stirred, ids.classics, 'a0'),
      [ids.beer]: section(ids.beer, null, 'a1'),
    },
    items: {
      [ids.negroni]: item(ids.negroni, 'Negroni', {
        tags: [ids.signature, ids.spicy, ids.old],
        dietary: ['vegan'],
      }),
      [ids.spritz]: item(ids.spritz, 'Spritz', { tags: [ids.local] }),
      [ids.daiquiri]: item(ids.daiquiri, 'Daiquiri'),
      [ids.lager]: item(ids.lager, 'Lager'),
      [ids.stout]: item(ids.stout, 'Stout'),
      [ids.water]: item(ids.water, 'Water', { origin: 'owned' }),
    },
    placements: {
      [ids.cocktails]: [
        { itemId: ids.negroni, sortKey: 'a0' },
        { itemId: ids.spritz, sortKey: 'a1' },
      ],
      [ids.classics]: [{ itemId: ids.daiquiri, sortKey: 'a0' }],
      [ids.stirred]: [],
      [ids.beer]: [
        { itemId: ids.lager, sortKey: 'a0' },
        { itemId: ids.stout, sortKey: 'a1' },
      ],
    },
    unsortedIds: [ids.water],
    tagIds: [ids.signature, ids.spicy, ids.local, ids.old],
    tags: {
      [ids.signature]: tag(ids.signature, 'Signature', 'accent'),
      [ids.spicy]: tag(ids.spicy, 'Spicy', 'text'),
      [ids.local]: tag(ids.local, 'Local', 'muted'),
      [ids.old]: tag(ids.old, 'Old', 'border', true),
    },
    tillLabel: SAMPLE_TILL_LABEL,
  }
  return { view, ids }
}
