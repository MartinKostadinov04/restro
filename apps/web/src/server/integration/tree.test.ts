import { describe, expect, it } from 'vitest'

import { buildCategoryTree, detectAllergenOption, readDetailOptions, treeHas } from './tree'

const cat = (cat_id: number, parent_id: number | null, name: string) => ({
  cat_id,
  parent_id,
  name,
})

describe('buildCategoryTree', () => {
  it('nests the flat list and keeps barsy’s order among siblings', () => {
    const tree = buildCategoryTree([
      cat(1171, null, 'Публично меню'),
      cat(2, 1171, 'Бира'),
      cat(3, 1171, 'Коктейли'),
      cat(4, 3, 'Класически'),
    ])
    expect(tree).toEqual([
      {
        id: 1171,
        name: 'Публично меню',
        children: [
          { id: 2, name: 'Бира', children: [] },
          { id: 3, name: 'Коктейли', children: [{ id: 4, name: 'Класически', children: [] }] },
        ],
      },
    ])
  })

  it('marks only the suggested category, wherever it is, and nothing else', () => {
    const categories = [
      cat(1171, null, 'Публично меню'),
      cat(2, 1171, 'Бира'),
      cat(3, 1171, 'Коктейли'),
      cat(4, 3, 'Класически'),
    ]
    const marked = buildCategoryTree(categories, 4)
    const flat = (nodes: typeof marked): { id: number; suggested?: true }[] =>
      nodes.flatMap((node) => [
        { id: node.id, ...(node.suggested ? { suggested: true as const } : {}) },
        ...flat([...node.children]),
      ])
    expect(flat(marked).filter((node) => node.suggested)).toEqual([{ id: 4, suggested: true }])
    // No suggestion, or one that is not in the tree: no mark at all, the tree is as before.
    expect(buildCategoryTree(categories)).toEqual(buildCategoryTree(categories, null))
    expect(flat(buildCategoryTree(categories, 999)).some((node) => node.suggested)).toBe(false)
    expect(JSON.stringify(buildCategoryTree(categories))).not.toContain('suggested')
  })

  it('makes a category with an unknown parent a top-level one', () => {
    expect(buildCategoryTree([cat(5, 999, 'Orphan')])).toEqual([
      { id: 5, name: 'Orphan', children: [] },
    ])
  })

  it('cannot loop on a damaged cache', () => {
    const tree = buildCategoryTree([cat(1, 2, 'a'), cat(2, 1, 'b'), cat(3, 3, 'self')])
    const ids = (nodes: typeof tree): number[] =>
      nodes.flatMap((node) => [node.id, ...ids([...node.children])])
    expect(ids(tree).sort()).toEqual([3])
    // a and b point at each other and are placed under no one: they are dropped, not repeated.
    expect(tree.every((node) => node.children.length === 0)).toBe(true)
  })

  it('answers for an empty list', () => {
    expect(buildCategoryTree([])).toEqual([])
  })
})

describe('treeHas', () => {
  const tree = buildCategoryTree([cat(1, null, 'a'), cat(2, 1, 'b'), cat(3, 2, 'c')])
  it('finds categories at any depth', () => {
    expect(treeHas(tree, 1)).toBe(true)
    expect(treeHas(tree, 3)).toBe(true)
    expect(treeHas(tree, 4)).toBe(false)
  })
})

describe('readDetailOptions and detectAllergenOption', () => {
  const payload = [
    {
      group_name: 'Основна',
      group_id: 1,
      details: {
        k102: { detail_name: 'Алергени', type: 'text' },
        k101: { detail_name: 'Годност в дни', type: 'text' },
      },
    },
    { group_name: 'Other', group_id: 2, details: { k200: { detail_name: ' allergens ' } } },
  ]

  it('lists every characteristic by name, ordered by key', () => {
    expect(readDetailOptions(payload)).toEqual([
      { key: 'k101', name: 'Годност в дни' },
      { key: 'k102', name: 'Алергени' },
      { key: 'k200', name: 'allergens' },
    ])
  })

  it('detects "Алергени" or "Allergens" in any case, the lowest key first', () => {
    expect(detectAllergenOption(readDetailOptions(payload))).toEqual({
      key: 'k102',
      name: 'Алергени',
    })
    expect(detectAllergenOption([{ key: 'k1', name: 'ALLERGENS' }])).toEqual({
      key: 'k1',
      name: 'ALLERGENS',
    })
  })

  it('finds none when nothing is named like that', () => {
    expect(detectAllergenOption([{ key: 'k1', name: 'Грамаж' }])).toBeNull()
    expect(detectAllergenOption([])).toBeNull()
  })

  it('reads nothing from a payload of another shape', () => {
    expect(readDetailOptions(null)).toEqual([])
    expect(readDetailOptions({ details: {} })).toEqual([])
    expect(readDetailOptions([{ details: 'x' }, null, { details: [1] }])).toEqual([])
  })
})
