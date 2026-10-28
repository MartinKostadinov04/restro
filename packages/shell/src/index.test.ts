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

  it('exports the entry points of brief SH-03', () => {
    for (const name of [
      'resolveOptions',
      'FEATURE_NAMES',
      'OPTION_GROUPS',
      'SERVICE_KINDS',
      'CapabilitiesSchema',
    ]) {
      expect(Object.keys(shell), name).toContain(name)
    }
  })

  it('exports the services contract and the bag of brief SH-06', () => {
    for (const name of [
      'GuestCommandSchema',
      'EMPTY_SERVICE_STATE',
      'PAYMENT_STATES',
      'choosePay',
      'payScreen',
      'SERVICE_LIMITS',
      'bagReducer',
      'bagEstimate',
      'resolveBag',
      'orderLines',
      'groupValid',
      'selectionValid',
      'toggleOption',
      'needsChoices',
    ]) {
      expect(Object.keys(shell), name).toContain(name)
    }
  })

  it('keeps money arithmetic out of the main entry: faces draw amounts, they do not add them up', () => {
    for (const name of [
      'addMinor',
      'subtractMinor',
      'multiplyMinor',
      'percentOfMinor',
      'ratioOfMinor',
      'viewMinor',
    ]) {
      expect(Object.keys(shell), name).not.toContain(name)
    }
  })
})
