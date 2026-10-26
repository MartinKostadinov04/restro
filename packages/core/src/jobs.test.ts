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

  it('a pull is keyed by its integration and venue: a queue holds one pull per venue (CF-16, T50)', () => {
    const full = prepareJob(JOB_NAMES.barsyFullPull, { tenantId, integrationId, venueId })
    const incremental = prepareJob(JOB_NAMES.barsyIncremental, { tenantId, integrationId, venueId })
    const places = prepareJob(JOB_NAMES.placesRead, { tenantId, integrationId, venueId })
    expect(full.singletonKey).toBe(`${integrationId}:${venueId}`)
    expect(incremental.singletonKey).toBe(`${integrationId}:${venueId}`)
    expect(places.singletonKey).toBe(`${integrationId}:${venueId}`)
    expect(jobSingletonKey(JOB_NAMES.barsyConnect, { tenantId, integrationId })).toBe(integrationId)
  })

  it('a table reading is keyed by its table: one reading per table at a time (#74)', () => {
    const tableId = newId('tb')
    const job = prepareJob(JOB_NAMES.tableRead, { tenantId, venueId, tableId })
    expect(job.singletonKey).toBe(tableId)
    expect(EXCLUSIVE_JOBS.has(JOB_NAMES.tableRead)).toBe(true)
    expect(() =>
      prepareJob(JOB_NAMES.tableRead, { tenantId, venueId, tableId: newId('nd') }),
    ).toThrow()
  })

  it('a Send is keyed by its table, stately: a Send while one runs waits behind it (#77)', () => {
    const tableId = newId('tb')
    const job = prepareJob(JOB_NAMES.orderSend, { tenantId, venueId, tableId })
    expect(job.singletonKey).toBe(tableId)
    expect(STATELY_JOBS.has(JOB_NAMES.orderSend)).toBe(true)
    expect(isProducedJob(JOB_NAMES.orderSlotSweep)).toBe(false)
  })

  it('two venues of one integration never share a pull key, so neither pull drops the other', () => {
    const other = newId('vn')
    const keys = [venueId, other].map(
      (id) =>
        prepareJob(JOB_NAMES.barsyFullPull, { tenantId, integrationId, venueId: id }).singletonKey,
    )
    expect(new Set(keys).size).toBe(2)
  })

  it('a pull sent again for later has a key of its own, different each second', () => {
    const at = new Date('2026-10-10T12:00:00.900Z')
    const own = `${integrationId}:${venueId}`
    const key = deferredSingletonKey(own, at)
    expect(key).toBe(`${own}:later:${Math.floor(at.getTime() / 1000)}`)
    expect(key).not.toBe(own)
    expect(deferredSingletonKey(own, new Date(at.getTime() + 60_000))).not.toBe(key)
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

  describe('the table token job (S3-07)', () => {
    const a = 'Ab3dEfGh1jKlMnOpQrStUv'
    const b = 'Zz9yXwVuTsRqPoNmLkJiHg'

    it('is keyed by venue, and by the set of tokens it must remove', () => {
      const refresh = prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId, retired: [] })
      expect(refresh.singletonKey).toBe(venueId)
      expect(refresh).not.toHaveProperty('startAfter')

      const removeA = prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId, retired: [a] })
      const removeB = prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId, retired: [b] })
      // Different work never shares a key, so a waiting job is never replaced by one that
      // removes a different token; the same work, in any order, does.
      expect(new Set([refresh.singletonKey, removeA.singletonKey, removeB.singletonKey]).size).toBe(
        3,
      )
      const both = prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId, retired: [a, b] })
      const reversed = prepareJob(JOB_NAMES.publishTableTokens, {
        tenantId,
        venueId,
        retired: [b, a],
      })
      expect(both.singletonKey).toBe(reversed.singletonKey)
      expect(both.singletonKey).toMatch(new RegExp(`^${venueId}:[0-9a-f]{16}$`))
      // Another venue is another key.
      const other = prepareJob(JOB_NAMES.publishTableTokens, {
        tenantId,
        venueId: newId('vn'),
        retired: [a],
      })
      expect(other.singletonKey).not.toBe(removeA.singletonKey)
    })

    it('refuses a token that is not a token and a list that is too long', () => {
      expect(() =>
        prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId, retired: ['short'] }),
      ).toThrow(/invalid payload/)
      expect(() =>
        prepareJob(JOB_NAMES.publishTableTokens, {
          tenantId,
          venueId,
          retired: Array.from(
            { length: 501 },
            (_, index) => `Token${String(index).padStart(6, '0')}`,
          ),
        }),
      ).toThrow(/invalid payload/)
      expect(() => prepareJob(JOB_NAMES.publishTableTokens, { tenantId, venueId })).toThrow(
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
