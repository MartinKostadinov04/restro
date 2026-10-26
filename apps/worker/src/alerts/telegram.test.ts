import { describe, expect, it } from 'vitest'

import { createTelegramClient, TelegramError } from './telegram'

const TOKEN = `123456789:${'T'.repeat(35)}`

interface Call {
  readonly url: string
  readonly body: Record<string, unknown>
  readonly signal: AbortSignal | undefined
}

/** A fetch that answers each call with the next reply and remembers what it was asked. */
function fakeFetch(replies: readonly { status?: number; json: unknown }[]) {
  const calls: Call[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    })
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] as {
      status?: number
      json: unknown
    }
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

describe('the Telegram client', () => {
  it('sends a message with the Done button and returns where it went', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { json: { ok: true, result: { message_id: 42, chat: { id: -100123 } } } },
    ])
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl })
    const sent = await client.sendMessage('-100123', 'Table 7: an order couldn’t be confirmed', {
      doneFor: 'al_abc',
    })
    expect(sent).toEqual({ chatId: '-100123', messageId: 42 })
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(calls[0]?.body).toEqual({
      chat_id: '-100123',
      text: 'Table 7: an order couldn’t be confirmed',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Done', callback_data: 'al_abc' }]] },
    })
  })

  it('puts the venue’s own word on the button', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { json: { ok: true, result: { message_id: 7, chat: { id: -5 } } } },
    ])
    await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).sendMessage('-5', 'x', {
      doneFor: 'al_abc',
      doneLabel: 'Готово',
    })
    expect(calls[0]?.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Готово', callback_data: 'al_abc' }]],
    })
  })

  it('sends a plain message without a button', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { json: { ok: true, result: { message_id: 7, chat: { id: -5 } } } },
    ])
    await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).sendMessage('-5', 'hello')
    expect(calls[0]?.body).not.toHaveProperty('reply_markup')
  })

  it('edits a message and takes its button away', async () => {
    const { calls, fetchImpl } = fakeFetch([{ json: { ok: true, result: true } }])
    await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).editMessage(
      { chatId: '-100123', messageId: 42 },
      'Done by Maria, 02:14',
    )
    expect(calls[0]?.url).toMatch(/\/editMessageText$/)
    expect(calls[0]?.body).toEqual({
      chat_id: '-100123',
      message_id: 42,
      text: 'Done by Maria, 02:14',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    })
  })

  it('answers a button press', async () => {
    const { calls, fetchImpl } = fakeFetch([{ json: { ok: true, result: true } }])
    await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).answerCallback('cb1', 'Done')
    expect(calls[0]?.url).toMatch(/\/answerCallbackQuery$/)
    expect(calls[0]?.body).toEqual({ callback_query_id: 'cb1', text: 'Done' })
  })

  it('long-polls for button presses from the offset, and reads them', async () => {
    const { calls, fetchImpl } = fakeFetch([
      {
        json: {
          ok: true,
          result: [
            {
              update_id: 10,
              callback_query: {
                id: 'cb1',
                from: { id: 555, first_name: 'Maria' },
                message: { message_id: 42, text: 'Table 7', chat: { id: -100123 } },
                data: 'al_abc',
              },
            },
            { update_id: 11, message: { text: 'chatter' } },
          ],
        },
      },
    ])
    const updates = await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).getUpdates({
      offset: 10,
      timeoutSeconds: 25,
    })
    expect(calls[0]?.body).toEqual({
      offset: 10,
      timeout: 25,
      allowed_updates: ['callback_query'],
    })
    expect(updates).toEqual([
      {
        updateId: 10,
        press: {
          callbackId: 'cb1',
          userId: '555',
          chatId: '-100123',
          messageId: 42,
          text: 'Table 7',
          data: 'al_abc',
        },
      },
      { updateId: 11, press: null },
    ])
  })

  it('fails with the method and Telegram’s words, never the token', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 400,
        json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
      },
    ])
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl })
    const failure = await client.sendMessage('-1', 'x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramError)
    expect((failure as TelegramError).status).toBe(400)
    expect((failure as Error).message).toBe(
      'Telegram sendMessage failed: Bad Request: chat not found',
    )
    expect(String((failure as Error).stack)).not.toContain(TOKEN)
  })

  it('does not put the token in the error when the network fails', async () => {
    const client = createTelegramClient({
      token: TOKEN,
      fetch: async () => {
        throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`)
      },
    })
    const failure = await client.sendMessage('-1', 'x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramError)
    expect(String((failure as Error).message)).not.toContain(TOKEN)
    expect((failure as TelegramError).status).toBeNull()
  })

  it('passes the abort signal on, so the worker can stop a long poll', async () => {
    const { calls, fetchImpl } = fakeFetch([{ json: { ok: true, result: [] } }])
    const controller = new AbortController()
    await createTelegramClient({ token: TOKEN, fetch: fetchImpl }).getUpdates({
      offset: 0,
      timeoutSeconds: 25,
      signal: controller.signal,
    })
    expect(calls[0]?.signal).toBeDefined()
  })
})
