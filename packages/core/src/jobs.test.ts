import { describe, expect, it } from 'vitest'

import { newId } from './ids'
import {
  AUTO_PUBLISH_DELAY_SECONDS,
  deferredSingletonKey,
  EXCLUSIVE_JOBS,
  isProducedJob,
  JOB_NAMES,
  JOB_PAYLOADS,
  jobSingletonKey,
  prepareJob,
  STATELY_JOBS,
} from './jobs'

const tenantId = newId('tn')
const integrationId = newId('in')
const venueId = newId('vn')
const menuId = newId('nd')

describe('job names and payloads', () => {
  it('every produced job has a payload schema and exactly one queue policy', () => {
    for (const name of Object.keys(JOB_PAYLOADS)) {
      expect(isProducedJob(name)).toBe(true)
      expect(Number(EXCLUSIVE_JOBS.has(name)) + Number(STATELY_JOBS.has(name)), name).toBe(1)
    }
    expect(isProducedJob(JOB_NAMES.barsySyncTick)).toBe(false)
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

  describe('the publish jobs', () => {
    const auto = { tenantId, menuId, venueId, reason: 'auto_sync', actor: 'system' } as const
    const manual = { ...auto, reason: 'manual', actor: 'user:us_1' } as const

    it('an automatic publish waits out the merge window, keyed by menu and venue', () => {
      const job = prepareJob(JOB_NAMES.publishMenu, auto)
      expect(job.startAfter).toBe(AUTO_PUBLISH_DELAY_SECONDS)
      expect(AUTO_PUBLISH_DELAY_SECONDS).toBe(30)
      expect(job.singletonKey).toBe(`${menuId}:${venueId}:auto`)
      // Another venue is another key.
      const other = prepareJob(JOB_NAMES.publishMenu, { ...auto, venueId: newId('vn') })
      expect(other.singletonKey).not.toBe(job.singletonKey)
    })

    it('a manual publish starts at once and never shares a key with an automatic one', () => {
      const job = prepareJob(JOB_NAMES.publishMenu, manual)
      expect(job.startAfter).toBeUndefined()
      expect(job).not.toHaveProperty('startAfter')
      expect(job.singletonKey).toBe(`${menuId}:${venueId}:manual:new`)
      const hold = newId('sn')
      const approving = prepareJob(JOB_NAMES.publishMenu, { ...manual, approveHold: hold })
      expect(approving.singletonKey).toBe(`${menuId}:${venueId}:manual:${hold}`)
    })

    it('only a manual publish may approve a held snapshot', () => {
      expect(() =>
        prepareJob(JOB_NAMES.publishMenu, { ...auto, approveHold: newId('sn') }),
      ).toThrow(/invalid payload/)
    })

    it('refuses an actor that carries personal data and an unknown reason', () => {
      expect(() =>
        prepareJob(JOB_NAMES.publishMenu, { ...manual, actor: 'martin@example.com' }),
      ).toThrow(/invalid payload/)
      expect(() => prepareJob(JOB_NAMES.publishMenu, { ...manual, reason: 'rollback' })).toThrow(
        /invalid payload/,
      )
    })

    it('files and the live overlay are keyed by menu and venue; a photo by its asset', () => {
      const scope = { tenantId, menuId, venueId }
      expect(prepareJob(JOB_NAMES.publishFiles, scope).singletonKey).toBe(`${menuId}:${venueId}`)
      expect(prepareJob(JOB_NAMES.publishLive, scope).singletonKey).toBe(`${menuId}:${venueId}`)
      expect(prepareJob(JOB_NAMES.publishLive, scope)).not.toHaveProperty('startAfter')
      const assetId = newId('as')
      expect(prepareJob(JOB_NAMES.assetVariants, { tenantId, assetId }).singletonKey).toBe(assetId)
      expect(() => prepareJob(JOB_NAMES.publishFiles, { tenantId, menuId })).toThrow(
        /invalid payload/,
      )
    })
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
