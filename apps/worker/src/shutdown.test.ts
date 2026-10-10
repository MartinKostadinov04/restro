import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from './logger'
import { FORCE_EXIT_AFTER_MS, installShutdownHandlers, SHUTDOWN_SIGNALS } from './shutdown'

async function setup(stop: () => Promise<void>) {
  const signals = new EventEmitter()
  const calls = { stop: vi.fn(stop), exitCode: [] as number[], forceExit: [] as number[] }
  const log = await createLogger({ level: 'silent', pretty: false })
  const uninstall = installShutdownHandlers({
    worker: { stop: calls.stop },
    log,
    signals,
    setExitCode: (code) => calls.exitCode.push(code),
    forceExit: (code) => calls.forceExit.push(code),
  })
  return { signals, calls, uninstall }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('installShutdownHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles SIGINT and SIGTERM', () => {
    expect([...SHUTDOWN_SIGNALS]).toEqual(['SIGINT', 'SIGTERM'])
  })

  it.each(['SIGINT', 'SIGTERM'])(
    '%s stops the worker once and ends with exit code 0',
    async (signal) => {
      const { signals, calls } = await setup(async () => undefined)
      signals.emit(signal, signal)
      await settle()
      expect(calls.stop).toHaveBeenCalledTimes(1)
      expect(calls.exitCode).toEqual([0])
      expect(calls.forceExit).toEqual([])
    },
  )

  it('a second signal while stopping exits at once with code 1, and stops only once', async () => {
    const { signals, calls } = await setup(() => new Promise<void>(() => undefined))
    signals.emit('SIGTERM', 'SIGTERM')
    signals.emit('SIGINT', 'SIGINT')
    expect(calls.stop).toHaveBeenCalledTimes(1)
    expect(calls.forceExit).toEqual([1])
    expect(calls.exitCode).toEqual([])
  })

  it('exits with code 1 when stopping fails', async () => {
    const { signals, calls } = await setup(() => Promise.reject(new Error('close failed')))
    signals.emit('SIGTERM', 'SIGTERM')
    await settle()
    expect(calls.forceExit).toEqual([1])
    expect(calls.exitCode).toEqual([])
  })

  it('forces exit code 1 when stopping takes longer than the limit', async () => {
    const { signals, calls } = await setup(() => new Promise<void>(() => undefined))
    signals.emit('SIGTERM', 'SIGTERM')
    vi.advanceTimersByTime(FORCE_EXIT_AFTER_MS - 1)
    expect(calls.forceExit).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls.forceExit).toEqual([1])
  })

  it('keeps the watchdog armed after a clean stop, in case something keeps the process alive', async () => {
    const { signals, calls } = await setup(async () => undefined)
    signals.emit('SIGTERM', 'SIGTERM')
    await settle()
    expect(calls.exitCode).toEqual([0])
    vi.advanceTimersByTime(FORCE_EXIT_AFTER_MS)
    expect(calls.forceExit).toEqual([1])
  })

  it('removes its listeners when uninstalled', async () => {
    const { signals, uninstall } = await setup(async () => undefined)
    expect(signals.listenerCount('SIGTERM')).toBe(1)
    uninstall()
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })
})
