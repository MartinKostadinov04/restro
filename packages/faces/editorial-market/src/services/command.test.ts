import { type CommandResult, type GuestCommand, GuestCommandSchema } from '@restro/shell'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { newActionId, runCommand, SERVICE_TIMEOUT_MS } from './command'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const command = (actionId = newActionId()): GuestCommand => ({
  kind: 'service.request',
  actionId,
  request: 'waiter',
  note: '',
})
const answer = (to: GuestCommand, status: CommandResult['status'] = 'accepted'): CommandResult => ({
  actionId: to.actionId,
  status,
  message: null,
  ref: null,
})

describe('newActionId', () => {
  it('is a version 4 uuid, and a different one every time', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newActionId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })

  it('is accepted by the schema of a command', () => {
    expect(GuestCommandSchema.safeParse(command()).success).toBe(true)
  })

  it('still makes one on a page where randomUUID does not exist (an insecure page)', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes) })
    expect(typeof (globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBe('undefined')
    const ids = new Set(Array.from({ length: 200 }, () => newActionId()))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id).toMatch(UUID_V4)
      expect(GuestCommandSchema.safeParse({ ...command(), actionId: id }).success).toBe(true)
    }
  })
})

describe('runCommand (it never throws)', () => {
  it("returns the host's answer to the command", async () => {
    const sent = command()
    const outcome = await runCommand(async (c) => answer(c, 'rejected'), sent)
    expect(outcome).toEqual({ ok: true, result: answer(sent, 'rejected') })
  })

  it('returns "no usable answer" when the host rejects, throws at once or returns nothing', async () => {
    expect(await runCommand(() => Promise.reject(new Error('down')), command())).toEqual({
      ok: false,
    })
    expect(
      await runCommand(() => {
        throw new Error('threw before it returned a promise')
      }, command()),
    ).toEqual({ ok: false })
    expect(await runCommand((() => Promise.resolve(undefined)) as never, command())).toEqual({
      ok: false,
    })
    expect(await runCommand((() => Promise.resolve(null)) as never, command())).toEqual({
      ok: false,
    })
  })

  it('refuses an answer to another command, or one with a status it does not know', async () => {
    const sent = command()
    expect(await runCommand(async () => answer(command()), sent)).toEqual({ ok: false })
    expect(
      await runCommand(
        (async (c: GuestCommand) => ({ ...answer(c), status: 'done' })) as never,
        sent,
      ),
    ).toEqual({ ok: false })
    expect(await runCommand((async () => 'accepted') as never, sent)).toEqual({ ok: false })
  })

  it('gives up after the timeout, and ignores an answer that comes later', async () => {
    vi.useFakeTimers()
    const sent = command()
    let late: (result: CommandResult) => void = () => {}
    const pending = runCommand(
      () =>
        new Promise<CommandResult>((resolve) => {
          late = resolve
        }),
      sent,
    )
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await pending).toEqual({ ok: false })
    late(answer(sent)) // too late; nothing happens, and nothing is left unhandled
    await vi.advanceTimersByTimeAsync(0)
  })

  it('takes a shorter timeout when it is given one, and leaves no timer behind after an answer', async () => {
    vi.useFakeTimers()
    const sent = command()
    const quick = runCommand(() => new Promise<CommandResult>(() => {}), sent, 50)
    await vi.advanceTimersByTimeAsync(60)
    expect(await quick).toEqual({ ok: false })

    expect(await runCommand(async (c) => answer(c), command())).toMatchObject({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not report an error that came after the timeout as unhandled', async () => {
    vi.useFakeTimers()
    let fail: (error: Error) => void = () => {}
    const pending = runCommand(
      () =>
        new Promise<CommandResult>((_, reject) => {
          fail = reject
        }),
      command(),
      10,
    )
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toEqual({ ok: false })
    fail(new Error('too late'))
    await vi.advanceTimersByTimeAsync(0)
  })
})
