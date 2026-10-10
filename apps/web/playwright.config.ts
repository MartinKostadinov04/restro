import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// The repo keeps one `.env.local` at its root (README): use it for the database address when
// there is one. Values already in the environment win; CI sets DATABASE_URL itself.
const rootEnvFile = fileURLToPath(new URL('../../.env.local', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

// A port that `pnpm dev` (3000) does not use, so the tests always hit the production build.
const PORT = 3100
const ORIGIN = `http://127.0.0.1:${PORT}`

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // `pnpm test:e2e` runs `next build` first, then this starts the built app. It needs the local
  // database (`pnpm db:local`, `pnpm db:migrate && pnpm db:roles`; CI has a Postgres service).
  webServer: {
    command: `next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...(process.env as Record<string, string>),
      BETTER_AUTH_URL: ORIGIN,
      // Throwaway secret for the test server only; a real one comes from the environment.
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-used-anywhere-else-0123456789',
    },
  },
})
