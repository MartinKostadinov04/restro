import { describe, expect, it } from 'vitest'

import type { TelegramClient, TelegramUpdate } from './telegram'
import { TelegramError } from './telegram'
import { startTelegramPoller } from './telegram-poller'

const quiet = { warn: () => undefined, info: () => undefined }
/** A client whose polls are answered one at a time by the script; the last one waits to be aborted. */
function scripted(script: (Error | TelegramUpdate[])[]) {
  const offsets: number[] = []
  const client: TelegramClient = {
    async sendMessage() {
      throw new Error('not used')
    },
    async editMessage() {},
    async answerCallback() {},
    async getUpdates({ offset, signal }) {
      offsets.push(offset)
      const next = script.shift()
      if (next instanceof Error) throw next
      if (next !== undefined) return next
      return new Promise<TelegramUpdate[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
  }
  return { client, offsets }
}

const waitUntil = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5))
  expect(condition()).toBe(true)
}

describe('the Telegram poller', () => {
  it('asks again from the update after the last one it handled', async () => {
    const { client, offsets } = scripted([
      [
        { updateId: 7, press: null },
        { updateId: 8, press: null },
      ],
    ])
    // Neither update is a button press, so the handler is not reached and the database is not used.
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: client,
      log: quiet,
      now: () => new Date(),
    })
    await waitUntil(() => offsets.length >= 2)
    expect(offsets.slice(0, 2)).toEqual([0, 9])
    await poller.stop()
  })

  it('waits and tries again when Telegram fails, longer when another process holds the bot', async () => {
    const waits: number[] = []
    const { client, offsets } = scripted([
      new TelegramError('getUpdates', 502, 'bad gateway'),
      new TelegramError('getUpdates', 409, 'Conflict: terminated by other getUpdates request'),
    ])
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: client,
      log: quiet,
      now: () => new Date(),
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await waitUntil(() => offsets.length >= 3)
    expect(waits).toEqual([4_000, 30_000])
    await poller.stop()
  })

  it('stops when told, even in the middle of a poll', async () => {
    const { client, offsets } = scripted([])
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: client,
      log: quiet,
      now: () => new Date(),
    })
    await waitUntil(() => offsets.length === 1)
    await poller.stop()
    expect(offsets).toHaveLength(1)
  })
})
