// docs/guides/qr-links.md (brief S3-07): the written guide to the two kinds of address on a QR code.
// Checked as a file: Bulgarian first, then English, the same sections in both, no hard-coded domain,
// and every button and field it quotes is called that in the tab (so the words cannot drift apart).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

  it('never hard-codes a domain: addresses are placeholders, or the network address of a PC', () => {
    const urls = GUIDE.match(/https?:\/\/[^\s`"')]+/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      const rest = url.replace(/^https?:\/\//, '')
      // `<your-domain>`, `<our-address>`, `menu.<your-domain>`, `192.168.1.20` or `localhost`,
      // followed by the end, a path, a port or a variable of the server's own syntax.
      expect(rest, url).toMatch(
        /^(?:[a-z.]*<[^>]+>|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?:$|[/:$;?])/i,
      )
    }
  })

  it('names the buttons and fields of the tab as they are called in the tab', () => {
    const quoted = {
      bg: [
        bg.tables.address.title,
        bg.tables.address.ours,
        bg.tables.address.own,
        bg.tables.address.baseUrl,
        bg.tables.address.pattern,
        bg.tables.address.testLink,
        bg.tables.address.save,
        bg.tables.createAll,
        bg.tables.printSheet,
        bg.tables.print.button,
        bg.workspace.tabs.tables,
      ],
      en: [
        en.tables.address.title,
        en.tables.address.ours,
        en.tables.address.own,
        en.tables.address.baseUrl,
        en.tables.address.pattern,
        en.tables.address.testLink,
        en.tables.address.save,
        en.tables.createAll,
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
