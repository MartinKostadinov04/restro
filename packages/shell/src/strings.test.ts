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

  it('reads English for every language but Bulgarian', () => {
    expect(stringsFor('de_DE').guest.back).toBe('Back to menu')
    expect(stringsFor('bg_BG').guest.back).toBe('Обратно към менюто')
  })
})
