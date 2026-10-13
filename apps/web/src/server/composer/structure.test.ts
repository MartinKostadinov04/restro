// The plans behind the composer's structure actions (brief S6), on a small hand-made document:
// which ops deleting a section and renaming write, and what they refuse. Pure; the actions'
// database tests are in `@/composer/structure-actions.test.ts`.
import type { MenuDocument, NodeId } from '@restro/core'
import type { MenuSummary } from '@restro/core/apply'
import { describe, expect, it } from 'vitest'

import { pickMenu } from './menu'
import { deleteSectionPlan, renamePlan, sectionSubtree } from './structure'

const id = (name: string) => `nd_${name.padEnd(22, '0')}` as NodeId
const MENU = id('menu')
const DRINKS = id('drinks')
const CLASSICS = id('classics')
const BEER = id('beer')
const MOJITO = id('mojito')
const LAGER = id('lager')
const VENUE = 'vn_0123456789ABCDEFGHIJKL'

function value(
  nodeId: NodeId,
  fieldKey: string,
  layer: 'till' | 'manual' | 'override',
  v: unknown,
) {
  return {
    nodeId,
    fieldKey,
    layer,
    scope: 'master' as const,
    value: v,
    valueHash: 'x',
    source: layer === 'till' ? ('till:in_x' as const) : ('manual' as const),
    observedAt: '2026-10-13T10:00:00Z',
    basis: null,
    valid: true,
  }
}

/** Drinks > Classics (ours), Beer (the till's); Mojito in Drinks and Classics, Lager in Beer. */
function document(): MenuDocument {
  const node = (nodeId: NodeId, type: 'menu' | 'section' | 'item', parentId: NodeId | null) => ({
    id: nodeId,
    type,
    parentId,
    status: 'active' as const,
    revision: 1,
    sortKey: type === 'section' ? 'a0' : null,
  })
  return {
    menu: {
      id: MENU,
      venueId: VENUE,
      templateKey: 'venue-menu',
      templateVersion: 1,
      rootNodeId: MENU,
    },
    nodes: [
      node(MENU, 'menu', null),
      node(DRINKS, 'section', MENU),
      node(CLASSICS, 'section', DRINKS),
      node(BEER, 'section', MENU),
      node(MOJITO, 'item', null),
      node(LAGER, 'item', null),
    ],
    placements: [
      { itemId: MOJITO, sectionId: DRINKS, sortKey: 'a0' },
      { itemId: MOJITO, sectionId: CLASSICS, sortKey: 'a0' },
      { itemId: LAGER, sectionId: BEER, sortKey: 'a0' },
    ],
    values: [
      value(DRINKS, 'title', 'manual', { bg_BG: 'Напитки', en_US: 'Drinks' }),
      value(BEER, 'title', 'till', { bg_BG: 'Бира' }),
      value(MOJITO, 'name', 'manual', { bg_BG: 'Мохито' }),
    ],
    links: [
      { nodeId: BEER, source: 'till:in_x', externalType: 'category', state: 'active' },
      { nodeId: LAGER, source: 'till:in_x', externalType: 'article', state: 'active' },
    ],
  }
}

const rename = (nodeId: NodeId, text: Record<string, string>, nodeType = 'section' as const) =>
  renamePlan({
    doc: document(),
    nodeId,
    nodeType,
    venueId: VENUE,
    text,
    defaultLocale: 'bg_BG',
    languages: ['bg_BG', 'en_US'],
  })

describe('deleting a section', () => {
  it('takes the section and the sections under it out, their items out of them', () => {
    expect(sectionSubtree(document(), DRINKS)).toEqual([CLASSICS, DRINKS])
    expect(deleteSectionPlan(document(), DRINKS)).toEqual({
      ok: true,
      ops: [
        { op: 'removePlacement', item: { id: MOJITO }, section: { id: DRINKS } },
        { op: 'removePlacement', item: { id: MOJITO }, section: { id: CLASSICS } },
        { op: 'setNodeStatus', node: { id: CLASSICS }, status: 'archived' },
        { op: 'setNodeStatus', node: { id: DRINKS }, status: 'archived' },
      ],
    })
  })

  it('refuses a section of the till, and one that holds a section of the till', () => {
    expect(deleteSectionPlan(document(), BEER)).toEqual({ ok: false, error: 'till_section' })
    const doc = document()
    const moved = {
      ...doc,
      nodes: doc.nodes.map((node) => (node.id === BEER ? { ...node, parentId: DRINKS } : node)),
    }
    expect(deleteSectionPlan(moved, DRINKS)).toEqual({ ok: false, error: 'till_section' })
  })

  it('refuses what is not a live section', () => {
    expect(deleteSectionPlan(document(), MOJITO)).toEqual({ ok: false, error: 'invalid' })
    expect(deleteSectionPlan(document(), id('nowhere'))).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('renaming', () => {
  it('a section of our own: the manual title, the other languages kept', () => {
    expect(rename(DRINKS, { en_US: 'Bar' })).toEqual({
      ok: true,
      ops: [
        {
          op: 'setField',
          node: { id: DRINKS },
          fieldKey: 'title',
          layer: 'manual',
          scope: 'master',
          value: { bg_BG: 'Напитки', en_US: 'Bar' },
        },
      ],
    })
  })

  it('a section of the till: our name over the till’s, with its text as the basis', () => {
    expect(rename(BEER, { bg_BG: 'Наливна' })).toEqual({
      ok: true,
      ops: [
        {
          op: 'setField',
          node: { id: BEER },
          fieldKey: 'title',
          layer: 'override',
          scope: 'master',
          value: { bg_BG: 'Наливна' },
          basis: { bg_BG: 'Бира' },
        },
      ],
    })
    // A language the till lacks is a translation of ours (D24).
    expect(rename(BEER, { en_US: 'Beer' })).toMatchObject({
      ok: true,
      ops: [{ layer: 'manual', value: { en_US: 'Beer' } }],
    })
  })

  it('an item made by hand renames its name', () => {
    expect(rename(MOJITO, { bg_BG: 'Мохито без алкохол' }, 'item' as never)).toMatchObject({
      ok: true,
      ops: [{ fieldKey: 'name', layer: 'manual', value: { bg_BG: 'Мохито без алкохол' } }],
    })
  })

  it('the same text writes nothing; a blank, an unknown language or the wrong node is refused', () => {
    expect(rename(DRINKS, { bg_BG: 'Напитки' })).toEqual({ ok: true, ops: [] })
    expect(rename(DRINKS, { bg_BG: '  ' })).toEqual({ ok: false })
    expect(rename(DRINKS, { de_DE: 'Getränke' })).toEqual({ ok: false })
    expect(rename(DRINKS, {})).toEqual({ ok: false })
    expect(rename(MOJITO, { bg_BG: 'X' })).toEqual({ ok: false })
  })
})

describe('which menu the composer opens', () => {
  const menu = (menuId: string, live: boolean) => ({ id: menuId, live }) as unknown as MenuSummary
  const MENUS = [menu('nd_a', false), menu('nd_b', true), menu('nd_c', false)]

  it('the one the URL names, else the live one, else the first, else none', () => {
    expect(pickMenu(MENUS, 'nd_c')?.id).toBe('nd_c')
    expect(pickMenu(MENUS, 'nd_binned')?.id).toBe('nd_b')
    expect(pickMenu(MENUS, undefined)?.id).toBe('nd_b')
    expect(pickMenu([menu('nd_a', false)], ['nd_a'])?.id).toBe('nd_a')
    expect(pickMenu([], 'nd_a')).toBeNull()
  })
})
