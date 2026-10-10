// A public address (venue slug) suggested from a venue's name. Pure, so the dialog and its tests
// share it. The server decides whether a slug is allowed and free (`isVenueSlug`, then the
// unique index); this only saves the person typing it out.
import { isVenueSlug } from '@restro/core'

/** The longest slug we suggest (the limit of a slug itself is 63). */
export const MAX_SUGGESTED_SLUG_LENGTH = 60

/** Bulgarian Cyrillic to Latin, the official transliteration scheme (Law on transliteration, 2009). */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ь: 'y',
  ю: 'yu',
  я: 'ya',
}

/**
 * A slug for a venue called `name`: lower-case, Bulgarian letters transliterated, every other run
 * of characters that are not a-z or 0-9 turned into one hyphen, hyphens trimmed from both ends,
 * at most 60 characters. Returns `''` when nothing usable is left (the field then shows its
 * error), so a non-empty result always passes core's `isVenueSlug`.
 */
export function suggestSlug(name: string): string {
  const latin = Array.from(name.toLowerCase(), (char) => TRANSLITERATION[char] ?? char).join('')
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SUGGESTED_SLUG_LENGTH)
    // The cut may leave a hyphen at the end.
    .replace(/-+$/, '')
  return isVenueSlug(slug) ? slug : ''
}
