// @vitest-environment jsdom
// The list that keeps itself current (#86; sent-orders plan §3, "New sent orders while the list is
// read"): at the top of the page new rows join as they come; scrolled down, the rows already drawn
// change in place and a still "{k} new" count waits for one tap; a new query replaces the list at
// once; a failed read is flagged and clears when the next one works; a night that is over is not
// asked again.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FEED_POLL_MS, useLiveFeed } from './live-feed'

interface View {
  rows: { id: number; text: string }[]
}

const view = (...rows: [number, string][]): View => ({
  rows: rows.map(([id, text]) => ({ id, text })),
})

function feed(
  load: () => Promise<View | null>,
  options: { live?: boolean; query?: unknown[] } = {},
) {
  return renderHook(
    ({ query }) =>
      useLiveFeed<View>({
        initial: view([2, 'two'], [1, 'one']),
        query,
        live: options.live ?? true,
        load,
        keysOf: (v) => v.rows.map((row) => row.id),
        refresh: (shown, latest) => ({
          rows: shown.rows.map((row) => latest.rows.find((fresh) => fresh.id === row.id) ?? row),
        }),
      }),
    { initialProps: { query: options.query ?? ['a'] } },
  )
}

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS)
  })
}

function scrolled(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
}

describe('useLiveFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    scrolled(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows what the server drew first', () => {
    const { result } = feed(async () => null)
    expect(result.current.shown.rows.map((row) => row.id)).toEqual([2, 1])
    expect(result.current.fresh).toBe(0)
    expect(result.current.failed).toBe(false)
  })

  it('lets a new row join at the top while the page is at the top', async () => {
    const { result } = feed(async () => view([3, 'three'], [2, 'two'], [1, 'one']))
    await tick()
    expect(result.current.shown.rows.map((row) => row.id)).toEqual([3, 2, 1])
    expect(result.current.fresh).toBe(0)
  })

  it('holds a new row back when scrolled down, changes the old ones in place, and shows it on one tap', async () => {
    scrolled(600)
    const { result } = feed(async () => view([3, 'three'], [2, 'TWO'], [1, 'one']))
    await tick()
    expect(result.current.shown.rows).toEqual([
      { id: 2, text: 'TWO' },
      { id: 1, text: 'one' },
    ])
    expect(result.current.fresh).toBe(1)
    act(() => result.current.show())
    expect(result.current.shown.rows.map((row) => row.id)).toEqual([3, 2, 1])
    expect(result.current.fresh).toBe(0)
  })

  it('replaces the list at once for a new query, however far down the page is', async () => {
    scrolled(600)
    const load = vi.fn(async () => view([9, 'nine']))
    const { result, rerender } = feed(load)
    rerender({ query: ['b'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.shown.rows.map((row) => row.id)).toEqual([9])
    expect(result.current.loading).toBe(false)
  })

  it('flags a read that failed and clears it when the next works', async () => {
    const load = vi.fn<() => Promise<View | null>>()
    load.mockResolvedValueOnce(null)
    load.mockResolvedValueOnce(view([2, 'two'], [1, 'one']))
    const { result } = feed(load)
    await tick()
    expect(result.current.failed).toBe(true)
    await tick()
    expect(result.current.failed).toBe(false)
  })

  it('asks again by itself only while the night is live', async () => {
    const load = vi.fn(async () => view([2, 'two']))
    feed(load, { live: false })
    await tick()
    await tick()
    expect(load).not.toHaveBeenCalled()
  })

  it('reloads on demand wherever the page is scrolled', async () => {
    scrolled(600)
    const { result } = feed(async () => view([3, 'three'], [2, 'two'], [1, 'one']))
    await act(async () => {
      result.current.reload()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.shown.rows.map((row) => row.id)).toEqual([3, 2, 1])
  })
})
