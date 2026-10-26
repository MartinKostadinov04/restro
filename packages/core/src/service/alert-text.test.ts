import { describe, expect, it } from 'vitest'

import {
  type AlertLocale,
  alertLocale,
  alertMessage,
  digestMessage,
  doneButtonText,
  doneLine,
  linkedMessage,
  reminderMessage,
  type TelegramAnswer,
  tableLabel,
  telegramAnswer,
} from './alert-text'

const context = (locale: AlertLocale) => ({
  locale,
  venueName: 'Club Nova',
  tableLabel: tableLabel(locale, { name: null, number: '7' }),
  source: 'barsy',
})

const unconfirmed = {
  kind: 'order_unconfirmed',
  details: {
    reference: 'K7Q',
    items: [
      { name: 'Gin tonic', options: [], qty: 2 },
      { name: 'Mojito', options: ['no mint'], qty: 1 },
    ],
    notes: 'a guest note that must never travel',
    delivery: {},
  },
}

describe('alertLocale', () => {
  it('words Bulgarian for bg_BG and English for anything else', () => {
    expect(alertLocale('bg_BG')).toBe('bg')
    for (const other of ['en_GB', 'en_US', 'de_DE', '', null, undefined]) {
      expect(alertLocale(other)).toBe('en')
    }
  })
})

describe('tableLabel', () => {
  it('uses the table’s own name, else its number, in the venue’s language', () => {
    expect(tableLabel('en', { name: 'Terrace 3', number: '7' })).toBe('Terrace 3')
    expect(tableLabel('en', { name: null, number: '7' })).toBe('Table 7')
    expect(tableLabel('bg', { name: null, number: '7' })).toBe('Маса 7')
    expect(tableLabel('bg', { name: null, number: null })).toBeNull()
  })
})

type Step = 'new' | 'reminder' | 'back' | 'still_paused'

/** Every kind the alerts word, in both languages: kind, details, step, EN title, BG title. */
const KINDS: readonly [string, Record<string, unknown>, Step, string, string][] = [
  [
    'order_unconfirmed',
    unconfirmed.details,
    'new',
    'Table 7: an order couldn’t be confirmed',
    'Маса 7: изпратена поръчка без потвърждение',
  ],
  [
    'ordering_paused',
    {},
    'new',
    'Ordering is paused at Club Nova',
    'Поръчките в Club Nova са спрени',
  ],
  [
    'ordering_paused',
    {},
    'reminder',
    'Ordering is still paused at Club Nova',
    'Поръчките в Club Nova все още са спрени',
  ],
  [
    'ordering_paused',
    {},
    'still_paused',
    'Ordering is still paused at Club Nova',
    'Поръчките в Club Nova все още са спрени',
  ],
  [
    'ordering_paused',
    {},
    'back',
    'Ordering is back at Club Nova',
    'Поръчките в Club Nova са пуснати отново',
  ],
  [
    'ordering_paused',
    { scope: 'bar', barName: 'Rooftop' },
    'new',
    'Ordering is paused at Rooftop, Club Nova',
    'Поръчките в Rooftop, Club Nova са спрени',
  ],
  [
    'pre_opening_check',
    {},
    'new',
    'Club Nova can’t open: Restro can’t work with barsy',
    'Club Nova не може да отвори: Restro не може да работи с barsy',
  ],
  [
    'order_pace',
    {},
    'new',
    'Club Nova: Table 7 hit the order pace limit',
    'Club Nova: Маса 7 достигна лимита за поръчки',
  ],
  [
    'order_rate',
    {},
    'new',
    'Club Nova: Table 7 changed its order too fast',
    'Club Nova: поръчката на Маса 7 се променя твърде бързо',
  ],
  [
    'connection_unstable',
    {},
    'new',
    'Club Nova: the connection to barsy is unstable',
    'Club Nova: връзката с barsy е нестабилна',
  ],
  [
    'table_code_block',
    {},
    'new',
    'Club Nova: a network was blocked after too many wrong table codes',
    'Club Nova: мрежа е блокирана след твърде много грешни кодове на маси',
  ],
  ['something_new', { secret: 'x' }, 'new', 'Club Nova: something_new', 'Club Nova: something_new'],
]

describe('alertMessage, in both languages, for every kind', () => {
  it.each(KINDS)('%s %j at %s', (kind, details, step, en, bg) => {
    expect(alertMessage({ kind, details }, context('en'), step).title).toBe(en)
    expect(alertMessage({ kind, details }, context('bg'), step).title).toBe(bg)
  })

  it('words the Unconfirmed order’s items, reference and where to check', () => {
    expect(alertMessage(unconfirmed, context('en'), 'new').body).toBe(
      '2 × Gin tonic, 1 × Mojito (no mint), ref K7Q. Check the bill in barsy.',
    )
    expect(alertMessage(unconfirmed, context('bg'), 'new').body).toBe(
      '2 × Gin tonic, 1 × Mojito (no mint), номер K7Q. Проверете сметката в barsy.',
    )
  })

  it.each(['en', 'bg'] as const)(
    'never carries a note, the delivery state or unknown details (%s)',
    (locale) => {
      const known = alertMessage(unconfirmed, context(locale), 'new')
      const unknown = alertMessage(
        { kind: 'something_new', details: { secret: 'x' } },
        context(locale),
        'new',
      )
      for (const message of [known, unknown]) {
        expect(`${message.title} ${message.body}`).not.toMatch(/guest note|delivery|secret/)
      }
    },
  )

  it('names a table that has no label as just "a table"', () => {
    const none = { ...context('en'), tableLabel: null }
    expect(alertMessage({ kind: 'order_pace', details: {} }, none, 'new').title).toBe(
      'Club Nova: A table hit the order pace limit',
    )
    expect(
      alertMessage({ kind: 'order_pace', details: {} }, { ...none, locale: 'bg' }, 'new').title,
    ).toBe('Club Nova: Маса достигна лимита за поръчки')
  })
})

describe('reminderMessage, digestMessage, linkedMessage', () => {
  const one = alertMessage(unconfirmed, context('en'), 'new')

  it('marks a reminder in each language', () => {
    expect(reminderMessage(one, 'en').title).toBe(
      'Reminder: Table 7: an order couldn’t be confirmed',
    )
    expect(reminderMessage(one, 'bg').title).toBe(
      'Напомняне: Table 7: an order couldn’t be confirmed',
    )
  })

  it('keeps one message as it is and joins several into one push', () => {
    expect(digestMessage([one], 'Club Nova', 'bg')).toEqual(one)
    const other = alertMessage(unconfirmed, { ...context('en'), tableLabel: 'Table 9' }, 'new')
    const en = digestMessage([one, other], 'Club Nova', 'en')
    expect(en.title).toBe('2 alerts at Club Nova')
    expect(en.body).toBe(`${one.title}\n${other.title}`)
    expect(digestMessage([one, other], 'Club Nova', 'bg').title).toBe('2 сигнала в Club Nova')
  })

  it('puts a title and a body in one text', () => {
    expect(linkedMessage({ title: 'T', body: 'B' })).toBe('T\nB')
    expect(linkedMessage({ title: 'T', body: '' })).toBe('T')
  })
})

describe('doneLine', () => {
  const at = new Date('2026-10-23T23:14:00Z')

  it('names who and when, in the venue’s time and language', () => {
    expect(doneLine('Maria', at, 'Europe/Sofia')).toBe('Done by Maria, 02:14')
    expect(doneLine('Maria', at, 'Europe/Sofia', 'en')).toBe('Done by Maria, 02:14')
    expect(doneLine('Мария', at, 'Europe/Sofia', 'bg')).toBe('Готово от Мария, 02:14')
  })
})

describe('telegramAnswer', () => {
  const ANSWERS: readonly TelegramAnswer[] = [
    'not_an_alert',
    'no_venue',
    'not_linked',
    'denied',
    'cannot',
    'already',
    'done',
    'failed',
  ]

  it('has every answer in both languages, and the two differ', () => {
    for (const answer of ANSWERS) {
      const en = telegramAnswer('en', answer)
      const bg = telegramAnswer('bg', answer)
      expect(en, answer).not.toBe('')
      expect(bg, answer).not.toBe('')
      expect(bg, answer).not.toBe(en)
      expect(bg, answer).toMatch(/[А-я]/)
    }
  })

  it('words the ones the ticket names', () => {
    expect(telegramAnswer('en', 'not_linked')).toBe(
      'Your Telegram is not linked to a Restro account.',
    )
    expect(telegramAnswer('en', 'already')).toBe('Already done.')
    expect(telegramAnswer('en', 'done')).toBe('Done.')
    expect(telegramAnswer('bg', 'already')).toBe('Вече е готово.')
    expect(telegramAnswer('bg', 'done')).toBe('Готово.')
  })
})

describe('doneButtonText', () => {
  it('words the Telegram button in the venue’s language', () => {
    expect(doneButtonText('en')).toBe('Done')
    expect(doneButtonText('bg')).toBe('Готово')
  })
})
