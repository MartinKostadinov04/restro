// Menus as data (D88, D92; adjustments M1, C1): what a menu's own settings may hold and how its
// header name is checked. The writers are in ./apply/menus.ts; this is what the composer, the
// settings lists and the publisher share. Pure: no I/O.

import { z } from 'zod'

/** How a face lays a menu out (D92): a list, one column of cards, or two columns. */
export const MENU_LAYOUTS = ['list', 'one_column', 'two_columns'] as const

export type MenuLayout = (typeof MENU_LAYOUTS)[number]

/**
 * A menu's settings (`menus.settings`, stored snake_case): the layout guests see first and
 * whether they may switch it (D92). A key left out means the template's default.
 */
export const MenuSettingsSchema = z.strictObject({
  layout: z.enum(MENU_LAYOUTS).optional(),
  layout_switch: z.boolean().optional(),
})

export type MenuSettings = z.output<typeof MenuSettingsSchema>

/** The keys `MenuSettingsSchema` knows; anything else in a stored object is ignored on read. */
const MENU_SETTING_KEYS = Object.keys(MenuSettingsSchema.shape)

/** Most characters in a menu's header name (`menus.name`; the venue name's rule). */
export const MAX_MENU_NAME_LENGTH = 120

/** A checked header name: `null` means "the venue's name" (D92). */
export type MenuNameCheck =
  | { readonly ok: true; readonly name: string | null }
  | { readonly ok: false; readonly reason: string }

/**
 * Checks a menu's header name: null (or blank) means the venue's name; else trimmed, 1 to 120
 * characters.
 */
export function checkMenuName(value: unknown): MenuNameCheck {
  if (value === null || value === undefined) return { ok: true, name: null }
  if (typeof value !== 'string') return { ok: false, reason: 'the menu name must be text' }
  const name = value.trim()
  if (name === '') return { ok: true, name: null }
  if ([...name].length > MAX_MENU_NAME_LENGTH) {
    return {
      ok: false,
      reason: `the menu name is longer than ${MAX_MENU_NAME_LENGTH} characters`,
    }
  }
  return { ok: true, name }
}

/**
 * The settings of a stored menu, forgivingly: unknown keys are dropped and a bad value means the
 * default for that key (an old or hand-edited row never breaks a screen).
 */
export function menuSettingsOf(stored: unknown): MenuSettings {
  if (typeof stored !== 'object' || stored === null) return {}
  const known: Record<string, unknown> = {}
  for (const key of MENU_SETTING_KEYS) {
    const value = (stored as Record<string, unknown>)[key]
    if (value !== undefined) known[key] = value
  }
  const parsed = MenuSettingsSchema.safeParse(known)
  if (parsed.success) return parsed.data
  const settings: Record<string, unknown> = {}
  for (const key of MENU_SETTING_KEYS) {
    const one = MenuSettingsSchema.safeParse({ [key]: known[key] })
    if (one.success && known[key] !== undefined) settings[key] = known[key]
  }
  return settings as MenuSettings
}
