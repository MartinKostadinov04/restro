// Local Postgres 17 for development, without Docker (embedded-postgres ships the binaries).
//
//   pnpm db:local          start (first run creates the data directory), keep running in the
//                          foreground until Ctrl+C or SIGTERM, then shut Postgres down cleanly
//   pnpm db:local:stop     clean shutdown of a running instance, from another terminal
//   pnpm db:local:reset    stop if running, then delete the data directory (.local/pg)
//
// Safe to run twice: `start` reuses the data directory, creates the database only if it is
// missing, and adopts an instance that is already running (for example one left behind when a
// previous `pnpm db:local` was killed without a chance to clean up).
//
// LOCAL DEVELOPMENT ONLY. The superuser password below is public on purpose, and Postgres
// listens on localhost only. Never reuse these values anywhere else.
//
// Why this script drives postgres and pg_ctl itself instead of calling EmbeddedPostgres#start()
// and #stop(): on Windows the library stops Postgres with `taskkill /f`, a hard kill that forces
// crash recovery on the next start. `pg_ctl stop -m fast` is Postgres's own clean shutdown.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

export const DATA_DIR = fileURLToPath(new URL('../.local/pg', import.meta.url))
export const PORT = 54329
export const USER = 'postgres'
export const PASSWORD = 'postgres'
export const DATABASE = 'restro'
export const DATABASE_URL = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`

const STARTUP_TIMEOUT_MS = 60_000
const ADOPTED_POLL_MS = 2_000

/** The embedded-postgres package for this operating system and CPU. */
const PLATFORM_PACKAGES = {
  'win32-x64': 'windows-x64',
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'linux-arm': 'linux-arm',
  'linux-ia32': 'linux-ia32',
  'linux-ppc64': 'linux-ppc64',
}

/**
 * Paths of the Postgres programs bundled for this platform. embedded-postgres only exposes
 * its start/stop wrapper, so the platform package is looked up from where embedded-postgres
 * itself is installed (pnpm does not make it importable from the repository root).
 * @returns {Promise<{ postgres: string, initdb: string, pg_ctl: string }>}
 */
async function loadBinaries() {
  const key = `${os.platform()}-${os.arch()}`
  const platformPackage = PLATFORM_PACKAGES[/** @type {keyof typeof PLATFORM_PACKAGES} */ (key)]
  if (!platformPackage) {
    throw new Error(`No bundled Postgres for ${key}.`)
  }
  const fromEmbeddedPostgres = createRequire(import.meta.resolve('embedded-postgres'))
  const entry = fromEmbeddedPostgres.resolve(`@embedded-postgres/${platformPackage}`)
  return import(pathToFileURL(entry).href)
}

/** @param {{ pg_ctl: string }} binaries */
function isRunning({ pg_ctl }) {
  // pg_ctl status exits 0 when a server is running and non-zero otherwise.
  return spawnSync(pg_ctl, ['status', '-D', DATA_DIR], { stdio: 'ignore' }).status === 0
}

/** Clean ("fast") shutdown: open sessions are ended, data is flushed, no crash recovery later.
 * @param {{ pg_ctl: string }} binaries
 */
function stopServer({ pg_ctl }) {
  const result = spawnSync(pg_ctl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(`pg_ctl stop failed (exit code ${result.status}).`)
  }
}

/** @type {EmbeddedPostgres | undefined} */
let cluster

/** One shared handle, used for initdb and for connecting. It is never asked to start or stop. */
function getCluster() {
  cluster ??= new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    authMethod: 'scram-sha-256',
    // UTF8 is required for Bulgarian text; the C locale is portable (no OS locale needed).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: (message) => process.stdout.write(message),
    onError: (error) => console.error(error),
  })
  return cluster
}

async function initialiseIfNeeded() {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) return
  console.log(`Creating a new Postgres data directory in ${DATA_DIR}`)
  try {
    await getCluster().initialise()
  } catch (error) {
    // Do not leave a half-made directory behind: initdb refuses to reuse it.
    rmSync(DATA_DIR, { recursive: true, force: true })
    throw error
  }
}

/**
 * Starts the server process. Resolves with the child; rejects if it exits before listening.
 * @param {{ postgres: string }} binaries
 */
function spawnServer({ postgres }) {
  const child = spawn(postgres, ['-D', DATA_DIR, '-p', String(PORT)], {
    // LC_MESSAGES=C keeps Postgres's own messages in English whatever the OS language is.
    env: { ...process.env, LC_MESSAGES: 'C' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  child.stderr.on('data', (chunk) => process.stderr.write(`[postgres] ${chunk}`))
  return child
}

/**
 * Waits until the server accepts a login, or throws if the process dies or time runs out.
 * @param {import('node:child_process').ChildProcess | undefined} child
 */
async function waitUntilReady(child) {
  let exited = false
  child?.once('exit', () => {
    exited = true
  })
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exited) throw new Error('Postgres exited before it was ready (see the log above).')
    const client = getCluster().getPgClient()
    try {
      await client.connect()
      await client.end()
      return
    } catch {
      client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Postgres did not accept connections within ${STARTUP_TIMEOUT_MS / 1000}s.`)
}

async function ensureDatabase() {
  const client = getCluster().getPgClient('postgres')
  await client.connect()
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE])
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(DATABASE)}`)
      console.log(`Created database "${DATABASE}".`)
    }
  } finally {
    await client.end()
  }
}

async function start() {
  const binaries = await loadBinaries()
  await initialiseIfNeeded()

  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child
  if (isRunning(binaries)) {
    console.log('Postgres is already running on this data directory; reusing it.')
  } else {
    child = spawnServer(binaries)
  }

  try {
    await waitUntilReady(child)
    await ensureDatabase()
  } catch (error) {
    if (child && isRunning(binaries)) stopServer(binaries)
    throw error
  }

  console.log(`Postgres 17 is ready on localhost:${PORT} (data: ${DATA_DIR})`)
  console.log(`DATABASE_URL=${DATABASE_URL}`)
  console.log('Press Ctrl+C to stop it.')

  await new Promise((resolve) => {
    let stopping = false
    /** @param {number} code */
    const finish = (code) => {
      console.log('Postgres stopped.')
      process.exitCode = code
      resolve(undefined)
    }

    // Stopped from outside (pnpm db:local:stop, or a crash): follow it.
    if (child) {
      child.once('exit', (code) => finish(stopping || code === 0 ? 0 : (code ?? 1)))
    } else {
      const timer = setInterval(() => {
        if (!isRunning(binaries)) {
          clearInterval(timer)
          finish(0)
        }
      }, ADOPTED_POLL_MS)
    }

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
      process.on(signal, () => {
        if (stopping) return
        stopping = true
        console.log(`\nReceived ${signal}, shutting Postgres down cleanly...`)
        try {
          if (isRunning(binaries)) stopServer(binaries)
        } catch (error) {
          // In a Linux or macOS terminal Ctrl+C also reaches Postgres directly, so it may
          // already be gone. Only complain if it is still up; another Ctrl+C tries again.
          if (isRunning(binaries)) {
            console.error(error instanceof Error ? error.message : error)
            stopping = false
          }
        }
      })
    }
  })
}

async function stop() {
  const binaries = await loadBinaries()
  if (!isRunning(binaries)) {
    console.log('Postgres is not running.')
    return
  }
  stopServer(binaries)
  console.log('Postgres stopped.')
}

async function reset() {
  const binaries = await loadBinaries()
  if (isRunning(binaries)) {
    stopServer(binaries)
    console.log('Postgres stopped.')
  }
  rmSync(DATA_DIR, { recursive: true, force: true })
  console.log(`Deleted ${DATA_DIR}. Run "pnpm db:local" to create a fresh, empty database.`)
}

const commands = { start, stop, reset }

async function main() {
  const name = process.argv[2]
  const command = commands[/** @type {keyof typeof commands} */ (name)]
  if (!command) {
    console.error('Usage: node scripts/local-db.mjs <start|stop|reset>')
    process.exitCode = 2
    return
  }
  try {
    await command()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
