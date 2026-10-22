// The worker's settings, read once at start from environment variables. Values are validated
// here and nowhere else (with Zod, like every other boundary); an invalid or missing setting
// stops the process before anything opens a connection. Error messages name the variable, never
// its value (DATABASE_URL carries a password): every problem is "<VARIABLE> <what is wrong>",
// built from the schema's own path and the fixed text written below, not from the input.
import type { KeyObject } from 'node:crypto'
import { hostname } from 'node:os'

import {
  type AssetStoreConfig,
  AssetStoreConfigError,
  assetStoreConfig,
  type PublishStoreConfig,
  PublishStoreConfigError,
  publishStoreConfig,
} from '@restro/assets'
import { BARSY_ENVS, type BarsyEnv, parseAllowedHosts } from '@restro/barsy'
import { parseSealPublicKey } from '@restro/core/seal'
import { isSealKeyPair, parseSealPrivateKey } from '@restro/core/seal-open'
import type { SimEnv } from '@restro/sim-pos'
import { z } from 'zod'

/** Port of the health endpoint when WORKER_HEALTH_PORT is not set. */
export const DEFAULT_HEALTH_PORT = 8081

/** The levels pino knows, plus 'silent'. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const MAX_WORKER_ID_LENGTH = 128

export interface WorkerConfig {
  /** Connection string of the app role `restro_app` (never the migration owner). */
  readonly databaseUrl: string
  /**
   * Connection string of the purge role `restro_purge` (D83), the only role with DELETE on venue
   * data, or null when DATABASE_URL_PURGE is not set: the purge job is then not registered.
   * Never the app role, never the owner.
   */
  readonly purgeDatabaseUrl: string | null
  /** Identifies this process in `restro.worker_heartbeats`. */
  readonly workerId: string
  /** TCP port of `GET /health`. `0` picks a free port (tests only; the environment cannot set it). */
  readonly healthPort: number
  readonly logLevel: LogLevel
  /** True: human-readable log lines (development). False: one JSON object per line (production). */
  readonly prettyLogs: boolean
  /**
   * The key pair that opens sealed barsy credentials (SEAL_PUBLIC_KEY + SEAL_PRIVATE_KEY), or
   * null when neither is set. Barsy sync jobs need it: see {@link requireSealKeys}. KeyObjects,
   * not text, so logging the config could never print the private key.
   */
  readonly seal: SealKeys | null
  /** Which barsy installations this process may talk to (CLAUDE.md rule 9). */
  readonly barsy: BarsyPolicy
  /** Which simulated POS hosts this process may talk to, and whether it may at all (#71). */
  readonly sim: SimPolicy
  /** Where barsy photos are stored: the same store the web app reads (`@restro/assets`). */
  readonly assets: AssetStoreConfig
  /** Where published menus and photo variants go: the store the `/cdn` route (later the CDN) serves. */
  readonly publish: PublishStoreConfig
}

/**
 * The barsy host rules of this environment. An integration's host is checked against them before
 * the client is built (apps/worker/src/sync/host-policy.ts).
 */
export interface BarsyPolicy {
  /** `development`, `test`, `staging` or `production` (BARSY_ENV). */
  readonly env: BarsyEnv
  /** A host must end with one of these (each starts with a dot): default `.barsyonline.com`. */
  readonly allowedHostSuffixes: readonly string[]
  /** Hosts of live venues: every environment except `production` refuses them. */
  readonly productionHosts: readonly string[]
}

/**
 * The simulated POS's rules in this environment (#71; test-POS design §7 risk 3). `env` is
 * `production` when NODE_ENV or the deployment's environment label says so (the same label the host
 * rules above use), and then the worker refuses every `sim`
 * instance: nothing real is ever pointed at a simulator, and no simulator at production. Outside
 * production only a local host (localhost, 127.0.0.1, ::1, *.localhost, *.test) and the hosts
 * listed in SIM_POS_ALLOWED_HOSTS (a staging demo's own host) are accepted.
 */
export interface SimPolicy {
  readonly env: SimEnv
  readonly allowHosts: readonly string[]
}

/** Default of BARSY_ALLOWED_HOST_SUFFIXES. */
export const DEFAULT_BARSY_HOST_SUFFIXES = ['.barsyonline.com'] as const

/** The worker's sealing key pair. */
export interface SealKeys {
  readonly publicKey: KeyObject
  readonly privateKey: KeyObject
}

/** Thrown by {@link loadConfig}; the message lists every problem found. */
export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid worker configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

/** A variable left empty counts as unset, so its default applies. */
function unsetWhenBlank(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const NOT_SET =
  'is not set. It is the connection string of the app role restro_app (local: see .env.example).'
const NOT_A_POSTGRES_URL = 'must be a postgres:// or postgresql:// URL.'
const BAD_WORKER_ID = `must be 1 to ${MAX_WORKER_ID_LENGTH} characters.`
const BAD_PORT = 'must be a whole number from 1 to 65535.'
const BAD_LOG_LEVEL = `must be one of: ${LOG_LEVELS.join(', ')}.`
const BAD_SEAL_PUBLIC_KEY =
  'must be base64url DER (SPKI) of an X25519 public key. Generate a pair with pnpm keys:seal.'
const BAD_SEAL_PRIVATE_KEY =
  'must be base64url DER (PKCS8) of an X25519 private key. Generate a pair with pnpm keys:seal.'
const SEAL_PUBLIC_KEY_MISSING = 'is not set. It goes with SEAL_PRIVATE_KEY (pnpm keys:seal).'
const SEAL_PRIVATE_KEY_MISSING = 'is not set. It goes with SEAL_PUBLIC_KEY (pnpm keys:seal).'
const SEAL_KEYS_DO_NOT_MATCH = 'is not the private half of SEAL_PUBLIC_KEY.'
const BAD_BARSY_ENV = `must be one of: ${BARSY_ENVS.join(', ')}.`
const BAD_HOST_SUFFIXES =
  'must be a comma-separated list of host suffixes that start with a dot, e.g. .barsyonline.com.'
const BAD_PRODUCTION_HOSTS =
  'must be a comma-separated list of bare host names (no scheme, port or path).'

const HOST_SUFFIX = /^\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/** A comma-separated list; blank means unset (undefined). */
function commaList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
}

/** An optional key variable: blank is unset (null); otherwise it must parse, or one issue. */
function sealKeySchema(parse: (text: string) => KeyObject, message: string) {
  return z.preprocess(
    unsetWhenBlank,
    z
      .string()
      .optional()
      .transform((value, ctx): KeyObject | null => {
        if (value === undefined) return null
        try {
          return parse(value)
        } catch {
          ctx.addIssue({ code: 'custom', message })
          return z.NEVER
        }
      }),
  )
}

/**
 * The schema of the environment. Its keys are the variable names, so an issue's path names the
 * variable; every message is a continuation of that name (see {@link describeIssue}). Variables
 * not listed here are ignored.
 */
function environmentSchema(defaultWorkerId: () => string) {
  return z
    .object({
      DATABASE_URL: z
        .string({ error: NOT_SET })
        .trim()
        .min(1, { error: NOT_SET, abort: true })
        .refine(isPostgresUrl, { error: NOT_A_POSTGRES_URL }),
      DATABASE_URL_PURGE: z.preprocess(
        unsetWhenBlank,
        z.string().trim().refine(isPostgresUrl, { error: NOT_A_POSTGRES_URL }).optional(),
      ),
      WORKER_ID: z
        .string()
        .optional()
        .transform((value) => value?.trim() || defaultWorkerId())
        .pipe(z.string().min(1, BAD_WORKER_ID).max(MAX_WORKER_ID_LENGTH, BAD_WORKER_ID)),
      WORKER_HEALTH_PORT: z.preprocess(
        unsetWhenBlank,
        z
          .string()
          .trim()
          .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535, {
            error: BAD_PORT,
          })
          .transform(Number)
          .default(DEFAULT_HEALTH_PORT),
      ),
      LOG_LEVEL: z.preprocess(
        unsetWhenBlank,
        z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.enum(LOG_LEVELS, { error: BAD_LOG_LEVEL }))
          .default('info'),
      ),
      NODE_ENV: z.string().optional(),
      BARSY_ENV: z.preprocess(
        unsetWhenBlank,
        z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.enum(BARSY_ENVS, { error: BAD_BARSY_ENV }))
          .default('development'),
      ),
      BARSY_ALLOWED_HOST_SUFFIXES: z.preprocess(commaList, z.array(z.string()).optional()),
      BARSY_PRODUCTION_HOSTS: z.preprocess(commaList, z.array(z.string()).optional()),
      SIM_POS_ALLOWED_HOSTS: z.preprocess(commaList, z.array(z.string()).optional()),
      // Passed on to @restro/assets (assetStoreConfig), which names the problems itself.
      ASSET_STORE: z.string().optional(),
      LOCAL_ASSET_DIR: z.string().optional(),
      R2_ACCOUNT_ID: z.string().optional(),
      R2_ACCESS_KEY_ID: z.string().optional(),
      R2_SECRET_ACCESS_KEY: z.string().optional(),
      R2_BUCKET: z.string().optional(),
      R2_ENDPOINT: z.string().optional(),
      // Passed on to @restro/assets (publishStoreConfig); R2_* above are shared with the asset store.
      PUBLISH_STORE: z.string().optional(),
      LOCAL_PUBLISH_DIR: z.string().optional(),
      R2_PUBLIC_BUCKET: z.string().optional(),
      SEAL_PUBLIC_KEY: sealKeySchema(parseSealPublicKey, BAD_SEAL_PUBLIC_KEY),
      SEAL_PRIVATE_KEY: sealKeySchema(parseSealPrivateKey, BAD_SEAL_PRIVATE_KEY),
    })
    .superRefine((env, ctx) => {
      const issue = (variable: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [variable], message })
      const { SEAL_PUBLIC_KEY: publicKey, SEAL_PRIVATE_KEY: privateKey } = env
      if (publicKey !== null && privateKey === null) {
        issue('SEAL_PRIVATE_KEY', SEAL_PRIVATE_KEY_MISSING)
      }
      if (publicKey === null && privateKey !== null) {
        issue('SEAL_PUBLIC_KEY', SEAL_PUBLIC_KEY_MISSING)
      }
      if (publicKey !== null && privateKey !== null && !isSealKeyPair(publicKey, privateKey)) {
        issue('SEAL_PRIVATE_KEY', SEAL_KEYS_DO_NOT_MATCH)
      }
      if (env.BARSY_ALLOWED_HOST_SUFFIXES?.some((suffix) => !HOST_SUFFIX.test(suffix))) {
        issue('BARSY_ALLOWED_HOST_SUFFIXES', BAD_HOST_SUFFIXES)
      }
      try {
        parseAllowedHosts(env.BARSY_PRODUCTION_HOSTS)
      } catch {
        issue('BARSY_PRODUCTION_HOSTS', BAD_PRODUCTION_HOSTS)
      }
    })
    .transform((env, ctx): WorkerConfig => {
      let assets: AssetStoreConfig
      try {
        assets = assetStoreConfig({
          NODE_ENV: env.NODE_ENV,
          ASSET_STORE: env.ASSET_STORE,
          LOCAL_ASSET_DIR: env.LOCAL_ASSET_DIR,
          R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET: env.R2_BUCKET,
          R2_ENDPOINT: env.R2_ENDPOINT,
        })
      } catch (error) {
        // Its messages name variables, never values.
        const message =
          error instanceof AssetStoreConfigError
            ? error.message.replace(/^ASSET_STORE /, '')
            : 'is not usable.'
        ctx.addIssue({ code: 'custom', path: ['ASSET_STORE'], message })
        return z.NEVER
      }
      let publish: PublishStoreConfig
      try {
        publish = publishStoreConfig({
          NODE_ENV: env.NODE_ENV,
          PUBLISH_STORE: env.PUBLISH_STORE,
          LOCAL_PUBLISH_DIR: env.LOCAL_PUBLISH_DIR,
          R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
          R2_PUBLIC_BUCKET: env.R2_PUBLIC_BUCKET,
          R2_ENDPOINT: env.R2_ENDPOINT,
        })
      } catch (error) {
        const message =
          error instanceof PublishStoreConfigError
            ? error.message.replace(/^PUBLISH_STORE /, '')
            : 'is not usable.'
        ctx.addIssue({ code: 'custom', path: ['PUBLISH_STORE'], message })
        return z.NEVER
      }
      // The deployment's environment label: the host rules and the simulated POS's policy share it.
      const label = env.BARSY_ENV
      return {
        databaseUrl: env.DATABASE_URL,
        purgeDatabaseUrl: env.DATABASE_URL_PURGE ?? null,
        workerId: env.WORKER_ID,
        healthPort: env.WORKER_HEALTH_PORT,
        logLevel: env.LOG_LEVEL,
        prettyLogs: env.NODE_ENV !== 'production',
        seal:
          env.SEAL_PUBLIC_KEY !== null && env.SEAL_PRIVATE_KEY !== null
            ? { publicKey: env.SEAL_PUBLIC_KEY, privateKey: env.SEAL_PRIVATE_KEY }
            : null,
        barsy: {
          env: label,
          allowedHostSuffixes: env.BARSY_ALLOWED_HOST_SUFFIXES ?? [...DEFAULT_BARSY_HOST_SUFFIXES],
          productionHosts: parseAllowedHosts(env.BARSY_PRODUCTION_HOSTS),
        },
        sim: {
          env: env.NODE_ENV === 'production' ? 'production' : label,
          allowHosts: env.SIM_POS_ALLOWED_HOSTS ?? [],
        },
        assets,
        publish,
      }
    })
}

/** "<VARIABLE> <message>": the variable from the schema path, the text fixed above. */
function describeIssue(issue: z.core.$ZodIssue): string {
  return `${issue.path.join('.')} ${issue.message}`
}

/**
 * Reads the configuration from `env`.
 *
 * | Variable | Meaning | Default |
 * |---|---|---|
 * | `DATABASE_URL` | postgres:// URL of the app role `restro_app` | required |
 * | `DATABASE_URL_PURGE` | postgres:// URL of the purge role `restro_purge` (D83); without it no purge job runs | unset |
 * | `WORKER_ID` | name of this process in `worker_heartbeats` | the host name |
 * | `WORKER_HEALTH_PORT` | port of `GET /health` | 8081 |
 * | `LOG_LEVEL` | fatal, error, warn, info, debug, trace or silent | info |
 * | `NODE_ENV` | `production` switches the logs to JSON | pretty logs |
 * | `SEAL_PUBLIC_KEY` | base64url DER (SPKI) X25519 public key; set with the private key | unset |
 * | `SEAL_PRIVATE_KEY` | base64url DER (PKCS8) X25519 private key; worker only | unset |
 * | `BARSY_ENV` | development, test, staging or production (the host rules below) | development |
 * | `BARSY_ALLOWED_HOST_SUFFIXES` | comma-separated; an integration host must end with one | .barsyonline.com |
 * | `BARSY_PRODUCTION_HOSTS` | comma-separated hosts of live venues; every env but production refuses them | none |
 * | `SIM_POS_ALLOWED_HOSTS` | comma-separated hosts a staging demo's simulated POS runs on; local hosts are always allowed; production refuses a `sim` instance outright | none |
 * | `ASSET_STORE`, `LOCAL_ASSET_DIR`, `R2_*` | where barsy photos go (see @restro/assets) | local in development |
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  defaultWorkerId: () => string = hostname,
): WorkerConfig {
  const result = environmentSchema(defaultWorkerId).safeParse(env)
  if (!result.success) throw new ConfigError(result.error.issues.map(describeIssue))
  return result.data
}

/**
 * The sealing key pair, for the barsy sync jobs (S2-03b calls this when it registers them, so a
 * worker without the keys stops at start instead of failing on the first pull).
 */
export function requireSealKeys(config: WorkerConfig): SealKeys {
  if (config.seal === null) {
    throw new ConfigError([
      'SEAL_PRIVATE_KEY is not set. The worker needs SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY to ' +
        'open barsy credentials (generate a pair with pnpm keys:seal).',
    ])
  }
  return config.seal
}
