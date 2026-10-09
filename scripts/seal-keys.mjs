// `pnpm keys:seal --write-env <file>`: generates the X25519 key pair that seals barsy
// credentials (D55; packages/core/src/seal) and appends it to an env file:
//
//   SEAL_PUBLIC_KEY=<base64url DER, SPKI>     web app and worker
//   SEAL_PRIVATE_KEY=<base64url DER, PKCS8>   worker only
//
// It prints the public key and the file path, never the private key. A file that already has
// both keys is left alone; a file with only one of them is refused (fix it by hand). There is no
// mode that prints the private key: copy it from the file into the worker's environment.
//
// Self-contained (node:crypto and node:fs only), so plain Node runs it; the format matches
// parseSealPublicKey / parseSealPrivateKey in @restro/core (scripts/seal-keys.test.ts checks).

import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const USAGE =
  'Usage: pnpm keys:seal --write-env <file>\n' +
  'Generates the sealing key pair and appends SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY to <file>.\n' +
  'Only the public key is printed. Use a git-ignored file (any .env.* except .env.example).'

/**
 * True if `text` sets the variable (an uncommented `NAME=value` line, optionally `export`).
 * @param {string} text
 * @param {string} name
 */
function declares(text, name) {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*\\S`, 'm').test(text)
}

/**
 * A new pair: each half base64url DER.
 * @returns {{ publicKey: string, privateKey: string }}
 */
export function generatePair() {
  const pair = generateKeyPairSync('x25519')
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  }
}

/**
 * Appends a new pair to `file` unless it already has one. Returns what to print: the outcome,
 * the public key and the path. Throws an Error with a message for people (never a key).
 * @param {string} file
 * @returns {{ outcome: 'kept' | 'written', path: string, publicKey: string | null }}
 */
export function writeEnv(file) {
  const path = resolve(file)
  if (basename(path) === '.env.example') {
    throw new Error('.env.example is committed: write the keys to a git-ignored file instead.')
  }
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const hasPublic = declares(text, 'SEAL_PUBLIC_KEY')
  const hasPrivate = declares(text, 'SEAL_PRIVATE_KEY')
  if (hasPublic && hasPrivate) {
    return { outcome: 'kept', path, publicKey: null }
  }
  if (hasPublic || hasPrivate) {
    throw new Error(
      `${path} has only one of SEAL_PUBLIC_KEY and SEAL_PRIVATE_KEY. Remove it (and connect the ` +
        'integrations again if the old pair was in use), then run this again.',
    )
  }
  const { publicKey, privateKey } = generatePair()
  const separator = text === '' || text.endsWith('\n') ? '' : '\n'
  appendFileSync(
    path,
    `${separator}# Sealing key pair (pnpm keys:seal). The private key is for the worker only.\n` +
      `SEAL_PUBLIC_KEY=${publicKey}\nSEAL_PRIVATE_KEY=${privateKey}\n`,
    { mode: 0o600 },
  )
  return { outcome: 'written', path, publicKey }
}

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
function main(argv) {
  const at = argv.indexOf('--write-env')
  const file = at === -1 ? undefined : argv[at + 1]
  if (file === undefined || file.startsWith('--') || argv.length !== 2) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  try {
    const result = writeEnv(file)
    if (result.outcome === 'kept') {
      process.stdout.write(`${result.path} already has a sealing key pair; nothing written.\n`)
    } else {
      process.stdout.write(
        `Appended a new sealing key pair to ${result.path}.\n` +
          `SEAL_PUBLIC_KEY=${result.publicKey}\n` +
          'The private key is in that file only: give SEAL_PRIVATE_KEY to the worker, never to the web app.\n',
      )
    }
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'keys:seal failed'}\n`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
