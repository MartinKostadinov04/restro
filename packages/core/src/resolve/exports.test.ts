import { describe, expect, it } from 'vitest'

import * as core from '../index'

describe('@restro/core resolver surface (brief S2-04)', () => {
  it('exports resolve, compareVisibility and the V11 limit', () => {
    for (const name of ['resolve', 'compareVisibility', 'V11_MAX_HIDDEN_SHARE']) {
      expect(Object.keys(core), name).toContain(name)
    }
    expect(typeof core.resolve).toBe('function')
  })
})
