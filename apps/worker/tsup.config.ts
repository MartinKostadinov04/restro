import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Workspace packages export TypeScript source (see README, "Workspace packages"),
  // so they are compiled into the worker bundle. npm dependencies stay external: tsup leaves
  // out everything in the worker's package.json `dependencies`, including the ones only
  // @restro/db imports (`pg`, `drizzle-orm`), which is why the worker declares them.
  noExternal: [/^@restro\//],
  // Development-only: logger.ts imports it on demand, and production images may not have it.
  external: ['pino-pretty'],
})
