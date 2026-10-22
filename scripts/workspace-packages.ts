import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The one place that lists where workspace packages live for Vitest. vitest.config.ts builds
// its projects from `vitestPackageDirs()`, and scripts/workspace-guard.test.ts checks the same
// list against pnpm-workspace.yaml, so a package folder cannot be added to one and forgotten in
// the other. To cover a new kind of folder, add it here and add its glob to pnpm-workspace.yaml
// in the same change.
//
// Each entry is a folder whose direct children are packages.
export const workspaceParents = ['apps', 'packages', 'packages/faces', 'packages/connectors']

/** Package folders (relative, with "/") that have a package.json, found under `workspaceParents`. */
export function vitestPackageDirs(root: string): string[] {
  return workspaceParents.flatMap((parent) => {
    const parentPath = join(root, parent)
    if (!existsSync(parentPath)) return []
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`)
      .filter((dir) => existsSync(join(root, dir, 'package.json')))
  })
}
