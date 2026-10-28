import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import { e2eSealEnvironment } from '../worker/src/e2e-seal-keys'
import { TONIGHT_PIN_PEPPER } from './e2e/support'

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

// A throwaway key pair, made here because the web servers start before the global setup runs.
// The public half (base64url DER, what `pnpm keys:seal` prints) goes to the web servers: the
// Integration tab seals with it (without it the tab shows 'sync keys are not set up') and every
// new table code is sealed with it (#70). Both halves go to the worker only, which opens the table
// codes for the Tables screen through its reveal endpoint (the worker's helper names them).
const SEAL_KEYS = e2eSealEnvironment()
// The bearer token of the worker's reveal endpoint, for the test servers only.
const REVEAL_SERVICE_TOKEN = 'e2e-only-reveal-token-not-used-anywhere-else-0123456789'
// The worker's health port, which also serves the reveal endpoint; it moves with E2E_PORT.
const WORKER_PORT = PORT + 2
// The simulated POS the Send's test adds rounds to (#77; never a real one); it moves with E2E_PORT.
const SIM_PORT = PORT + 3

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
  ...SEAL_KEYS.web,
  REVEAL_SERVICE_TOKEN,
  // The location pass's key (#76), for the test servers only; a real one comes from the environment.
  GUEST_PASS_KEY:
    process.env.GUEST_PASS_KEY ?? 'e2e-only-guest-pass-key-not-used-anywhere-else-0123456789',
  // The PIN pepper (#72) for the Tonight screen's PIN sheet (#85), for the test servers only.
  STAFF_PIN_PEPPER: process.env.STAFF_PIN_PEPPER ?? TONIGHT_PIN_PEPPER,
  // `localhost`, not 127.0.0.1: the endpoint answers a Host of localhost or *.railway.internal only.
  WORKER_REVEAL_URL: `http://localhost:${WORKER_PORT}`,
  // Cloudflare's published test secret (it passes every token, .env.example), for the Send's test
  // (#77) and the Pay's (#110): without a secret every Send and Pay fails the human check. The
  // build needs the matching test site key, NEXT_PUBLIC_TURNSTILE_SITE_KEY (CI sets it; the test
  // stubs Cloudflare's script).
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA',
})

// The REAL worker runs beside the web servers, for the Publish tab (brief S3-05): "Publish" only
// queues a job, and the worker publishes it. It holds this run's key pair (never a developer's
// from the root .env.local: these values win over the runner's own environment), so it reveals
// and seals table codes (#70); with WORKER_POS_SYNC=off it registers no POS sync job, so it never
// calls a till. WORKER_SEND=on runs the Send (#77), which only reaches the simulated POS here.
const workerEnvironment = {
  ...serverEnvironment(ORIGIN),
  WORKER_ID: 'e2e-worker',
  WORKER_HEALTH_PORT: String(WORKER_PORT),
  LOG_LEVEL: process.env.E2E_WORKER_LOG_LEVEL ?? 'warn',
  ...SEAL_KEYS.worker,
  WORKER_POS_SYNC: 'off',
  WORKER_SEND: 'on',
}

export default defineConfig({
  testDir: './e2e',
  // Playwright empties its output folder at the start of every run. The screenshot matrix keeps
  // its pictures in test-results/faces-visual/<face>/ (one folder per template), so Playwright's own
  // files go in a folder beside it and a run for one template leaves another's pictures alone.
  outputDir: './test-results/playwright',
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
      stdout: 'pipe',
      stderr: 'pipe',
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: workerEnvironment,
    },
    {
      // Starts on Demo Bar; the Send's test loads the scenario it needs through the control calls.
      command: `pnpm --dir ../.. sim:serve --scenario demo-bar --port ${SIM_PORT}`,
      url: `http://127.0.0.1:${SIM_PORT}/control`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
