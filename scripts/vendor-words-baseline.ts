// `pnpm vendor-words:baseline`: rewrites scripts/vendor-words.baseline.json from the current tree.
//
//   pnpm vendor-words:baseline                    lowers or removes entries; refuses to raise any
//   pnpm vendor-words:baseline --allow-increase   also raises or adds entries (the lead only,
//                                                 for example when merging older branches)
//
// The baseline only shrinks (D67). Run this after a change that removes vendor words, and commit
// the new file. scripts/vendor-words.test.ts never writes the baseline; this script is the only
// writer. Words in a wall zone are not baseline-able: fix them, the test names each one.
//
// Run by Node itself (native TypeScript), so: explicit ".ts" extensions, erasable syntax only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type Baseline,
  computeBaseline,
  defaultConfig,
  formatBaseline,
  raisedEntries,
  readBaseline,
  scanVendorWords,
  zoneTotals,
} from './vendor-words.ts'

const USAGE = 'Usage: pnpm vendor-words:baseline [--allow-increase]'

export type UpdateResult = {
  /** True when the baseline file was (re)written. */
  written: boolean
  baseline: Baseline
  /** Lines for the person running the script. */
  messages: string[]
}

/** Rescans `root` and rewrites its baseline, unless that would raise a number without permission. */
export function updateBaseline(root: string, options: { allowIncrease: boolean }): UpdateResult {
  const config = defaultConfig
  const previous = readBaseline(root, config)
  const next = computeBaseline(scanVendorWords(root, config))
  const raised = raisedEntries(next, previous ?? {})
  if (raised.length > 0 && !options.allowIncrease) {
    return {
      written: false,
      baseline: previous ?? {},
      messages: [
        'Refusing to raise the vendor-word baseline (D67: it only shrinks). Not written. Raised:',
        ...raised.map((entry) => `  ${entry.file}: ${entry.from} -> ${entry.to}`),
        previous === null
          ? 'There is no baseline file yet; the first one needs --allow-increase (the lead only).'
          : 'Remove the new vendor words instead. --allow-increase is for the lead only.',
      ],
    }
  }
  const path = join(root, config.baselineFile)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, formatBaseline(next))
  const totals = Object.entries(zoneTotals(next, config)).map(
    ([zone, total]) => `  ${zone}: ${total.words} words in ${total.files} files`,
  )
  return {
    written: true,
    baseline: next,
    messages: [`Wrote ${config.baselineFile}.`, ...totals],
  }
}

function main(args: string[]): number {
  const unknown = args.filter((arg) => arg !== '--allow-increase')
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(' ')}\n${USAGE}`)
    return 2
  }
  const root = fileURLToPath(new URL('..', import.meta.url))
  const result = updateBaseline(root, { allowIncrease: args.includes('--allow-increase') })
  for (const line of result.messages) (result.written ? console.log : console.error)(line)
  return result.written ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
