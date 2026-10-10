import { describe, expect, it } from 'vitest'

import bg from '../../messages/bg.json'
import en from '../../messages/en.json'

type Tree = { [key: string]: string | Tree }

/** Every leaf of a message tree as `a.b.c`. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const found = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') found.set(path, value)
    else for (const [leaf, text] of leaves(value, path)) found.set(leaf, text)
  }
  return found
}

/** The ICU argument names of a message: `{email}`, `{count, plural, …}` → `email`, `count`. */
function placeholders(message: string): string[] {
  const names = new Set<string>()
  let depth = 0
  let start = -1
  for (let i = 0; i < message.length; i++) {
    const char = message[i]
    if (char === '{') {
      if (depth === 0) start = i + 1
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const name = message.slice(start, i).split(',')[0]?.trim()
        if (name) names.add(name)
        start = -1
      }
    }
  }
  return [...names].sort()
}

const bgLeaves = leaves(bg as Tree)
const enLeaves = leaves(en as Tree)

describe('interface messages (BG and EN)', () => {
  it('have exactly the same keys', () => {
    const onlyBg = [...bgLeaves.keys()].filter((key) => !enLeaves.has(key))
    const onlyEn = [...enLeaves.keys()].filter((key) => !bgLeaves.has(key))
    expect({ onlyBg, onlyEn }).toEqual({ onlyBg: [], onlyEn: [] })
  })

  it('have no empty message', () => {
    const empty = [...bgLeaves, ...enLeaves].filter(([, text]) => text.trim() === '')
    expect(empty).toEqual([])
  })

  it('use the same placeholders in both languages', () => {
    const mismatched: string[] = []
    for (const [key, text] of bgLeaves) {
      const other = enLeaves.get(key)
      if (other === undefined) continue
      if (placeholders(text).join() !== placeholders(other).join()) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('translate the 14 EU allergens and the interface language names', () => {
    expect(Object.keys((bg as Tree).options as Tree)).toEqual(
      expect.arrayContaining(['allergens', 'dietary', 'order_mode']),
    )
    expect([...bgLeaves.keys()].filter((key) => key.startsWith('options.allergens.'))).toHaveLength(
      14,
    )
  })
})
