import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index'

describe('@restro/core', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@restro/core')
  })

  it('has fast-check available for property tests', () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a))
  })
})
