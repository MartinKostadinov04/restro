// The Log's sentences (#86; plan `2026-10-27-tonight-log-plan.md` §5, §8): a test fails when a kind
// of `LOG_KINDS` has none, `lease.taken_over` never shows, every string a sentence uses exists in
// both languages with the same parameters, and the plan's sentences read as written.
import { describe, expect, it } from 'vitest'

import type { LogLineView } from '@/server/tonight/night-view'

import bg from '../../messages/bg.json'
import en from '../../messages/en.json'
import { logSentence, type Say, SENTENCES, type SentenceContext } from './log-sentence'

const messages = {
  bg: bg.tonight as unknown as Record<string, string>,
  en: en.tonight as unknown as Record<string, string>,
}

/** Fills `{name}` and the one plural of `so_items`; enough for the sentences. */
function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

function context(locale: 'bg' | 'en', used: Set<string>): SentenceContext {
  const say: Say = (key, values) => {
    used.add(key)
    const template = messages[locale][key]
    if (template === undefined) throw new Error(`no ${locale} string "${key}"`)
    return fill(template, values)
  }
  return {
    say,
    table: (line) => (line.table === null ? say('lg_no_table') : say('tb', { n: line.table })),
    who: (by) =>
      by.who.kind === 'person' ? by.who.name : by.who.kind === 'guest' ? 'guest' : 'Restro',
    money: (minor) => `€${(minor / 100).toFixed(2)}`,
    source: 'Mistral',
    paymentStates: {},
  }
}

const line = (kind: LogLineView['kind'], fields: Partial<LogLineView> = {}): LogLineView => ({
  seq: 1,
  time: '01:30',
  kind,
  table: '7',
  numbered: true,
  sentOrderId: null,
  reference: null,
  state: null,
  reason: null,
  answer: null,
  by: { who: { kind: 'person', name: 'Maria' }, telegram: false },
  scope: null,
  cause: null,
  alertTitle: null,
  guard: null,
  setting: 'setting',
  subject: null,
  amountMinor: null,
  paymentState: null,
  paymentAnswer: null,
  paymentId: null,
  sentOrdersOfDay: null,
  callKinds: [],
  ...fields,
})

const SHOWN = (Object.keys(SENTENCES) as LogLineView['kind'][]).filter(
  (kind) => kind !== 'lease.taken_over',
)

describe("the Log's sentences", () => {
  // That the table covers every kind of `LOG_KINDS` is pinned in the server's tests
  // (server/tonight/log-kinds.test.ts), which may import core's service entry.
  it('has one for every shown kind, and the lease alone has none', () => {
    expect(SENTENCES['lease.taken_over']).toBeNull()
    for (const kind of SHOWN) {
      expect(SENTENCES[kind], kind).toBeTypeOf('function')
    }
  })

  it('never shows a lease taken over', () => {
    expect(logSentence(line('lease.taken_over'), context('en', new Set()))).toBeNull()
  })

  for (const locale of ['en', 'bg'] as const) {
    it(`words every shown kind in ${locale}, with no raw code and no "something happened"`, () => {
      for (const kind of SHOWN) {
        const text = logSentence(
          line(kind, { reference: 'K7Q', alertTitle: 'Alert title' }),
          context(locale, new Set()),
        )
        expect(text, kind).toBeTruthy()
        expect(text, kind).not.toMatch(/\{\w+\}/)
        expect(text, kind).not.toContain(kind)
        expect(text, kind).not.toMatch(/[a-z]+\.[a-z_]+/)
      }
    })
  }

  it('uses only strings that exist in both languages with the same parameters', () => {
    const used = new Set<string>()
    for (const kind of SHOWN) {
      for (const variant of [
        line(kind, {
          reference: 'K7Q',
          state: 'added',
          reason: 'soldout',
          answer: 'found',
          cause: 'staff',
        }),
        line(kind, {
          guard: 'pin',
          setting: 'pay_table',
          scope: { kind: 'connection', name: null },
          paymentAnswer: 'no_receipt',
        }),
        line(kind, {
          scope: { kind: 'bar', name: 'Main bar' },
          cause: 'vanished',
          state: 'approval',
          paymentAnswer: 'receipt_printed',
        }),
        line(kind, { scope: { kind: 'table', name: null }, cause: 'unreachable', guard: 'other' }),
      ]) {
        logSentence(variant, context('en', used))
        logSentence(variant, context('bg', used))
      }
    }
    const params = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort()
    for (const key of used) {
      expect(messages.en[key], key).toBeDefined()
      expect(messages.bg[key], key).toBeDefined()
      expect(params(messages.bg[key] as string), key).toEqual(params(messages.en[key] as string))
    }
  })

  it("reads the plan's sentences as written", () => {
    const en = context('en', new Set())
    const so = { reference: 'K7Q', sentOrderId: 'so_A1' }
    expect(logSentence(line('sitting.opened'), en)).toBe('Table 7 opened for phones')
    expect(logSentence(line('sitting.ended'), en)).toBe('Table 7 closed for phones')
    expect(logSentence(line('sent_order.state', { ...so, state: 'added' }), en)).toBe(
      'Sent order K7Q: Added',
    )
    expect(
      logSentence(line('sent_order.state', { ...so, state: 'notsent', reason: 'soldout' }), en),
    ).toBe('Sent order K7Q: Not sent (sold out)')
    expect(
      logSentence(line('sent_order.state', { ...so, state: 'added', answer: 'found' }), en),
    ).toBe('Sent order K7Q: Found on the bill')
    expect(logSentence(line('sent_order.landed_late', so), en)).toBe(
      'Sent order K7Q found on the bill',
    )
    const asked = { callKinds: ['ice', 'water'] }
    expect(logSentence(line('waiter_call.called', asked), en)).toBe('Table 7 asked for: Ice, Water')
    expect(logSentence(line('waiter_call.done', asked), en)).toBe(
      'Call at Table 7 handled (Ice, Water)',
    )
    expect(logSentence(line('waiter_call.lapsed', asked), en)).toBe(
      'Call at Table 7 ran out (Ice, Water)',
    )
    expect(logSentence(line('service_day.closed', { sentOrdersOfDay: 84 }), en)).toBe(
      'The night closed: 84 sent orders',
    )
    expect(logSentence(line('table_code.reissued'), en)).toBe('New code for Table 7')
    expect(logSentence(line('table_code.revealed'), en)).toBe('Code shown for Table 7')
    expect(logSentence(line('alert.raised', { alertTitle: 'Sent order not confirmed' }), en)).toBe(
      'Alert: Sent order not confirmed',
    )
    expect(logSentence(line('alert.done', { alertTitle: 'Sent order not confirmed' }), en)).toBe(
      'Alert done: Sent order not confirmed',
    )
    expect(logSentence(line('alert.cleared', { alertTitle: 'Sent order not confirmed' }), en)).toBe(
      'Cleared at the end of the night: Sent order not confirmed',
    )
  })

  it('names the scope of a pause and its cause', () => {
    const en = context('en', new Set())
    expect(
      logSentence(
        line('pause.started', { scope: { kind: 'venue', name: null }, cause: 'staff' }),
        en,
      ),
    ).toBe('Ordering paused: All bars · by Maria')
    expect(
      logSentence(line('pause.started', { scope: { kind: 'bar', name: 'Main bar' } }), en),
    ).toBe('Ordering paused: Main bar')
    expect(
      logSentence(
        line('pause.started', { scope: { kind: 'connection', name: null }, cause: 'unreachable' }),
        en,
      ),
    ).toBe("Ordering paused: the connection to Mistral · Mistral didn't answer")
    expect(logSentence(line('pause.lifted', { scope: { kind: 'table', name: null } }), en)).toBe(
      'Ordering back on: Table 7',
    )
  })

  it('words the settings and staff entries by name, never by id', () => {
    const en = context('en', new Set())
    expect(logSentence(line('role.changed', { subject: 'Manager' }), en)).toBe(
      'Role changed: Manager',
    )
    expect(logSentence(line('staff.changed', { subject: 'Georgi' }), en)).toBe(
      'Staff changed: Georgi',
    )
    expect(logSentence(line('pin.changed', { subject: 'Georgi' }), en)).toBe('PIN changed: Georgi')
    expect(logSentence(line('pin.revealed', { subject: 'Georgi' }), en)).toBe('PIN shown: Georgi')
    expect(logSentence(line('device.changed', { subject: 'Bar tablet' }), en)).toBe(
      'Device changed: Bar tablet',
    )
    expect(logSentence(line('settings.changed', { setting: 'pay_table' }), en)).toBe(
      'Settings changed: a payment table',
    )
    expect(logSentence(line('guard.tripped', { guard: 'cap' }), en)).toBe(
      'A guard stopped an order over the limit',
    )
    expect(logSentence(line('staff.changed', { subject: null }), en)).toBe('Staff changed: someone')
  })

  it("words a payment step with part 2's state word, or without one until #115 sends them", () => {
    const base = { paymentState: 'captured', amountMinor: 3800 }
    const none = context('en', new Set())
    expect(logSentence(line('payment.state', base), none)).toBe('Payment for Table 7')
    const withWord = { ...none, paymentStates: { captured: 'captured' } }
    expect(logSentence(line('payment.state', base), withWord)).toBe(
      'Payment for Table 7, €38.00: captured',
    )
    expect(logSentence(line('payment.answered', { paymentAnswer: 'receipt_printed' }), none)).toBe(
      'Payment for Table 7: Receipt printed',
    )
    expect(logSentence(line('payment.answered', { paymentAnswer: 'no_receipt' }), none)).toBe(
      'Payment for Table 7: No receipt',
    )
  })

  it("words a pay-first round's answers as the till's, never as a receipt's (#115)", () => {
    const none = context('en', new Set())
    expect(logSentence(line('payment.answered', { paymentAnswer: 'on_till' }), none)).toBe(
      'Payment for Table 7: On the till',
    )
    expect(logSentence(line('payment.answered', { paymentAnswer: 'not_on_till' }), none)).toBe(
      'Payment for Table 7: Not on the till',
    )
    const bg = context('bg', new Set())
    expect(logSentence(line('payment.answered', { paymentAnswer: 'on_till' }), bg)).toContain(
      'В касата е',
    )
  })
})
