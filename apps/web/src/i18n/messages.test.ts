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

/** Keys that still say "till" / "каса", on screens outside lane 5 (Studio, Tables, Tonight, Reservations). */
const TILL_WAITING: ReadonlySet<string> = new Set([
  'composer.empty.noItems.descriptionTill',
  'composer.errors.till_venue',
  'publish.paused.text',
  'tables.empty.description',
  'tonight.m_q_till',
  'tonight.m_till_ok',
  'tonight.m_till_no',
  'tonight.m_till_ok_toast',
  'tonight.lg_pay_till',
  'tonight.lg_pay_notill',
  'tonight.ps_entered',
  'tonight.pr_not_on_till',
  'tonight.pr_enter_refused',
  'tonight.pr_isolate_refused',
  'reservations.ct_bill_stays',
])

/** Keys that still say "Something went wrong", on screens outside lane 5 (Studio, Tables, Design). */
const WRONG_WAITING: ReadonlySet<string> = new Set([
  'composer.errors.failed',
  'composer.guestFeatures.errors.failed',
  'tables.errors.failed',
  'design.errors.failed',
  'design.myStyles.errors.failed',
])

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

  // Copy rule 8 and GLOSSARY "POS" (_Avoid_: till, cash register): an owner-facing string names the
  // POS by `{source}` (D82) or as "the POS" / „POS системата“. The keys below belong to screens of
  // other lanes of the 2026-11-18 screen round and wait for them; the list may only shrink (D67).
  it('never call the POS "till" or "каса" outside the keys still waiting for their screens', () => {
    const tillEn = /\btills?\b/i
    const tillBg = /(?<!\p{L})кас(?:а|ата|и|ите)(?!\p{L})/iu
    const found = [
      ...[...enLeaves].filter(([, text]) => tillEn.test(text)).map(([key]) => `en ${key}`),
      ...[...bgLeaves].filter(([, text]) => tillBg.test(text)).map(([key]) => `bg ${key}`),
    ]
    expect(found.filter((entry) => !TILL_WAITING.has(entry.slice(3)))).toEqual([])
    // A key fixed since stays out: the allowlist shrinks with it.
    const stale = [...TILL_WAITING].filter(
      (key) => !tillEn.test(enLeaves.get(key) ?? '') && !tillBg.test(bgLeaves.get(key) ?? ''),
    )
    expect(stale).toEqual([])
  })

  // Copy rule 7: Bulgarian quotation marks are „…“.
  it('quote Bulgarian with „…“, never «…»', () => {
    const found = [...bgLeaves].filter(([, text]) => /[«»]/.test(text)).map(([key]) => key)
    expect(found).toEqual([])
  })

  // Copy rule 4: an error names the fix, never "Something went wrong". The keys below belong to
  // screens of other lanes; the list may only shrink (D67).
  it('never say "Something went wrong" outside the keys still waiting for their screens', () => {
    const wrongEn = /something went wrong/i
    const wrongBg = /нещо се обърка/i
    const found = new Set([
      ...[...enLeaves].filter(([, text]) => wrongEn.test(text)).map(([key]) => key),
      ...[...bgLeaves].filter(([, text]) => wrongBg.test(text)).map(([key]) => key),
    ])
    expect([...found].filter((key) => !WRONG_WAITING.has(key))).toEqual([])
    expect([...WRONG_WAITING].filter((key) => !found.has(key))).toEqual([])
  })

  // GLOSSARY "Full read" (_Avoid_: full sync) and "Changes read" (_Avoid_: quick sync).
  it('name a full read and a changes read by their glossary words', () => {
    const found = [
      ...[...enLeaves].filter(([, text]) => /\b(?:full|quick) sync/i.test(text)),
      ...[...bgLeaves].filter(([, text]) => /(?:пълна|бърза) синхронизация/i.test(text)),
    ].map(([key]) => key)
    expect(found).toEqual([])
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
