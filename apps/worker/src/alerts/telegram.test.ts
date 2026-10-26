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

/** A fetch that never answers: it settles only when its signal aborts, as a hung connection does. */
function hangingFetch() {
  const signals: AbortSignal[] = []
  const fetchImpl = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) return
      signals.push(signal)
      const stop = () => reject(signal.reason)
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    })
  return { signals, fetchImpl }
}

describe('the Telegram client’s time limit', () => {
  const answeredNothing = 'Telegram sendMessage failed: Telegram did not answer in time'

  it('gives up on a call Telegram never answers, without the address or the token', async () => {
    const { fetchImpl } = hangingFetch()
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl, timeoutMs: 20 })
    const failure = await client.sendMessage('-1', 'x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramError)
    expect((failure as TelegramError).status).toBeNull()
    expect((failure as Error).message).toBe(answeredNothing)
    expect(String((failure as Error).stack)).not.toContain(TOKEN)
  })

  it('limits every call, not only the long poll', async () => {
    for (const run of [
      (client: ReturnType<typeof createTelegramClient>) =>
        client.editMessage({ chatId: '-1', messageId: 1 }, 'x'),
      (client: ReturnType<typeof createTelegramClient>) => client.answerCallback('cb', 'x'),
    ]) {
      const { fetchImpl } = hangingFetch()
      const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl, timeoutMs: 20 })
      const failure = await run(client).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(TelegramError)
      expect((failure as TelegramError).status).toBeNull()
    }
  })

  it('gives up when Telegram answers but the body never arrives', async () => {
    const client = createTelegramClient({
      token: TOKEN,
      timeoutMs: 20,
      fetch: async (_input, init) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
                once: true,
              })
            }),
        }) as unknown as Response,
    })
    const failure = await client.sendMessage('-1', 'x').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramError)
    expect((failure as Error).message).toBe(answeredNothing)
  })

  it('gives the long poll its own seconds plus the limit', async () => {
    const { signals, fetchImpl } = hangingFetch()
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl, timeoutMs: 60 })
    const started = Date.now()
    const failure = await client
      .getUpdates({ offset: 0, timeoutSeconds: 0.1 })
      .catch((error: unknown) => error)
    expect(signals).toHaveLength(1)
    expect(failure).toBeInstanceOf(TelegramError)
    expect((failure as Error).message).toBe(
      'Telegram getUpdates failed: Telegram did not answer in time',
    )
    // 0.1 s of polling + 60 ms: not the 60 ms of a plain call.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
  })

  it('tells the caller’s stop from a timeout: a stop is rethrown as it is', async () => {
    const { fetchImpl } = hangingFetch()
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl, timeoutMs: 5_000 })
    const controller = new AbortController()
    const pending = client
      .getUpdates({ offset: 0, timeoutSeconds: 25, signal: controller.signal })
      .catch((error: unknown) => error)
    controller.abort()
    const failure = await pending
    expect(failure).not.toBeInstanceOf(TelegramError)
    expect((failure as Error).name).toBe('AbortError')
  })

  it('does not time out a call that answers in time', async () => {
    const { fetchImpl } = fakeFetch([
      { json: { ok: true, result: { message_id: 1, chat: { id: -1 } } } },
    ])
    const client = createTelegramClient({ token: TOKEN, fetch: fetchImpl, timeoutMs: 20 })
    await expect(client.sendMessage('-1', 'x')).resolves.toEqual({ chatId: '-1', messageId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
})
