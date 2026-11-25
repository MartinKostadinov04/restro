import { describe, expect, it } from 'vitest'

import { ManualClock } from './clock'
import { SimPayEngine } from './engine'
import { checkSimPayEnv, SimPayNotAllowedError } from './env'
import { createSimPayProvider } from './provider'

describe('the environment guard (rules 7 and 9)', () => {
  const engine = new SimPayEngine({ clock: new ManualClock() })

  it('starts outside production', () => {
    for (const env of ['development', 'test', 'staging']) {
      expect(createSimPayProvider({ env, engine }).kind).toBe('sim-pay')
    }
  })

  it('refuses to start in production, or in an environment it does not know', () => {
    expect(() => createSimPayProvider({ env: 'production', engine })).toThrow(SimPayNotAllowedError)
    expect(() => checkSimPayEnv('production')).toThrow('never used in production')
    expect(() => checkSimPayEnv('prod')).toThrow(SimPayNotAllowedError)
    expect(() => checkSimPayEnv('')).toThrow(SimPayNotAllowedError)
  })
})
