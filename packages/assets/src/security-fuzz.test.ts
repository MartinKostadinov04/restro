// The storage paths, fuzzed (the repair-review's A7): nothing that is not exactly one of our own
// paths opens, so a traversal or an absolute path never reaches storage. Pure.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { parseAssetKey } from './keys'
import { parsePublishPath } from './publish-paths'

const HOSTILE = [
  '../../etc/passwd',
  'snap/../../../etc/passwd',
  'snap/sn_abc.json/../../x',
  '/etc/passwd',
  'snap\\sn_abc.json',
  'snap/sn_abc.json\u0000.png',
  'snap/%2e%2e%2fsn_abc.json',
  `assets/tn_${'a'.repeat(22)}/../as_x.png`,
]

describe('storage paths', () => {
  it('hostile paths open to nothing', () => {
    for (const path of HOSTILE) {
      expect(parsePublishPath(path), path).toBeNull()
      expect(parseAssetKey(path), path).toBeNull()
    }
  })
  it('anything arbitrary never throws, and what opens holds no traversal', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[a-z_/.]{0,40}$/)), (path) => {
        const opened = parsePublishPath(path) !== null || parseAssetKey(path) !== null
        if (opened) {
          expect(path).not.toContain('..')
          expect(path.startsWith('/')).toBe(false)
          expect(path).not.toContain('\\')
        }
      }),
      { seed: 20261030, numRuns: 1000 },
    )
  })
})
