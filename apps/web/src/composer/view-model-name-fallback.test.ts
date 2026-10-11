// The composer's warning that a name is the till's own, standing in for a missing public one
// (D75, CF-17): which nodes get it, and what takes it away.

import {
  type Layer,
  type MenuDocument,
  type NodeId,
  newId,
  resolve,
  type Scope,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import { buildComposerView } from './view-model'

const venueId = newId('vn')
const integration = newId('in')
const HASH = 'a'.repeat(64)

type Row = MenuDocument['values'][number]

function row(
  nodeId: NodeId,
  fieldKey: string,
  layer: Layer,
  value: unknown,
  extra: { scope?: Scope; basis?: unknown } = {},
): Row {
  return {
    nodeId,
    fieldKey,
    layer,
    scope: extra.scope ?? 'master',
    value,
    valueHash: HASH,
    source: layer === 'till' ? `till:${integration}` : 'manual',
    observedAt: '2026-10-09T10:00:00.000Z',
    basis: extra.basis ?? null,
    valid: true,
  }
}

const ids = {
  menu: newId('nd'),
  section: newId('nd'),
  publicSection: newId('nd'),
  fallback: newId('nd'),
  typed: newId('nd'),
  translated: newId('nd'),
  publicName: newId('nd'),
  noName: newId('nd'),
  handMade: newId('nd'),
}

const node = (id: NodeId, type: MenuDocument['nodes'][number]['type'], parent: NodeId | null) => ({
  id,
  type,
  parentId: parent,
  status: 'active' as const,
  revision: 1,
  sortKey: type === 'section' ? `a${String(id).slice(-3)}` : null,
})

/** An item with the rest of what a till item has, so only its name differs. */
const tillItem = (id: NodeId, name: Record<string, string> | null): Row[] => [
  ...(name === null ? [] : [row(id, 'name', 'till', name)]),
  row(id, 'price', 'till', { amount_minor: 850, currency: 'EUR' }, { scope: `venue:${venueId}` }),
  row(id, 'for_sale', 'till', true, { scope: `venue:${venueId}` }),
  row(id, 'visible', 'till', true),
  row(id, 'allergens', 'till', []),
]

const OWN = { bg_BG: 'Own name' }

const document: MenuDocument = {
  menu: {
    id: ids.menu,
    venueId,
    templateKey: 'venue-menu',
    templateVersion: 1,
    rootNodeId: ids.menu,
  },
  nodes: [
    node(ids.menu, 'menu', null),
    node(ids.section, 'section', ids.menu),
    node(ids.publicSection, 'section', ids.menu),
    ...[ids.fallback, ids.typed, ids.translated, ids.publicName, ids.noName, ids.handMade].map(
      (id) => node(id, 'item', null),
    ),
  ],
  placements: [
    ids.fallback,
    ids.typed,
    ids.translated,
    ids.publicName,
    ids.noName,
    ids.handMade,
  ].map((itemId, index) => ({ itemId, sectionId: ids.section, sortKey: `a${index}` })),
  values: [
    row(ids.section, 'title', 'till', OWN),
    row(ids.publicSection, 'title', 'till', { bg_BG: 'Public title' }),
    // The till's own name, standing in.
    ...tillItem(ids.fallback, OWN),
    // The same, and a person typed a name over it (an override on the till's value).
    ...tillItem(ids.typed, OWN),
    row(ids.typed, 'name', 'override', { bg_BG: 'Typed name' }, { basis: OWN }),
    // The same, and a person added an English translation (a language the till has no text for).
    ...tillItem(ids.translated, OWN),
    row(ids.translated, 'name', 'manual', { en_US: 'Translated' }),
    // A public name from the till.
    ...tillItem(ids.publicName, { bg_BG: 'Public name' }),
    // Nothing named at all.
    ...tillItem(ids.noName, null),
    // Made here.
    row(ids.handMade, 'name', 'manual', { bg_BG: 'Made here' }),
  ],
  links: [ids.section, ids.publicSection].map((nodeId) => ({
    nodeId,
    source: `till:${integration}` as const,
    externalType: 'category',
    state: 'active' as const,
  })),
}

function build(nameFallbackIds: NodeId[]) {
  const resolved = resolve(VENUE_MENU_TEMPLATE, document, {
    venueScope: `venue:${venueId}`,
    locales: ['bg_BG', 'en_US'],
    now: '2026-10-09T12:00:00+03:00',
  })
  return buildComposerView({ doc: document, resolved, displayLocale: 'bg_BG', nameFallbackIds })
}

// What the connector's `readNameFallbackNodeIds` says: the nodes whose stored till name was
// mapped from a record with no public name. Pairs of ids that are not nodes of the menu are fine.
const FALLBACK_IDS = [ids.section, ids.fallback, ids.typed, ids.translated, ids.noName, newId('nd')]

describe('the warning that a name is the till’s own (D75)', () => {
  const view = build(FALLBACK_IDS)

  it('an item and a section whose name is the till’s own stand-in carry the warning', () => {
    expect(view.items[ids.fallback]).toMatchObject({ name: 'Own name', nameFromTill: true })
    expect(view.sections[ids.section]).toMatchObject({ title: 'Own name', nameFromTill: true })
  })

  it('a name typed here takes it away: the override wins over the till’s name', () => {
    expect(view.items[ids.typed]).toMatchObject({ name: 'Typed name', nameFromTill: false })
  })

  it('a translation added for another language does not: guests still see the till’s name in its own', () => {
    expect(view.items[ids.translated]?.nameFromTill).toBe(true)
  })

  it('a public name from the till, a name made here, and no name at all carry none', () => {
    expect(view.items[ids.publicName]).toMatchObject({ name: 'Public name', nameFromTill: false })
    expect(view.sections[ids.publicSection]?.nameFromTill).toBe(false)
    expect(view.items[ids.handMade]?.nameFromTill).toBe(false)
    expect(view.items[ids.noName]?.nameFromTill).toBe(false)
  })

  it('nothing is flagged when the connector reports no fallback names', () => {
    const none = build([])
    for (const item of Object.values(none.items)) expect(item.nameFromTill).toBe(false)
    for (const section of Object.values(none.sections)) expect(section.nameFromTill).toBe(false)
  })

  it('it is a warning only: the item is still shown to guests', () => {
    expect(view.items[ids.fallback]).toMatchObject({ shown: true, hiddenBy: null })
    expect(view.items[ids.fallback]?.issues.map((issue) => issue.code)).not.toContain('V3')
  })
})
