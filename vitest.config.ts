import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// One Vitest project per workspace package and app, found by scanning the same folders
// as pnpm-workspace.yaml. A new package is picked up as soon as it has a package.json.
// Playwright specs end in .spec.ts and are not matched here; Vitest tests end in .test.ts(x).
const workspaceParents = ['apps', 'packages', 'packages/faces']

function toPath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url))
}

function workspaceDirs(): string[] {
  return workspaceParents.flatMap((parent) => {
    const parentPath = toPath(`${parent}/`)
    if (!existsSync(parentPath)) return []
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`)
      .filter((dir) => existsSync(toPath(`${dir}/package.json`)))
  })
}

const projects = [...workspaceDirs(), 'scripts'].map((dir) => ({
  test: {
    name: dir,
    root: toPath(`${dir}/`),
    include: ['**/*.test.{ts,tsx}'],
    environment: 'node' as const,
  },
}))

export default defineConfig({
  test: { projects },
})
