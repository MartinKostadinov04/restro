import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

import { guestHeaders } from './src/guest/headers'

// Next.js reads .env files from this folder only, but the repo keeps one `.env.local` at its root
// (README, "Running it locally"). Load it too. Values already in the environment win, and so
// does a `.env.local` in this folder; nothing is committed (`.env*` is git-ignored).
const rootEnvFile = fileURLToPath(new URL('../../.env.local', import.meta.url))
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile)

// next-intl without i18n routing: the admin's language is a cookie (src/i18n/request.ts).
// next-intl's `createNextIntlPlugin` would do exactly this alias for us, but it also loads
// `@swc/core` and `@parcel/watcher` (for its message extractor, which we do not use), and on
// some Windows machines `@swc/core`'s native binding refuses to load. So the one thing the
// plugin does for us, pointing `next-intl/config` at our request config, is done here.
const requestConfig = './src/i18n/request.ts'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // No referrer from the guest's pages: the table code is in their address (src/guest/headers.ts).
  headers: async () => guestHeaders(),
  // Workspace packages export TypeScript source (see README, "Workspace packages"),
  // so Next has to compile them. @restro/barsy is deliberately absent: the web app
  // never imports it (CLAUDE.md, import boundaries).
  transpilePackages: [
    '@restro/assets',
    '@restro/core',
    '@restro/db',
    '@restro/shell',
    '@restro/qr-phone',
  ],
  turbopack: {
    resolveAlias: { 'next-intl/config': requestConfig },
  },
  webpack(config) {
    config.resolve.alias['next-intl/config'] = path.resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      requestConfig,
    )
    return config
  },
}

export default nextConfig
