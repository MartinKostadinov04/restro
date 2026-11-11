// The registry of provider-hosted onboarding pages (#398): found by a glob of `./<kind>/onboarding.ts`.
import { describe, expect, it } from 'vitest'

describe('which providers have a hosted onboarding page of the app', () => {
  it('is the simulated provider alone, never a real one', () => {
    // A real provider's form is its own site. A new provider that wants a page of ours would show
    // up here and need a decision (D127).
    expect(Object.keys(import.meta.glob('./*/onboarding.ts')).sort()).toEqual([
      './sim-pay/onboarding.ts',
    ])
  })
})
