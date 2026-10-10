import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support'

// Before the tests: put the demo organisation, its venue and the demo owner into the local
// database, the same way a developer does with `pnpm db:seed:dev` (same script, same refusals:
// development mode and a database on this machine only). Idempotent.
export default function globalSetup() {
  const webDir = fileURLToPath(new URL('..', import.meta.url))
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--env-file-if-exists=../../.env.local',
      '--env-file=./scripts/dev.env',
      '--import',
      './scripts/register-ts.mjs',
      './scripts/seed-dev.ts',
    ],
    {
      cwd: webDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEV_ADMIN_EMAIL: ADMIN_EMAIL,
        DEV_ADMIN_PASSWORD: ADMIN_PASSWORD,
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-used-anywhere-else-0123456789',
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(`The demo seed failed:\n${result.stdout}\n${result.stderr}`)
  }
}
