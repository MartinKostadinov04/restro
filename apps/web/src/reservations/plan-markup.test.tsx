// @vitest-environment jsdom
// The floor plan's first acceptance criterion (#327): **the stored shape must never become markup
// in a staff screen.** A venue's plan is its own data (D134, log 1.29), so a row of it is as
// untrusted as anything else a venue types — and a plan is read by staff at 02:00, on a tablet
// behind the bar, with nobody to notice.
//
// This test is the guardrail, not an extra. It fails if someone later:
//   - renders any of the plan's modules' strings as markup (`dangerouslySetInnerHTML` and the rest
//     of the ways to do it are forbidden across `src/reservations/`);
//   - builds a class, a style, a URL or an attribute out of a spot's own text instead of out of
//     the shape folder's names and checked numbers;
//   - lets a stored name reach the DOM as anything but text.
//
// Its other half is `packages/core/src/spot-shapes.test.ts`, which pins that a stored row is
// checked — a name out of our list and whole numbers — before a screen is handed it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { SPOT_SHAPES, type SpotPlace, type SpotSymbol } from '@restro/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RvSpotView } from '@/server/reservations/view'
import { renderWithIntl } from '@/test-utils'

import { KindSymbol, placeStyle, SpotTile, StateMark, stateTileClass } from './plan-shape'

/** What a venue could put in a name, a plan's name or a block's reason if it tried. */
const NASTY = [
  '<img src=x onerror="alert(1)">',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  `' ;drop table spots;--`,
  'javascript:alert(1)',
  '{{constructor.constructor("alert(1)")()}}',
] as const

const BOX = { x: 0, y: 0, width: 1000, height: 1000 } as const

function spotOf(over: Partial<RvSpotView> = {}): RvSpotView {
  return {
    id: 'sp_1',
    name: 'Маса 7',
    kind: 'table',
    place: { shape: 'rect', x: 100, y: 200, width: 80, height: 60, rotation: 0 },
    seats: 4,
    state: 'free',
    table: null,
    holds: [],
    leading: null,
    ...over,
  }
}

function tile(spot: RvSpotView, symbol: SpotSymbol = 'table') {
  return renderWithIntl(
    <SpotTile
      spot={spot}
      box={BOX}
      symbol={symbol}
      kindLabel="Маси"
      line="Свободно"
      stateWord="Свободно"
      selected={false}
      onOpen={() => {}}
      label={`Spot ${spot.name}`}
    />,
  )
}

/** Every source file of the plan's own folder, so the scan cannot miss a new one. */
function reservationSources(): readonly { readonly file: string; readonly text: string }[] {
  const root = path.resolve(__dirname)
  const found: { file: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !name.includes('.test.')) {
        // Comments are stripped: this file's own notes name what the code may not do.
        const text = readFileSync(full, 'utf8')
          .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
          .replaceAll(/(^|[^:])\/\/.*$/gm, '$1')
        found.push({ file: path.relative(root, full), text })
      }
    }
  }
  walk(root)
  return found
}

describe('no module of the plan can turn stored text into markup', () => {
  // Every way a React screen can put a string into the DOM as markup, or run it.
  const FORBIDDEN = [
    'dangerouslySetInnerHTML',
    '.innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'document.write',
    'createContextualFragment',
    'new Function',
    'eval(',
    'srcdoc',
  ] as const

  it('names no way of doing it, anywhere under src/reservations', () => {
    const sources = reservationSources()
    expect(sources.length).toBeGreaterThan(5)
    for (const { file, text } of sources) {
      for (const forbidden of FORBIDDEN) {
        expect(text.includes(forbidden), `${file} names ${forbidden}`).toBe(false)
      }
    }
  })

  it('draws every symbol and every state mark with a component, never with stored text', () => {
    // The symbol and the state are names out of the folder's lists; the components are lucide's,
    // and nothing stored reaches an `svg` attribute. A `<use href>` or a `<path d>` built from a
    // row would show up here as an element the test does not allow.
    const { container } = render(
      <>
        <KindSymbol symbol="booth" />
        <StateMark state="blocked" />
      </>,
    )
    for (const node of container.querySelectorAll('svg')) {
      expect(node.querySelector('use')).toBeNull()
      expect(node.getAttribute('onload')).toBeNull()
    }
    expect(container.querySelectorAll('svg').length).toBe(2)
  })

  it("builds a tile's class only out of the folder's corner names", () => {
    for (const shape of SPOT_SHAPES) {
      const place: SpotPlace = {
        shape,
        x: 10,
        y: 10,
        width: 80,
        height: shape === 'circle' ? 80 : 40,
        rotation: 0,
      }
      const { unmount } = tile(spotOf({ place }))
      const node = screen.getByTestId('rv-spot')
      expect(node.getAttribute('data-shape')).toBe(shape)
      // Exactly one rounding class, out of the three our own table holds.
      const rounded = [...node.classList].filter((name) => name.startsWith('rounded'))
      expect(rounded.length).toBe(1)
      expect(['rounded-none', 'rounded-xl', 'rounded-full']).toContain(rounded[0])
      unmount()
    }
  })

  it('builds a place out of arithmetic on checked numbers and nothing else', () => {
    const style = placeStyle(
      { shape: 'booth', x: 300, y: 400, width: 200, height: 100, rotation: 45 },
      BOX,
    )
    expect(Object.keys(style).sort()).toEqual(['height', 'left', 'top', 'transform', 'width'])
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      expect(String(style[key])).toMatch(/^\d+\.\d{4}%$/)
    }
    expect(style.transform).toBe('rotate(45deg)')
    // No rotation, no transform: nothing is written that is not needed.
    expect(
      placeStyle({ shape: 'rect', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, BOX).transform,
    ).toBeUndefined()
  })

  it('gives each state a surface out of its own table, never out of a row', () => {
    for (const state of ['free', 'held', 'sitting', 'late', 'blocked'] as const) {
      const look = stateTileClass(state)
      expect(look).not.toMatch(/[<>'"`]/)
      expect(look).not.toMatch(/url\(|\$\{/)
    }
  })
})

describe("a venue's own text, on the plan", () => {
  it('draws a hostile spot name as text and puts no element of it in the DOM', () => {
    const plain = tile(spotOf())
    const plainElements = plain.container.querySelectorAll('*').length
    plain.unmount()
    for (const name of NASTY) {
      const { container, unmount } = tile(spotOf({ name }))
      const node = screen.getByTestId('rv-spot')
      expect(node.textContent).toContain(name)
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector('svg[onload]')).toBeNull()
      // The name is a text node, not an element: a tile of a hostile name holds exactly the
      // elements a tile of an ordinary one holds.
      expect(container.querySelectorAll('*').length).toBe(plainElements)
      expect(
        [...container.querySelectorAll('span')].some((node) => node.textContent === name),
      ).toBe(true)
      unmount()
    }
  })

  it('keeps a hostile state line text too, and the title attribute an attribute', () => {
    const { container, unmount } = renderWithIntl(
      <SpotTile
        spot={spotOf({ name: NASTY[0] })}
        box={BOX}
        symbol="table"
        kindLabel={NASTY[1]}
        line={NASTY[2]}
        stateWord="Blocked"
        selected={false}
        onOpen={() => {}}
        label={NASTY[3]}
      />,
    )
    const node = screen.getByTestId('rv-spot')
    expect(node.getAttribute('aria-label')).toBe(NASTY[3])
    expect(node.getAttribute('title')).toContain(NASTY[1])
    expect(node.textContent).toContain(NASTY[2])
    expect(container.querySelectorAll('img, script, iframe, object, embed, use').length).toBe(0)
    unmount()
  })

  it('never lets a name become a class or a style of its own', () => {
    const { unmount } = tile(spotOf({ name: 'bg-[url(https://evil.test/x.png)]' }))
    const node = screen.getByTestId('rv-spot')
    expect([...node.classList].some((name) => name.includes('evil.test'))).toBe(false)
    expect(node.getAttribute('style') ?? '').not.toContain('evil.test')
    unmount()
  })
})
