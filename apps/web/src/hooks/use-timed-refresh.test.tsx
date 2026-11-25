// @vitest-environment jsdom
// The timed refresh (RR-88): it asks the server whether it can be reached before it refreshes, and
// when it cannot it leaves the screen alone and says so.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshIfReachable, serverReachable, useTimedRefresh } from './use-timed-refresh'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: navigation.refresh }) }))

const fetchMock = vi.fn<typeof fetch>()

function Probe(props: { enabled?: boolean; visibleOnly?: boolean }) {
  const { offline } = useTimedRefresh({ every: 5000, ...props })
  return <p data-testid="state">{offline ? 'offline' : 'online'}</p>
}

const answer = () => Promise.resolve(new Response('{}', { status: 200 }))
const lost = () => Promise.reject(new TypeError('Failed to fetch'))

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  navigation.refresh.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('serverReachable', () => {
  it('asks the liveness endpoint, which the sign-in gate leaves alone, and never from a cache', async () => {
    fetchMock.mockImplementation(answer)
    expect(await serverReachable()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/health')
    expect(init?.cache).toBe('no-store')
    expect(init?.redirect).toBe('manual')
  })

  it('counts any answer as reachable: an error status, a redirect to sign-in', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('', { status: 503 })))
    expect(await serverReachable()).toBe(true)
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ type: 'opaqueredirect', status: 0 } as Response),
    )
    expect(await serverReachable()).toBe(true)
  })

  it('counts no answer as out of reach: a lost connection, a timeout', async () => {
    fetchMock.mockImplementationOnce(lost)
    expect(await serverReachable()).toBe(false)
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    )
    expect(await serverReachable()).toBe(false)
  })
})

describe('useTimedRefresh', () => {
  it('refreshes after each probe that gets an answer, and shows nothing wrong', async () => {
    fetchMock.mockImplementation(answer)
    render(<Probe />)
    await pass(4999)
    expect(navigation.refresh).not.toHaveBeenCalled()
    await pass(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    await pass(10_000)
    expect(navigation.refresh).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('state').textContent).toBe('online')
  })

  it('does not refresh while the server cannot be reached, and refreshes the moment it can', async () => {
    fetchMock.mockImplementation(lost)
    render(<Probe />)
    await pass(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(navigation.refresh).not.toHaveBeenCalled()
    expect(screen.getByTestId('state').textContent).toBe('offline')
    fetchMock.mockImplementation(answer)
    await pass(5000)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state').textContent).toBe('online')
  })

  it('notices the connection coming back at once', async () => {
    fetchMock.mockImplementation(lost)
    render(<Probe />)
    await pass(5000)
    expect(screen.getByTestId('state').textContent).toBe('offline')
    fetchMock.mockImplementation(answer)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state').textContent).toBe('online')
  })

  it('does not stack probes when one is slow', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined))
    render(<Probe />)
    await pass(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('does nothing while it is switched off, and stops when it goes away', async () => {
    fetchMock.mockImplementation(answer)
    const off = render(<Probe enabled={false} />)
    await pass(20_000)
    expect(fetchMock).not.toHaveBeenCalled()
    off.unmount()
    const on = render(<Probe />)
    on.unmount()
    await pass(20_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('can skip the ticks of a hidden tab', async () => {
    fetchMock.mockImplementation(answer)
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(<Probe visibleOnly />)
    await pass(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    state.mockReturnValue('visible')
    await pass(5000)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    state.mockRestore()
  })
})

describe('refreshIfReachable', () => {
  it('refreshes once when the server answers, and not when it does not', async () => {
    fetchMock.mockImplementationOnce(answer)
    await refreshIfReachable(navigation.refresh)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    fetchMock.mockImplementationOnce(lost)
    await refreshIfReachable(navigation.refresh)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
  })
})
