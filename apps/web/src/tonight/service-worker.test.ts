// The service worker's handlers (RR-86), run from its real file against a fake `self`. Nothing here
// needs a browser or a push service.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://restro.example'

type Handler = (event: Record<string, unknown>) => void

function loadWorker(windows: readonly Record<string, unknown>[] = []) {
  const handlers = new Map<string, Handler>()
  const showNotification = vi.fn(async () => undefined)
  const openWindow = vi.fn(async () => ({}))
  const matchAll = vi.fn(async () => windows)
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
  }
  runInNewContext(SOURCE, { self, URL })
  return { handlers, showNotification, openWindow, matchAll }
}

/** Fires an event and waits for what it gave `waitUntil`. */
async function fire(worker: ReturnType<typeof loadWorker>, type: string, event: object) {
  let waited: Promise<unknown> = Promise.resolve()
  worker.handlers.get(type)?.({
    ...event,
    waitUntil: (work: Promise<unknown>) => {
      waited = work
    },
  })
  await waited
}

const push = (worker: ReturnType<typeof loadWorker>, json: () => unknown) =>
  fire(worker, 'push', { data: { json } })

async function tap(worker: ReturnType<typeof loadWorker>, url: unknown) {
  const close = vi.fn()
  await fire(worker, 'notificationclick', { notification: { close, data: { url } } })
  expect(close).toHaveBeenCalledOnce()
}

describe('the service worker', () => {
  it('has no fetch handler and caches nothing: guest pages behave as if it were not there', () => {
    const worker = loadWorker()
    expect(worker.handlers.has('fetch')).toBe(false)
    expect(SOURCE).not.toMatch(/\bcaches\./)
    expect(SOURCE).not.toMatch(/\bfetch\(/)
  })

  describe('on a push', () => {
    it('shows the title, body and tag, and buzzes again on a repeat with the same tag', async () => {
      const worker = loadWorker()
      await push(worker, () => ({
        title: 'Ordering is paused at Club Nova',
        body: 'Check the bill',
        tag: 'vn_1:venue_paused',
        url: '/venues/vn_1?tab=tonight&view=log',
      }))
      expect(worker.showNotification).toHaveBeenCalledOnce()
      const [title, options] = worker.showNotification.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ]
      expect(title).toBe('Ordering is paused at Club Nova')
      expect(options).toMatchObject({
        body: 'Check the bill',
        tag: 'vn_1:venue_paused',
        renotify: true,
      })
      expect(options.data).toEqual({ url: '/venues/vn_1?tab=tonight&view=log' })
    })

    it('still shows something for a push it cannot read, with a tag `renotify` needs', async () => {
      for (const json of [
        () => {
          throw new SyntaxError('not JSON')
        },
        () => ({ body: 'no title' }),
      ]) {
        const worker = loadWorker()
        await push(worker, json)
        const [title, options] = worker.showNotification.mock.calls[0] as unknown as [
          string,
          Record<string, unknown>,
        ]
        expect(title).toBe('Restro')
        expect(options.renotify).toBe(true)
        expect(options.tag).not.toBe('')
      }
    })

    it('gives a push with no tag one, since a browser refuses `renotify` without', async () => {
      const worker = loadWorker()
      await push(worker, () => ({ title: 'Alert', body: '', tag: '', url: '/venues' }))
      const options = worker.showNotification.mock.calls[0]?.[1 as never] as unknown as {
        tag: string
      }
      expect(options.tag).not.toBe('')
    })

    it('reads a push with no data at all', async () => {
      const worker = loadWorker()
      await fire(worker, 'push', { data: null })
      expect(worker.showNotification).toHaveBeenCalledOnce()
    })
  })

  describe('on a tap', () => {
    it('opens a path of this origin', async () => {
      const worker = loadWorker()
      await tap(worker, '/venues/vn_1?tab=tonight&view=log')
      expect(worker.openWindow).toHaveBeenCalledWith('/venues/vn_1?tab=tonight&view=log')
    })

    it('opens the panel, never a foreign address', async () => {
      for (const url of [
        'https://evil.example/phish',
        '//evil.example/phish',
        '/\\evil.example/phish',
        'javascript:alert(1)',
        'http://restro.example/venues',
        undefined,
        42,
      ]) {
        const worker = loadWorker()
        await tap(worker, url)
        expect(worker.openWindow, String(url)).toHaveBeenCalledWith('/venues')
      }
    })

    it('focuses a staff window already there, and looks at no guest tab', async () => {
      const focus = vi.fn(async () => ({}))
      const worker = loadWorker([{ url: `${ORIGIN}/venues/vn_1?tab=tonight&view=log`, focus }])
      await tap(worker, '/venues/vn_1?tab=tonight&view=log')
      expect(focus).toHaveBeenCalledOnce()
      expect(worker.openWindow).not.toHaveBeenCalled()
      // Without `includeUncontrolled`, only windows in the worker's scope, /venues/.
      expect(worker.matchAll).toHaveBeenCalledWith({ type: 'window' })
    })

    it('moves another staff window to the path, or opens one if it cannot move', async () => {
      const navigate = vi.fn(async () => ({}))
      const client = {
        url: `${ORIGIN}/venues/vn_1?tab=studio`,
        navigate,
        focus: async () => client,
      }
      const moved = loadWorker([client])
      await tap(moved, '/venues/vn_1?tab=tonight')
      expect(navigate).toHaveBeenCalledWith('/venues/vn_1?tab=tonight')
      expect(moved.openWindow).not.toHaveBeenCalled()

      const stuck = {
        url: `${ORIGIN}/venues/vn_1`,
        focus: async () => {
          throw new Error('not allowed')
        },
      }
      const opened = loadWorker([stuck])
      await tap(opened, '/venues/vn_2')
      expect(opened.openWindow).toHaveBeenCalledWith('/venues/vn_2')
    })
  })
})
