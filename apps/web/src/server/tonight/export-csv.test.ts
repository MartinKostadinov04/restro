// The rows of the Log's two exports (#87), without a database: oldest first with the day in front of
// the time, the screens' own words, amounts only as minor units for core's CSV writer (the money
// module), our ids only, and the end-of-night CSV's byte-order mark and columns.
import { nightCsv } from '@restro/core/service'
import { describe, expect, it } from 'vitest'

import bg from '../../../messages/bg.json'
import en from '../../../messages/en.json'
import { logExportRows, sentExportRows } from './export-csv'
import type { LogLineView, SentRowView } from './night-view'

/** The `tonight` messages as a translator, with `{name}` filled in (no ICU plurals needed here). */
function say(messages: Record<string, string>) {
  return (key: string, values: Record<string, string | number> = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
}
const english = say(en.tonight as unknown as Record<string, string>)
const bulgarian = say(bg.tonight as unknown as Record<string, string>)

const sent = (fields: Partial<SentRowView> = {}): SentRowView => ({
  id: 'so_A1',
  reference: 'K7Q',
  tableId: 'tb_A1',
  table: '7',
  numbered: true,
  itemCount: 3,
  totalMinor: 1250,
  state: 'added',
  reason: null,
  time: '23:14',
  landedAt: null,
  answer: null,
  ...fields,
})

const logLine = (fields: Partial<LogLineView> = {}): LogLineView => ({
  seq: 1,
  time: '23:10',
  kind: 'sitting.opened',
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
  sentOrdersOfDay: null,
  callKinds: [],
  ...fields,
})

describe('the sent orders export', () => {
  it('lists the days oldest first, each day oldest first, with the day in front of the time', () => {
    const rows = sentExportRows(
      [
        {
          day: '2026-10-25',
          rows: [
            sent({ reference: 'LATE', time: '23:59' }),
            sent({ reference: 'EARLY', time: '22:00' }),
          ],
        },
        { day: '2026-10-26', rows: [sent({ reference: 'NEXT', time: '23:14' })] },
      ],
      { say: english, source: 'barsy' },
    )
    expect(rows.map((row) => [row.time, row.reference])).toEqual([
      ['2026-10-25 22:00', 'EARLY'],
      ['2026-10-25 23:59', 'LATE'],
      ['2026-10-26 23:14', 'NEXT'],
    ])
  })

  it('writes the end-of-night CSV: BOM, the same columns, the amount as a decimal, no ids', () => {
    const rows = sentExportRows(
      [
        {
          day: '2026-10-26',
          rows: [
            sent({
              state: 'check',
              answer: {
                answer: 'found',
                by: { who: { kind: 'person', name: 'Maria' }, telegram: true },
              },
            }),
          ],
        },
      ],
      { say: english, source: 'barsy' },
    )
    const csv = nightCsv(rows, 'EUR')
    expect(
      csv.startsWith('﻿section,time,table,reference,what,state,reason,answer,who,amount,tip,detail'),
    ).toBe(true)
    const line = csv.split('\r\n')[1] ?? ''
    expect(line).toContain('2026-10-26 23:14')
    expect(line).toContain('K7Q')
    expect(line).toContain(',12.50,')
    expect(csv).not.toMatch(/\b(so|tb|nd|vn|tn|sm)_[0-9A-Za-z]{4,}/)
  })

  it('words the rows in Bulgarian when the admin reads Bulgarian', () => {
    const [row] = sentExportRows([{ day: '2026-10-26', rows: [sent()] }], {
      say: bulgarian,
      source: 'barsy',
    })
    expect(row?.table).toBe('Маса 7')
    expect(row?.section).toBe(bg.tonight.nt_sent)
  })
})

describe('the Log export', () => {
  const context = { say: english, source: 'barsy', currency: 'EUR', locale: 'en-GB' } as const

  it('has one row per line the venue sees, oldest first, worded as the screen words it', () => {
    const rows = logExportRows(
      [
        {
          day: '2026-10-26',
          rows: [
            logLine({ seq: 3, time: '23:40', kind: 'sitting.ended' }),
            logLine({ seq: 2, time: '23:30', kind: 'lease.taken_over' }),
            logLine({ seq: 1, time: '23:10', kind: 'sitting.opened' }),
          ],
        },
      ],
      context as never,
    )
    expect(rows.map((row) => row.time)).toEqual(['2026-10-26 23:10', '2026-10-26 23:40'])
    expect(rows[0]).toMatchObject({
      section: en.tonight.tab_log,
      table: 'Table 7',
      who: 'Maria',
    })
    expect(rows[0]?.what).toBe(english('lg_opened', { table: 'Table 7' }))
  })

  it('carries a payment line’s amount as minor units for the money module, never a float', () => {
    const rows = logExportRows(
      [
        {
          day: '2026-10-26',
          rows: [logLine({ kind: 'payment.answered', paymentAnswer: 'ok', amountMinor: 4200 })],
        },
      ],
      context as never,
    )
    expect(rows[0]?.amountMinor).toBe(4200)
    expect(nightCsv(rows, 'EUR')).toContain(',42.00,')
  })

  it('names Telegram when an answer came from there, and keeps no id in the file', () => {
    const rows = logExportRows(
      [
        {
          day: '2026-10-26',
          rows: [
            logLine({
              kind: 'sent_order.state',
              sentOrderId: 'so_A1',
              reference: 'K7Q',
              state: 'added',
              answer: 'found',
              by: { who: { kind: 'person', name: 'Maria' }, telegram: true },
            }),
          ],
        },
      ],
      context as never,
    )
    expect(rows[0]?.who).toBe(english('lg_via_tg', { who: 'Maria' }))
    expect(JSON.stringify(rows)).not.toMatch(/so_A1/)
  })
})
