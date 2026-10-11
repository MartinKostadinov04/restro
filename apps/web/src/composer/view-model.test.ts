import {
  type Layer,
  type MenuDocument,
  mergeDocumentParts,
  type NodeId,
  newId,
  resolve,
  type Scope,
  type Tag,
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
  scope: Scope = 'master',
): Row {
  return {
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
  }
}

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

// A menu with two sections (one from barsy, one made here) and six items in different states.
const ids = {
  menu: newId('nd'),
  barsySection: newId('nd'),
  ownSection: newId('nd'),
  normal: newId('nd'),
  barsyHidden: newId('nd'),
  builderHidden: newId('nd'),
  held: newId('nd'),
  nameless: newId('nd'),
  loose: newId('nd'),
}

const node = (
  id: NodeId,
  type: MenuDocument['nodes'][number]['type'],
  parentId: NodeId | null,
  sortKey: string | null,
  status: MenuDocument['nodes'][number]['status'] = 'active',
) => ({ id, type, parentId, status, revision: 1, sortKey })

const barsyItem = (id: NodeId, name: string, price: number, visible = true): Row[] => [
  row(id, 'name', 'till', { bg_BG: name, en_US: `${name} EN` }),
  row(id, 'price', 'till', eur(price), `venue:${venueId}`),
  row(id, 'for_sale', 'till', true, `venue:${venueId}`),
  row(id, 'visible', 'till', visible),
  row(id, 'allergens', 'till', []),
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
    node(ids.menu, 'menu', null, null),
    node(ids.barsySection, 'section', ids.menu, 'a0'),
    node(ids.ownSection, 'section', ids.menu, 'a1'),
    node(ids.normal, 'item', null, null),
    node(ids.barsyHidden, 'item', null, null),
    node(ids.builderHidden, 'item', null, null),
    node(ids.held, 'item', null, null, 'hidden'),
    node(ids.nameless, 'item', null, null),
    node(ids.loose, 'item', null, null),
  ],
  placements: [
    { itemId: ids.barsyHidden, sectionId: ids.barsySection, sortKey: 'a1' },
    { itemId: ids.normal, sectionId: ids.barsySection, sortKey: 'a0' },
    { itemId: ids.builderHidden, sectionId: ids.barsySection, sortKey: 'a2' },
    { itemId: ids.held, sectionId: ids.barsySection, sortKey: 'a3' },
    { itemId: ids.nameless, sectionId: ids.ownSection, sortKey: 'a0' },
  ],
  values: [
    row(ids.barsySection, 'title', 'till', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
    row(ids.ownSection, 'title', 'manual', { bg_BG: 'Специални' }),
    ...barsyItem(ids.normal, 'Негрони', 850),
    ...barsyItem(ids.barsyHidden, 'Спритц', 900, false),
    ...barsyItem(ids.builderHidden, 'Дайкири', 950),
    row(ids.builderHidden, 'visible', 'manual', false),
    ...barsyItem(ids.held, 'Мохито', 1000),
    row(ids.nameless, 'description', 'manual', { bg_BG: 'Без име' }),
    row(ids.loose, 'name', 'manual', { bg_BG: 'Вода' }),
  ],
  links: [
    ...[ids.barsySection].map((nodeId) => ({
      nodeId,
      source: `till:${integration}` as const,
      externalType: 'category',
      state: 'active' as const,
    })),
    ...[ids.normal, ids.barsyHidden, ids.builderHidden, ids.held].map((nodeId) => ({
      nodeId,
      source: `till:${integration}` as const,
      externalType: 'article',
      state: 'active' as const,
    })),
  ],
}

function build(displayLocale: 'bg_BG' | 'en_US' = 'bg_BG', heldNewIds: NodeId[] = []) {
  const resolved = resolve(VENUE_MENU_TEMPLATE, document, {
    venueScope: `venue:${venueId}`,
    locales: ['bg_BG', 'en_US'],
    now: '2026-10-09T12:00:00+03:00',
  })
  return buildComposerView({ doc: document, resolved, displayLocale, heldNewIds })
}

describe('buildComposerView', () => {
  it('lists the sections in order with their title, origin and items in order', () => {
    const view = build()
    expect(view.menuId).toBe(ids.menu)
    expect(view.rootIds).toEqual([ids.barsySection, ids.ownSection])
    expect(view.sections[ids.barsySection]).toMatchObject({
      title: 'Коктейли',
      origin: 'till',
      parentId: null,
      hidden: false,
      sortKey: 'a0',
    })
    expect(view.sections[ids.ownSection]).toMatchObject({ title: 'Специални', origin: 'owned' })
    expect(view.placements[ids.barsySection]?.map((p) => p.itemId)).toEqual([
      ids.normal,
      ids.barsyHidden,
      ids.builderHidden,
      ids.held,
    ])
    expect(view.placements[ids.barsySection]?.map((p) => p.sortKey)).toEqual([
      'a0',
      'a1',
      'a2',
      'a3',
    ])
  })

  it('shows names and titles in the interface language, with barsy’s price', () => {
    expect(build('bg_BG').items[ids.normal]).toMatchObject({
      name: 'Негрони',
      price: eur(850),
      origin: 'till',
    })
    expect(build('en_US').items[ids.normal]?.name).toBe('Негрони EN')
    expect(build('en_US').sections[ids.barsySection]?.title).toBe('Cocktails')
    // A section with only a Bulgarian title falls back to it in English.
    expect(build('en_US').sections[ids.ownSection]?.title).toBe('Специални')
  })

  it('says why an item is hidden: barsy, the builder, or a held-back status', () => {
    const { items } = build()
    expect(items[ids.normal]).toMatchObject({ hiddenBy: null })
    expect(items[ids.barsyHidden]).toMatchObject({ hiddenBy: 'till', shown: false })
    expect(items[ids.builderHidden]).toMatchObject({ hiddenBy: 'builder', shown: false })
    expect(items[ids.held]).toMatchObject({ hiddenBy: 'status', shown: false })
  })

  it('marks a builder hide the sync wrote as "new from barsy", and only that one (S3-04)', () => {
    const { items } = build('bg_BG', [ids.builderHidden])
    expect(items[ids.builderHidden]).toMatchObject({ hiddenBy: 'new_from_till', shown: false })
    // The marker means nothing for an item that is not hidden by the manual layer.
    const unhidden = build('bg_BG', [ids.normal, ids.barsyHidden, ids.held]).items
    expect(unhidden[ids.normal]?.hiddenBy).toBeNull()
    expect(unhidden[ids.barsyHidden]?.hiddenBy).toBe('till')
    expect(unhidden[ids.held]?.hiddenBy).toBe('status')
    // Without the list, the same item is the builder's own hide.
    expect(build().items[ids.builderHidden]?.hiddenBy).toBe('builder')
  })

  it('keeps the barsy hide when the builder also hid the item (barsy decides first)', () => {
    const both: MenuDocument = {
      ...document,
      values: [...document.values, row(ids.barsyHidden, 'visible', 'manual', false)],
    }
    const resolved = resolve(VENUE_MENU_TEMPLATE, both, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: '2026-10-09T12:00:00+03:00',
    })
    const view = buildComposerView({ doc: both, resolved, displayLocale: 'bg_BG' })
    expect(view.items[ids.barsyHidden]?.hiddenBy).toBe('till')
  })

  it('counts the problems the resolver found on a row', () => {
    const { items } = build()
    expect(items[ids.normal]?.issues).toEqual([])
    const nameless = items[ids.nameless]
    expect(nameless?.name).toBe('')
    expect(nameless?.issues.map((issue) => issue.code)).toContain('V3')
    expect(nameless?.issues.some((issue) => issue.severity === 'block_node')).toBe(true)
  })

  it('puts the items placed nowhere in Unsorted, once the unplaced items are merged in', () => {
    // loadMenuDocument cannot reach an unplaced item; the server merges it in before resolving.
    const withLoose = mergeDocumentParts(
      { ...document, nodes: document.nodes.filter((n) => n.id !== ids.loose) },
      {
        nodes: document.nodes.filter((n) => n.id === ids.loose),
        values: document.values.filter((v) => v.nodeId === ids.loose),
        links: [],
      },
    )
    const resolved = resolve(VENUE_MENU_TEMPLATE, withLoose, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: '2026-10-09T12:00:00+03:00',
    })
    const view = buildComposerView({ doc: withLoose, resolved, displayLocale: 'bg_BG' })
    expect(view.unsortedIds).toEqual([ids.loose])
    expect(view.items[ids.loose]).toMatchObject({ name: 'Вода', origin: 'owned' })
    expect(view.items[ids.loose]?.issues.map((issue) => issue.code)).toContain('unplaced_item')
    // Without that item in the document there is nothing to put in Unsorted.
    const without: MenuDocument = {
      ...document,
      nodes: document.nodes.filter((n) => n.id !== ids.loose),
      values: document.values.filter((v) => v.nodeId !== ids.loose),
    }
    const resolvedWithout = resolve(VENUE_MENU_TEMPLATE, without, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: '2026-10-09T12:00:00+03:00',
    })
    expect(
      buildComposerView({ doc: without, resolved: resolvedWithout, displayLocale: 'bg_BG' })
        .unsortedIds,
    ).toEqual([])
  })

  it('contains no barsy id and no layer detail a screen could leak (rule 3)', () => {
    const json = JSON.stringify(build())
    expect(json).not.toContain(integration)
    expect(json).not.toContain('externalId')
    expect(json).not.toContain('till:')
  })

  describe('tags and dietary labels (S3-06)', () => {
    const signature = newId('tg')
    const spicy = newId('tg')
    const old = newId('tg')
    const venueTags: Tag[] = [
      {
        id: signature,
        venueId,
        label: { bg_BG: 'Фирмено', en_US: 'Signature' },
        color: 'accent',
        sortKey: 'a0',
        archived: false,
      },
      {
        id: spicy,
        venueId,
        label: { bg_BG: 'Люто' },
        color: 'text',
        sortKey: 'a1',
        archived: false,
      },
      { id: old, venueId, label: { en_US: 'Old' }, color: 'border', sortKey: 'a2', archived: true },
    ]
    const withTags: MenuDocument = {
      ...document,
      values: [
        ...document.values,
        row(ids.normal, 'tags', 'manual', [spicy, signature, 'signature', old]),
        row(ids.normal, 'dietary', 'manual', ['vegan', 'gluten_free']),
      ],
    }

    function buildWithTags(displayLocale: 'bg_BG' | 'en_US' = 'bg_BG') {
      const resolved = resolve(VENUE_MENU_TEMPLATE, withTags, {
        venueScope: `venue:${venueId}`,
        locales: ['bg_BG', 'en_US'],
        now: '2026-10-09T12:00:00+03:00',
      })
      return buildComposerView({ doc: withTags, resolved, displayLocale, tags: venueTags })
    }

    it('lists the venue’s tags in order, archived ones flagged, names in the interface language', () => {
      const view = buildWithTags('en_US')
      expect(view.tagIds).toEqual([signature, spicy, old])
      expect(view.tags[signature]).toMatchObject({
        name: 'Signature',
        color: 'accent',
        archived: false,
      })
      // A tag named in Bulgarian only falls back to it in English.
      expect(view.tags[spicy]?.name).toBe('Люто')
      expect(view.tags[old]).toMatchObject({ name: 'Old', archived: true })
      expect(buildWithTags('bg_BG').tags[signature]?.name).toBe('Фирмено')
      expect(view.tags[signature]?.label).toEqual({ bg_BG: 'Фирмено', en_US: 'Signature' })
    })

    it('gives each item its tag ids (only tg_ ids) and dietary codes', () => {
      const { items } = buildWithTags()
      expect([...(items[ids.normal]?.tags ?? [])].sort()).toEqual([old, signature, spicy].sort())
      expect([...(items[ids.normal]?.dietary ?? [])].sort()).toEqual(['gluten_free', 'vegan'])
      expect(items[ids.barsyHidden]).toMatchObject({ tags: [], dietary: [] })
    })

    it('has no tags when none are passed', () => {
      const view = build()
      expect(view.tagIds).toEqual([])
      expect(view.tags).toEqual({})
    })
  })
})
