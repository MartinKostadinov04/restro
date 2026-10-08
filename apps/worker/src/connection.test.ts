import { describe, expect, it } from 'vitest'

import { APP_POOL_MAX, QUEUE_POOL_MAX } from './connection'

describe('pool sizes', () => {
  it('keep the whole worker at five connections or fewer (Supabase session pooler)', () => {
    expect(APP_POOL_MAX + QUEUE_POOL_MAX).toBeLessThanOrEqual(5)
  })
})
