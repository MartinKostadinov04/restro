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
  /**
   * The address the table QR codes are printed with by default (`<this>/t/<token>`, brief S3-07),
   * when a venue has not saved a base address of its own: `http://localhost:3000` while we build,
   * the permanent domain later (P53). Falls back to BETTER_AUTH_URL. Empty counts as missing.
   */
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
  /**
   * The worker's sealing PUBLIC key (base64url DER, `pnpm keys:seal`). With it the Integration tab
   * seals the barsy credentials a manager types; without it the tab explains that the operator
   * has to set up the sync keys. Empty counts as missing. Whether it is a valid key is checked
   * where it is used, so a bad value never takes the whole app down.
   */
  SEAL_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
  /**
   * The worker's reveal endpoint on the private network (#70), e.g.
   * `http://worker.railway.internal:8081` (`http://localhost:8081` locally): the Tables screen asks
   * it for the codes it draws. Without it (or the token) the screen shows no QR codes. Empty
   * counts as missing.
   */
  WORKER_REVEAL_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    })
    .pipe(z.url({ protocol: /^https?$/ }).optional()),
  /**
   * The PIN pepper (#72, D122 §7): the key of `HMAC(pepper, tenant ‖ pin)`, by which a shared
   * device finds the person a PIN names. Web app only, 32 characters or more (checked where it is
   * used, so a bad value never takes the whole app down). Without it no PIN is made or checked.
   * Empty counts as missing. A new pepper makes every PIN unknown: each needs "New PIN".
   */
  STAFF_PIN_PEPPER: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
  /**
   * The key that seals the guests' location passes (#76, D121): HMAC-SHA256, web app only, 32
   * characters or more (checked where it is used). Without it no pass is issued, so a venue that
   * checks location takes no additions from phones. A new key ends every pass: phones locate
   * again. Empty counts as missing.
   */
  GUEST_PASS_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
  /**
   * Turnstile's secret key (#76, D119): siteverify at an on-the-bill Send and at a Pay (#110).
   * Without it every Send and Pay fails the check (fail closed). Empty counts as missing.
   */
  TURNSTILE_SECRET_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
  /** The bearer token the reveal endpoint expects (the worker's REVEAL_SERVICE_TOKEN). */
  REVEAL_SERVICE_TOKEN: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }),
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

/**
 * The address table QR codes use when a venue has saved none: `PUBLIC_BASE_URL`, else
 * `BETTER_AUTH_URL`, else null (a venue then has to type one). Whether it is usable is checked
 * where it is read (`readVenueQr`).
 */
export function defaultQrBaseUrl(
  env: Pick<ServerEnv, 'PUBLIC_BASE_URL' | 'BETTER_AUTH_URL'> = serverEnv(),
): string | null {
  return env.PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL ?? null
}
