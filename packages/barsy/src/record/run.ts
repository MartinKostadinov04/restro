// The fixture recorder, as a function so tests can drive it with an injected environment and a
// temporary fixtures folder. `cli.ts` is the thin entry point that wires it to the real process.
//
// It sends exactly one read-allowlisted call, stores the response as a fixture and prints where.
// It records whatever status barsy answers (a 401 is a useful recording: the shape of the
// authorisation error is undocumented). It never writes credentials or headers other than
// BARSY_REQUEST_ID, and it refuses to overwrite an existing recording without --force.

import { relative } from 'node:path'
import { parseArgs } from 'node:util'
import type { Logger } from 'pino'
import { type BarsyParams, createBarsyClient } from '../client.ts'
import { loadBarsyConfig } from '../config.ts'
import { BarsyConfigError, BarsyError, BarsyMethodNotAllowedError } from '../errors.ts'
import {
  assertFixtureName,
  type BarsyFixture,
  defaultFixtureName,
  fixtureHostLabel,
  fixtureSchema,
} from '../fixture.ts'
import { writeFixture } from '../fixture-files.ts'
import { BARSY_READ_METHOD_NAMES, isBarsyReadMethod } from '../read-methods.ts'

export const EXIT_OK = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2

export interface RecorderDeps {
  /** Normally `process.env`, filled from .env.local by `node --env-file-if-exists`. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Folder that holds `<host-label>/<name>.json`. */
  readonly fixturesRoot: string
  readonly now: () => Date
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  /** Logger for the client's call log (request id, duration). */
  readonly logger?: Logger
}

export const USAGE = `Records one barsy read response as a test fixture.

Usage:
  pnpm barsy:record -- --method <Method> [--bid <venueId>] [--params '<json>'] [--name <fixture-name>] [--label pilot-<n>] [--force]

  --method   a read-allowlisted method (${BARSY_READ_METHOD_NAMES.join(', ')})
  --bid      venue id sent as ?bid= (default: the API user's default venue)
  --params   JSON object (or array) sent as the request body (default: {})
  --name     fixture file name without .json (default: the method, lowercased with dashes)
  --label    folder under packages/barsy/fixtures; needed for every host except the demo
             installation (which is always "demo"); pilot-<n> for a pilot venue
  --force    replace an existing fixture file

Settings come from the environment (pnpm loads .env.local): BARSY_HOST, BARSY_USER,
BARSY_PASSWORD, BARSY_ENV and, outside the demo installation, BARSY_ALLOWED_HOSTS.
Files are written to packages/barsy/fixtures/<host-label>/<name>.json.`

/** Runs the recorder and returns the process exit code. Never throws for expected failures. */
export async function runRecorder(argv: readonly string[], deps: RecorderDeps): Promise<number> {
  let args: ReturnType<typeof parseCliArgs>
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    deps.stderr(`barsy:record: ${messageOf(error)}`)
    deps.stderr(USAGE)
    return EXIT_USAGE
  }
  if (args.help) {
    deps.stdout(USAGE)
    return EXIT_OK
  }

  try {
    // The allowlist check comes first: nothing is loaded or sent for a method that may not be.
    if (args.method === undefined) {
      throw new BarsyConfigError('--method is required')
    }
    if (!isBarsyReadMethod(args.method)) {
      throw new BarsyMethodNotAllowedError(args.method)
    }
    const method = args.method
    const params = parseParams(args.params)
    const name = assertFixtureName(args.name ?? defaultFixtureName(method))

    const config = loadBarsyConfig(deps.env)
    const label = fixtureHostLabel(config.host, args.label)
    const client = createBarsyClient(
      config,
      deps.logger === undefined ? {} : { logger: deps.logger },
    )

    const raw = await client.callRaw(
      method,
      params,
      args.bid === undefined ? {} : { bid: args.bid },
    )

    const fixture: BarsyFixture = fixtureSchema.parse({
      method,
      params,
      bid: raw.bid,
      recordedAt: deps.now().toISOString(),
      status: raw.status,
      requestId: raw.requestId,
      body: raw.body,
    })
    const path = await writeFixture(fixture, {
      root: deps.fixturesRoot,
      label,
      name,
      force: args.force,
    })

    deps.stdout(
      `recorded ${method} -> ${relative(deps.fixturesRoot, path).replaceAll('\\', '/')} ` +
        `(HTTP ${raw.status}, request id ${raw.requestId ?? 'none'}, ${raw.body.length} characters)`,
    )
    if (raw.status < 200 || raw.status > 299) {
      deps.stdout(`note: HTTP ${raw.status} was recorded as received; review it before committing`)
    }
    return EXIT_OK
  } catch (error) {
    deps.stderr(`barsy:record: ${messageOf(error)}`)
    // Bad input, a refused method or host, or bad settings are usage problems; the rest failed at run time.
    const isUsage = error instanceof BarsyConfigError || error instanceof BarsyMethodNotAllowedError
    if (!(error instanceof BarsyError)) {
      deps.stderr('barsy:record: unexpected failure; no fixture was written')
    }
    return isUsage ? EXIT_USAGE : EXIT_FAILED
  }
}

function parseCliArgs(argv: readonly string[]) {
  // `pnpm barsy:record -- --method X` may hand the script a literal "--" first; ignore it.
  const args = argv[0] === '--' ? argv.slice(1) : argv
  const { values } = parseArgs({
    args: [...args],
    options: {
      method: { type: 'string' },
      bid: { type: 'string' },
      params: { type: 'string' },
      name: { type: 'string' },
      label: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  return values
}

function parseParams(text: string | undefined): BarsyParams {
  if (text === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BarsyConfigError('--params is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BarsyConfigError('--params must be a JSON object or array')
  }
  return parsed as BarsyParams
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
