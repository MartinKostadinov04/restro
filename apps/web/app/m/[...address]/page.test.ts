import { describe, expect, it } from 'vitest'

import { generateMetadata } from './page'

const titleFor = async (search: Record<string, string | string[] | undefined>) =>
  (await generateMetadata({ searchParams: Promise.resolve(search) })).title

describe('the guest menu page’s first title (R4)', () => {
  it('is in the language the address asks for, from the messages', async () => {
    expect(await titleFor({ lang: 'en' })).toEqual({ absolute: 'Menu' })
    expect(await titleFor({ lang: 'bg' })).toEqual({ absolute: 'Меню' })
  })

  it('is Bulgarian without a language, or with one it does not have', async () => {
    expect(await titleFor({})).toEqual({ absolute: 'Меню' })
    expect(await titleFor({ lang: 'xx' })).toEqual({ absolute: 'Меню' })
    expect(await titleFor({ lang: ['en', 'bg'] })).toEqual({ absolute: 'Меню' })
  })

  it('keeps the page out of search engines', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
