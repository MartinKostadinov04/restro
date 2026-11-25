// What the worker's two night's-end paths (the closing hour and the passed-night sweep) do with
// the command's answer (#578): nothing to queue unless the night's end declined a request, and a
// failed read is logged by venue, never thrown, so the night's end itself stays done. The
// queueing of the emails found is covered on Postgres (core's `answer.test.ts`).
import type { ServiceResult } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import { describe, expect, it, vi } from 'vitest'

import { queueNightEndEmails } from '../src/jobs/guest-email'
import type { JobQueue } from '../src/jobs/types'

const SCOPE = { tenantId: 'tn_test', venueId: 'vn_test', jobId: 'job-test' }

/** A pool every touch of which fails, as a database that went away. */
const downPool = new Proxy(
  {},
  {
    get() {
      throw new Error('the database is down')
    },
  },
) as unknown as DbPool

function fakeQueue() {
  const send = vi.fn(async () => 'job-id')
  return { queue: { send } as unknown as JobQueue, send }
}

const accepted = (declined: number) =>
  ({ status: 'accepted', details: { changed: true, declined } }) as unknown as ServiceResult

describe('queueNightEndEmails (#578)', () => {
  it('reads nothing and queues nothing when the night’s end declined no request', async () => {
    const { queue, send } = fakeQueue()
    const warn = vi.fn()
    expect(await queueNightEndEmails(downPool, queue, accepted(0), SCOPE, { warn })).toBe(0)
    const refused = { status: 'refused', code: 'x', details: {} } as unknown as ServiceResult
    expect(await queueNightEndEmails(downPool, queue, refused, SCOPE, { warn })).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs a failed read by venue alone and does not throw', async () => {
    const { queue, send } = fakeQueue()
    const warn = vi.fn()
    expect(await queueNightEndEmails(downPool, queue, accepted(2), SCOPE, { warn })).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ venueId: SCOPE.venueId })
    expect(Object.keys(warn.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['err', 'venueId'])
  })
})
