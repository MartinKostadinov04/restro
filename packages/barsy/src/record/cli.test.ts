import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))

// Starts the real entry point under Node's own TypeScript support, the way `pnpm barsy:record`
// does. Only paths that stop before any network call are used: --help and a refused method. The
// child gets an empty environment, so it has no settings and no way to reach barsy.
async function cli(args: string[]) {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', CLI, ...args],
      { env: {}, timeout: 30_000 },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('pnpm barsy:record entry point', () => {
  it('starts under plain Node and prints its usage', async () => {
    const result = await cli(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('pnpm barsy:record -- --method <Method>')
    expect(result.stdout).toContain('Misc_ping, Misc_ping_user')
  })

  it('refuses a method off the read allowlist with exit code 2', async () => {
    const result = await cli(['--', '--method', 'Accounts_place'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('read allowlist')
  })
})
