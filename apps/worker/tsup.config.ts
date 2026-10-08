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
})
