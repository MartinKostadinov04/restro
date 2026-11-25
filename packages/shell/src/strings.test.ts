import { describe, expect, it } from 'vitest'

import { orderingClosedText } from './paying'
import { stringsFor } from './strings'

describe('the words D121 quotes (RR-58)', () => {
  it('says "Slow down a moment" and "no longer in use", in both languages', () => {
    expect(stringsFor('en_US').services.refusals).toMatchObject({
      rate_limited: 'Slow down a moment.',
      code_retired: 'This table code is no longer in use. Scan the code on your table again.',
    })
    expect(stringsFor('bg_BG').services.refusals).toMatchObject({
      rate_limited: 'Малко по-бавно, моля.',
      code_retired: 'Този код на маса вече не се използва. Сканирайте отново кода на масата.',
    })
  })

  it('tells a retired code from a closed table, in both languages', () => {
    for (const locale of ['en_US', 'bg_BG'] as const) {
      const words = stringsFor(locale).services
      expect(orderingClosedText({ retired: true }, words)).toBe(words.refusals.code_retired)
      expect(orderingClosedText({}, words)).toBe(words.orderingClosed)
      expect(orderingClosedText(null, words)).toBe(words.orderingClosed)
    }
  })
})

describe('the guest strings', () => {
  it('has the same keys in Bulgarian and English, none of them empty', () => {
    const bg = stringsFor('bg_BG').guest
    const en = stringsFor('en_US').guest
    expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort())
    for (const table of [bg, en]) {
      for (const [key, value] of Object.entries(table)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('')
        else expect(value('12').trim(), key).not.toBe('')
      }
    }
  })

  it('has the words of the filter sheet, the dish page and the layout switch (SH-02)', () => {
    expect(stringsFor('en_US').guest).toMatchObject({
      filterIntro: 'Choose one or more labels.',
      back: 'Back to menu',
      layout: 'Menu layout',
      layoutList: 'List',
      layoutOne: '1 column',
      layoutTwo: '2 columns',
    })
    expect(stringsFor('bg_BG').guest).toMatchObject({
      filterIntro: 'Изберете един или повече етикети.',
      back: 'Обратно към менюто',
      layout: 'Изглед на менюто',
      layoutList: 'Списък',
      layoutOne: '1 колона',
      layoutTwo: '2 колони',
    })
  })

  it("words Send's guards in both languages (#78, D117)", () => {
    const en = stringsFor('en_US').services
    const bg = stringsFor('bg_BG').services
    expect(en.duplicateAsk(4)).toBe('Same as 4 minutes ago. Send another?')
    expect(en.duplicateAsk(1)).toBe('Same as 1 minute ago. Send another?')
    expect(en.sendOthers(4)).toBe('Send the other 4')
    expect(en.notesAtStaff).toBe('Allergies or special requests? Tell the staff.')
    for (const table of [en, bg]) {
      for (const words of [
        table.duplicateAsk(0),
        table.duplicateAsk(12),
        table.sendAnother,
        table.duplicateCancel,
        table.lineSoldOut,
        table.sendOthers(2),
        table.notesAtStaff,
        table.refusals.duplicate_order,
        table.refusals.guard_tripped,
      ]) {
        expect(words.trim()).not.toBe('')
      }
    }
    expect(bg.duplicateAsk(4)).not.toBe(en.duplicateAsk(4))
  })

  it('words the service screens as the 11-18 screen round settled (lane 3, F1, F2, F4)', () => {
    const en = stringsFor('en_US').services
    const bg = stringsFor('bg_BG').services
    // F1: an empty Pay sheet, and the second step's button.
    expect([en.nothingToPay, en.done]).toEqual(['Nothing to pay yet', 'Back to the menu'])
    expect([bg.nothingToPay, bg.done]).toEqual(['Няма какво да се плати', 'Към менюто'])
    expect(en.paying.confirmX('110.00 EUR')).toBe('Confirm 110.00 EUR')
    expect(bg.paying.confirmX('110,00 EUR')).toBe('Потвърди 110,00 EUR')
    // F2: one name per figure, a tile that does not repeat the title, a call that names itself.
    expect([en.paying.yourItems, bg.paying.yourItems]).toEqual(['Selected', 'Избрано'])
    expect([en.kindWaiterTile, bg.kindWaiterTile]).toEqual(['Something else', 'Друго'])
    expect(en.requestStates.sent).toEqual({
      title: 'Request sent',
      hint: 'Waiting for a waiter to confirm.',
    })
    expect(bg.requestStates.sent).toEqual({
      title: 'Заявката е изпратена',
      hint: 'Чакаме сервитьор да я потвърди.',
    })
    // A cap trip says the waiter takes it, and never to send fewer items (D118).
    expect(en.refusals.over_phone_limit).toBe(
      'This order is over the limit for phone orders. Your waiter will take it.',
    )
    for (const words of [en.refusals.over_phone_limit, bg.refusals.over_phone_limit]) {
      expect(words).not.toMatch(/fewer|по-малко/i)
    }
    // F2 and F4: a closed table, for orders and for calls.
    expect(en.orderingClosed).toBe('This table isn’t open for phone orders. Ask a waiter.')
    expect(bg.orderingClosed).toBe(
      'Тази маса не е отворена за поръчки от телефон. Попитайте сервитьор.',
    )
    expect(en.refusals.table_not_open).toBe(en.orderingClosed)
    expect(bg.refusals.table_not_open).toBe(bg.orderingClosed)
    expect(en.callTableNotOpen).toBe('This table isn’t open for phones. Wave to a waiter.')
    expect(bg.callTableNotOpen).toBe('Тази маса не е отворена за телефони. Махнете на сервитьор.')
    // F4: beside a sent order's card the bag invites more instead of calling itself empty.
    expect([en.addMore, bg.addMore]).toEqual(['Add more from the menu.', 'Добавете още от менюто.'])
  })

  it('reads English for every language but Bulgarian', () => {
    expect(stringsFor('de_DE').guest.back).toBe('Back to menu')
    expect(stringsFor('bg_BG').guest.back).toBe('Обратно към менюто')
  })
})
