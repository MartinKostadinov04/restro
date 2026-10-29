// Turnstile on the guest page (D119, D121; tickets #76, #114): a token for an on-the-bill Send or a
// Pay, nothing else. The script loads only at the first Send, from Cloudflare's address, and each Send runs a
// fresh widget (a token works once) and removes it after. Invisible mode is the widget's setting
// in Cloudflare's dashboard; `interaction-only` shows the widget only if Cloudflare must ask.
// Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** How long a Send waits for a token before it goes without one (and the server refuses it). */
const TOKEN_TIMEOUT_MS = 15_000

/** The part of Cloudflare's `window.turnstile` the page uses. */
interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined
  execute(widgetId: string): void
  remove(widgetId: string): void
}

let loading: Promise<TurnstileApi | null> | null = null

function load(): Promise<TurnstileApi | null> {
  const ready = (window as { turnstile?: TurnstileApi }).turnstile
  if (ready !== undefined) return Promise.resolve(ready)
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.onload = () => resolve((window as { turnstile?: TurnstileApi }).turnstile ?? null)
    script.onerror = () => {
      loading = null
      resolve(null)
    }
    document.head.appendChild(script)
  })
  return loading
}

/** A token getter for the services client, or undefined without a site key (Sends then fail). */
export function turnstileTokens(
  siteKey: string | undefined,
): ((action: string) => Promise<string | null>) | undefined {
  if (siteKey === undefined || siteKey === '') return undefined
  return async (action) => {
    const api = await load()
    if (api === null) return null
    const container = document.createElement('div')
    document.body.appendChild(container)
    return new Promise<string | null>((resolve) => {
      let widgetId: string | undefined
      const finish = (token: string | null) => {
        clearTimeout(timer)
        if (widgetId !== undefined) api.remove(widgetId)
        container.remove()
        resolve(token)
      }
      const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS)
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        execution: 'execute',
        appearance: 'interaction-only',
        'feedback-enabled': false,
        callback: (token: string) => finish(token),
        'error-callback': () => finish(null),
        'timeout-callback': () => finish(null),
      })
      if (widgetId === undefined) finish(null)
      else api.execute(widgetId)
    })
  }
}
