import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TypeScript source (see README, "Workspace packages"),
  // so Next has to compile them. @restro/barsy is deliberately absent: the web app
  // never imports it (CLAUDE.md, import boundaries).
  transpilePackages: ['@restro/core', '@restro/db', '@restro/shell', '@restro/qr-phone'],
}

export default nextConfig
