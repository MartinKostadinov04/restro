// The `queueJobs` of the worker's two runs that end a night (the closing hour and the passed-night
// sweep, #578): one `guest-email` job per email the night's end owed, sent on the command's own
// transaction (`db`, #592), and nothing when it owed none. That the sweep owes them is covered on
// Postgres (core's `answer.test.ts`).
import { type GuestEmailJob, JOB_NAMES, newId } from '@restro/core'
import type { QueueExecutor, ServiceResult } from '@restro/core/service'
import { describe, expect, it, vi } from 'vitest'

import { queueNightEndEmails } from '../src/jobs/guest-email'
import type { JobQueue } from '../src/jobs/types'

const ACCEPTED = { status: 'accepted', details: { changed: true } } as unknown as ServiceResult
const TX: QueueExecutor = { executeSql: async () => ({ rows: [] }) }

const TENANT = newId('tn')
const VENUE = newId('vn')
const ONE = newId('rv')
const TWO = newId('rv')

const owed = (reservationId: GuestEmailJob['reservationId'], entry: number): GuestEmailJob => ({
  tenantId: TENANT,
  venueId: VENUE,
  reservationId,
  kind: 'reservation_declined',
  entry,
})

function fakeQueue() {
  const send = vi.fn(async () => 'job-id')
  return { queue: { send } as unknown as JobQueue, send }
}

describe('queueNightEndEmails (#578)', () => {
  it('sends one guest-email job per owed email, on the command’s own transaction', async () => {
    const { queue, send } = fakeQueue()
    const emails = [owed(ONE, 11), owed(TWO, 12)]
    await queueNightEndEmails(queue)(ACCEPTED, TX, { guestEmails: emails })
    expect(send).toHaveBeenCalledTimes(2)
    for (const [index, call] of send.mock.calls.entries()) {
      const [name, data, options] = call as unknown as [string, object, { db: unknown }]
      expect(name).toBe(JOB_NAMES.guestEmail)
      expect(data).toMatchObject({ reservationId: emails[index]?.reservationId })
      expect(options.db).toBe(TX)
    }
  })

  it('sends nothing when the night’s end owed no email', async () => {
    const { queue, send } = fakeQueue()
    await queueNightEndEmails(queue)(ACCEPTED, TX, { guestEmails: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('lets a queue that cannot take the job fail the command, so it rolls back', async () => {
    const send = vi.fn(async () => Promise.reject(new Error('the queue is down')))
    const queue = { send } as unknown as JobQueue
    await expect(
      queueNightEndEmails(queue)(ACCEPTED, TX, { guestEmails: [owed(ONE, 11)] }),
    ).rejects.toThrow('the queue is down')
  })
})
