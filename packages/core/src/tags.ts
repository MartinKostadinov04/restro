// Tags (brief S3-06, D60): a venue keeps its own list ("Signature", "Spicy", "Local"), named in its
// languages and given a colour. The words here are the pure part, shared by the writers
// (apply/tags.ts), the composer and the publisher; no I/O.
//
// A tag's colour is a token name, never a hex value: the guest face resolves it against the
// venue's theme (R13), so the same tag fits whatever brand colour the venue picks. The names are
// semantic colours the shell already knows (`color.<name>` in its manifest); a tag is drawn as a
// small label in that colour.

import { z } from 'zod'

import type { TagId, VenueId } from './ids'
import { type Locale, LocaleSchema, type LocalizedText } from './locales'

/**
 * The colours a tag may have, as semantic theme tokens:
 * - `accent`: the brand colour, filled;
 * - `accent_text`: the brand colour as text on a light chip;
 * - `muted`: a quiet grey;
 * - `text`: the strongest text colour, filled;
 * - `border`: an outline only.
 */
export const TAG_COLORS = ['accent', 'accent_text', 'muted', 'text', 'border'] as const

/** One of the colour tokens a tag may have. */
export type TagColor = (typeof TAG_COLORS)[number]

/** Zod schema for a `TagColor`. */
export const TagColorSchema = z.enum(TAG_COLORS)

/** The colour a new tag gets. */
export const DEFAULT_TAG_COLOR: TagColor = 'accent'

/** A tag's name per language is short: it is drawn as a small label. */
export const MAX_TAG_NAME_LENGTH = 40

/** At most this many items are changed by one bulk tag change. */
export const MAX_BULK_TAG_ITEMS = 1000

/** A tag's name: text per language, each trimmed, 1–40 characters, at least one language. */
export const TagLabelSchema = z
  .partialRecord(LocaleSchema, z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH))
  .refine((label) => Object.keys(label).length > 0, 'a tag needs a name')

/** A venue's tag as the composer and the publisher read it. */
export interface Tag {
  readonly id: TagId
  readonly venueId: VenueId
  readonly label: LocalizedText
  readonly color: TagColor
  /** Position among the venue's tags: a fractional key, compared by byte order. */
  readonly sortKey: string
  /** True while the tag is archived (hidden from pickers, left out of new snapshots). */
  readonly archived: boolean
}

/** The languages a venue names its tags in. */
export interface TagLanguages {
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
}

/** Why a tag's name was refused. */
export type TagLabelProblem =
  /** Not a name at all (empty, too long, an unknown language). */
  | 'invalid'
  /** No name in the venue's default language (every title needs one, check V3). */
  | 'default_language_missing'
  /** A name in a language the venue has not enabled. */
  | 'language_not_enabled'

/** A tag name that passed `checkTagLabel`, or why it did not. */
export type TagLabelCheck =
  | { readonly ok: true; readonly label: LocalizedText }
  | { readonly ok: false; readonly problem: TagLabelProblem; readonly reason: string }

/**
 * Checks a tag's name against the venue: trimmed, a name in the venue's default language and no
 * language the venue has not enabled. Returns the cleaned name.
 */
export function checkTagLabel(label: unknown, languages: TagLanguages): TagLabelCheck {
  const parsed = TagLabelSchema.safeParse(label)
  if (!parsed.success) {
    return {
      ok: false,
      problem: 'invalid',
      reason: parsed.error.issues[0]?.message ?? 'the tag name is not valid',
    }
  }
  const cleaned = parsed.data
  if (cleaned[languages.defaultLocale] === undefined) {
    return {
      ok: false,
      problem: 'default_language_missing',
      reason: `a tag needs a name in ${languages.defaultLocale}`,
    }
  }
  const stray = Object.keys(cleaned).find(
    (locale) => !languages.enabledLocales.includes(locale as Locale),
  )
  if (stray !== undefined) {
    return {
      ok: false,
      problem: 'language_not_enabled',
      reason: `${stray} is not enabled for this venue`,
    }
  }
  return { ok: true, label: cleaned }
}
