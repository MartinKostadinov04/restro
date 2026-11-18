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
/** The most lines a statement may run before its end is found: past it the check fails, not drifts. */
const STATEMENT_LINES = 25
const STATEMENT_END = /^\s*(\.where\(|\.values\(.*\}\)$|\}\)$)/

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
        const ceiling = Math.min(index + STATEMENT_LINES, lines.length - 1)
        let end = index
        while (end < ceiling && !STATEMENT_END.test(lines[end] ?? '')) end += 1
        if (!STATEMENT_END.test(lines[end] ?? '')) {
          // No end found within the ceiling (say a write that ends in `.returning(`): the window
          // cannot be trusted, so the write is reported instead of being checked against whatever
          // follows it.
          missing.push(`${path.relative(SERVICE, file)}:${index + 1} (statement end not found)`)
          return
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

  it('has no write to reservations spelled as raw SQL, which the check above cannot see', () => {
    const raw = sources(SERVICE).filter((file) =>
      /(update\s+restro\.reservations|insert\s+into\s+restro\.reservations)\b/i.test(
        readFileSync(file, 'utf8'),
      ),
    )
    expect(raw.map((file) => path.relative(SERVICE, file))).toEqual([])
  })
})
