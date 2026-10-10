// The context the guest page gives the shell (doc "The visualization shell", step 2): the language
// (the address `?lang=`, then the browser, then the menu's default), the table token from `?t=`,
// and the channel. The venue's clock is the shell's own default (Europe/Sofia)
// until the snapshot carries a time zone. Ordering is off in Stage 3.

import { type Locale, TABLE_TOKEN_PATTERN } from '@restro/core'
import { imageSlotsFor, type ShellContextInput } from '@restro/shell'
import { QR_PHONE_MANIFEST } from '@restro/qr-phone'

/** The language of the page before the menu says otherwise: the pilot venues are Bulgarian. */
export const FALLBACK_LOCALE: Locale = 'bg_BG'

/** `bg`, `bg-BG`, `bg_BG` and `EN` all name a language; the first of the menu's that fits wins. */
function matchLocale(wanted: string, available: readonly Locale[]): Locale | null {
  const normalised = wanted.trim().replace('-', '_').toLowerCase()
  if (normalised === '') return null
  const exact = available.find((locale) => locale.toLowerCase() === normalised)
  if (exact !== undefined) return exact
  const language = normalised.split('_')[0]
  return available.find((locale) => locale.split('_')[0]?.toLowerCase() === language) ?? null
}

/** What the guest asked for in the address (`?lang=`), the browser's languages and the menu's. */
export interface LanguageChoice {
  /** The query string, with or without the leading `?`. */
  readonly search: string
  /** `navigator.languages`, most wanted first. */
  readonly browser: readonly string[]
  /** The languages the menu has; empty before it is loaded. */
  readonly available: readonly Locale[]
  readonly menuDefault: Locale | null
}

/**
 * The page's language: `?lang=` if the menu has it, else the first browser language the menu has,
 * else the menu's default. Before the menu is loaded (`available` empty) the guest's own wish is
 * used for the loading and error messages, and Bulgarian when there is none.
 */
export function chooseLocale(choice: LanguageChoice): Locale {
  const requested = new URLSearchParams(choice.search).get('lang')
  const known = (wanted: string): Locale | null => {
    if (choice.available.length > 0) return matchLocale(wanted, choice.available)
    return matchLocale(wanted, ['bg_BG', 'en_US'])
  }
  if (requested !== null) {
    const found = known(requested)
    if (found !== null) return found
  }
  for (const language of choice.browser) {
    const found = known(language)
    if (found !== null) return found
  }
  return choice.menuDefault ?? FALLBACK_LOCALE
}

/** The short form for the address: `bg_BG` is `bg`. */
export function langParam(locale: Locale): string {
  return locale.split('_')[0] ?? locale
}

/** The table token in the address (`?t=`), or null when it is missing or cannot be a token. */
export function readTableToken(search: string): string | null {
  const token = new URLSearchParams(search).get('t')
  return token !== null && TABLE_TOKEN_PATTERN.test(token) ? token : null
}

/** The context of one view model. */
export function buildContext(input: {
  readonly locale: Locale
  readonly now: Date
  readonly tableToken: string | null
}): ShellContextInput {
  return {
    locale: input.locale,
    now: input.now.toISOString(),
    channel: 'qr',
    tableToken: input.tableToken,
    orderingEnabled: false,
    // One device pixel per CSS pixel: the face lets the browser choose among the photo files (srcset).
    images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
  }
}
