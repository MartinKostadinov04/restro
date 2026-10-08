import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from './index'

describe('@restro/barsy', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@restro/barsy')
  })
})
