// A small hand-made composer view for the unit tests of this folder. Not part of the app.
//
//   Cocktails (a0)                 Negroni, Spritz
//     Classics (a0)                Daiquiri
//       Stirred (a0)               (empty)
//   Beer (a1)                      Lager, Stout
//   Unsorted:                      Water

import { type NodeId, newId } from '@restro/core'

import type { ComposerItem, ComposerSection, ComposerView } from './view-model'

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
  origin: 'barsy',
  hidden: false,
  shown: true,
  sortKey,
  childIds,
  issues: [],
  ...extra,
})

const item = (id: NodeId, name: string, extra: Partial<ComposerItem> = {}): ComposerItem => ({
  id,
  name,
  price: { amount_minor: 850, currency: 'EUR' },
  origin: 'barsy',
  hiddenBy: null,
  shown: true,
  issues: [],
  ...extra,
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
      [ids.negroni]: item(ids.negroni, 'Negroni'),
      [ids.spritz]: item(ids.spritz, 'Spritz'),
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
  }
  return { view, ids }
}
