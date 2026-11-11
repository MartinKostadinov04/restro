// Menus as data (D88, D92; adjustments M1, C1): how a menu's header name is checked. The writers
// are in ./apply/menus.ts; this is what the composer, the settings lists and the publisher share.
// A menu's layout and guest switch moved to the venue's design record (D129,
// ./design/record.ts): one look for every menu of the venue. Pure: no I/O.

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
