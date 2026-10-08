// Lets Node run the web app's server code outside Next.js (the dev seed). Node strips TypeScript
// types by itself, but cannot resolve the extensionless relative imports the workspace packages
// use (`./ids`, `./internal/pool`), because Next.js, Vitest and TypeScript's bundler resolution do
// not need extensions. This hook retries such an import with `.ts`, `.tsx` and `/index.ts`.
// Used as `node --import ./scripts/register-ts.mjs scripts/seed-dev.ts`. Dev tooling only.
import { registerHooks } from 'node:module'

const RETRY_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'])
const SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      if (!relative || !RETRY_CODES.has(error?.code)) throw error
      for (const suffix of SUFFIXES) {
        try {
          return nextResolve(`${specifier}${suffix}`, context)
        } catch {
          // try the next suffix
        }
      }
      throw error
    }
  },
})
