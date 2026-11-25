// The Payment Element's look from General (D130): a pure mapping, so a plain unit test. It holds
// what goes through (colours of both screens, the body font, corners, density, text size), what does
// not (no rules, no danger colour, nothing for Apple Pay and Google Pay but height, radius, theme) and
// that every colour is a hex the API accepts (it takes neither rgba() nor var()).

import type { SemanticColours } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { EXPRESS_BUTTON_HEIGHT, type StripeLook, sheetPair, stripeOptions } from './appearance'

const LIGHT: SemanticColours = {
  background: '#f6f1e9',
  surface: '#e9dccb',
  accent: '#7a2e8c',
  onAccent: '#ffffff',
  text: '#1d1a17',
  muted: '#5c544c',
  accentText: '#6a2679',
  border: '#d4c7b4',
}
const DARK: SemanticColours = {
  background: '#14110f',
  surface: '#26211d',
  accent: '#c68ad6',
  onAccent: '#14110f',
  text: '#f3ece3',
  muted: '#b9afa3',
  accentText: '#d9a8e6',
  border: '#3a332d',
}
const LOOK: StripeLook = {
  colors: LIGHT,
  colorsDark: DARK,
  fontFamily: '"Inter", system-ui, sans-serif',
  radius: 12,
  density: 'comfortable',
  textSize: 'standard',
}

const HEX = /^#[0-9a-f]{6}$/i

describe('the Payment Element’s look from General (D130)', () => {
  it('is the flat theme with variables only, in the screen’s colours', () => {
    const light = stripeOptions(LOOK, 'light').appearance
    const dark = stripeOptions(LOOK, 'dark').appearance
    expect(light.theme).toBe('flat')
    expect(Object.keys(light)).toEqual(['theme', 'variables'])
    // The default sheet is the panel: the panel’s fill, the venue’s writing.
    expect(light.variables).toMatchObject({
      colorBackground: LIGHT.surface,
      colorText: LIGHT.text,
      colorPrimary: LIGHT.accentText,
    })
    expect(dark.variables).toMatchObject({
      colorBackground: DARK.surface,
      colorText: DARK.text,
      colorPrimary: DARK.accentText,
    })
    // Hex only: Stripe takes neither rgba() nor var() for these.
    for (const name of ['colorPrimary', 'colorBackground', 'colorText']) {
      expect(light.variables[name], name).toMatch(HEX)
      expect(dark.variables[name], name).toMatch(HEX)
    }
  })

  it('leaves Stripe’s own colours for what General has no role for, and sets no rules', () => {
    for (const screen of ['light', 'dark'] as const) {
      const { appearance } = stripeOptions(LOOK, screen)
      const names = Object.keys(appearance.variables)
      expect(names).not.toContain('colorDanger')
      expect(names).not.toContain('colorSuccess')
      expect(names).not.toContain('colorWarning')
      expect(appearance).not.toHaveProperty('rules')
    }
  })

  it('takes the body font, the corners, the density and the text size', () => {
    const options = (change: Partial<StripeLook>) =>
      stripeOptions({ ...LOOK, ...change }, 'light').appearance.variables
    expect(options({}).fontFamily).toBe('"Inter", system-ui, sans-serif')
    expect(options({ radius: 0 }).borderRadius).toBe('0px')
    expect(options({ radius: 18 }).borderRadius).toBe('18px')
    expect(options({ density: 'compact' }).spacingUnit).toBe('3px')
    expect(options({ density: 'comfortable' }).spacingUnit).toBe('4px')
    expect(options({ density: 'spacious' }).spacingUnit).toBe('5px')
    expect(options({ textSize: 'standard' }).fontSizeBase).toBe('16px')
    expect(options({ textSize: 'large' }).fontSizeBase).toBe('18px')
    // Never under 16 px: an input smaller than that makes a phone zoom (§7.5).
    for (const textSize of ['standard', 'large'] as const) {
      expect(Number.parseFloat(options({ textSize }).fontSizeBase ?? '0')).toBeGreaterThanOrEqual(
        16,
      )
    }
  })

  it('passes the body font’s file as the fonts option, or none', () => {
    expect(stripeOptions(LOOK, 'light').fonts).toEqual([])
    const file = {
      family: 'Inter',
      src: 'url(https://restro.example/f/inter.woff2)',
      weight: '100 900',
    }
    expect(stripeOptions({ ...LOOK, fontFile: file }, 'light').fonts).toEqual([file])
  })

  it('writes the sheet’s own pair: ink on ink does not vanish', () => {
    expect(sheetPair(LIGHT, 'ink')).toEqual({ background: LIGHT.text, text: LIGHT.background })
    expect(sheetPair(LIGHT, 'panel')).toEqual({ background: LIGHT.surface, text: LIGHT.text })
    expect(sheetPair(LIGHT, 'page')).toEqual({ background: LIGHT.background, text: LIGHT.text })
    const ink = stripeOptions({ ...LOOK, sheet: 'ink' }, 'light').appearance.variables
    expect(ink).toMatchObject({
      colorBackground: LIGHT.text,
      colorText: LIGHT.background,
      colorPrimary: LIGHT.background,
    })
    expect(ink.colorText).not.toBe(ink.colorBackground)
  })

  it('gives Apple Pay and Google Pay a height, a radius and a black or white theme, nothing else', () => {
    const light = stripeOptions(LOOK, 'light')
    const dark = stripeOptions(LOOK, 'dark')
    expect(Object.keys(light.expressCheckout).sort()).toEqual(['buttonHeight', 'buttonTheme'])
    expect(Object.keys(light.expressCheckout.buttonTheme).sort()).toEqual(['applePay', 'googlePay'])
    expect(light.expressCheckout.buttonHeight).toBe(EXPRESS_BUTTON_HEIGHT)
    expect(EXPRESS_BUTTON_HEIGHT).toBeGreaterThanOrEqual(44)
    expect(EXPRESS_BUTTON_HEIGHT).toBeLessThanOrEqual(55)
    // A black button on a light fill, a white one on a dark fill (Apple’s and Google’s rules).
    expect(light.expressCheckout.buttonTheme).toEqual({ applePay: 'black', googlePay: 'black' })
    expect(dark.expressCheckout.buttonTheme).toEqual({ applePay: 'white', googlePay: 'white' })
    // The radius is the one variable the buttons take, a pill up to half their height.
    expect(light.appearance.variables.buttonExpressCheckoutBorderRadius).toBe('19px')
    const round = stripeOptions({ ...LOOK, radius: 30 }, 'light')
    expect(round.appearance.variables.buttonExpressCheckoutBorderRadius).toBe(
      `${EXPRESS_BUTTON_HEIGHT / 2}px`,
    )
  })
})
