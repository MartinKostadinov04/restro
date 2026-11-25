// What the guest's own phone did, on its way to `POST /api/guest/events` (D142, #335): the menu
// opened, an item opened, a language chosen. Nothing else about the phone goes with it — no phone
// value, no device, no text a guest typed; the table's code says where an event belongs and the
// server stamps the venue, the table and the service day itself.
//
// The queue waits a moment for more events before it sends, so a guest who opens three dishes in a
// row costs one request. Every event is checked against the wire schema as it goes out, so one
// malformed fact (an item id from a crafted address) is dropped instead of taking its batch with
// it. A refused batch is this page's own mistake and is dropped; only a request that never landed
// is kept for the next flush, and the queue is capped, oldest out. Measuring a night is never worth
// a retry storm or a growing page.

import {
  GUEST_EVENT_REPORT_MAX,
  type GuestEventReport,
  GuestEventReportSchema,
  TABLE_AUTH_SCHEME,
} from '@restro/shell'

/** `Omit` over each member of a union, not over the union collapsed into one object. */
type EachWithout<T, K extends string> = T extends unknown ? Omit<T, K> : never

/** One event as the page reports it: the wire shape without the age, which this client works out. */
export type GuestEventFact = EachWithout<GuestEventReport, 'ageMs'>

/** How long the queue waits for more events before it sends. */
const WAIT_MS = 1_500

/** How many events a page keeps when sending fails; the oldest go first. */
export const EVENTS_QUEUE_MAX = 60

export interface EventsReporterDeps {
  /** The table's code, sent in `Authorization: Table <code>`. */
  readonly code: string
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number
  /** Same origin by default; a test gives its own. */
  readonly base?: string
  readonly waitMs?: number
}

export interface EventsReporter {
  /** Queues one event; it goes out with the next flush. */
  report(fact: GuestEventFact): void
  /** Sends what is queued now (the page hiding, or the wait running out). */
  flush(): Promise<void>
  /** Drops the pending wait; what is queued stays queued. */
  stop(): void
}

export function createEventsReporter(deps: EventsReporterDeps): EventsReporter {
  const base = deps.base ?? ''
  const wait = deps.waitMs ?? WAIT_MS
  let queue: readonly { readonly fact: GuestEventFact; readonly at: number }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let sending: Promise<void> | null = null

  function keep(batch: readonly { readonly fact: GuestEventFact; readonly at: number }[]): void {
    queue = [...batch, ...queue].slice(-EVENTS_QUEUE_MAX)
  }

  async function send(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.slice(0, GUEST_EVENT_REPORT_MAX)
      queue = queue.slice(batch.length)
      const at = deps.now()
      const events = batch.flatMap((one) => {
        const parsed = GuestEventReportSchema.safeParse({
          ...one.fact,
          ageMs: Math.max(0, at - one.at),
        })
        return parsed.success ? [parsed.data] : []
      })
      if (events.length === 0) continue
      try {
        const response = await deps.fetch(`${base}/api/guest/events`, {
          method: 'POST',
          headers: {
            Authorization: `${TABLE_AUTH_SCHEME} ${deps.code}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ events }),
          // The page may be going away: let the request outlive it.
          keepalive: true,
        })
        // A refused batch (a retired code, a body this page got wrong) is dropped; the server's own
        // trouble keeps it for the next flush.
        if (!response.ok && response.status >= 500) {
          keep(batch)
          return
        }
      } catch {
        keep(batch)
        return
      }
    }
  }

  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    sending ??= send().finally(() => {
      sending = null
    })
    return sending
  }

  return {
    report(fact) {
      queue = [...queue, { fact, at: deps.now() }].slice(-EVENTS_QUEUE_MAX)
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          void flush()
        }, wait)
      }
    },
    flush,
    stop() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
