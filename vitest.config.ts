import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { vitestPackageDirs } from './scripts/workspace-packages.ts'

// One Vitest project per workspace package and app. The folders that are scanned are listed in
// scripts/workspace-packages.ts, and scripts/workspace-guard.test.ts fails when a package exists
// that this list (or pnpm-workspace.yaml) does not cover. A new package in a covered folder is
// picked up as soon as it has a package.json.
// Playwright specs end in .spec.ts and are not matched here; Vitest tests end in .test.ts(x).

function toPath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url))
}

function workspaceDirs(): string[] {
  return vitestPackageDirs(toPath('./'))
}

// The web app's component tests (Testing Library) need the `@/` alias of its tsconfig and a
// setup file (DOM clean-up, matchMedia). A component test opts into jsdom with the docblock
// `// @vitest-environment jsdom`; every other test stays in Node.
function projectExtras(dir: string) {
  if (dir !== 'apps/web') return {}
  return {
    resolve: { alias: { '@': toPath('apps/web/src') } },
    // Component tests with user-event run several seconds under a full parallel run on this PC;
    // 15 s keeps them from timing out without hiding a real hang.
    test: { setupFiles: [toPath('apps/web/vitest.setup.ts')], testTimeout: 15_000 },
  }
}

const projects = [...workspaceDirs(), 'scripts'].map((dir) => {
  const extras = projectExtras(dir)
  return {
    ...(extras.resolve ? { resolve: extras.resolve } : {}),
    test: {
      name: dir,
      root: toPath(`${dir}/`),
      include: ['**/*.test.{ts,tsx}'],
      environment: 'node' as const,
      ...extras.test,
    },
  }
})

export default defineConfig({
  test: { projects },
})
