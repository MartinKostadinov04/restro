// The venue's legal details for the pay screen (#198, D127 log 1.6; entered on the owner's Paying
// settings, #116): the legal name, ЕИК, registered address and a privacy notice link, kept per venue
// in `venues.settings.legalDetails` (a Platform field, never connector data). Until all four are
// filled in, the Paying settings list them as one missing check.
//
// ЕИК is 9 digits (a company) or 13 (a branch: the company's 9 and 4 more). The last digit is a
// check digit in the Registry Agency's scheme, but no official source for its rule has been cited
// in the project, so only the length is checked here (#116's call: never an invented rule).
//
// Pure data and pure functions: no I/O, safe in the browser.

import { z } from 'zod'

/** The longest values kept; the screen's fields stop there. */
export const LEGAL_NAME_MAX = 200
export const LEGAL_ADDRESS_MAX = 300
export const LEGAL_PRIVACY_URL_MAX = 500

/** ЕИК: 9 or 13 digits. */
export const EIK_PATTERN = /^(\d{9}|\d{13})$/

/** Whether `value` has the shape of an ЕИК (length and digits only). */
export function isEik(value: string): boolean {
  return EIK_PATTERN.test(value)
}

/** A full `https://` link with a host (the guest page links to it). */
export function isHttpsLink(value: string): boolean {
  if (value.length > LEGAL_PRIVACY_URL_MAX || !value.startsWith('https://')) return false
  try {
    return new URL(value).hostname.includes('.')
  } catch {
    return false
  }
}

/** The details as stored: all four present, trimmed. */
export const LegalDetailsSchema = z.strictObject({
  name: z.string().trim().min(1).max(LEGAL_NAME_MAX),
  eik: z.string().trim().regex(EIK_PATTERN),
  address: z.string().trim().min(1).max(LEGAL_ADDRESS_MAX),
  privacyUrl: z
    .string()
    .trim()
    .refine((value) => isHttpsLink(value)),
})

/** A venue's legal details. */
export type LegalDetails = z.infer<typeof LegalDetailsSchema>

/** The venue's legal details from `venues.settings`, or null until all four are filled in. */
export function readLegalDetails(settings: Readonly<Record<string, unknown>>): LegalDetails | null {
  const parsed = LegalDetailsSchema.safeParse(settings.legalDetails)
  return parsed.success ? parsed.data : null
}

/** The four fields as the screen's form holds them: any of them may be empty. */
export interface LegalDraft {
  readonly name: string
  readonly eik: string
  readonly address: string
  readonly privacyUrl: string
}

/** The field a problem is under. */
export type LegalField = keyof LegalDraft

/** What is wrong with each field of a draft; a field that is fine is left out. */
export function legalProblems(draft: LegalDraft): Partial<Record<LegalField, 'required' | 'bad'>> {
  const problems: Partial<Record<LegalField, 'required' | 'bad'>> = {}
  const name = draft.name.trim()
  const eik = draft.eik.trim()
  const address = draft.address.trim()
  const link = draft.privacyUrl.trim()
  if (name === '') problems.name = 'required'
  else if (name.length > LEGAL_NAME_MAX) problems.name = 'bad'
  if (eik === '') problems.eik = 'required'
  else if (!isEik(eik)) problems.eik = 'bad'
  if (address === '') problems.address = 'required'
  else if (address.length > LEGAL_ADDRESS_MAX) problems.address = 'bad'
  if (link === '') problems.privacyUrl = 'required'
  else if (!isHttpsLink(link)) problems.privacyUrl = 'bad'
  return problems
}
