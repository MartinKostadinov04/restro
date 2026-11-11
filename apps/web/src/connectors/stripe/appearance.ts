// How the venue's General look reaches Stripe's Payment Element (D130, "Stripe's Payment Element";
// D125). A pure function from the colours and roles of both screens, the body font, the corners, the
// density and the text size to the Appearance API's options. Nothing here loads Stripe or draws
// anything: the card form (card-form.ts) hands `appearance` and `fonts` of the result to
// `stripe.elements` (#258). The Express Checkout options are for an Express Checkout Element, which
// the form does not create: Apple Pay and Google Pay show inside the Payment Element.
//   https://docs.stripe.com/elements/appearance-api.md
//
// What goes through, and what does not:
//   - `theme: 'flat'` with `variables` only: colours (hex, which the API wants), `fontFamily`,
//     `fontSizeBase`, `spacingUnit`, `borderRadius`. No `rules`: Click to edit stops at Stripe's frame.
//   - Stripe's own default stays for `colorDanger` (and success, warning): General has no role for them.
//   - The custom font is the `fonts` option of `stripe.elements`, not part of the appearance.
//   - The Express Checkout buttons (Apple Pay, Google Pay) keep their own look by Apple's and Google's
//     rules: they take a height, a corner radius and a black or white theme, nothing else.

import { relativeLuminance, type SemanticColours } from '@restro/shell'

/** The Payment Element's sheet is one of the three colours of the renderer's Sheets option. */
export type SheetColour = 'ink' | 'panel' | 'page'
/** The two screens the colours are chosen for. */
export type Screen = 'light' | 'dark'
/** General's density. */
export type Density = 'compact' | 'comfortable' | 'spacious'
/** General's text size. */
export type TextSize = 'standard' | 'large'

/** A font file the page serves, for the `fonts` option. */
export interface FontFile {
  /** The family name the stack uses (`Inter`). */
  readonly family: string
  /** A `src` value pointing to the file, `url(https://…)`: Stripe fetches it, so it must be https. */
  readonly src: string
  /** A `font-weight` (a range for a variable font: `100 900`). */
  readonly weight?: string
}

/** What General gives the Payment Element. */
export interface StripeLook {
  /** The venue's colours for a light screen and for a dark one (the view model's `theme`). */
  readonly colors: SemanticColours
  readonly colorsDark: SemanticColours
  /** The body font as a CSS stack, as the renderer's `--rm-font` has it. */
  readonly fontFamily: string
  /** The body font's file, when the page serves one Stripe can fetch. */
  readonly fontFile?: FontFile | null
  /** General's corners, as the theme's radius in pixels (`CORNER_RADIUS`). */
  readonly radius: number
  readonly density: Density
  readonly textSize: TextSize
  /** The sheet the form sits on (Sheets); Basic's `panel` when not said. */
  readonly sheet?: SheetColour
}

/** What `stripe.elements` and `elements.create('expressCheckout')` take. */
export interface StripeOptions {
  readonly appearance: {
    readonly theme: 'flat'
    readonly variables: Readonly<Record<string, string>>
  }
  /** The `fonts` option of `stripe.elements`: the body font's file, or none. */
  readonly fonts: readonly {
    readonly family: string
    readonly src: string
    readonly weight?: string
  }[]
  /** The Express Checkout Element's options: a height and a black or white theme (the radius is a variable). */
  readonly expressCheckout: {
    readonly buttonHeight: number
    readonly buttonTheme: {
      readonly applePay: 'black' | 'white'
      readonly googlePay: 'black' | 'white'
    }
  }
}

/** Stripe's spacing unit per density (its default is 4 px, the renderer's comfortable). */
const SPACING_UNIT: Readonly<Record<Density, string>> = {
  compact: '3px',
  comfortable: '4px',
  spacious: '5px',
}

/** The base font size per text size: inputs stay at 16 px at the least on a phone (Stripe's advice and §7.5). */
const FONT_SIZE_BASE: Readonly<Record<TextSize, string>> = {
  standard: '16px',
  large: '18px',
}

/** The Express Checkout buttons' height: 48 px, inside Stripe's 40 to 55 and over the 44 px target. */
export const EXPRESS_BUTTON_HEIGHT = 48

/** The pill's factor of the renderer's buttons (`--rm-pill`). */
const PILL = 1.6

/** The writing and the fill of a sheet, from the screen's colours (css.ts: `ink` is the text colour). */
export function sheetPair(
  colors: SemanticColours,
  sheet: SheetColour,
): { readonly background: string; readonly text: string } {
  switch (sheet) {
    case 'ink':
      return { background: colors.text, text: colors.background }
    case 'panel':
      return { background: colors.surface, text: colors.text }
    case 'page':
      return { background: colors.background, text: colors.text }
  }
}

/** True for a fill the writing on it should be light. */
function isDark(hex: string): boolean {
  return relativeLuminance(hex) < 0.4
}

/**
 * The options for one screen. The primary colour is the one the form draws its selected tab, its
 * links and its focus ring in: the accent as text where the venue's pairs promise it reads on the
 * sheet (the page's and the panel's colour), else the sheet's own writing.
 */
export function stripeOptions(look: StripeLook, screen: Screen): StripeOptions {
  const colors = screen === 'dark' ? look.colorsDark : look.colors
  const sheet = look.sheet ?? 'panel'
  const pair = sheetPair(colors, sheet)
  const radius = Math.max(0, Math.round(look.radius))
  const pill = Math.round(radius * PILL)
  const fonts = look.fontFile == null ? [] : [{ ...look.fontFile }]
  return {
    appearance: {
      theme: 'flat',
      variables: {
        colorPrimary: sheet === 'ink' ? pair.text : colors.accentText,
        colorBackground: pair.background,
        colorText: pair.text,
        fontFamily: look.fontFamily,
        fontSizeBase: FONT_SIZE_BASE[look.textSize],
        spacingUnit: SPACING_UNIT[look.density],
        borderRadius: `${radius}px`,
        // The Express Checkout buttons are pills like the renderer's buttons, up to half their height.
        buttonExpressCheckoutBorderRadius: `${Math.min(pill, EXPRESS_BUTTON_HEIGHT / 2)}px`,
      },
    },
    fonts,
    expressCheckout: {
      buttonHeight: EXPRESS_BUTTON_HEIGHT,
      // Apple's and Google's rules: a black button on a light fill, a white one on a dark fill.
      buttonTheme: isDark(pair.background)
        ? { applePay: 'white', googlePay: 'white' }
        : { applePay: 'black', googlePay: 'black' },
    },
  }
}
