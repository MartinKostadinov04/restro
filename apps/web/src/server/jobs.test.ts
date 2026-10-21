import { JOB_NAMES, newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { enqueueJob, type JobSender } from './jobs'

const tenantId = newId('tn')
const integrationId = newId('in')
const venueId = newId('vn')

function recorder(answer: string | null = 'job-1') {
  const sent: { name: string; data: object; options: { singletonKey: string } }[] = []
  const sender: JobSender = {
    async send(name, data, options) {
      sent.push({ name, data, options })
      return answer
    },
  }
  return { sent, sender }
}

describe('enqueueJob', () => {
  it('sends the validated payload with the integration and the venue as the singleton key', async () => {
    const { sent, sender } = recorder()
    const id = await enqueueJob(
      JOB_NAMES.barsyFullPull,
      { tenantId, integrationId, venueId },
      sender,
    )
    expect(id).toBe('job-1')
    expect(sent).toEqual([
      {
        name: 'barsy-full-pull',
        data: { tenantId, integrationId, venueId },
        options: { singletonKey: `${integrationId}:${venueId}` },
      },
    ])
  })

  it('sends an automatic publish with its merge delay and its own key, a manual one at once', async () => {
    const { sent, sender } = recorder()
    const menuId = newId('nd')
    const payload = { tenantId, menuId, venueId, actor: 'system' } as const
    await enqueueJob(JOB_NAMES.publishMenu, { ...payload, reason: 'auto_sync' }, sender)
    await enqueueJob(JOB_NAMES.publishMenu, { ...payload, reason: 'manual' }, sender)
    expect(sent.map((call) => call.options)).toEqual([
      { singletonKey: `${menuId}:${venueId}:auto`, startAfter: 30 },
      { singletonKey: `${menuId}:${venueId}:manual:new` },
    ])
  })

  it('reports a job that is already queued or running as null', async () => {
    const { sender } = recorder(null)
    expect(await enqueueJob(JOB_NAMES.barsyConnect, { tenantId, integrationId }, sender)).toBeNull()
  })

  it('refuses a payload that does not match the job, and sends nothing', async () => {
    const { sent, sender } = recorder()
    await expect(enqueueJob(JOB_NAMES.barsyConnect, { tenantId } as never, sender)).rejects.toThrow(
      /invalid payload for job barsy-connect/,
    )
    await expect(
      enqueueJob(
        JOB_NAMES.barsyFullPull,
        { tenantId, integrationId, venueId: 'a-barsy-bid' } as never,
        sender,
      ),
    ).rejects.toThrow(/invalid payload/)
    expect(sent).toEqual([])
  })

  it('refuses keys a payload does not declare, so nothing extra (a password) is ever queued', async () => {
    const { sent, sender } = recorder()
    await expect(
      enqueueJob(
        JOB_NAMES.barsyConnect,
        { tenantId, integrationId, password: 'x' } as never,
        sender,
      ),
    ).rejects.toThrow(/invalid payload/)
    expect(sent).toEqual([])
  })
})
