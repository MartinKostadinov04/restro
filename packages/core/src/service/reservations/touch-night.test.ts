// Every write to `reservations` in the service path says which night it wrote (D144, #425):
// `stx.touchNight(day)` is what a closed night's re-roll goes by, and nothing else decides which
// rows a count covers. A writer that forgets would leave a closed night's counts stale with no
// error anywhere, so the source is checked: each `update(reservations)` or `insert(reservations)`
// is followed within a few lines by `touchNight(`, or says in a `counts-unaffected` comment why
// none of the counted columns (kind, status, party size, deleted_at) can have moved.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SERVICE = path.resolve(__dirname, '..')
const WINDOW = 4

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

describe('the writers of reservation rows name their night', () => {
  it('has a touchNight (or a counts-unaffected note) after every write', () => {
    const missing: string[] = []
    let writes = 0
    for (const file of sources(SERVICE)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/\.(update|insert)\(reservations\)/.test(line)) return
        writes += 1
        // The statement runs on to its closing line; look from its start to a few lines after it.
        let end = index
        while (
          end < lines.length - 1 &&
          !/^\s*(\.where\(|\.values\(.*\}\)$|\}\)$)/.test(lines[end] ?? '')
        ) {
          end += 1
        }
        const after = lines.slice(index, end + WINDOW + 1).join('\n')
        const note = lines.slice(Math.max(0, index - 6), index).join('\n')
        if (!/touchNight\(/.test(after) && !/counts-unaffected/.test(note)) {
          missing.push(`${path.relative(SERVICE, file)}:${index + 1}`)
        }
      })
    }
    // A moved or renamed writer must not make this check pass by finding nothing.
    expect(writes).toBeGreaterThanOrEqual(17)
    expect(missing).toEqual([])
  })
})
