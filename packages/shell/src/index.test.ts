import { describe, expect, it } from 'vitest'

import * as shell from './index'

describe('@restro/shell public surface', () => {
  it('exports the entry points of brief S3-02', () => {
    for (const name of [
      'buildViewModel',
      'validateManifest',
      'FaceManifestSchema',
      'generatePalette',
      'contrastRatio',
      'semanticColours',
      'parseContext',
    ]) {
      expect(Object.keys(shell), name).toContain(name)
    }
  })
})
