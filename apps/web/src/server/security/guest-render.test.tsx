// Script and markup in every text a guest sees, in the rendered page of each face (the repair-review's
// A7, audit step 5). A POS name, a hand-made text and a tag are all whatever someone typed: the
// markup must come out as text. Pure rendering; no database.
import { EDITORIAL_MARKET_MANIFEST, EditorialMarketFace } from '@restro/editorial-market'
import { QR_PHONE_MANIFEST, QrPhoneFace } from '@restro/qr-phone'
import { buildViewModel, imageSlotsFor } from '@restro/shell'
import {
  type Fixture,
  fixtureId,
  type HtmlElement,
  parseHtml,
  snapshotFromSpec,
  textOf,
} from '@restro/shell/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const PAYLOADS = [
  '<script>window.__xss=1</script>',
  '<img src=x onerror=window.__xss=1>',
  '"><svg onload=window.__xss=1>',
  "' onmouseover='window.__xss=1",
  'javascript:window.__xss=1',
  '</style><script>window.__xss=1</script>',
  '<a href="javascript:window.__xss=1">x</a>',
  '{{7*7}}',
]

function allOf(root: HtmlElement): HtmlElement[] {
  const found = [root]
  for (const child of root.children) if (typeof child !== 'string') found.push(...allOf(child))
  return found
}

const both = (text: string) => ({ en_US: text, bg_BG: text })

function hostileMenu(payload: string): Fixture {
  const tag = fixtureId('tg', 1)
  const photo = fixtureId('as', 1)
  return {
    name: 'hostile-markup',
    note: 'Markup in every guest-visible text.',
    snapshot: snapshotFromSpec({
      locales: { default: 'en_US', available: ['en_US', 'bg_BG'] },
      menuTitle: both(payload),
      assets: { [photo]: { w: 800, h: 600, alt: both(payload) } },
      tags: { [tag]: both(payload) },
      sections: [
        {
          title: both(payload),
          description: both(payload),
          items: [
            {
              name: both(payload),
              description: both(payload),
              image: photo,
              price: 700,
              tags: [tag],
              allergens: ['milk'],
              groups: [
                {
                  name: both(payload),
                  min: 0,
                  max: 1,
                  options: [{ name: both(payload), delta: 100 }],
                },
              ],
            },
          ],
        },
      ],
    } as never),
    overlay: null,
    context: { locale: 'en_US', now: '2026-10-07T20:30:00+03:00' },
  }
}

const FACES = [
  {
    name: 'qr-phone',
    render: (payload: string) => {
      const f = hostileMenu(payload)
      const view = buildViewModel(f.snapshot, f.overlay, {
        ...f.context,
        images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
      })
      return renderToStaticMarkup(<QrPhoneFace view={view} />)
    },
  },
  {
    name: 'editorial-market',
    render: (payload: string) => {
      const f = hostileMenu(payload)
      const view = buildViewModel(f.snapshot, f.overlay, {
        ...f.context,
        images: imageSlotsFor(EDITORIAL_MARKET_MANIFEST, 1),
      })
      return renderToStaticMarkup(<EditorialMarketFace view={view} />)
    },
  },
]

describe.each(FACES)('$name with markup in every text', ({ render }) => {
  describe.each(PAYLOADS)('%s', (payload) => {
    const html = render(payload)
    const root = parseHtml(html)
    const elements = allOf(root)

    it('the page shows the payload (the test reaches the text)', () => {
      expect(textOf(root)).toContain(payload)
    })

    it('no element or handler comes from it', () => {
      for (const element of elements) {
        const tag = element.tag.toLowerCase()
        expect(['iframe', 'object', 'embed', 'script'], tag).not.toContain(tag)
        for (const name of Object.keys(element.attrs)) {
          expect(name.toLowerCase().startsWith('on'), `${tag} ${name}`).toBe(false)
        }
        const url = element.attrs.href ?? element.attrs.src ?? ''
        expect(url.toLowerCase().startsWith('javascript:'), url).toBe(false)
      }
    })

    it('the raw payload never reaches the page unescaped', () => {
      if (!/[<>]/.test(payload)) return
      expect(html).not.toContain(payload)
    })
  })
})
