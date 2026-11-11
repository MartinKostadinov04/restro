// @vitest-environment jsdom
// Guardrail (D67, designer audit DA-O7): every value of the design record and the theme that reaches the
// guest page, made hostile. Two layers:
//   1. the published snapshot's schema, which the guest page parses every file with (load.ts
//      `getFile`): each hostile value must be refused there;
//   2. the rendered page, with a hostile view that skipped the schema (a defence in depth): what the
//      server render (renderToString) and the browser (jsdom) put out, and that the face's
//      stylesheet is the constant and nothing else.
// And what goes to Stripe's Appearance API from a view that parsed.
import {
  BASIC_DESIGN_VALUES,
  DesignValuesSchema,
  type MenuSnapshot,
  MenuSnapshotSchema,
} from '@restro/core'
import { EDITORIAL_MARKET_MANIFEST, EditorialMarketFace } from '@restro/editorial-market'
import { buildViewModel, imageSlotsFor, type ViewModel } from '@restro/shell'
import { snapshotFromSpec } from '@restro/shell/testing'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { stripeOptions } from '@/connectors/stripe/appearance'

import { cardFormLookOf } from './card-form-look'

const HOSTILE = [
  'x;}body{display:none}',
  '</style><script>window.__xss=1</script>',
  'url(https://evil.test/a.png)',
  'expression(alert(1))',
  '@import url(https://evil.test/x.css)',
  '"x" ; background:url(https://evil.test/p)',
  "' onmouseover='window.__xss=1",
  `Inter${'a'.repeat(10_000)}`,
  'Inter‮evil',
  'Inter‏',
  '#zzzzzz',
  '#FFFFFF',
] as const

const both = (text: string) => ({ en_US: text, bg_BG: text })

function baseSnapshot(): MenuSnapshot {
  const snapshot = snapshotFromSpec({
    locales: { default: 'en_US', available: ['en_US', 'bg_BG'] },
    menuTitle: both('Menu'),
    sections: [{ title: both('Drinks'), items: [{ name: both('Water'), price: 300 }] }],
  } as never) as MenuSnapshot
  return { ...snapshot, design: structuredClone(BASIC_DESIGN_VALUES) }
}

const viewOf = (snapshot: MenuSnapshot): ViewModel =>
  buildViewModel(snapshot, null, {
    locale: 'en_US',
    now: '2026-11-01T20:30:00+02:00',
    orderingEnabled: false,
    tableToken: null,
    capabilities: { ordering: false },
    images: imageSlotsFor(EDITORIAL_MARKET_MANIFEST, 1),
  })

type Mutation = readonly [string, (s: MenuSnapshot, value: string) => unknown]

/** Every path of the snapshot from the design record or the theme that the face reads. */
const PATHS: readonly Mutation[] = [
  ['theme.font', (s, v) => Object.assign(s.theme, { font: v })],
  ['theme.palette[0]', (s, v) => Object.assign(s.theme, { palette: [v] })],
  [
    'theme.roles.light.accent',
    (s, v) =>
      Object.assign(s.theme, {
        roles: {
          light: { ...(s.theme.roles?.light ?? {}), accent: v },
          dark: s.theme.roles?.dark,
        },
      }),
  ],
  ['theme.scheme', (s, v) => Object.assign(s.theme, { scheme: v })],
  ['theme.logo', (s, v) => Object.assign(s.theme, { logo: v })],
]

/** The design record is read leniently (DA-15): a hostile value is replaced, never refused. */
const DESIGN_PATHS: readonly Mutation[] = [
  ['design.general.corners', (s, v) => Object.assign(s.design?.general ?? {}, { corners: v })],
  [
    'design.general.heading_font',
    (s, v) => Object.assign(s.design?.general ?? {}, { heading_font: v }),
  ],
  ['design.items.layout', (s, v) => Object.assign(s.design?.items ?? {}, { layout: v })],
  ['design.<new option>', (s, v) => Object.assign(s.design?.general ?? {}, { [v]: 'soft' })],
  ['design.<new page>', (s, v) => Object.assign(s.design ?? {}, { [v]: {} })],
]

afterEach(() => cleanup())

describe('the published snapshot refuses every hostile theme value', () => {
  it('the base snapshot parses (the control)', () => {
    const parsed = MenuSnapshotSchema.safeParse(baseSnapshot())
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 2))).toBe(true)
  })
  for (const [path, mutate] of PATHS) {
    for (const value of HOSTILE) {
      it(`${path} = ${JSON.stringify(value.slice(0, 40))}: refused`, () => {
        const snapshot = baseSnapshot()
        mutate(snapshot, value)
        expect(MenuSnapshotSchema.safeParse(snapshot).success).toBe(false)
      })
    }
  }
})

describe('the published snapshot replaces every hostile design value with the contract’s own', () => {
  // The design block is read as the option list is now (DA-15): an unknown option or page is
  // dropped and a value off the list falls back to Basic's. The parse succeeds, and what comes back
  // is the contract's words, never the hostile string. (The publisher writes the block strictly.)
  for (const [path, mutate] of DESIGN_PATHS) {
    for (const value of HOSTILE) {
      it(`${path} = ${JSON.stringify(value.slice(0, 40))}: replaced`, () => {
        const snapshot = baseSnapshot()
        mutate(snapshot, value)
        const parsed = MenuSnapshotSchema.safeParse(snapshot)
        expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 2))).toBe(true)
        const design = parsed.data?.design
        // Whole and on the contract: every option has one of its listed values.
        expect(DesignValuesSchema.safeParse(design).success).toBe(true)
        // The base design is Basic's, and the one hostile value is gone: Basic's is back.
        expect(design).toEqual(BASIC_DESIGN_VALUES)
        expect(JSON.stringify(parsed.data)).not.toContain(value)
      })
    }
  }
})

describe('the rendered face, with a hostile view that skipped the schema (defence in depth)', () => {
  const STYLE_CLOSE = /<\/style>/g

  function hostile(value: string): ViewModel {
    const view = viewOf(baseSnapshot())
    return {
      ...view,
      theme: { ...view.theme, font: value },
      design: {
        ...view.design,
        general: { ...view.design.general, corners: value, heading_font: value },
      },
    } as ViewModel
  }

  for (const value of HOSTILE.slice(0, 7)) {
    it(`server render, ${JSON.stringify(value.slice(0, 40))}: one <style>, closed once, no script, no handler`, () => {
      const html = renderToString(<EditorialMarketFace view={hostile(value)} />)
      // The face's own stylesheet opens and closes once: nothing interpolated reaches it.
      expect(html.match(STYLE_CLOSE)?.length ?? 0).toBe(1)
      expect(html).not.toContain('<script')
      // Parsed as the browser would: no element carries a handler attribute.
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      for (const element of parsed.body.querySelectorAll('*')) {
        for (const name of element.getAttributeNames())
          expect(name.startsWith('on'), name).toBe(false)
      }
      expect(parsed.querySelectorAll('script')).toHaveLength(0)
    })

    it(`browser render, ${JSON.stringify(value.slice(0, 40))}: the root's attributes hold the value as data`, () => {
      const { container } = render(<EditorialMarketFace view={hostile(value)} />)
      const root = container.querySelector('.rm') as HTMLElement
      expect(root.getAttribute('data-corners')).toBe(value)
      expect(container.querySelectorAll('style')).toHaveLength(1)
      expect(container.querySelectorAll('script')).toHaveLength(0)
      expect(Reflect.get(window, '__xss')).toBeUndefined()
    })
  }
})

describe("what reaches Stripe's Appearance API from a view that parsed", () => {
  for (const font of ['Inter', 'Playfair Display', 'Unbounded'] as const) {
    it(`${font}: every variable is a hex, a px length or a plain font stack`, () => {
      const snapshot = baseSnapshot()
      Object.assign(snapshot.theme, { font })
      const parsed = MenuSnapshotSchema.parse(snapshot)
      const look = cardFormLookOf(viewOf(parsed), (family) => `"${family}", system-ui, sans-serif`)
      for (const screen of ['light', 'dark'] as const) {
        const { appearance, fonts } = stripeOptions(look, screen)
        for (const [key, value] of Object.entries(appearance.variables)) {
          expect(value, key).toMatch(
            /^(#[0-9a-f]{6}|\d+px|"[A-Za-z0-9 -]+", system-ui, sans-serif)$/,
          )
        }
        expect(fonts).toEqual([])
      }
    })
  }
})
