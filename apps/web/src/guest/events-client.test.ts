// The guest page's events client (D142, #335), driven without a page: its fetch, clock and wait are
// the test's. Events wait a moment and go together, the age is worked out when the batch leaves,
// a batch over the wire cap is split, a fact the model would refuse is dropped instead of taking
// its batch with it, a refused batch is dropped and a request that never landed is kept.
import { newId } from '@restro/core'
import { GUEST_EVENT_REPORT_MAX } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { createEventsReporter, EVENTS_QUEUE_MAX, type GuestEventFact } from './events-client'

const CODE = 'code-of-the-table'

interface Call {
  readonly url: string
  readonly auth: string | undefined
  readonly events: readonly { readonly kind: string; readonly ageMs: number }[]
}

/** A fetch whose answers the test chooses, keeping what each call carried. */
function harness(answers: readonly number[] = []) {
  const calls: Call[] = []
  let at = 1_000
  const statuses = [...answers]
  const reporter = createEventsReporter({
    code: CODE,
    now: () => at,
    waitMs: 10,
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({
        url: String(url),
        auth: headers.Authorization,
        events: JSON.parse(String(init?.body)).events,
      })
      const status = statuses.shift() ?? 200
      return new Response(null, { status })
    },
  })
  return {
    reporter,
    calls,
    tick: (ms: number) => {
      at += ms
    },
  }
}

describe('the events client', () => {
  it('sends what is queued, as one batch, with the table’s code', async () => {
    const { reporter, calls, tick } = harness()
    reporter.report({ kind: 'menu.opened' })
    tick(250)
    reporter.report({ kind: 'language.chosen', locale: 'en_US' })
    await reporter.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/guest/events')
    expect(calls[0]?.auth).toBe(`Table ${CODE}`)
    expect(calls[0]?.events).toEqual([
      { kind: 'menu.opened', ageMs: 250 },
      { kind: 'language.chosen', locale: 'en_US', ageMs: 0 },
    ])
  })

  it('sends nothing when nothing happened', async () => {
    const { reporter, calls } = harness()
    await reporter.flush()
    expect(calls).toEqual([])
  })

  it('splits a queue over the wire cap into batches', async () => {
    const { reporter, calls } = harness()
    for (let n = 0; n < GUEST_EVENT_REPORT_MAX + 3; n += 1) reporter.report({ kind: 'menu.opened' })
    await reporter.flush()
    expect(calls).toHaveLength(2)
    expect(calls[0]?.events).toHaveLength(GUEST_EVENT_REPORT_MAX)
    expect(calls[1]?.events).toHaveLength(3)
  })

  it('drops a fact the model would refuse and keeps the rest of its batch', async () => {
    const { reporter, calls } = harness()
    const itemId = newId('nd')
    reporter.report({ kind: 'item.opened', itemId: 'Negroni' } as GuestEventFact)
    reporter.report({ kind: 'item.opened', itemId })
    await reporter.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.events).toEqual([{ kind: 'item.opened', itemId, ageMs: 0 }])
  })

  it('drops a batch the server refused, and keeps one whose request never landed', async () => {
    const refused = harness([400])
    refused.reporter.report({ kind: 'menu.opened' })
    await refused.reporter.flush()
    await refused.reporter.flush()
    expect(refused.calls).toHaveLength(1)

    const failed = harness([503])
    failed.reporter.report({ kind: 'menu.opened' })
    await failed.reporter.flush()
    expect(failed.calls).toHaveLength(1)
    await failed.reporter.flush()
    expect(failed.calls).toHaveLength(2)
    expect(failed.calls[1]?.events).toEqual([{ kind: 'menu.opened', ageMs: 0 }])
  })

  it('keeps at most a capped queue, oldest out', async () => {
    const { reporter, calls } = harness()
    for (let n = 0; n < EVENTS_QUEUE_MAX + 20; n += 1) reporter.report({ kind: 'menu.opened' })
    await reporter.flush()
    const sent = calls.reduce((all, call) => all + call.events.length, 0)
    expect(sent).toBe(EVENTS_QUEUE_MAX)
  })

  it('stops waiting when the page is done with it', async () => {
    const { reporter, calls } = harness()
    reporter.report({ kind: 'menu.opened' })
    reporter.stop()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([])
  })
})
