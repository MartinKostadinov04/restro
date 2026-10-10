// Which publish store a process uses, read from the environment (`PUBLISH_STORE=local|r2`).
//
//   PUBLISH_STORE      local | r2. Unset means local in development and tests, and an error in
//                      production: a production deploy must say where its menus are published.
//   LOCAL_PUBLISH_DIR  local only. Default: `.local/cdn` in the repository (git ignores it); the
//                      web app serves it at `/cdn/...`.
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET
//                      r2 only, all required (the account and key are the asset store's).
//   R2_ENDPOINT        r2 only. As for the asset store.
//
// Errors name the variables, never their values.
import path from 'node:path'
import { z } from 'zod'

import { repositoryRoot } from './config'

export type PublishStoreConfig =
  | { readonly kind: 'local'; readonly dir: string }
  | {
      readonly kind: 'r2'
      readonly accessKeyId: string
      readonly secretAccessKey: string
      readonly bucket: string
      readonly endpoint: string
    }

/** Thrown when the publish store's settings are missing or malformed. */
export class PublishStoreConfigError extends Error {
  override name = 'PublishStoreConfigError'
}

const R2Schema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-zA-Z]{8,64}$/),
  R2_ACCESS_KEY_ID: z.string().min(8),
  R2_SECRET_ACCESS_KEY: z.string().min(8),
  R2_PUBLIC_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  R2_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
})

/** Reads the settings from `env`; `cwd` only locates the default local folder. */
export function publishStoreConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): PublishStoreConfig {
  const chosen = env.PUBLISH_STORE?.trim() || undefined
  if (chosen === undefined && env.NODE_ENV === 'production') {
    throw new PublishStoreConfigError('PUBLISH_STORE must be set to "local" or "r2" in production.')
  }
  const kind = chosen ?? 'local'
  if (kind === 'local') {
    const dir = env.LOCAL_PUBLISH_DIR?.trim()
    return {
      kind,
      dir: dir ? path.resolve(dir) : path.join(repositoryRoot(cwd), '.local', 'cdn'),
    }
  }
  if (kind !== 'r2') throw new PublishStoreConfigError('PUBLISH_STORE must be "local" or "r2".')
  const parsed = R2Schema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new PublishStoreConfigError(
      `Missing or invalid setting(s) for the R2 publish store: ${names.join(', ')}.`,
    )
  }
  const settings = parsed.data
  return {
    kind,
    accessKeyId: settings.R2_ACCESS_KEY_ID,
    secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
    bucket: settings.R2_PUBLIC_BUCKET,
    endpoint: settings.R2_ENDPOINT ?? `https://${settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  }
}
