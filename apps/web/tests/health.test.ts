import { describe, expect, it } from 'vitest'

import { GET } from '../app/api/health/route'

describe('GET /api/health', () => {
  it('returns { status: "ok" } and is never cached', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
