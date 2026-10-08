import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Workspace packages export TypeScript source (see README, "Workspace packages"),
  // so they are compiled into the worker bundle. npm dependencies stay external.
  noExternal: [/^@restro\//],
  // Development-only: logger.ts imports it on demand, and production images may not have it.
  external: ['pino-pretty'],
  // @restro/db needs `pg` and `drizzle-orm`, which are not dependencies of the worker, so
  // they are bundled with it. `pg` is CommonJS and calls require() for Node built-ins, which
  // an ES module bundle does not have; this gives it one. Declaring both as worker
  // dependencies would make them external and this banner unnecessary.
  banner: {
    js: "import { createRequire as __restroCreateRequire } from 'node:module';\nconst require = __restroCreateRequire(import.meta.url);",
  },
})
