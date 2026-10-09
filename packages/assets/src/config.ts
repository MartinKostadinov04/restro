// Which asset store the server uses, read from the environment (`ASSET_STORE=local|r2`).
//
//   ASSET_STORE        local | r2. Unset means local in development and tests, and an error in
//                      production: a production deploy must say where its photos go.
//   LOCAL_ASSET_DIR    local only. Default: `.local/assets` in the repository (git ignores it).
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//                      r2 only, all required.
//   R2_ENDPOINT        r2 only. Default `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; set it
//                      for EU jurisdiction (`https://<id>.eu.r2.cloudflarestorage.com`).
//
// Errors name the variables, never their values.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export type AssetStoreConfig =
  | { readonly kind: 'local'; readonly dir: string }
  | {
      readonly kind: 'r2'
      readonly accessKeyId: string
      readonly secretAccessKey: string
      readonly bucket: string
      readonly endpoint: string
    }

/** Thrown when the asset store's settings are missing or malformed. */
export class AssetStoreConfigError extends Error {
  override name = 'AssetStoreConfigError'
}

const R2Schema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-zA-Z]{8,64}$/),
  R2_ACCESS_KEY_ID: z.string().min(8),
  R2_SECRET_ACCESS_KEY: z.string().min(8),
  R2_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  R2_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
})

/** The repository root (the folder with pnpm-workspace.yaml) above `from`, else `from` itself. */
function repositoryRoot(from: string): string {
  for (let current = path.resolve(from); ; current = path.dirname(current)) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    if (path.dirname(current) === current) return path.resolve(from)
  }
}

/** Reads the settings from `env`; `cwd` only locates the default local folder. */
export function assetStoreConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): AssetStoreConfig {
  const chosen = env.ASSET_STORE?.trim() || undefined
  if (chosen === undefined && env.NODE_ENV === 'production') {
    throw new AssetStoreConfigError('ASSET_STORE must be set to "local" or "r2" in production.')
  }
  const kind = chosen ?? 'local'
  if (kind === 'local') {
    const dir = env.LOCAL_ASSET_DIR?.trim()
    return {
      kind,
      dir: dir ? path.resolve(dir) : path.join(repositoryRoot(cwd), '.local', 'assets'),
    }
  }
  if (kind !== 'r2') {
    throw new AssetStoreConfigError('ASSET_STORE must be "local" or "r2".')
  }
  const parsed = R2Schema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new AssetStoreConfigError(
      `Missing or invalid setting(s) for the R2 asset store: ${names.join(', ')}.`,
    )
  }
  const settings = parsed.data
  return {
    kind,
    accessKeyId: settings.R2_ACCESS_KEY_ID,
    secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
    bucket: settings.R2_BUCKET,
    endpoint: settings.R2_ENDPOINT ?? `https://${settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  }
}
