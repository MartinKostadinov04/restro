import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DESIGN_OPTIONS, DESIGN_PAGES } from '../packages/core/src/design/contract'
import { PREMADE_STYLES } from '../packages/shell/src/design/styles/index'
import {
  checkAgainstD130,
  checkLabels,
  checkShape,
  checkStyle,
  type D130Row,
  readD130Table,
} from './design-contract'

// The design contract guard (D128, D130, D67). packages/core/src/design/contract.ts is the binding
// list of the menu designer's pages, options and values; docs/decisions/D130.md is the same table
// in words. This test fails when
//   1. a page, an option, a value or their order differs between D130's table and the contract
//      (D130 says 14 pages and 48 options; the counts are asserted too);
//   2. an id or a value is not a short lower-case token, or a marker is owned twice;
//   3. a page, an option or a value lacks its English or its Bulgarian label;
//   4. a Style file (packages/shell/src/design/styles/<id>.ts) names an option the contract lacks,
//      holds a value outside the option's list, sets the venue's brand, or is not a short
//      lower-case token; Basic is not the first value of every row; Editorial lists no departures.
// When the file and D130 disagree, one of them changed alone: change the other in the same commit.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const stylesDir = join(repoRoot, 'packages/shell/src/design/styles')
const d130 = readFileSync(join(repoRoot, 'docs/decisions/D130.md'), 'utf8')

interface MutableValue {
  id: string
  en: string
  bg: string
}
interface MutableOption {
  id: string
  kind: string
  en: string
  bg: string
  brand?: boolean
  values?: MutableValue[]
}
interface MutablePage {
  id: string
  en: string
  bg: string
  markers: string[]
  options: MutableOption[]
}

/** A copy of the contract that a test may change. */
const contract = (): MutablePage[] => structuredClone(DESIGN_PAGES) as unknown as MutablePage[]

function option(pages: MutablePage[], pageId: string, optionId: string): MutableOption {
  const found = pages.find((p) => p.id === pageId)?.options.find((o) => o.id === optionId)
  if (found === undefined) throw new Error(`no ${pageId}.${optionId}`)
  return found
}

describe('the design contract and D130', () => {
  const rows = readD130Table(d130)

  it('reads D130’s table: 14 pages, 48 options', () => {
    expect(rows).toHaveLength(48)
    expect(new Set(rows.map((r) => r.page)).size).toBe(14)
    expect(DESIGN_PAGES).toHaveLength(14)
    expect(DESIGN_OPTIONS).toHaveLength(48)
  })

  it('equals D130 in pages, options, values and order', () => {
    expect(checkAgainstD130(DESIGN_PAGES, rows)).toEqual([])
  })

  it('fails on a value moved, added or removed', () => {
    const swapped = d130.replace('| bold, regular, heavy |', '| regular, bold, heavy |')
    expect(swapped).not.toBe(d130)
    expect(checkAgainstD130(DESIGN_PAGES, readD130Table(swapped))).not.toEqual([])

    const added = d130.replace('| auto, light, dark |', '| auto, light, dark, sepia |')
    expect(added).not.toBe(d130)
    expect(checkAgainstD130(DESIGN_PAGES, readD130Table(added))).not.toEqual([])

    const pages = contract()
    option(pages, 'items', 'layout').values?.pop()
    expect(checkAgainstD130(pages, rows)).not.toEqual([])
  })

  it('fails on an option or a page added to, removed from or renamed in one side', () => {
    const lines = d130.split('\n')
    const dropped = lines.filter((line) => !line.startsWith('| Pay | Tip |')).join('\n')
    expect(checkAgainstD130(DESIGN_PAGES, readD130Table(dropped))).not.toEqual([])

    const pages = contract()
    option(pages, 'photos', 'shape').en = 'Crop'
    expect(checkAgainstD130(pages, rows)).not.toEqual([])

    const renamed = contract()
    ;(renamed[7] as MutablePage).en = 'Dish'
    expect(checkAgainstD130(renamed, rows)).not.toEqual([])

    const extra = contract()
    ;(extra[1] as MutablePage).options.push({
      id: 'title',
      kind: 'choice',
      en: 'Title',
      bg: 'Заглавие',
      values: [],
    })
    expect(checkAgainstD130(extra, rows)).not.toEqual([])
  })

  it('puts Basic’s value first in every row', () => {
    // D130: "Basic's values are the first value of each row". The Basic file holds them; see below.
    const basic = PREMADE_STYLES.basic?.values as unknown as
      | Record<string, Record<string, string>>
      | undefined
    expect(basic).toBeDefined()
    for (const { page, option: o } of DESIGN_OPTIONS) {
      if (o.kind !== 'choice' || ('brand' in o && o.brand === true)) continue
      const given = basic?.[page.id]?.[o.id]
      expect(given, `${page.id}.${o.id}`).toBe(o.values[0].id)
    }
  })
})

describe('the shape and the labels of the contract', () => {
  it('has short lower-case tokens and each marker owned once', () => {
    expect(checkShape(DESIGN_PAGES)).toEqual([])
  })

  it('fails on a value that is not a short lower-case token', () => {
    const pages = contract()
    option(pages, 'items', 'layout').values?.push({ id: 'Three-Columns', en: 'Three', bg: 'Три' })
    option(pages, 'items', 'frame').values?.push({
      id: 'a-value-far-too-long-to-be-short',
      en: 'Long',
      bg: 'Дълго',
    })
    expect(checkShape(pages).filter((p) => p.includes('short lower-case token'))).toHaveLength(2)
  })

  it('fails on a marker owned twice', () => {
    const pages = contract()
    ;(pages[1] as MutablePage).markers.push('nav')
    expect(checkShape(pages).some((p) => p.includes('"nav"'))).toBe(true)
  })

  it('has an English and a Bulgarian label for every page, option and value', () => {
    expect(checkLabels(DESIGN_PAGES)).toEqual([])
  })

  it('fails on a missing label in either language', () => {
    const noBg = contract()
    const one = option(noBg, 'items', 'layout').values?.[1]
    if (one === undefined) throw new Error('no value')
    one.bg = ''
    expect(checkLabels(noBg)).toEqual(['items.layout.one: no Bulgarian label'])

    const noEn = contract()
    option(noEn, 'bill', 'rows').en = ' '
    expect(checkLabels(noEn)).toEqual(['bill.rows: no English label'])

    const pageNoBg = contract()
    ;(pageNoBg[3] as MutablePage).bg = ''
    expect(checkLabels(pageNoBg)).toEqual(['sections: no Bulgarian label'])
  })

  it('fails on an English text left in the Bulgarian slot', () => {
    const pages = contract()
    option(pages, 'header', 'band').bg = 'Band'
    expect(checkLabels(pages)).toEqual(['header.band: the Bulgarian label has no Cyrillic letters'])
  })
})

describe('the Style files', () => {
  const files = readdirSync(stylesDir).filter((name) => name.endsWith('.ts') && name !== 'index.ts')

  async function load(file: string) {
    const exports = Object.values(await import(pathToFileURL(join(stylesDir, file)).href)) as {
      id?: unknown
      departures?: unknown
      values?: unknown
    }[]
    expect(exports, `${file} exports one Style`).toHaveLength(1)
    return exports[0] as {
      id: string
      departures: string[]
      values: Record<string, Record<string, string>>
    }
  }

  type StyleData = {
    id: string
    departures: string[]
    values: Record<string, Record<string, string>>
  }

  function pageOf(style: StyleData, id: string): Record<string, string> {
    const page = style.values[id]
    if (page === undefined) throw new Error(`no page ${id}`)
    return page
  }

  function setValue(style: StyleData, page: string, option: string, value: string): void {
    pageOf(style, page)[option] = value
  }

  it('has Basic and Editorial, each in a file named for it and listed in the index', async () => {
    expect(files.sort()).toEqual(['basic.ts', 'editorial.ts'])
    for (const file of files) {
      const style = await load(file)
      expect(`${style.id}.ts`).toBe(file)
      expect(Object.keys(PREMADE_STYLES)).toContain(style.id)
    }
    expect(Object.keys(PREMADE_STYLES).sort()).toEqual(['basic', 'editorial'])
  })

  it('validates every Style file against the contract', async () => {
    for (const file of files) {
      expect(checkStyle(await load(file), DESIGN_PAGES), file).toEqual([])
    }
  })

  it('lists Editorial’s departures and none for Basic', async () => {
    expect((await load('basic.ts')).departures).toEqual([])
    expect((await load('editorial.ts')).departures.length).toBeGreaterThanOrEqual(7)
  })

  it('fails on a value outside the option’s list', async () => {
    const style = structuredClone(await load('editorial.ts'))
    setValue(style, 'items', 'layout', 'three')
    expect(checkStyle(style, DESIGN_PAGES)).toEqual([
      'editorial.items.layout: "three" is not one of list, one, two',
    ])
  })

  it('fails on a value that is not a short lower-case token', async () => {
    const style = structuredClone(await load('basic.ts'))
    setValue(style, 'general', 'corners', 'Soft')
    expect(checkStyle(style, DESIGN_PAGES)).toEqual([
      'basic.general.corners: "Soft" is not a short lower-case token',
    ])
  })

  it('fails on an option the contract lacks, a missing option and a missing page', async () => {
    const style = structuredClone(await load('basic.ts'))
    setValue(style, 'items', 'shadow', 'low')
    Reflect.deleteProperty(pageOf(style, 'pay'), 'tip')
    Reflect.deleteProperty(style.values, 'receipt')
    expect(checkStyle(style, DESIGN_PAGES).sort()).toEqual([
      'basic.items: names an option "shadow" the contract lacks',
      'basic.pay.tip: no value',
      'basic.receipt: no values for the page',
    ])
  })

  it('fails on colours, roles, a logo, a body font or the Style itself (a Style never sets them)', async () => {
    const style = structuredClone(await load('basic.ts'))
    setValue(style, 'general', 'body_font', 'lora')
    setValue(style, 'general', 'colours', '#ff0000')
    setValue(style, 'general', 'style', 'club')
    Object.assign(style.values, { logo: 'lg_1' })
    expect(checkStyle(style, DESIGN_PAGES).sort()).toEqual(
      [
        "basic.general.body_font: a Style never sets the venue's brand",
        'basic.general: names an option "colours" the contract lacks',
        'basic.general: names an option "style" the contract lacks',
        'basic: names a page "logo" the contract lacks',
      ].sort(),
    )
  })

  it('fails on a Style the contract does not list', async () => {
    const style = { ...(await load('basic.ts')), id: 'neon' }
    expect(checkStyle(style, DESIGN_PAGES)).toEqual(['neon: not a Style of the contract'])
  })
})

describe('the D130 row reader', () => {
  it('reads a row as page, option and values', () => {
    const table: D130Row[] = readD130Table(
      '| Page | Option | Values (Basic first) |\n|---|---|---|\n| A | B | c, d |\n\nafter',
    )
    expect(table).toEqual([{ page: 'A', option: 'B', values: 'c, d' }])
  })
})
