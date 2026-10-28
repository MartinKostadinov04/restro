// The words and the shapes of the other Tonight screens (#86), without a database: every reason
// code core writes on a sent order has a word (a code with none is reported, never drawn raw), the
// states read as the plan's words, and the end of the night draws what the role was handed.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { REFUSAL_CODES } from '@restro/core'
import type { LogLine, NightRead, SentOrderRow } from '@restro/core/service'
import { describe, expect, it } from 'vitest'

import {
  clockIn,
  logLineView,
  nightView,
  REASON_WORD_CODES,
  reasonWordOf,
  sentRowView,
  stateWord,
  unknownReasons,
} from './night-view'

const repo = (path: string) => fileURLToPath(new URL(`../../../../../${path}`, import.meta.url))

describe('the reason words of a sent order', () => {
  it('words the codes the plan names', () => {
    expect(reasonWordOf('item_unavailable')).toEqual({ word: 'soldout', unknown: false })
    expect(reasonWordOf('ordering_paused')).toEqual({ word: 'paused', unknown: false })
    expect(reasonWordOf('table_closed')).toEqual({ word: 'closed', unknown: false })
    expect(reasonWordOf('staff_closed')).toEqual({ word: 'closed', unknown: false })
    expect(reasonWordOf('closing_hour')).toEqual({ word: 'hours', unknown: false })
    expect(reasonWordOf('pos_unreachable')).toEqual({ word: 'unreachable', unknown: false })
  })

  it('words every refusal the POS can give as "refused it", except an item that ran out', () => {
    for (const code of REFUSAL_CODES) {
      expect(reasonWordOf(code)).toEqual({
        word: code === 'item_unavailable' ? 'soldout' : 'refused',
        unknown: false,
      })
    }
  })

  it('shows no word for an answer or a check, and no raw code', () => {
    for (const code of ['staff_found', 'staff_not_found', 'check_timed_out', 'check_ambiguous']) {
      expect(reasonWordOf(code)).toEqual({ word: null, unknown: false })
    }
    expect(reasonWordOf(null)).toEqual({ word: null, unknown: false })
  })

  it('reports a code with no word, and shows none', () => {
    expect(reasonWordOf('made_up_reason')).toEqual({ word: null, unknown: true })
    expect(
      unknownReasons([
        { reason: 'made_up_reason' },
        { reason: 'ordering_paused' },
        { reason: null },
      ]),
    ).toEqual(['made_up_reason'])
  })

  it('has a word for every reason code core and the worker write on a sent order', () => {
    // The codes are listed from the sources that write them, so a new one fails here.
    const found = new Set<string>()
    for (const path of [
      'packages/core/src/service/sent-order.ts',
      'packages/core/src/service/sent-order-answer.ts',
      'apps/worker/src/jobs/order-send.ts',
    ]) {
      for (const line of readFileSync(repo(path), 'utf8').split('\n')) {
        if (!/reason|settle\(|unconfirmed\(|paused\(\)/.test(line)) continue
        for (const match of line.matchAll(/'([a-z]+(?:_[a-z]+)+)'/g)) found.add(match[1] as string)
      }
    }
    // States, commands and other words that share those lines.
    const notReasons = new Set([
      'not_sent',
      'awaiting_approval',
      'sent_order',
      'on_bill',
      'pay_first',
      'by_state',
      'sent_order_missing',
      'sent_order_answered',
      'sent_order_settled',
      'no_turn',
    ])
    const missing = [...found].filter(
      (code) =>
        !notReasons.has(code) &&
        !REASON_WORD_CODES.includes(code) &&
        // A code the sources use that is not a sent order's reason (a refusal of a command, a key).
        !/^(sent_order|pos_table|table_order)\./.test(code) &&
        reasonWordOf(code).unknown,
    )
    expect(missing).toEqual([])
    expect(found.size).toBeGreaterThan(5)
  })
})

describe('the state words', () => {
  it("maps the stored states to the plan's words", () => {
    expect(stateWord('waiting')).toBe('waiting')
    expect(stateWord('sending')).toBe('sending')
    expect(stateWord('checking')).toBe('checking')
    expect(stateWord('added')).toBe('added')
    expect(stateWord('awaiting_approval')).toBe('approval')
    expect(stateWord('not_sent')).toBe('notsent')
    expect(stateWord('unconfirmed')).toBe('check')
  })

  it('reads an unknown state as the cautious one', () => {
    expect(stateWord('made_up')).toBe('check')
    expect(stateWord(null)).toBeNull()
  })
})

const row = (fields: Partial<SentOrderRow> = {}): SentOrderRow => ({
  id: 'so_A1',
  reference: 'K7Q',
  tableId: 'tb_A1',
  table: '7',
  numbered: true,
  itemCount: 3,
  totalMinor: 1250,
  state: 'added',
  reason: null,
  createdAt: new Date('2026-10-26T22:30:00Z'),
  landedAt: null,
  answer: null,
  ...fields,
})

describe('a sent order row', () => {
  const clock = clockIn('Europe/Sofia')

  it("words the time in the venue's zone, not the server's", () => {
    expect(clock(new Date('2026-10-26T22:30:00Z'))).toBe('00:30')
    expect(sentRowView(row(), clock).time).toBe('00:30')
  })

  it('keeps the answer and who gave it, and where it came from', () => {
    const answered = sentRowView(
      row({
        state: 'not_sent',
        answer: { answer: 'not_found', who: { kind: 'person', name: 'Maria' }, via: 'telegram' },
      }),
      clock,
    )
    expect(answered.answer).toEqual({
      answer: 'not_found',
      by: { who: { kind: 'person', name: 'Maria' }, telegram: true },
    })
    expect(answered.state).toBe('notsent')
  })

  it('carries our fields only: no POS reference, no guest data', () => {
    expect(Object.keys(sentRowView(row(), clock)).sort()).toEqual(
      [
        'answer',
        'id',
        'itemCount',
        'landedAt',
        'numbered',
        'reason',
        'reference',
        'state',
        'table',
        'tableId',
        'time',
        'totalMinor',
      ].sort(),
    )
  })
})

const line = (fields: Partial<LogLine> = {}): LogLine => ({
  seq: 1,
  at: new Date('2026-10-26T22:30:00Z'),
  kind: 'sent_order.state',
  tableId: 'tb_A1',
  table: '7',
  numbered: true,
  sentOrderId: 'so_A1',
  reference: 'K7Q',
  paymentId: null,
  fromState: null,
  toState: 'added',
  reason: null,
  who: { kind: 'restro' },
  via: null,
  scope: null,
  cause: null,
  subject: null,
  amountMinor: null,
  sentOrdersOfDay: null,
  callKinds: [],
  ...fields,
})

describe('a Log line', () => {
  const input = { clock: clockIn('Europe/Sofia'), locale: 'en' as const, source: 'Mistral' }

  it('keeps the answer apart from an ordinary move', () => {
    const answer = logLineView(line({ reason: 'staff_found' }), input)
    expect(answer.answer).toBe('found')
    expect(logLineView(line(), input).answer).toBeNull()
  })

  it("titles an alert by its own kind, in the admin's language", () => {
    const view = logLineView(line({ kind: 'alert.raised', reason: 'order_unconfirmed' }), input)
    expect(view.alertTitle).toBeTruthy()
    expect(view.alertTitle).not.toContain('order_unconfirmed')
  })

  it('words a guard and a setting, and falls back to a plain word for an unknown one', () => {
    expect(logLineView(line({ kind: 'guard.tripped', reason: 'pin_wrong' }), input).guard).toBe(
      'pin',
    )
    expect(logLineView(line({ kind: 'guard.tripped', reason: 'new_guard' }), input).guard).toBe(
      'other',
    )
    expect(
      logLineView(line({ kind: 'settings.changed', reason: 'payment_table' }), input).setting,
    ).toBe('pay_table')
    expect(logLineView(line({ kind: 'settings.changed', reason: 'x' }), input).setting).toBe(
      'setting',
    )
  })

  it('words a pause cause only when it has a word', () => {
    expect(logLineView(line({ kind: 'pause.started', cause: 'staff' }), input).cause).toBe('staff')
    expect(
      logLineView(line({ kind: 'pause.started', cause: 'pos_unreachable' }), input).cause,
    ).toBe('unreachable')
    expect(logLineView(line({ kind: 'pause.started', cause: 'made_up' }), input).cause).toBeNull()
  })
})

const night = (fields: Partial<NightRead> = {}): NightRead => ({
  day: '2026-10-26',
  days: ['2026-10-26'],
  today: false,
  hasService: true,
  dayEndsAt: '07:00',
  closedAt: new Date('2026-10-27T05:05:00Z'),
  full: true,
  fix: [
    {
      alertId: 'al_A1',
      sentOrderId: 'so_A1',
      reference: 'K7Q',
      tableId: 'tb_A1',
      table: '7',
      numbered: true,
      items: [{ name: 'Gin tonic', options: ['no mint'], qty: 2 }],
      at: new Date('2026-10-26T22:30:00Z'),
      sentAt: new Date('2026-10-26T22:29:00Z'),
      billBeforeMinor: 4200,
      landedAt: null,
      answer: null,
    },
    {
      alertId: null,
      sentOrderId: 'so_B2',
      reference: 'M2P',
      tableId: 'tb_B2',
      table: 'Loge',
      numbered: false,
      items: [],
      at: new Date('2026-10-26T23:00:00Z'),
      sentAt: null,
      billBeforeMinor: null,
      landedAt: null,
      answer: { answer: 'found', who: { kind: 'person', name: 'Georgi' }, via: null },
    },
  ],
  sent: {
    counts: { all: 84, notAdded: 5, added: 79, notSent: 3, unconfirmed: 2 },
    notAdded: {
      day: '2026-10-26',
      rows: [row({ state: 'unconfirmed' })],
      hasMore: false,
      counts: { all: 84, notAdded: 5, added: 79, notSent: 3, unconfirmed: 2 },
    },
  },
  totals: {
    sittings: 30,
    sentOrders: 84,
    sentOrdersAdded: 79,
    sentOrdersNotSent: 3,
    sentOrdersUnconfirmed: 2,
    addedMinor: 123456,
    waiterCalls: 12,
    alerts: 4,
    pauses: 1,
  },
  money: null,
  ...fields,
})

describe('the end of the night', () => {
  it('splits section 1 into the problems that wait and the ones already answered', () => {
    const view = nightView(night(), 'Europe/Sofia')
    expect(view.fix.map((r) => r.check?.reference)).toEqual(['K7Q'])
    expect(view.fix[0]?.kind).toBe('check')
    expect(view.fix[0]?.check?.sentAt).toBe('00:29')
    expect(view.answered).toEqual([
      {
        sentOrderId: 'so_B2',
        reference: 'M2P',
        table: 'Loge',
        numbered: false,
        answer: 'found',
        by: { who: { kind: 'person', name: 'Georgi' }, telegram: false },
      },
    ])
  })

  it('hands a staff role no money: the view has no field for tips or captured money', () => {
    const view = nightView(night({ full: false }), 'Europe/Sofia')
    expect(view.full).toBe(false)
    expect(JSON.stringify(view)).not.toMatch(/tip|captured|payments/i)
  })
})
