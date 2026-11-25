// The one value the command line reads from a working folder's `.env.local` (walk P19): where its
// own simulator listens, so a second simulator on the default port is never talked to by mistake.
// Developer tooling; it reads one file and one key, nothing else.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The value of `key` in dotenv text: `KEY=value`, optional quotes, `#` comments ignored; else undefined. */
export function envFileValue(text: string, key: string): string | undefined {
  let found: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match?.[1] !== key) continue
    let value = (match[2] ?? '').trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote))
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    found = value === '' ? undefined : value
  }
  return found
}

/** `key` from `<folder>/.env.local`, or undefined when the file or the key is missing. */
export function envLocalValue(folder: string, key: string): string | undefined {
  try {
    return envFileValue(readFileSync(join(folder, '.env.local'), 'utf8'), key)
  } catch {
    return undefined
  }
}
