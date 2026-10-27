import { describe, expect, it } from 'vitest'

import type { TelegramClient, TelegramUpdate } from './telegram'
import { TelegramError } from './telegram'
import { makeLinkCode } from './telegram-link'
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
    async getMe() {
      return { username: 'restro_bot' }
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

  it('hears /start CODE and the bot leaving a group (#87): a link that is not ours is answered in a private chat, silently in a group', async () => {
    const said: { chatId: string; text: string }[] = []
    const { client, offsets } = scripted([
      [
        {
          updateId: 1,
          press: null,
          start: {
            userId: '4242',
            chatId: '4242',
            chatType: 'private',
            title: '',
            code: 'A'.repeat(62),
          },
        },
        {
          updateId: 2,
          press: null,
          start: {
            userId: '4242',
            chatId: '-100',
            chatType: 'supergroup',
            title: 'Staff',
            code: 'A'.repeat(62),
          },
        },
      ],
    ])
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: {
        ...client,
        async sendMessage(chatId, text) {
          said.push({ chatId, text })
          return { chatId, messageId: 1 }
        },
      },
      log: quiet,
      now: () => new Date(),
      linkSecret: 'a-reveal-token-of-at-least-32-characters',
    })
    await waitUntil(() => offsets.length >= 2)
    expect(said).toEqual([
      { chatId: '4242', text: 'This link ran out. Ask for a new one in Restro.' },
    ])
    await poller.stop()
  })

  it('ignores /start CODE when linking is off (no secret)', async () => {
    const said: string[] = []
    const { client, offsets } = scripted([
      [
        {
          updateId: 1,
          press: null,
          start: {
            userId: '4242',
            chatId: '4242',
            chatType: 'private',
            title: '',
            code: makeLinkCode('a-reveal-token-of-at-least-32-characters', {
              purpose: 'group',
              venueId: 'vn_0000000000000000000001',
              now: new Date(),
            }),
          },
        },
      ],
    ])
    const poller = startTelegramPoller({
      pool: {} as never,
      telegram: {
        ...client,
        async sendMessage(_chatId, text) {
          said.push(text)
          return { chatId: '1', messageId: 1 }
        },
      },
      log: quiet,
      now: () => new Date(),
    })
    await waitUntil(() => offsets.length >= 2)
    expect(said).toEqual([])
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
