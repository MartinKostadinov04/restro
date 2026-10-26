import { describe, expect, it } from 'vitest'

import { stringsFor } from './strings'

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

  it('reads English for every language but Bulgarian', () => {
    expect(stringsFor('de_DE').guest.back).toBe('Back to menu')
    expect(stringsFor('bg_BG').guest.back).toBe('Обратно към менюто')
  })
})
