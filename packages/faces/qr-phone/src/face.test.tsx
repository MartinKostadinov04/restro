import { buildViewModel, imageSlotsFor, type ViewModel, validateManifest } from '@restro/shell'
import { fixture, parseHtml, runFaceContract, textOf, withAttribute } from '@restro/shell/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FACE_CSS } from './css'
import { QrPhoneFace } from './face'
import { QR_PHONE_MANIFEST } from './manifest'
import {
  assetUrl,
  bcp47,
  filterSections,
  languageLabel,
  matchesFilters,
  NO_FILTERS,
  themeVariables,
} from './model'
import { QrPhoneNotice, QrPhoneSkeleton } from './notices'

const render = (view: ViewModel) => renderToStaticMarkup(<QrPhoneFace view={view} />)
/** The markup without the stylesheet (whose text mentions every class). */
const withoutStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '')

function viewOf(name: string, overrides: Record<string, unknown> = {}): ViewModel {
  const f = fixture(name)
  return buildViewModel(f.snapshot, f.overlay, {
    ...f.context,
    images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
    ...overrides,
  })
}

describe('the qr-phone manifest', () => {
  it('passes validateManifest (R6, R7, R9)', () => {
    expect(validateManifest(QR_PHONE_MANIFEST).ok).toBe(true)
  })

  it('declares what the brief asks for', () => {
    expect(QR_PHONE_MANIFEST).toMatchObject({
      face: 'qr-phone',
      channels: ['qr'],
      paging: null,
      allergen_mode: 'inline_codes',
      no_image_layout: 'text_only',
      ordering: false,
    })
    expect(QR_PHONE_MANIFEST.slots['item.image']).toEqual({
      optional: true,
      variant: 'card',
      aspect: '4:3',
    })
    expect(QR_PHONE_MANIFEST.slots['item.description']).toEqual({
      optional: true,
      lines: 3,
      overflow: 'expand',
    })
  })
})

describe('the face contract (brief S3-02 harness, every fixture)', () => {
  it('renders every fixture with every required slot, in order, with no failure', async () => {
    const report = await runFaceContract(render, QR_PHONE_MANIFEST)
    expect(report.failures).toEqual([])
    expect(report.renders).toBeGreaterThanOrEqual(10)
    expect(report.items).toBeGreaterThan(300)
  })

  it('also passes on a dense screen (the shell picks the larger photo variant)', async () => {
    const report = await runFaceContract(render, QR_PHONE_MANIFEST, { density: 3 })
    expect(report.failures).toEqual([])
  })
})

describe('what the face draws', () => {
  it('draws the title, the intro and the sections in snapshot order', () => {
    const view = viewOf('tags-dietary')
    const root = parseHtml(render(view))
    expect(textOf(withAttribute(root, 'data-slot', 'menu.title')[0] as never)).toBe(
      view.menu.title?.text,
    )
    const headings = withAttribute(root, 'data-section').map((el) => el.attrs['data-section'])
    expect(headings).toEqual(view.sections.map((section) => section.id))
  })

  it('shows the table banner only when a table is known', () => {
    const view = viewOf('no-images')
    expect(withoutStyle(render(view))).not.toContain('menu.table')
    const html = renderToStaticMarkup(<QrPhoneFace view={view} tableLabel="12" />)
    expect(textOf(withAttribute(parseHtml(html), 'data-slot', 'menu.table')[0] as never)).toBe(
      view.locale === 'bg_BG' ? 'Маса 12' : 'Table 12',
    )
    // A named table is shown as it is.
    const named = renderToStaticMarkup(<QrPhoneFace view={view} tableLabel="VIP 3" />)
    expect(textOf(withAttribute(parseHtml(named), 'data-slot', 'menu.table')[0] as never)).toBe(
      'VIP 3',
    )
  })

  it('shows the language switch only with two languages, the current one pressed', () => {
    const view = viewOf('tags-dietary')
    expect(withoutStyle(render(view))).not.toContain('rq-lang')
    const html = renderToStaticMarkup(
      <QrPhoneFace view={view} languages={['bg_BG', 'en_US']} onLanguageChange={() => {}} />,
    )
    const root = parseHtml(html)
    const buttons = withAttribute(root, 'lang').filter(
      (el) => el.tag === 'button' && el.parent?.attrs.class === 'rq-lang',
    )
    expect(buttons.map(textOf)).toEqual(['БГ', 'EN'])
    expect(buttons.map((el) => el.attrs['aria-pressed'])).toEqual(['true', 'false'])
  })

  it('draws a jump link per section and filter chips from the view model', () => {
    const view = viewOf('tags-dietary')
    const html = render(view)
    const root = parseHtml(html)
    const links = withAttribute(root, 'href').filter((el) => el.attrs.href?.startsWith('#s-nd_'))
    // A single-section menu has no jump bar; the fixture has one, so none are drawn.
    expect(links.length).toBe(view.sections.length > 1 ? view.sections.length : 0)
    const chips = withAttribute(root, 'aria-pressed').filter((el) => el.attrs.class === 'rq-chip')
    // "All" chip per group, then one chip per entry.
    const expected =
      (view.filters.dietary.length > 0 ? 1 + view.filters.dietary.length : 0) +
      (view.filters.tags.length > 0 ? 1 + view.filters.tags.length : 0)
    expect(chips).toHaveLength(expected)
  })

  it('reserves the photo box, lazy loads it and gives a srcset', () => {
    const view = viewOf('with-images')
    const html = renderToStaticMarkup(<QrPhoneFace view={view} assetBase="/cdn" />)
    const images = withAttribute(parseHtml(html), 'srcset')
    expect(images.length).toBeGreaterThan(0)
    for (const img of images) {
      expect(img.attrs.loading).toBe('lazy')
      expect(Number(img.attrs.width)).toBeGreaterThan(0)
      expect(Number(img.attrs.height)).toBeGreaterThan(0)
      expect(img.attrs.src).toMatch(/^\/cdn\/a\/as_/)
      expect(img.attrs.srcset).toMatch(/\/cdn\/a\/as_[0-9A-Za-z]+\/w\d+\.webp \d+w/)
      expect(img.attrs.sizes).toBeTruthy()
    }
  })

  it('collapses the photo slot for an item without a photo (text only)', () => {
    const view = viewOf('no-images')
    expect(withAttribute(parseHtml(render(view)), 'data-slot', 'item.image')).toHaveLength(0)
  })

  it('takes the asset base from the host (the CDN, later)', () => {
    const view = viewOf('with-images')
    const html = renderToStaticMarkup(
      <QrPhoneFace view={view} assetBase="https://cdn.example.test/" />,
    )
    expect(html).toContain('src="https://cdn.example.test/a/as_')
  })

  it('paints from the theme variables only, for a light and a dark screen', () => {
    const view = viewOf('no-images')
    const vars = themeVariables(view.theme)
    expect(vars['--rq-bg']).toBe(view.theme.colors.background)
    expect(vars['--rq-d-bg']).toBe(view.theme.colorsDark.background)
    expect(vars['--rq-radius']).toBe(`${view.theme.radius}px`)
    expect(vars['--rq-font']).toContain(view.theme.font)
    const html = render(view)
    expect(html).toContain(`--rq-accent:${view.theme.colors.accent}`)
    expect(renderToStaticMarkup(<QrPhoneFace view={view} scheme="dark" />)).toContain(
      'data-scheme="dark"',
    )
  })

  it('uses the host font stack for a font it self-hosts', () => {
    const view = viewOf('no-images')
    const vars = themeVariables(view.theme, { [view.theme.font]: 'var(--font-inter), sans-serif' })
    expect(vars['--rq-font']).toBe('var(--font-inter), sans-serif')
  })
})

describe('the stylesheet', () => {
  it('holds no colour of its own (R13): only variables and CSS system colours', () => {
    expect(FACE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(FACE_CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/)
    const named =
      /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal|gold)(?![-\w])/
    expect(FACE_CSS).not.toMatch(named)
  })

  it('makes every control at least 44 px tall', () => {
    const controls = [
      '.rq-chip',
      '.rq-jump a',
      '.rq-allergen',
      '.rq-more',
      '.rq-close',
      '.rq-clear',
    ]
    for (const selector of controls) {
      const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*min-height:\\s*44px`)
      expect(FACE_CSS, selector).toMatch(rule)
    }
    expect(FACE_CSS).toMatch(/\.rq-lang button\s*\{[^}]*min-height:\s*44px/)
  })

  it('respects prefers-reduced-motion and prefers-color-scheme', () => {
    expect(FACE_CSS).toContain('prefers-reduced-motion: reduce')
    expect(FACE_CSS).toContain('prefers-color-scheme: dark')
  })

  it('cuts only the description, to three lines', () => {
    expect(FACE_CSS.match(/-webkit-line-clamp/g)).toHaveLength(1)
    expect(FACE_CSS).toMatch(/\.rq-desc\[data-clamped="true"\][^}]*-webkit-line-clamp:\s*3/)
    expect(FACE_CSS).not.toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('loading and notice states', () => {
  it('draws a skeleton and a notice without a view model', () => {
    const skeleton = renderToStaticMarkup(<QrPhoneSkeleton label="Loading" lang="en-US" />)
    expect(skeleton).toContain('aria-busy="true"')
    const notice = renderToStaticMarkup(
      <QrPhoneNotice title="Menu not found" text="Ask the staff." lang="en-US" />,
    )
    expect(notice).toContain('Menu not found')
    expect(notice).not.toContain('<button')
  })
})

describe('model helpers', () => {
  it('builds asset addresses and language tags', () => {
    expect(assetUrl('/cdn', '/a/as_x/w640.webp')).toBe('/cdn/a/as_x/w640.webp')
    expect(assetUrl('https://cdn.test/', '/a/as_x/w640.webp')).toBe(
      'https://cdn.test/a/as_x/w640.webp',
    )
    expect(bcp47('bg_BG')).toBe('bg-BG')
    expect(languageLabel('bg_BG')).toBe('БГ')
    expect(languageLabel('en_US')).toBe('EN')
    expect(languageLabel('de_DE')).toBe('DE')
  })

  it('filters: tags are alternatives, dietary labels are requirements, order is kept', () => {
    const view = viewOf('tags-dietary')
    const all = view.sections.flatMap((section) => section.items)
    const tagged = all.find((item) => item.tags.length > 0)
    expect(tagged).toBeDefined()
    const tagId = tagged?.tags[0]?.id as string
    const byTag = { tags: new Set([tagId]), dietary: new Set<string>() }
    expect(all.filter((item) => matchesFilters(item, byTag))).toEqual(
      all.filter((item) => item.tags.some((tag) => tag.id === tagId)),
    )
    const both = { tags: new Set<string>(), dietary: new Set(['vegan', 'halal']) }
    for (const item of all.filter((item) => matchesFilters(item, both))) {
      expect(item.dietary.map((label) => label.code)).toEqual(
        expect.arrayContaining(['vegan', 'halal']),
      )
    }
    expect(filterSections(view.sections, NO_FILTERS)).toBe(view.sections)
    const filtered = filterSections(view.sections, byTag)
    expect(
      filtered.flatMap((section) => section.items).every((item) => matchesFilters(item, byTag)),
    ).toBe(true)
    // A section with nothing left goes.
    const none = { tags: new Set(['tg_does_not_exist']), dietary: new Set<string>() }
    expect(filterSections(view.sections, none)).toEqual([])
  })
})
