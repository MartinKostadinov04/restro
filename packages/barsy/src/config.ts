// Client configuration. One API user per integration per environment (CLAUDE.md rule 9): the
// host, user, password and environment always come together, and the host guard runs before any
// request can be built.

import { z } from 'zod'

import { BarsyConfigError } from './errors.ts'
import { barsyEnvSchema, parseAllowedHosts } from './hosts.ts'

/** barsy ends every call after 30 seconds (integrations/20-articles.html); the client matches it. */
export const BARSY_TIMEOUT_MS = 30_000

export const barsyClientConfigSchema = z.strictObject({
  /** `demo.barsyonline.com` or `https://demo.barsyonline.com`. */
  host: z.string().min(1, 'is empty'),
  user: z
    .string()
    .min(1, 'is empty')
    .refine((user) => !user.includes(':'), 'must not contain ":" (HTTP Basic auth)'),
  password: z.string().min(1, 'is empty'),
  env: barsyEnvSchema,
  /** Parsed BARSY_ALLOWED_HOSTS: a list, or the comma-separated string itself. */
  allowedHosts: z.union([z.string(), z.array(z.string())]).default([]),
  timeoutMs: z.number().int().positive().default(BARSY_TIMEOUT_MS),
})

export type BarsyClientConfigInput = z.input<typeof barsyClientConfigSchema>
export type BarsyClientConfig = z.output<typeof barsyClientConfigSchema>

/** The variables `loadBarsyConfig` reads, by config field (for error messages that name the variable). */
const ENV_NAMES: Record<string, string> = {
  host: 'BARSY_HOST',
  user: 'BARSY_USER',
  password: 'BARSY_PASSWORD',
  env: 'BARSY_ENV',
  allowedHosts: 'BARSY_ALLOWED_HOSTS',
  timeoutMs: 'timeoutMs',
}

/** Validates a config object. The error names the offending fields, never their values. */
export function parseClientConfig(input: unknown): BarsyClientConfig {
  const result = barsyClientConfigSchema.safeParse(input)
  if (!result.success) {
    throw new BarsyConfigError(`invalid barsy configuration: ${describeIssues(result.error)}`)
  }
  return result.data
}

/**
 * Reads BARSY_HOST, BARSY_USER, BARSY_PASSWORD, BARSY_ENV and (optionally) BARSY_ALLOWED_HOSTS from
 * `env` (normally `process.env`). The error names the variables that are missing or invalid, never
 * their values. It does not read any file: the caller decides how `env` is filled (the recorder
 * script uses Node's --env-file-if-exists).
 */
export function loadBarsyConfig(
  env: Readonly<Record<string, string | undefined>>,
): BarsyClientConfig {
  let allowedHosts: string[]
  try {
    allowedHosts = parseAllowedHosts(env.BARSY_ALLOWED_HOSTS)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid'
    throw new BarsyConfigError(`invalid barsy configuration: BARSY_ALLOWED_HOSTS: ${reason}`)
  }
  const result = barsyClientConfigSchema.safeParse({
    host: env.BARSY_HOST,
    user: env.BARSY_USER,
    password: env.BARSY_PASSWORD,
    env: env.BARSY_ENV,
    allowedHosts,
  })
  if (!result.success) {
    throw new BarsyConfigError(`invalid barsy configuration: ${describeIssues(result.error)}`)
  }
  return result.data
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = String(issue.path[0] ?? '(config)')
      const name = ENV_NAMES[field] ?? field
      // Zod's own messages for a missing or mistyped value say "expected string, received
      // undefined": the type, not the value. Values themselves are never repeated.
      return `${name}: ${issue.message}`
    })
    .join('; ')
}
