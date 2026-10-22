import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support'

/**
 * Runs one of the dev scripts the way `pnpm db:seed:dev` does (same flags, same refusals) and
 * returns what it printed.
 */
export function runScript(script: string, ...args: string[]): string {
  return runScriptWith({}, script, ...args)
}

/** The same, with extra environment variables. */
export function runScriptWith(
  extraEnv: Record<string, string>,
  script: string,
  ...args: string[]
): string {
  const webDir = fileURLToPath(new URL('..', import.meta.url))
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      // apply() uses constructor parameter properties, which Node's default type stripping
      // refuses; this flag transforms them instead.
      '--experimental-transform-types',
      '--env-file-if-exists=../../.env.local',
      '--env-file=./scripts/dev.env',
      '--import',
      './scripts/register-ts.mjs',
      script,
      ...args,
    ],
    {
      cwd: webDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...extraEnv,
        DEV_ADMIN_EMAIL: ADMIN_EMAIL,
        DEV_ADMIN_PASSWORD: ADMIN_PASSWORD,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-used-anywhere-else-0123456789',
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

// Before the tests: put the demo organisation, its venue and the demo owner into the local
// database, the same way a developer does with `pnpm db:seed:dev` (same script, same refusals:
// development mode and a database on this machine only), then the item the item sheet's test
// opens. Both are idempotent.
export default function globalSetup() {
  // Without Demo Bar (#71): the specs take the one demo venue, its menu and its tables.
  runScriptWith({ SEED_DEMO_BAR: '0' }, './scripts/seed-dev.ts')
  runScript('./scripts/seed-item-sheet.ts')
  runScript('./scripts/seed-integration-e2e.ts', 'seed')
  // The Publish tab's own organisation (nothing published yet); the worker publishes for it.
  runScript('./scripts/seed-publish-e2e.ts', 'seed')
  // Last: it publishes the demo menu as it is after the seeds above (photos, labels, a brand colour).
  runScript('./scripts/seed-guest-e2e.ts')
}
