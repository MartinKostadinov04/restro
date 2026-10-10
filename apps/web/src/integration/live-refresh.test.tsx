// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveRefresh, REFRESH_INTERVAL_MS } from './live-refresh'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: navigation.refresh }) }))

beforeEach(() => {
  vi.useFakeTimers()
  navigation.refresh.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveRefresh', () => {
  it('refreshes about every 3 seconds while a job is queued or running', async () => {
    expect(REFRESH_INTERVAL_MS).toBe(3000)
    render(<LiveRefresh active />)
    expect(navigation.refresh).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(navigation.refresh).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(navigation.refresh).toHaveBeenCalledTimes(3)
  })

  it('stops once the job has finished', async () => {
    const { rerender } = render(<LiveRefresh active />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    rerender(<LiveRefresh active={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing while no job is running, and stops when it goes away', async () => {
    const { unmount } = render(<LiveRefresh active={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(navigation.refresh).not.toHaveBeenCalled()
    const running = render(<LiveRefresh active />)
    running.unmount()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(navigation.refresh).not.toHaveBeenCalled()
  })
})
