import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// The repo keeps one `.env.local` at its root (README): use it for the database address when
// there is one. Values already in the environment win; CI sets DATABASE_URL itself.
const rootEnvFile = fileURLToPath(new URL('../../.env.local', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

// A port that `pnpm dev` (3000) does not use, so the tests always hit the production build.
// `E2E_PORT` moves both servers when another checkout is running its own tests on this machine.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const ORIGIN = `http://127.0.0.1:${PORT}`
// The second server runs `next dev`, only for the pages that exist in development alone (the
// development harness of the item sheet, /dev/item-sheet).
const DEV_PORT = PORT + 1
const DEV_ORIGIN = `http://127.0.0.1:${DEV_PORT}`
// Where the item sheet's test stores the photos it uploads (git ignores `.local`).
const E2E_ASSET_DIR = fileURLToPath(new URL('../../.local/assets-e2e', import.meta.url))
// Where the guest page's test publishes its menus (seed-guest-e2e.ts writes, `/cdn` serves).
const E2E_PUBLISH_DIR = fileURLToPath(new URL('../../.local/cdn-e2e', import.meta.url))
// The setup scripts run in this process and read the same stores as the servers below.
process.env.ASSET_STORE = 'local'
process.env.LOCAL_ASSET_DIR = E2E_ASSET_DIR
process.env.PUBLISH_STORE = 'local'
process.env.LOCAL_PUBLISH_DIR = E2E_PUBLISH_DIR

// A throwaway key pair for the Integration tab's test, made here because the web servers start
// before the global setup runs. Only the public half (base64url DER, what `pnpm keys:seal` prints)
// goes to the servers; the other half is dropped at once, since the worker that runs beside them
// (below) holds no sealing keys and nothing needs to open what the tab seals. Without `SEAL_PUBLIC_KEY` the tab would show
// the 'sync keys are not set up' message instead of the form.
const SEAL_PUBLIC_KEY = generateKeyPairSync('x25519')
  .publicKey.export({ type: 'spki', format: 'der' })
  .toString('base64url')

const serverEnvironment = (origin: string) => ({
  ...(process.env as Record<string, string>),
  BETTER_AUTH_URL: origin,
  // Throwaway secret for the test servers only; a real one comes from the environment.
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-used-anywhere-else-0123456789',
  // Photos go to disk, in a folder of their own.
  ASSET_STORE: 'local',
  LOCAL_ASSET_DIR: E2E_ASSET_DIR,
  PUBLISH_STORE: 'local',
  LOCAL_PUBLISH_DIR: E2E_PUBLISH_DIR,
  SEAL_PUBLIC_KEY,
})

// The REAL worker runs beside the web servers, for the Publish tab (brief S3-05): "Publish" only
// queues a job, and the worker publishes it. It holds no sealing keys (a public key without the
// private half would stop it), so it runs the publish jobs and the heartbeat and syncs no barsy.
// Its health port moves with E2E_PORT.
const WORKER_PORT = PORT + 2
const workerEnvironment = Object.fromEntries(
  Object.entries({
    ...serverEnvironment(ORIGIN),
    WORKER_ID: 'e2e-worker',
    WORKER_HEALTH_PORT: String(WORKER_PORT),
    LOG_LEVEL: process.env.E2E_WORKER_LOG_LEVEL ?? 'warn',
  })
    .filter(([name]) => !name.startsWith('SEAL_'))
    // Blank, not absent: Playwright merges this over the runner's own environment, which may hold
    // a developer's SEAL_* keys from the root .env.local. Blank counts as unset for the worker.
    .concat([
      ['SEAL_PUBLIC_KEY', ''],
      ['SEAL_PRIVATE_KEY', ''],
    ]),
)

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The sign-in tests share one demo owner and Better Auth's rate limiter (3 sign-ins per
  // 10 seconds), so the files run one after the other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /item-sheet\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'item-sheet-dev',
      testMatch: /item-sheet\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: DEV_ORIGIN },
    },
  ],
  // `pnpm test:e2e` runs `next build` first, then this starts the built app, and a dev server
  // beside it. It needs the local database (`pnpm db:local`, `pnpm db:migrate && pnpm db:roles`;
  // CI has a Postgres service).
  webServer: [
    {
      command: `next start --hostname 127.0.0.1 --port ${PORT}`,
      url: `${ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnvironment(ORIGIN),
    },
    {
      command: `next dev --hostname 127.0.0.1 --port ${DEV_PORT}`,
      url: `${DEV_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...serverEnvironment(DEV_ORIGIN), NODE_ENV: 'development' },
    },
    {
      command: 'pnpm --filter @restro/worker exec tsx src/index.ts',
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: workerEnvironment,
    },
  ],
})
