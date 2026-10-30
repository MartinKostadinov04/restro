// RED by design (the repair-review's A7). D122 §9: "After 20 wrong codes in 10 minutes from one
// network, Turnstile is required. After 50, a 15-minute block and an alert." `/t/<code>` has the
// limiter; the guest API takes the same code in a header and has none, so a script tries codes there
// at full speed. A code holds 128 random bits, so this cannot find one: what it costs is a database
// read per guess. On Postgres as restro_app.
import type { DbPool } from '@restro/db'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPool } from '../db'
import { handleGuestState } from '../guest-api'
import { hasDatabase, useTestServerEnvironment } from '../test-database'

describe.skipIf(!hasDatabase)('wrong codes at the guest API', () => {
  let app: DbPool

  beforeAll(() => {
    useTestServerEnvironment()
    app = getPool()
  })

  it('one network trying 60 codes must be slowed or blocked, as at /t/<code>', async () => {
    const deps = {
      pool: app,
      queueReading: async () => {},
      passKey: null,
      humanCheck: async () => 'passed' as const,
      queueSend: async () => {},
      queuePayment: async () => {},
    }
    const statuses = new Set<number>()
    for (let attempt = 0; attempt < 60; attempt++) {
      const answer = await handleGuestState(
        new Request('http://localhost/api/guest/state?view=menu', {
          headers: {
            authorization: `Table ${String(attempt).padStart(22, 'x')}`,
            'x-forwarded-for': '198.51.100.7',
          },
        }),
        deps,
      )
      statuses.add(answer.status)
    }
    expect([...statuses]).toContain(429)
  }, 120_000)
})
