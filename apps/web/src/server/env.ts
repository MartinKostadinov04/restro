// The web app's server-side settings. Read lazily, on first use, so that `next build` (which
// loads every route module) does not need them. Names only in messages, never values.
import { z } from 'zod'

/**
 * The web app never declares the sealing private key: it may seal barsy credentials with the
 * worker's public key, never open them (D55; env.test.ts checks this).
 */
export const ServerEnvSchema = z.object({
  /** The app role (restro_app), never the migration owner. */
  DATABASE_URL: z.string().min(1),
  /** Signs session cookies. 32+ characters; generate with `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** The public address of this app, e.g. http://localhost:3000. Cookies and CSRF use it. */
  BETTER_AUTH_URL: z.url().optional(),
})

/** The settings the server needs. */
export type ServerEnv = z.output<typeof ServerEnvSchema>

let cached: ServerEnv | undefined

export function serverEnv(): ServerEnv {
  if (cached) return cached
  const parsed = ServerEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(
      `Missing or invalid setting(s): ${names.join(', ')}. Copy .env.example to .env.local and ` +
        'fill them in (BETTER_AUTH_SECRET needs 32 or more characters).',
    )
  }
  cached = parsed.data
  return cached
}
