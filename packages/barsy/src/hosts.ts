// Host guard (CLAUDE.md rule 9: staging config refuses production hosts).
//
// Outside production a host must be in the allowlist (BARSY_ALLOWED_HOSTS) or be barsy's public
// demo installation. Production needs an explicit allowlist too, and the demo host gets no
// exception there. A host that is not listed is refused, so a staging deployment can never reach a
// customer's production installation just because someone pasted its URL into a variable.

import { z } from 'zod'

import { BarsyConfigError, BarsyHostNotAllowedError } from './errors.ts'

export const BARSY_ENVS = ['development', 'test', 'staging', 'production'] as const
export type BarsyEnv = (typeof BARSY_ENVS)[number]
export const barsyEnvSchema = z.enum(BARSY_ENVS)

/** barsy's public demo installation (user "demo"); used in every example of the official docs. */
export const BARSY_DEMO_HOST = 'demo.barsyonline.com'

/**
 * Reduces `host` to a bare lowercase hostname. Accepts `club.example.com` and `https://club.example.com/`
 * (the form owner-actions.md puts in BARSY_HOST). Everything else is refused: other schemes, user info,
 * a port, a path, a query or whitespace, because any of them could make a string comparison
 * against the allowlist disagree with where the request actually goes.
 */
export function normaliseHost(host: string): string {
  const trimmed = host.trim()
  if (trimmed === '') {
    throw new BarsyConfigError('barsy host is empty')
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\s\\\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new BarsyConfigError(
      'barsy host must not contain whitespace, backslashes or control characters',
    )
  }
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (schemeMatch && schemeMatch[1]?.toLowerCase() !== 'https') {
    throw new BarsyConfigError('barsy host must use https')
  }
  let url: URL
  try {
    url = new URL(schemeMatch ? trimmed : `https://${trimmed}`)
  } catch {
    throw new BarsyConfigError('barsy host is not a valid host name')
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    trimmed.endsWith('?') ||
    trimmed.endsWith('#') ||
    url.hostname === ''
  ) {
    throw new BarsyConfigError(
      'barsy host must be a bare host name (no user info, port, path or query)',
    )
  }
  return url.hostname.toLowerCase()
}

/** Splits a comma-separated allowlist (BARSY_ALLOWED_HOSTS) and normalises every entry. */
export function parseAllowedHosts(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return []
  const entries = typeof value === 'string' ? value.split(',') : value
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map(normaliseHost)
}

/**
 * Throws `BarsyHostNotAllowedError` unless `host` may be used in `env`; returns the normalised host.
 * `allowedHosts` is the parsed BARSY_ALLOWED_HOSTS (comma-separated string or list). The function
 * reads no environment variable itself, so the result depends only on its arguments.
 */
export function assertHostAllowed(
  host: string,
  env: BarsyEnv,
  allowedHosts?: string | readonly string[],
): string {
  const normalised = normaliseHost(host)
  const allowed = parseAllowedHosts(allowedHosts)

  if (env === 'production') {
    if (allowed.length === 0) {
      throw new BarsyHostNotAllowedError(
        'production needs an explicit BARSY_ALLOWED_HOSTS allowlist; none is set',
        normalised,
        env,
      )
    }
    if (!allowed.includes(normalised)) {
      throw new BarsyHostNotAllowedError(
        `barsy host ${normalised} is not in BARSY_ALLOWED_HOSTS`,
        normalised,
        env,
      )
    }
    return normalised
  }

  if (normalised === BARSY_DEMO_HOST || allowed.includes(normalised)) {
    return normalised
  }
  throw new BarsyHostNotAllowedError(
    `barsy host ${normalised} is neither ${BARSY_DEMO_HOST} nor in BARSY_ALLOWED_HOSTS (env ${env})`,
    normalised,
    env,
  )
}
