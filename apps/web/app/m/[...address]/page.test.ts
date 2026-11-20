import { describe, expect, it } from 'vitest'

import { metadata } from './page'

describe('the guest menu page’s static title', () => {
  it('names the tab in Bulgarian first, from the messages, before the page knows the language (R4)', () => {
    expect(metadata.title).toEqual({ absolute: 'Меню' })
  })
})
