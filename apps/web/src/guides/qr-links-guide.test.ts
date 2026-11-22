// docs/guides/qr-links.md (brief S3-07): the written guide to the two kinds of address on a QR code.
// Checked as a file: Bulgarian first, then English, the same sections in both, no hard-coded domain,
// and every button and field it quotes is called that in the tab (so the words cannot drift apart).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import bg from '../../messages/bg.json'
import en from '../../messages/en.json'
import { isGuideName, loadGuide } from '../server/guides'
import { parseBlocks, splitLanguages } from './markdown'

const GUIDE = readFileSync(
  fileURLToPath(new URL('../../../../docs/guides/qr-links.md', import.meta.url)),
  'utf8',
)
const languages = splitLanguages(GUIDE)
/** The tab's "Create the N missing codes" button as the guide quotes it, for eight tables. */
const createMissing = (locale: 'bg' | 'en') =>
  createTranslator({ locale, messages: locale === 'bg' ? bg : en, namespace: 'tables' })(
    'createMissing',
    { count: 8 },
  )
const headingsOf = (text: string) =>
  parseBlocks(text).filter((block) => block.type === 'heading').length

describe('docs/guides/qr-links.md', () => {
  it('is Bulgarian first, then English, and the admin can load it from where the server runs', async () => {
    expect(Object.keys(languages)).toEqual(['bg', 'en'])
    expect(GUIDE.indexOf('<!-- lang:bg -->')).toBeLessThan(GUIDE.indexOf('<!-- lang:en -->'))
    const web = fileURLToPath(new URL('../..', import.meta.url))
    const root = fileURLToPath(new URL('../../../..', import.meta.url))
    expect(await loadGuide('qr-links', web)).toBe(GUIDE)
    expect(await loadGuide('qr-links', root)).toBe(GUIDE)
    expect(await loadGuide('qr-links', fileURLToPath(new URL('.', import.meta.url)))).toBeNull()
  })

  it('can only load the guides it names', () => {
    expect(isGuideName('qr-links')).toBe(true)
    expect(isGuideName('../../.env.local')).toBe(false)
    expect(isGuideName('constructor')).toBe(false)
  })

  it.each(['bg', 'en'] as const)(
    '%s: covers both options, the three examples and a broken forwarding',
    (lang) => {
      const text = languages[lang] as string
      for (const needle of [
        'Cloudflare',
        'Redirect Rules',
        '.htaccess',
        'nginx',
        '/t/',
        '{token}',
        '302',
      ]) {
        expect(text, needle).toContain(needle)
      }
      // The same sections in both languages.
      expect(headingsOf(text)).toBe(headingsOf(languages[lang === 'bg' ? 'en' : 'bg'] as string))
      expect(headingsOf(text)).toBeGreaterThanOrEqual(10)
    },
  )

  it('never hard-codes a domain or a machine: addresses are placeholders', () => {
    const urls = GUIDE.match(/https?:\/\/[^\s`"')]+/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      const rest = url.replace(/^https?:\/\//, '')
      // `<your-domain>`, `<our-address>` or `menu.<your-domain>`, followed by the end, a path, a
      // port or a variable of the server's own syntax.
      expect(rest, url).toMatch(/^[a-z.]*<[^>]+>(?:$|[/:$;?])/i)
    }
  })

  // R3 (screen round 2026-11-18, lane 5): the card is read-only ("Codes lead to"), so the guide
  // names no control the card lacks, and no developer step (a computer's network address).
  it('describes only the controls the card has, and no developer step', () => {
    for (const gone of [
      'Base address',
      'Our link',
      'Link pattern',
      'Save address',
      "The venue's own link",
      'Основен адрес',
      'Нашият линк',
      'Шаблон на линка',
      'Запиши адреса',
      'Собствен линк на заведението',
      '192.168',
      'localhost',
    ]) {
      expect(GUIDE, gone).not.toContain(gone)
    }
  })

  it('names the buttons and fields of the tab as they are called in the tab', () => {
    const quoted = {
      bg: [
        bg.tables.address.title,
        bg.tables.address.leads,
        bg.tables.address.domainLater,
        bg.tables.address.testLink,
        createMissing('bg'),
        bg.tables.printSheet,
        bg.tables.print.button,
        bg.workspace.tabs.tables,
      ],
      en: [
        en.tables.address.title,
        en.tables.address.leads,
        en.tables.address.domainLater,
        en.tables.address.testLink,
        createMissing('en'),
        en.tables.printSheet,
        en.tables.print.button,
        en.workspace.tabs.tables,
      ],
    }
    for (const lang of ['bg', 'en'] as const) {
      for (const label of quoted[lang]) {
        expect(languages[lang], `“${label}” in the ${lang} guide`).toContain(label)
      }
    }
  })
})
