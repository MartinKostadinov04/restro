import { describe, expect, it } from 'vitest'

import type { ButtonPress, TelegramClient, TelegramUpdate } from './telegram'
import { TelegramError } from './telegram'
import { startTelegramPoller } from './telegram-poller'

const quiet = { warn: () => undefined, info: () => undefined }
const NOT_A_BUTTON: ButtonPress = {
  callbackId: 'cb',
  userId: '1',
  chatId: '-1',
  messageId: 1,
  text: '',
  data: 'nope',
}

/** A client whose polls are answered one at a time by the script; the last one waits to be aborted. */
function scripted(script: (Error | TelegramUpdate[])[]) {
  const offsets: number[] = []
  const answered: string[] = []
  const client: TelegramClient = {
    async sendMessage() {
      throw new Error('not used')
    },
    async editMessage() {},
    async answerCallback(_id, text) {
      answered.push(text)
    },
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
  return { client, offsets, answered }
}

const waitUntil = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5))
  expect(condition()).toBe(true)
}

describe('the Telegram poller', () => {
  it('asks again from the update after the last one it handled', async () => {
    const { client, offsets, answered } = scripted([
      [
        { updateId: 7, press: NOT_A_BUTTON },
        { updateId: 8, press: null },
      ],
    ])
    // The press names no alert, so the handler answers without touching the database.
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: client,
      log: quiet,
      now: () => new Date(),
    })
    await waitUntil(() => offsets.length >= 2)
    expect(offsets.slice(0, 2)).toEqual([0, 9])
    expect(answered).toEqual(['That button is not for an alert.'])
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
