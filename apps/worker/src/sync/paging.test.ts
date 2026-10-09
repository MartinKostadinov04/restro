import {
  BarsyAuthError,
  type BarsyCallContext,
  BarsyConfigError,
  BarsyHttpError,
  BarsyNetworkError,
  BarsyResponseError,
  BarsyTimeoutError,
} from '@restro/barsy'
import { describe, expect, it, vi } from 'vitest'

import { SyncError } from './errors'
import { readPages } from './paging'

const context: BarsyCallContext = {
  method: 'Articles_getlist',
  bid: '10',
  requestId: null,
  durationMs: 1,
}
const timeout = () => new BarsyTimeoutError(context, 30_000)
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

/** A read of `total` numbered rows where `fail(offset, length)` may throw. */
function read(total: number, fail: (offset: number, length: number) => unknown, start = 500) {
  const asked: [number, number][] = []
  const result = readPages<number>({
    what: 'test',
    startLength: start,
    minLength: 25,
    log,
    fetchPage: async (offset, length) => {
      asked.push([offset, length])
      const error = fail(offset, length)
      if (error) throw error
      return Array.from(
        { length: Math.max(0, Math.min(length, total - offset)) },
        (_, i) => offset + i,
      )
    },
  })
  return { result, asked }
}

describe('readPages', () => {
  it('reads every page, the last one short, and reports each page ok', async () => {
    const { result, asked } = read(1200, () => undefined)
    const read1 = await result
    expect(read1.items).toHaveLength(1200)
    expect(read1.pagesOk).toEqual([true, true, true])
    expect(asked).toEqual([
      [0, 500],
      [500, 500],
      [1000, 500],
    ])
  })

  it('an exact multiple of the page length ends on an empty page', async () => {
    const { result, asked } = read(1000, () => undefined)
    const done = await result
    expect(done.items).toHaveLength(1000)
    expect(asked.at(-1)).toEqual([1000, 500])
    expect(done.pagesOk).toEqual([true, true, true])
  })

  it('halves on a timeout, down to 25, and keeps the smaller size for the pages after it', async () => {
    const { result, asked } = read(120, (_offset, length) => (length > 25 ? timeout() : undefined))
    const done = await result
    expect(asked.map(([, length]) => length)).toEqual([500, 250, 125, 62, 31, 25, 25, 25, 25, 25])
    expect(done.items).toHaveLength(120)
    expect(done.pagesOk.every(Boolean)).toBe(true)
    expect(done.finalLength).toBe(25)
  })

  it('halves on barsy’s own 30 s error (5xx) and on a dropped connection, not on a 4xx', async () => {
    for (const error of [new BarsyHttpError(context, 504), new BarsyNetworkError(context)]) {
      const { result, asked } = read(10, (_o, length) => (length > 100 ? error : undefined))
      await result
      expect(asked.map(([, length]) => length)).toEqual([500, 250, 125, 62])
    }
    const { result, asked } = read(10, () => new BarsyHttpError(context, 400))
    const done = await result
    // A 400 does not get better with a smaller page: the page is failed at once.
    expect(asked[0]).toEqual([0, 500])
    expect(done.pagesOk[0]).toBe(false)
  })

  it('the third failure at 25 marks the page failed and the read goes on with the next one', async () => {
    const { result, asked } = read(100, (offset, length) =>
      length > 25 || offset === 25 ? timeout() : undefined,
    )
    const done = await result
    expect(asked.filter(([offset]) => offset === 25)).toHaveLength(3)
    expect(done.pagesOk).toEqual([true, false, true, true, true].slice(0, done.pagesOk.length))
    expect(done.pagesOk.filter((ok) => !ok)).toHaveLength(1)
    // Rows 0-24 and 50-99 were read; 25-49 are the failed page.
    expect(done.items).toEqual([
      ...Array(25).keys(),
      ...Array.from({ length: 50 }, (_, i) => 50 + i),
    ])
  })

  it('an unreadable response is a failed page without halving', async () => {
    const { result, asked } = read(
      10,
      () => new BarsyResponseError(context, [{ path: '', code: 'invalid_json' }]),
    )
    const done = await result
    expect(asked.slice(0, 1)).toEqual([[0, 500]])
    expect(done.pagesOk[0]).toBe(false)
  })

  it('three failed pages in a row end the read, which is then incomplete', async () => {
    const { result, asked } = read(10_000, () => timeout())
    const done = await result
    expect(done.pagesOk).toEqual([false, false, false])
    expect(done.items).toEqual([])
    // 500..25 (six sizes) and then three tries at 25 for each page, three pages.
    expect(asked.length).toBeGreaterThan(9)
  })

  it('rethrows credentials and configuration errors: they are not a bad page', async () => {
    await expect(read(10, () => new BarsyAuthError(context, 401)).result).rejects.toBeInstanceOf(
      BarsyAuthError,
    )
    await expect(read(10, () => new BarsyConfigError('bad')).result).rejects.toBeInstanceOf(
      BarsyConfigError,
    )
  })

  it('stops with a SyncError when the worker is shutting down', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      readPages<number>({
        what: 'test',
        startLength: 10,
        minLength: 5,
        log,
        signal: controller.signal,
        fetchPage: async () => [],
      }),
    ).rejects.toBeInstanceOf(SyncError)
  })
})
