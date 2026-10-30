// The context the guest page gives the shell (doc "The visualization shell", step 2): the language
// (the address `?lang=`, then the browser, then the menu's default), the table code from the
// address's fragment `#t=` (given on only after the published table file confirmed it, see
// `confirmedTable`) and the
// channel. The venue's clock is the shell's own default (Europe/Sofia) until the snapshot
// carries a time zone. Ordering is off in Stage 3.

import { type Locale, TABLE_TOKEN_PATTERN } from '@restro/core'
import {
  type FaceManifest,
  type FeatureName,
  imageSlotsFor,
  type ShellContextInput,
} from '@restro/shell'

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

/**
 * The table code in the address, or null when it is missing or cannot be a code. `/t/<code>` puts
 * it in the fragment (`#t=`, D122): a fragment never reaches a server, a log or a Referer. A code
 * in the query (`?t=`, links of before #70) still counts; the page moves it into the fragment
 * (`withCodeInFragment`).
 */
export function readTableToken(search: string, fragment = ''): string | null {
  for (const params of [
    new URLSearchParams(fragment.replace(/^#/, '')),
    new URLSearchParams(search),
  ]) {
    const token = params.get('t')
    if (token !== null) return TABLE_TOKEN_PATTERN.test(token) ? token : null
  }
  return null
}

/** The address with a table code in its query moved into the fragment, or null when it has none. */
export function withCodeInFragment(href: string): string | null {
  const url = new URL(href)
  const code = url.searchParams.get('t')
  if (code === null) return null
  url.searchParams.delete('t')
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  if (!fragment.has('t')) fragment.set('t', code)
  url.hash = fragment.toString()
  return url.toString()
}

/** What a tab keeps between reloads: its `sessionStorage`. */
export type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The tab's storage, or null where the browser gives none (some private modes throw on access). */
export function tabStorage(): TabStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const tableKey = (publicId: string) => `restro.table.${publicId}`

/**
 * The table code this tab kept for a venue, or null. A dish page's address (`#item-<id>`) takes
 * the fragment, so a reload there finds no code in the address: the tab's copy keeps the table.
 * Kept per tab (never in a shared link), checked against the published files like any code.
 */
export function rememberedTable(storage: TabStorage | null, publicId: string): string | null {
  try {
    const code = storage?.getItem(tableKey(publicId)) ?? null
    return code !== null && TABLE_TOKEN_PATTERN.test(code) ? code : null
  } catch {
    return null
  }
}

/**
 * Keeps the venue's confirmed table code for this tab, or forgets it (`code` null): after each
 * load the tab holds exactly the table that load confirmed, so a new code in the address replaces
 * the old one and an unknown one clears it. Without storage nothing is kept and nothing breaks.
 */
export function rememberTable(
  storage: TabStorage | null,
  publicId: string,
  code: string | null,
): void {
  try {
    if (code === null) storage?.removeItem(tableKey(publicId))
    else storage?.setItem(tableKey(publicId), code)
  } catch {
    // Private mode or a full storage: the table lasts until the next reload only.
  }
}

/** A table the published files know: the code from the address and how the table is called. */
export interface ConfirmedTable {
  readonly token: string
  readonly label: string
}

/**
 * The table the shell may be told about (A5-F5). The code in the address is only a claim until
 * `t/<hash>.json` has answered for this venue; a well-formed but unknown code is the same as no
 * code at all. `found` is the answer to the lookup of `requested` (null while it is out, when the
 * code is unknown, belongs to another venue or could not be read); an answer for another code,
 * left over from before the address changed, counts for nothing.
 */
export function confirmedTable(
  requested: string | null,
  found: ConfirmedTable | null,
): ConfirmedTable | null {
  return requested !== null && found !== null && found.token === requested ? found : null
}

/**
 * The context of one view model. `manifest` is the manifest of the template that will draw it: it
 * decides which photo sizes the shell asks for (R10).
 */
export function buildContext(input: {
  readonly locale: Locale
  readonly now: Date
  readonly tableToken: string | null
  readonly manifest: FaceManifest
  /** The page binds the table's shared order (#75): ordering is supported for this template. */
  readonly sharedOrder?: boolean
}): ShellContextInput {
  const sharedOrder = input.sharedOrder === true
  // What the platform supports for this page is what the page binds (the table's services client)
  // and the template draws: a template that is not bound gets no service, and a bound one gets the
  // services it declares controls for (`manifest.features`, R15). The reference template declares
  // only ordering, so it is offered no bill, pay or waiter control; the venue's own switches, in
  // the snapshot, still decide for the rest.
  const draws = (feature: FeatureName) => sharedOrder && input.manifest.features.includes(feature)
  return {
    locale: input.locale,
    now: input.now.toISOString(),
    channel: 'qr',
    tableToken: input.tableToken,
    orderingEnabled: sharedOrder,
    capabilities: {
      ordering: sharedOrder,
      callWaiter: draws('call_waiter'),
      bill: draws('bill'),
      pay: draws('pay'),
    },
    // One device pixel per CSS pixel: the face lets the browser choose among the photo files (srcset).
    images: imageSlotsFor(input.manifest, 1),
  }
}
