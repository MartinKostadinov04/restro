import { describe, expect, it } from 'vitest'

import { newId } from './ids'
import {
  deferredSingletonKey,
  EXCLUSIVE_JOBS,
  isProducedJob,
  JOB_NAMES,
  JOB_PAYLOADS,
  jobSingletonKey,
  prepareJob,
} from './jobs'

const tenantId = newId('tn')
const integrationId = newId('in')
const venueId = newId('vn')

describe('job names and payloads', () => {
  it('every produced job has a payload schema and is exclusive', () => {
    for (const name of Object.keys(JOB_PAYLOADS)) {
      expect(isProducedJob(name)).toBe(true)
      expect(EXCLUSIVE_JOBS.has(name)).toBe(true)
    }
    expect(isProducedJob(JOB_NAMES.barsyIncrementalTick)).toBe(false)
    expect(isProducedJob('constructor')).toBe(false)
  })

  it('names are unique and queue-safe', () => {
    const names = Object.values(JOB_NAMES)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z0-9-]+$/)
  })

  it('a pull is keyed by its integration, so a queue holds one pull of it at a time', () => {
    const full = prepareJob(JOB_NAMES.barsyFullPull, { tenantId, integrationId, venueId })
    const incremental = prepareJob(JOB_NAMES.barsyIncremental, { tenantId, integrationId, venueId })
    expect(full.singletonKey).toBe(integrationId)
    expect(incremental.singletonKey).toBe(integrationId)
    expect(jobSingletonKey(JOB_NAMES.barsyConnect, { tenantId, integrationId })).toBe(integrationId)
  })

  it('a pull sent again for later has a key of its own, different each second', () => {
    const at = new Date('2026-10-10T12:00:00.900Z')
    const key = deferredSingletonKey(integrationId, at)
    expect(key).toBe(`${integrationId}:later:${Math.floor(at.getTime() / 1000)}`)
    expect(key).not.toBe(integrationId)
    expect(deferredSingletonKey(integrationId, new Date(at.getTime() + 60_000))).not.toBe(key)
  })

  it('a picture is keyed by integration and article', () => {
    const job = prepareJob(JOB_NAMES.assetFetch, {
      tenantId,
      integrationId,
      articleExternalId: '7183',
      pictureName: 'burger.jpg',
      url: 'https://demo.barsyonline.com/endpoints/res/files_get?x=1',
    })
    expect(job.singletonKey).toBe(`${integrationId}:7183`)
  })

  it('refuses a payload with a wrong id, a missing tenant or an unknown key', () => {
    expect(() => prepareJob(JOB_NAMES.barsyConnect, { integrationId })).toThrow(/invalid payload/)
    expect(() =>
      prepareJob(JOB_NAMES.barsyFullPull, { tenantId, integrationId, venueId: 'vn_x' }),
    ).toThrow(/invalid payload/)
    expect(() =>
      prepareJob(JOB_NAMES.barsyConnect, { tenantId, integrationId, extra: true }),
    ).toThrow(/invalid payload/)
    expect(() =>
      prepareJob(JOB_NAMES.assetFetch, {
        tenantId,
        integrationId,
        articleExternalId: '1',
        pictureName: 'a.jpg',
        url: 'http://insecure.test/a.jpg',
      }),
    ).toThrow(/invalid payload/)
  })
})
