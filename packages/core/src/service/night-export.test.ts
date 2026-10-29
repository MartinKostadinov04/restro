// The Log's grouping and the end of the night's exports (#86): every kind of `LOG_KINDS` has a
// place on the Log screen (so no kind can show as "something happened"), `lease.taken_over` never
// shows, the CSV is Excel-safe UTF-8 with amounts from the money module, and the Telegram message
// holds counts and problems and no money.
import { describe, expect, it } from 'vitest'

import { LOG_KINDS } from './log'
import { LOG_GROUPS, LOG_KIND_GROUP, logKindsOf, SHOWN_LOG_KINDS } from './log-view'
import { CSV_BOM, CSV_COLUMNS, nightCsv, nightCsvName, nightMessage } from './night-export'

describe("the Log screen's kinds", () => {
  it('has a place for every kind of LOG_KINDS, and none that is not one', () => {
    expect(Object.keys(LOG_KIND_GROUP).sort()).toEqual(Object.keys(LOG_KINDS).sort())
  })

  it('hides only the lease taken over', () => {
    const hidden = Object.entries(LOG_KIND_GROUP).filter(([, group]) => group === null)
    expect(hidden.map(([kind]) => kind)).toEqual(['lease.taken_over'])
    expect(SHOWN_LOG_KINDS).not.toContain('lease.taken_over')
  })

  it('splits the shown kinds into the four filters with no overlap and none left out', () => {
    const together = LOG_GROUPS.flatMap((group) => logKindsOf(group))
    expect([...together].sort()).toEqual([...SHOWN_LOG_KINDS].sort())
    expect(new Set(together).size).toBe(together.length)
    expect(logKindsOf(null)).toEqual(SHOWN_LOG_KINDS)
  })

  it('puts the payment kinds under "Money"', () => {
    expect(logKindsOf('money')).toEqual(['payment.state', 'payment.answered'])
  })
})

describe('the CSV of a night', () => {
  it("starts with the byte-order mark and the plan's columns", () => {
    const text = nightCsv([], 'EUR')
    expect(text.startsWith(CSV_BOM)).toBe(true)
    expect(text.slice(1).split('\r\n')[0]).toBe(
      'section,time,table,reference,what,state,reason,answer,who,amount,tip,detail',
    )
    expect(CSV_COLUMNS).toHaveLength(12)
  })

  it('writes amounts as decimals with a dot and two places, through the money module', () => {
    const text = nightCsv(
      [
        { section: 'Sent orders', reference: 'K7Q', amountMinor: 1250 },
        { section: 'Sent orders', reference: 'K8R', amountMinor: 5, tipMinor: 100 },
        { section: 'Totals', what: 'Count', detail: '84' },
      ],
      'EUR',
    )
    const lines = text.slice(1).split('\r\n')
    expect(lines[1]).toBe('Sent orders,,,K7Q,,,,,,12.50,,')
    expect(lines[2]).toBe('Sent orders,,,K8R,,,,,,0.05,1.00,')
    expect(lines[3]).toBe('Totals,,,,Count,,,,,,,84')
  })

  it('quotes what holds a comma, a quote or a line break, and keeps Cyrillic whole', () => {
    const text = nightCsv(
      [{ section: 'Поръчки', who: 'Мария, бар "Главен"', detail: '2 × Джин\nтоник' }],
      'EUR',
    )
    expect(text).toContain('Поръчки,,,,,,,,"Мария, бар ""Главен""",,,"2 × Джин\nтоник"')
  })

  it('never lets a cell run as a formula', () => {
    const text = nightCsv([{ section: '=HYPERLINK("x")', who: '+1', detail: '@sum' }], 'EUR')
    const line = text.slice(1).split('\r\n')[1] as string
    expect(line.startsWith('"\'=HYPERLINK(""x"")",')).toBe(true)
    expect(line).toContain(",'+1,")
    expect(line.endsWith(",'@sum")).toBe(true)
  })

  it('names the file by venue and day', () => {
    expect(nightCsvName('club-luna', '2026-10-26')).toBe('restro-club-luna-2026-10-26.csv')
    expect(nightCsvName('a b/c', '2026-10-26')).toBe('restro-a-b-c-2026-10-26.csv')
  })
})

describe('the message at the close of the service day', () => {
  const base = {
    venueName: 'Club Luna',
    day: '2026-10-26',
    sentOrders: 84,
    added: 79,
    notSent: 3,
    unconfirmed: 2,
  }

  it('words the totals and the problems in English', () => {
    expect(
      nightMessage('en', {
        ...base,
        fix: [
          { reference: 'K7Q', table: 'Table 7' },
          { reference: 'M2P', table: null },
        ],
      }),
    ).toBe(
      [
        'Club Luna · night of 26 October',
        'Sent orders: 84 (added 79, not sent 3, unconfirmed 2)',
        'To fix (2):',
        '· Sent order K7Q, Table 7: still unconfirmed',
        '· Sent order M2P: still unconfirmed',
      ].join('\n'),
    )
  })

  it('words it in Bulgarian, and says so when there is nothing to fix', () => {
    expect(nightMessage('bg', { ...base, unconfirmed: 0, fix: [] })).toBe(
      [
        'Club Luna · вечерта на 26 октомври',
        'Поръчки: 84 (добавени 79, неизпратени 3, непотвърдени 0)',
        'Няма нищо за оправяне.',
      ].join('\n'),
    )
  })

  it('carries no money amount and no tip', () => {
    const text = nightMessage('en', { ...base, fix: [{ reference: 'K7Q', table: 'Table 7' }] })
    expect(text).not.toMatch(/[€$]|EUR|BGN|lv|tip/i)
    // The facts of the message have no field that could hold one.
    expect(Object.keys(base).filter((key) => /minor|amount|tip/i.test(key))).toEqual([])
  })

  it('adds the payments as counts and words, with no amount (#115)', () => {
    const payments = {
      taken: 41,
      fix: [
        { table: 'Table 7', what: 'unconfirmed' as const },
        { table: null, what: 'capture_failed' as const },
      ],
    }
    expect(nightMessage('en', { ...base, fix: [], payments })).toBe(
      [
        'Club Luna · night of 26 October',
        'Sent orders: 84 (added 79, not sent 3, unconfirmed 2)',
        'Payments: 41 taken, 2 to fix',
        'To fix (2):',
        '· Payment, Table 7: not confirmed',
        '· Payment: card not charged after the bill closed',
      ].join('\n'),
    )
    expect(nightMessage('bg', { ...base, fix: [], payments: { taken: 3, fix: [] } })).toBe(
      [
        'Club Luna · вечерта на 26 октомври',
        'Поръчки: 84 (добавени 79, неизпратени 3, непотвърдени 2)',
        'Плащания: 3 взети, 0 за оправяне',
        'Няма нищо за оправяне.',
      ].join('\n'),
    )
  })

  it('gives a payment charged with no receipt number its payment number (#200)', () => {
    const payments = {
      taken: 1,
      fix: [{ table: 'Table 7', what: 'no_receipt' as const, paymentNumber: 'KQ7MD' }],
    }
    expect(nightMessage('en', { ...base, fix: [], payments })).toContain(
      '· Payment, Table 7: charged, no receipt number · payment KQ7MD',
    )
    // Without a number the line reads as before.
    expect(
      nightMessage('en', {
        ...base,
        fix: [],
        payments: { taken: 1, fix: [{ table: 'Table 7', what: 'no_receipt' as const }] },
      }),
    ).toMatch(/· Payment, Table 7: charged, no receipt number$/)
  })

  it('lists the receipts not brought by table and payment number, with no amount (#200)', () => {
    const payments = {
      taken: 2,
      fix: [{ table: 'Table 7', what: 'receipt_not_brought' as const, paymentNumber: 'KQ7MD' }],
    }
    expect(nightMessage('en', { ...base, fix: [], payments })).toBe(
      [
        'Club Luna · night of 26 October',
        'Sent orders: 84 (added 79, not sent 3, unconfirmed 2)',
        'Payments: 2 taken, 1 to fix',
        'To fix (1):',
        '· Payment, Table 7: receipt not brought · payment KQ7MD',
      ].join('\n'),
    )
    expect(nightMessage('bg', { ...base, fix: [], payments })).toContain(
      '· Плащане, Table 7: бележката не е занесена · плащане KQ7MD',
    )
    expect(nightMessage('en', { ...base, fix: [], payments })).not.toMatch(/[€$]|EUR|\d+[.,]\d\d/)
  })
})
