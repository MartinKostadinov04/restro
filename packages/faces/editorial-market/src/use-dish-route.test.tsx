// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type HashRoute, useHashRoute } from './use-dish-route'

const ROUTE: HashRoute = {
  parse: (hash) => (hash.startsWith('#test-') ? hash.slice('#test-'.length) : null),
  format: (id) => `#test-${id}`,
  stateKey: 'rmTest',
  replaceWhenOpen: false,
}

beforeEach(() => {
  // A guest who asked for less motion: the page goes at once.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('the focus a closed page gives back (SH-07)', () => {
  it('goes to the control that opened it', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    const { result } = renderHook(() => useHashRoute(ROUTE))
    act(() => result.current.open('a', opener))
    await waitFor(() => expect(result.current.isOpen).toBe(true))
    act(() => result.current.close())
    await waitFor(() => expect(result.current.isOpen).toBe(false))
    expect(document.activeElement).toBe(opener)
  })

  it('is tried again once the page is gone, for a control that is hidden while it slides out', async () => {
    // The service bar is hidden while a sheet shows, and a hidden control cannot take the focus:
    // here the first try does nothing, as a browser would, and the second one works.
    const opener = document.createElement('button')
    document.body.append(opener)
    const focus = HTMLElement.prototype.focus
    let tries = 0
    opener.focus = vi.fn((options?: FocusOptions) => {
      tries += 1
      if (tries >= 2) focus.call(opener, options)
    })
    const { result } = renderHook(() => useHashRoute(ROUTE))
    act(() => result.current.open('a', opener))
    await waitFor(() => expect(result.current.isOpen).toBe(true))
    act(() => result.current.close())
    await waitFor(() => expect(result.current.shownId).toBeNull())
    expect(tries).toBe(2)
    expect(document.activeElement).toBe(opener)
  })

  it('is not tried a second time when the first one worked', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    const focus = vi.spyOn(opener, 'focus')
    const { result } = renderHook(() => useHashRoute(ROUTE))
    act(() => result.current.open('a', opener))
    await waitFor(() => expect(result.current.isOpen).toBe(true))
    act(() => result.current.close())
    await waitFor(() => expect(result.current.shownId).toBeNull())
    expect(focus).toHaveBeenCalledTimes(1)
  })
})
