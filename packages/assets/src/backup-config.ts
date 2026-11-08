// Which backup store the worker uses, read from the environment (`BACKUP_STORE=local|r2`).
//
//   BACKUP_STORE       local | r2. Unset means local in development and tests, and an error in
//                      production: a production deploy must say where its dumps go.
//   LOCAL_BACKUP_DIR   local only. Default: `.local/backups` in the repository (git ignores it).
//   R2_ACCOUNT_ID, R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET
//                      r2 only, all required. Only the account is shared with the asset store (it
//                      names the account and grants nothing). The key is the dumps' own, scoped to
//                      their bucket, and never falls back to the asset store's R2_ACCESS_KEY_ID: a
//                      fallback is how a shared key creeps back in. The bucket is private and never
//                      the asset or the public one.
//   R2_BACKUP_ENDPOINT r2 only. Default: https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com, the EU
//                      jurisdiction endpoint, because the dumps' bucket is created in the EU
//                      jurisdiction (which cannot be changed afterwards) and a jurisdiction endpoint
//                      cannot reach buckets outside it. So it cannot be the asset store's R2_ENDPOINT.
//
// Errors name the variables, never their values.
import path from 'node:path'
import { z } from 'zod'

import { repositoryRoot } from './config'

export type BackupStoreConfig =
  | { readonly kind: 'local'; readonly dir: string }
  | {
      readonly kind: 'r2'
      readonly accessKeyId: string
      readonly secretAccessKey: string
      readonly bucket: string
      readonly endpoint: string
    }

/** Thrown when the backup store's settings are missing or malformed. */
export class BackupStoreConfigError extends Error {
  override name = 'BackupStoreConfigError'
}

const R2Schema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-zA-Z]{8,64}$/),
  R2_BACKUP_ACCESS_KEY_ID: z.string().min(8),
  R2_BACKUP_SECRET_ACCESS_KEY: z.string().min(8),
  R2_BACKUP_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  R2_BACKUP_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
})

/** Reads the settings from `env`; `cwd` only locates the default local folder. */
export function backupStoreConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): BackupStoreConfig {
  const chosen = env.BACKUP_STORE?.trim() || undefined
  if (chosen === undefined && env.NODE_ENV === 'production') {
    throw new BackupStoreConfigError('BACKUP_STORE must be set to "local" or "r2" in production.')
  }
  const kind = chosen ?? 'local'
  if (kind === 'local') {
    const dir = env.LOCAL_BACKUP_DIR?.trim()
    return {
      kind,
      dir: dir ? path.resolve(dir) : path.join(repositoryRoot(cwd), '.local', 'backups'),
    }
  }
  if (kind !== 'r2') throw new BackupStoreConfigError('BACKUP_STORE must be "local" or "r2".')
  const parsed = R2Schema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new BackupStoreConfigError(
      `Missing or invalid setting(s) for the R2 backup store: ${names.join(', ')}.`,
    )
  }
  const settings = parsed.data
  return {
    kind,
    accessKeyId: settings.R2_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: settings.R2_BACKUP_SECRET_ACCESS_KEY,
    bucket: settings.R2_BACKUP_BUCKET,
    endpoint:
      settings.R2_BACKUP_ENDPOINT ??
      `https://${settings.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  }
}
