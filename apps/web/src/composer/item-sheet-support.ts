// Small pure helpers of the item sheet's tabs (no React, so they are tested on their own).
import type { Locale } from '@restro/core'

import type { Provenance } from '@/fields/types'
import type { SheetProvenance, SheetResult } from '@/server/item-sheet/types'

const MARK = '\u0001'

/**
 * Placeholder values for a message that must contain React elements (a person's name in bold, a
 * value drawn by its field type): next-intl fills `{who}` with a marker, and `splitMarks` cuts
 * the finished sentence at the markers so the caller can put the elements in. The word order is
 * the translation's own, which a sentence glued together in code could not leave to it.
 */
export function marks<K extends string>(...names: readonly K[]): Record<K, string> {
  return Object.fromEntries(names.map((name) => [name, `${MARK}${name}${MARK}`])) as Record<
    K,
    string
  >
}

/** A sentence cut at its markers: text, and the places the caller's elements go. */
export type SentencePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mark'; readonly name: string }

export function splitMarks(sentence: string): SentencePart[] {
  return sentence
    .split(new RegExp(`${MARK}([A-Za-z]+)${MARK}`))
    .map(
      (piece, index): SentencePart =>
        index % 2 === 1 ? { kind: 'mark', name: piece } : { kind: 'text', text: piece },
    )
    .filter((part) => part.kind === 'mark' || part.text !== '')
}

/** The name of a document language in the interface language: `bg_BG` -> "Bulgarian" / "български". */
export function languageName(locale: Locale, interfaceLanguage: string): string {
  const language = locale.split('_')[0] ?? locale
  try {
    return new Intl.DisplayNames([interfaceLanguage], { type: 'language' }).of(language) ?? language
  } catch {
    return language
  }
}

/** The badge for a resolved provenance; `none` has no badge. */
export function badgeProvenance(provenance: SheetProvenance): Provenance | undefined {
  return provenance === 'none' ? undefined : provenance
}

/** The provenance a stored layer stands for in the history (`edition:` layers have none). */
export function layerProvenance(layer: string): Provenance | null {
  if (layer === 'till') return 'till'
  if (layer === 'manual') return 'owned'
  if (layer === 'override') return 'overridden'
  return null
}

/** The message key (under `itemSheet.errors`) for a save that did not happen. */
export function errorKey(result: Extract<SheetResult, { ok: false }>): string {
  return `errors.${result.error}`
}

/** Why an upload was refused, as the route's JSON says it (or `network` when nothing came back). */
export type UploadFailure =
  | 'unauthorized'
  | 'bad_origin'
  | 'no_file'
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'corrupt'
  | 'dimensions'
  | 'server_error'
  | 'network'

const UPLOAD_FAILURES: readonly string[] = [
  'unauthorized',
  'bad_origin',
  'no_file',
  'empty',
  'too_large',
  'unsupported_type',
  'corrupt',
  'dimensions',
  'server_error',
]

/** Reads the route's error body; anything unexpected is a server error. */
export function uploadFailureOf(body: unknown): UploadFailure {
  const error = (body as { error?: unknown } | null)?.error
  return typeof error === 'string' && UPLOAD_FAILURES.includes(error)
    ? (error as UploadFailure)
    : 'server_error'
}
