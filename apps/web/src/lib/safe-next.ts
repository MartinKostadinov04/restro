/**
 * The path to return to after signing in, from the `next` query parameter. Only a path on this
 * site is accepted (starts with a single `/`, no `//`, no backslash, no control characters), so
 * the sign-in page cannot be turned into an open redirect. Anything else falls back to `/venues`.
 */
export function safeNextPath(value: string | string[] | null | undefined): string {
  const fallback = '/venues'
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback
  return raw
}
