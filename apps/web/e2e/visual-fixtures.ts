// What the accessibility and visual audit of the Editorial Market (brief SH-07) shares between its
// fixtures (scripts/seed-visual-e2e.ts) and its specs (faces-a11y.spec.ts, faces-visual.spec.ts):
// five published menus, one per theme, with the same content, so every theme meets the same hard
// cases (long names, sold-out and scheduled items, photos in every layout, every allergen).
//
// Like the look fixture of the guest page (e2e/support.ts) these menus have no venue row: they are
// snapshot files in the e2e publish folder, found by a fixed public code.

/** The five themes of the audit: the designer's four presets and one made from three colours. */
export const VISUAL_THEMES = [
  { id: 'botanical', publicId: 'visualbota01', table: 'tb_e2eVisualTable01' },
  { id: 'midnight', publicId: 'visualmid001', table: 'tb_e2eVisualTable02' },
  { id: 'nordic', publicId: 'visualnor001', table: 'tb_e2eVisualTable03' },
  { id: 'terracotta', publicId: 'visualter001', table: 'tb_e2eVisualTable04' },
  { id: 'custom', publicId: 'visualcus001', table: 'tb_e2eVisualTable05' },
] as const

/** One theme of the audit. */
export type VisualTheme = (typeof VISUAL_THEMES)[number]
/** The id of one theme of the audit. */
export type VisualThemeId = VisualTheme['id']

/** The custom theme's three colours (primary, secondary, tertiary), as the brief names them. */
export const CUSTOM_COLOURS = { primary: '#f6f1e9', secondary: '#e9dccb', tertiary: '#7a2e8c' }

/** A template id as the registry spells it (`editorial-market`, `qr-phone`): lower case and hyphens. */
export const isFaceId = (id: string): boolean => /^[a-z][a-z0-9-]*$/.test(id)

/** The slug in front of a fixture menu's public code. */
export const VISUAL_SLUG = 'visual-fixture'

/** The address of a fixture menu: `/m/visual-fixture-<code>`. */
export const visualPath = (theme: VisualTheme): string => `/m/${VISUAL_SLUG}-${theme.publicId}`

/** The label of the table every fixture menu's table code opens. */
export const VISUAL_TABLE_LABEL = '12'

/** A name of exactly 60 characters in one unbroken run of Cyrillic (the worst case for a card). */
export const LONG_NAME_BG = `Негрони ${'и'.repeat(52)}`
/** The same in English. */
export const LONG_NAME_EN = `Negroni ${'x'.repeat(52)}`
/** A second 60-character name, with spaces, on an item without a photo. */
export const LONG_TEXT_NAME_BG = 'Агнешко печено с розмарин, чесън и зеленчуци на скара и лук.'
/** The English twin of the one above (60 characters as well). */
export const LONG_TEXT_NAME_EN = 'Roast lamb with rosemary, garlic and grilled vegetables (2x)'

/**
 * Two more logos for the venue, drawn with no background (D109): a white mark and a black one, each
 * invisible on one of the two schemes. The seed writes their image files, and the matrix serves a
 * menu's snapshot with one of them as `theme.logo`.
 */
export const LOGO_MARKS = {
  white: 'as_0000000000000000000008',
  black: 'as_0000000000000000000009',
} as const

/** Items the specs look for by their Bulgarian name. */
export const VISUAL_ITEMS = {
  /** A photo card in the photo strip, with a "new" badge and many labels. */
  negroni: 'Негрони',
  /** A photo card that is sold out. */
  soldOut: 'Пшенична бира',
  /** A photo card whose hours have not come. */
  scheduled: 'Нощен шот',
  /** A photo card with all fourteen allergens and two groups of choices. */
  platter: 'Плато за компания',
} as const
