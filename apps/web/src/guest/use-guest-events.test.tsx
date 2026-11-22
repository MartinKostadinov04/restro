// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGuestEvents } from './use-guest-events'

const CODE = 'tb_0123456789ABCDEFGHIJKL'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGuestEvents', () => {
  it('sends nothing without a table, even when the page goes away', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { result, unmount } = renderHook(() => useGuestEvents(null))
    await act(async () => {
      result.current({ kind: 'menu.opened' })
      result.current({ kind: 'item.opened', itemId: 'nd_0000000000000000000001' })
      window.dispatchEvent(new Event('pagehide'))
    })
    unmount()
    await act(async () => {})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends what it was told at a table once the page goes away (the check above can see)', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { result, unmount } = renderHook(() => useGuestEvents(CODE))
    await act(async () => {
      result.current({ kind: 'item.opened', itemId: 'nd_0000000000000000000001' })
      window.dispatchEvent(new Event('pagehide'))
    })
    unmount()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  })
})
