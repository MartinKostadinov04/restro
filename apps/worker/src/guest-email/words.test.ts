import { GUEST_EMAIL_KINDS } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { GUEST_EMAIL_LANGUAGES, guestEmailWords, hourWords, nightWords } from './words'

// 22:30 in Sofia on Saturday 28 November 2026 (winter time, UTC+2).
const FACTS = {
  venueName: 'Club "Нощ"',
  serviceDate: '2026-11-28',
  startsAt: new Date('2026-11-28T20:30:00Z'),
  timeZone: 'Europe/Sofia',
  partySize: 4,
}

describe('the words of a guest email (#576)', () => {
  it('says a cancellation in Bulgarian: the venue, what happened, the night, the hour, the party', () => {
    expect(guestEmailWords('reservation_cancelled', 'bg', FACTS)).toEqual({
      subject: 'Резервацията ви е отказана',
      text: [
        'Резервацията ви в Club Нощ е отказана.',
        '',
        'Вечер: събота, 28 ноември',
        'Час: 22:30',
        'Гости: 4',
      ].join('\n'),
    })
  })

  it('and in English', () => {
    expect(guestEmailWords('reservation_cancelled', 'en', FACTS)).toEqual({
      subject: 'Your reservation is cancelled',
      text: [
        'Your reservation at Club Нощ is cancelled.',
        '',
        'Night: Saturday 28 November',
        'Time: 22:30',
        'Guests: 4',
      ].join('\n'),
    })
  })

  it('leaves the party out when it has no size', () => {
    const { text } = guestEmailWords('reservation_cancelled', 'en', { ...FACTS, partySize: null })
    expect(text).not.toContain('Guests')
  })

  it('has every kind in both languages, plain, and never calls itself a receipt', () => {
    for (const kind of GUEST_EMAIL_KINDS) {
      for (const language of GUEST_EMAIL_LANGUAGES) {
        const { subject, text } = guestEmailWords(kind, language, FACTS)
        expect(subject.trim()).not.toBe('')
        expect(`${subject}\n${text}`).not.toMatch(/receipt|бележк|<|https?:/i)
      }
    }
  })

  it('reads the night from the service day and the hour on the venue’s clock', () => {
    // 01:30 on Saturday morning belongs to Friday's night.
    expect(nightWords('2026-11-27', 'bg')).toBe('петък, 27 ноември')
    expect(nightWords('2026-01-01', 'en')).toBe('Thursday 1 January')
    expect(hourWords(new Date('2026-11-27T23:30:00Z'), 'Europe/Sofia')).toBe('01:30')
    expect(hourWords(new Date('2026-07-01T19:05:00Z'), 'Europe/Sofia')).toBe('22:05')
    expect(() => nightWords('28.11.2026', 'bg')).toThrow(RangeError)
    expect(() => nightWords('2026-13-01', 'en')).toThrow(RangeError)
  })
})
