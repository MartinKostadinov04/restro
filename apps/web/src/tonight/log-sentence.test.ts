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
  setting: [],
  subject: null,
  heldCount: null,
  codeCount: null,
  amountMinor: null,
  paymentState: null,
  paymentReason: null,
  paymentAnswer: null,
  provider: null,
  disputeState: null,
  refundFailed: false,
  stornoUndone: false,
  refundSeenUndone: false,
  paymentId: null,
  sentOrdersOfDay: null,
  openBills: null,
  endedEarly: false,
  reservationStatus: null,
  callKinds: [],
  callUndone: false,
  ...fields,
})

/** Every word a changed setting can be named by (S15). */
const SETTING_WORDS = [
  'pay_table',
  'hours',
  'limits',
  'location',
  'calls',
  'alerts',
  'telegram',
  'pay_rule',
  'paying',
  'payments',
  'refunds',
  'setting',
] as const satisfies readonly LogLineView['setting'][number][]

const SHOWN = (Object.keys(SENTENCES) as LogLineView['kind'][]).filter(
  (kind) => kind !== 'lease.taken_over' && kind !== 'payment.hold_unread',
)

describe("the Log's sentences", () => {
  // That the table covers every kind of `LOG_KINDS` is pinned in the server's tests
  // (server/tonight/log-kinds.test.ts), which may import core's service entry.
  it('has one for every shown kind, and the lease and the failed hold reads alone have none', () => {
    expect(SENTENCES['lease.taken_over']).toBeNull()
    expect(SENTENCES['payment.hold_unread']).toBeNull()
    for (const kind of SHOWN) {
      expect(SENTENCES[kind], kind).toBeTypeOf('function')
    }
  })

  it('never shows a lease taken over', () => {
    expect(logSentence(line('lease.taken_over'), context('en', new Set()))).toBeNull()
    expect(logSentence(line('payment.hold_unread'), context('en', new Set()))).toBeNull()
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
          setting: ['pay_table'],
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
        line(kind, { setting: [...SETTING_WORDS], paymentReason: 'table_freed' }),
        line(kind, { paymentReason: 'release_refused' }),
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
    expect(logSentence(line('waiter_call.done', { ...asked, callUndone: true }), en)).toBe(
      'Maria undid "handled" · Table 7',
    )
    expect(logSentence(line('waiter_call.lapsed', asked), en)).toBe(
      'Call at Table 7 ran out (Ice, Water)',
    )
    expect(logSentence(line('service_day.closed', { sentOrdersOfDay: 84 }), en)).toBe(
      'The night closed: 84 sent orders',
    )
    // The night's end (#332): the bills it found still open, counted and named.
    expect(logSentence(line('night.closed', { openBills: 2 }), en)).toBe(
      'The night ended at the closing hour · bills still open: 2',
    )
    expect(logSentence(line('night.closed', { openBills: 1, endedEarly: true }), en)).toBe(
      'Maria ended the night early · bills still open: 1',
    )
    expect(logSentence(line('night.closed', { openBills: 0 }), en)).toBe(
      'The night ended at the closing hour · bills still open: 0',
    )
    expect(logSentence(line('table_code.reissued'), en)).toBe('New code for Table 7')
    expect(logSentence(line('table_code.revealed'), en)).toBe('Code shown for Table 7')
    expect(logSentence(line('table_code.revealed', { codeCount: 3 }), en)).toBe(
      'Codes shown for 3 tables',
    )
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

  it('words a receipt marked Brought, and its Undo by the state the line carries (#200)', () => {
    const en = context('en', new Set())
    const bg = context('bg', new Set())
    const marked = { receipt: { undone: false, paymentNumber: 'KQ7MD' } }
    const undone = { receipt: { undone: true, paymentNumber: 'KQ7MD' } }
    // Screen 1's `r_toast` for the mark; a line without the optional field reads as the mark.
    expect(logSentence(line('receipt.brought', marked), en)).toBe('Receipt for Table 7 brought')
    expect(logSentence(line('receipt.brought'), en)).toBe('Receipt for Table 7 brought')
    expect(logSentence(line('receipt.brought', marked), bg)).toBe('Бележката за Маса 7 е занесена')
    // The lead's words for Undo, awaiting Martin: who, and the number the guest shows.
    expect(logSentence(line('receipt.brought', undone), en)).toBe(
      'Maria undid "receipt brought" · payment KQ7MD',
    )
    expect(logSentence(line('receipt.brought', undone), bg)).toBe(
      'Maria отмени „донесена бележка" · плащане KQ7MD',
    )
    // No amount anywhere in either.
    for (const entry of [marked, undone]) {
      expect(logSentence(line('receipt.brought', entry), en)).not.toMatch(/[€\d]{2,}/)
    }
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
    expect(logSentence(line('settings.changed', { setting: ['pay_table'] }), en)).toBe(
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

describe('the sentences of refunds, stornos and disputes (#222)', () => {
  const used = new Set<string>()
  const en = (l: LogLineView) => logSentence(l, context('en', used))
  const bgText = (l: LogLineView) => logSentence(l, context('bg', used))

  it('words a refund with its amount and the provider it was made in, and one that failed', () => {
    const refund = line('payment.refund_seen', { amountMinor: 500, provider: 'Stripe' })
    expect(en(refund)).toBe('Refund of €5.00 made in Stripe')
    expect(bgText(refund)).toBe('Връщане на €5.00, направено в Stripe')
    // A provider the screen does not know is named plainly, never left as a gap.
    expect(en(line('payment.refund_seen', { amountMinor: 500 }))).toBe(
      'Refund of €5.00 made in the payment provider',
    )
    expect(en(line('payment.refund_seen', { amountMinor: 500, refundFailed: true }))).toBe(
      "The refund didn't go through at the payment provider",
    )
  })

  it('words the refund Restro sends for a line marked Not served, step by step, with who asked', () => {
    const base = {
      amountMinor: 1200,
      provider: 'Stripe',
      by: { who: { kind: 'person', name: 'Ivan' }, telegram: false },
    } as Partial<LogLineView>
    expect(en(line('payment.refund_requested', base))).toBe(
      'Ivan: not served, refund of €12.00 asked (Table 7)',
    )
    expect(en(line('payment.refund_sent', { ...base, refundStep: 'sent' }))).toBe(
      'Refund of €12.00 sent to Stripe',
    )
    expect(en(line('payment.refund_sent', { ...base, refundStep: 'confirmed' }))).toBe(
      'Refund of €12.00 confirmed by Stripe',
    )
    expect(en(line('payment.refund_sent', { ...base, refundStep: 'failed' }))).toBe(
      "Refund of €12.00 didn't go through at Stripe",
    )
    expect(bgText(line('payment.refund_sent', { ...base, refundStep: 'confirmed' }))).toBe(
      'Връщане на €12.00 е потвърдено от Stripe',
    )
  })

  it('words a storno done and taken back', () => {
    expect(en(line('payment.storno'))).toBe('Storno done')
    expect(bgText(line('payment.storno'))).toBe('Сторно направено')
    expect(en(line('payment.storno', { stornoUndone: true }))).toBe('Storno taken back')
  })

  it('words "Got it" on a failed refund and its Undo (#234)', () => {
    expect(en(line('payment.refund_failed_seen'))).toBe("Seen: refund that didn't go through")
    expect(bgText(line('payment.refund_failed_seen'))).toBe('Видяно: неуспешно връщане')
    expect(en(line('payment.refund_failed_seen', { refundSeenUndone: true }))).toBe(
      "Seen taken back: refund that didn't go through",
    )
    expect(bgText(line('payment.refund_failed_seen', { refundSeenUndone: true }))).toBe(
      'Видяното е отменено: неуспешно връщане',
    )
  })

  it('words a dispute by where it stands', () => {
    expect(en(line('payment.dispute', { disputeState: 'open' }))).toBe('Card dispute: Disputed')
    expect(en(line('payment.dispute', { disputeState: 'won' }))).toMatch(
      /^Card dispute: Dispute won: the venue keeps the money\.$/,
    )
    expect(en(line('payment.dispute', { disputeState: 'lost' }))).toMatch(
      /^Card dispute: Dispute lost: the money went back to the guest's bank\./,
    )
    expect(bgText(line('payment.dispute', { disputeState: 'open' }))).toBe(
      'Спор по плащането: Оспорено',
    )
  })

  it('words which reservation rule a settings change moved (#325), and a seats change', () => {
    const settings = (code: string | null) =>
      line('reservation_settings.changed', { reservationStatus: code })
    expect(en(settings('phone_required'))).toBe('Phone requirement for bookings changed')
    expect(en(settings('closed_date_added'))).toBe('Closed date added')
    expect(en(settings('closed_date_removed'))).toBe('Closed date removed')
    expect(bgText(settings('closed_date_added'))).toBe('Добавена затворена дата')
    // A change that moved several rules, or only where the PIN falls, keeps the plain sentence.
    expect(en(settings('changed'))).toBe('Reservation settings changed')
    expect(en(settings(null))).toBe('Reservation settings changed')
    expect(en(line('spot.changed', { reservationStatus: 'seats' }))).toBe('Seats of a spot changed')
    expect(bgText(line('spot.changed', { reservationStatus: 'seats' }))).toBe(
      'Променени места на маса',
    )
  })
})

describe('the screen round lines (S15, S20)', () => {
  const en = context('en', new Set())
  const bgSay = context('bg', new Set())

  it('names the settings that changed, not "a setting"', () => {
    expect(logSentence(line('settings.changed', { setting: ['hours'] }), bgSay)).toBe(
      'Променени настройки: часове за поръчки',
    )
    expect(logSentence(line('settings.changed', { setting: ['hours', 'limits'] }), en)).toBe(
      'Settings changed: ordering hours, order limits',
    )
    expect(logSentence(line('settings.changed', { setting: [] }), en)).toBe(
      'Settings changed: a setting',
    )
  })

  it('words a freed payment table and a refused release, never a second charge', () => {
    const charged = { ...en, paymentStates: { captured: 'captured' } }
    const base = { paymentState: 'captured', amountMinor: 9500 }
    expect(
      logSentence(line('payment.state', { ...base, paymentReason: 'table_freed' }), charged),
    ).toBe('Payment for Table 7: payment table freed')
    expect(
      logSentence(line('payment.state', { ...base, paymentReason: 'release_refused' }), charged),
    ).toBe('Payment for Table 7: the release of the hold was refused')
    expect(logSentence(line('payment.state', base), charged)).toBe(
      'Payment for Table 7, €95.00: captured',
    )
  })
})
