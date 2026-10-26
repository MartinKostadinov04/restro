// The Telegram Bot API as the alerts use it (#83; D122 §7): send a message (with a Done button),
// edit it to "Done by Maria, 02:14", answer a button press, and long-poll for presses. Plain
// `fetch`, no library. The bot token is a secret: it is in the request address, so no error here
// carries the address or the token, and nothing logs either.
//
// Long polling means no public endpoint (spec #64, 13): the worker asks Telegram for updates.

/** A message in a chat, to edit later. */
export interface MessageRef {
  readonly chatId: string
  readonly messageId: number
}

/** A press of the Done button, as Telegram reports it. */
export interface ButtonPress {
  readonly callbackId: string
  /** The Telegram user who pressed it. */
  readonly userId: string
  readonly chatId: string
  readonly messageId: number
  /** The text of the message the button is on. */
  readonly text: string
  /** The alert's id. */
  readonly data: string
}

/** One update; `press` is null for anything but a button press. */
export interface TelegramUpdate {
  readonly updateId: number
  readonly press: ButtonPress | null
}

/** What the alerts need of Telegram. The worker's tests replace it. */
export interface TelegramClient {
  /** Sends a message; `doneFor` puts a Done button on it that names the alert. */
  sendMessage(
    chatId: string,
    text: string,
    options?: { readonly doneFor?: string; readonly doneLabel?: string },
  ): Promise<MessageRef>
  /** Replaces the message's text and takes its button away. */
  editMessage(ref: MessageRef, text: string): Promise<void>
  /** Closes the spinner on a pressed button, with a short line shown to the person. */
  answerCallback(callbackId: string, text: string): Promise<void>
  /** Waits up to `timeoutSeconds` for button presses at or after `offset`. */
  getUpdates(options: {
    readonly offset: number
    readonly timeoutSeconds: number
    readonly signal?: AbortSignal
  }): Promise<TelegramUpdate[]>
}

/** Telegram refused, or could not be reached (`status` null). */
export class TelegramError extends Error {
  constructor(
    method: string,
    readonly status: number | null,
    description: string,
  ) {
    super(`Telegram ${method} failed: ${description}`)
    this.name = 'TelegramError'
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface Options {
  readonly token: string
  /** Replaced in tests. */
  readonly fetch?: Fetch
  /**
   * How long a call may wait for Telegram, in milliseconds (a long poll gets its own seconds on
   * top). Without a limit one hanging connection holds the worker's serial delivery pass. Short in
   * tests.
   */
  readonly timeoutMs?: number
}

const API = 'https://api.telegram.org'

/** How long Telegram gets to answer before the call is given up (R11). */
const CALL_TIMEOUT_MS = 10_000

/** The Bot API client for one bot. */
export function createTelegramClient(options: Options): TelegramClient {
  const fetchImpl: Fetch = options.fetch ?? fetch
  const limitMs = options.timeoutMs ?? CALL_TIMEOUT_MS

  async function call(
    method: string,
    body: Record<string, unknown>,
    { signal, waitMs = 0 }: { signal?: AbortSignal; waitMs?: number } = {},
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(waitMs + limitMs)
    const combined = AbortSignal.any([timeout, ...(signal ? [signal] : [])])
    // The caller's stop is told apart from our timeout: a stop is rethrown as it came.
    const failure = (error: unknown): unknown => {
      if (signal?.aborted === true) return error
      // The network error's own text can carry the address, which holds the token.
      return timeout.aborted
        ? new TelegramError(method, null, 'Telegram did not answer in time')
        : new TelegramError(method, null, 'could not reach Telegram')
    }
    let response: Response
    try {
      response = await fetchImpl(`${API}/bot${options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      throw failure(error)
    }
    let payload: { ok?: boolean; result?: unknown; description?: unknown } = {}
    try {
      payload = (await response.json()) as typeof payload
    } catch (error) {
      // A body that is not JSON is reported by the status below; one that never came, or was
      // stopped, is not.
      if (signal?.aborted === true || timeout.aborted) throw failure(error)
    }
    if (!response.ok || payload.ok !== true) {
      const description =
        typeof payload.description === 'string' ? payload.description : `status ${response.status}`
      throw new TelegramError(method, response.status, description)
    }
    return payload.result
  }

  return {
    async sendMessage(chatId, text, extra = {}) {
      const result = (await call('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(extra.doneFor === undefined
          ? {}
          : {
              reply_markup: {
                inline_keyboard: [
                  [{ text: extra.doneLabel ?? 'Done', callback_data: extra.doneFor }],
                ],
              },
            }),
      })) as { message_id: number; chat: { id: number } }
      return { chatId: String(result.chat.id), messageId: result.message_id }
    },

    async editMessage(ref, text) {
      await call('editMessageText', {
        chat_id: ref.chatId,
        message_id: ref.messageId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      })
    },

    async answerCallback(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, text })
    },

    async getUpdates({ offset, timeoutSeconds, signal }) {
      const result = (await call(
        'getUpdates',
        { offset, timeout: timeoutSeconds, allowed_updates: ['callback_query'] },
        { ...(signal === undefined ? {} : { signal }), waitMs: timeoutSeconds * 1000 },
      )) as {
        update_id: number
        callback_query?: {
          id: string
          from: { id: number }
          message?: { message_id: number; text?: string; chat: { id: number } }
          data?: string
        }
      }[]
      return result.map((update) => {
        const query = update.callback_query
        const press: ButtonPress | null =
          query?.message !== undefined && query.data !== undefined
            ? {
                callbackId: query.id,
                userId: String(query.from.id),
                chatId: String(query.message.chat.id),
                messageId: query.message.message_id,
                text: query.message.text ?? '',
                data: query.data,
              }
            : null
        return { updateId: update.update_id, press }
      })
    },
  }
}
