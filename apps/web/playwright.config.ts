import { defineConfig, devices } from '@playwright/test'

// A port that `pnpm dev` (3000) does not use, so the tests always hit the production build.
const PORT = 3100
const ORIGIN = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // `pnpm test:e2e` runs `next build` first, then this starts the built app.
  webServer: {
    command: `next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
