import {
  buildViewModel,
  EMPTY_SERVICE_STATE,
  imageSlotsFor,
  stringsFor,
  type ViewModel,
  validateManifest,
} from '@restro/shell'
import {
  type ContractHost,
  faceContractSuite,
  fixture,
  parseHtml,
  runFaceContract,
  textOf,
  withAttribute,
} from '@restro/shell/testing'
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
import { DuplicateCheck, minutesSinceSent } from './table-order'

const render = (view: ViewModel, host?: ContractHost) =>
  renderToStaticMarkup(<QrPhoneFace view={view} languages={host?.languages} />)
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
      // The table's shared order (#75).
      ordering: true,
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
    // The contract marker the audits find the switch by (T90): the group, once.
    const marked = withAttribute(root, 'data-slot', 'menu.language')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.attrs.class).toBe('rq-lang')
    expect(withAttribute(parseHtml(render(view)), 'data-slot', 'menu.language')).toHaveLength(0)
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

  it('draws the filter chips as one menu.filters slot when the shell turned filters on (R15)', () => {
    for (const name of ['tags-dietary', 'features-on']) {
      const view = viewOf(name)
      expect(view.features.filters, name).toBe(true)
      const slots = withAttribute(parseHtml(render(view)), 'data-slot', 'menu.filters')
      expect(slots, name).toHaveLength(1)
      // The chips are inside it, and nowhere else.
      const chips = withAttribute(slots[0] as never, 'aria-pressed').filter(
        (el) => el.attrs.class === 'rq-chip',
      )
      expect(chips.length, name).toBeGreaterThan(0)
    }
  })

  it('draws no chips and no slot when the venue switched filters off, though the menu has chips (R15)', () => {
    const view = viewOf('features-off')
    expect(view.filters.tags.length + view.filters.dietary.length).toBeGreaterThan(0)
    expect(view.features.filters).toBe(false)
    const html = withoutStyle(render(view))
    expect(withAttribute(parseHtml(html), 'data-slot', 'menu.filters')).toHaveLength(0)
    expect(html).not.toContain('rq-filters')
    expect(html).not.toContain('rq-chip')
    // The menu itself is all there.
    expect(withAttribute(parseHtml(html), 'data-item')).toHaveLength(
      view.sections.flatMap((section) => section.items).length,
    )
  })

  it('draws no slot for a menu without chips', () => {
    const view = viewOf('no-images')
    expect(view.features.filters).toBe(false)
    expect(withAttribute(parseHtml(render(view)), 'data-slot', 'menu.filters')).toHaveLength(0)
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
    expect(vars['--rq-l-bg']).toBe(view.theme.colors.background)
    expect(vars['--rq-d-bg']).toBe(view.theme.colorsDark.background)
    expect(vars['--rq-radius']).toBe(`${view.theme.radius}px`)
    expect(vars['--rq-font']).toContain(view.theme.font)
    const html = render(view)
    // An inline `--rq-bg` would beat the stylesheet's dark-scheme rule: the root carries only the
    // light (`l-`) and dark (`d-`) sets, and the stylesheet picks between them.
    expect(withoutStyle(html)).not.toMatch(/--rq-(?:bg|text|accent|surface):/)
    expect(html).toContain(`--rq-l-accent:${view.theme.colors.accent}`)
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

describe('the manifest: guest features (R15)', () => {
  it('has the filter chips and the shared order (#75) as its guest controls, and no options', () => {
    expect(QR_PHONE_MANIFEST.features).toEqual(['filters', 'ordering'])
    expect(QR_PHONE_MANIFEST.options).toEqual({})
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

// The tests every face has to pass (brief SH-03): manifest, contract on every fixture, theme-only CSS.
faceContractSuite('qr-phone', { manifest: QR_PHONE_MANIFEST, render, css: FACE_CSS })

describe('the shared order (#75)', () => {
  const view = viewOf('features-on')
  const items = view.sections.flatMap((section) => section.items)
  const negroni = items[0]
  const mojito = items[1]
  if (negroni === undefined || mojito === undefined) throw new Error('the fixture has no items')
  const lineId = (n: number) => `ol_${'0'.repeat(21)}${n}` as const
  const services = {
    state: {
      ...EMPTY_SERVICE_STATE,
      ordering: { state: 'on' as const },
      order: {
        lines: [
          {
            id: lineId(1),
            itemId: negroni.id,
            optionIds: [],
            qty: 2,
            note: '',
            mode: 'on_bill' as const,
            held: false,
            pending: false,
          },
          {
            id: lineId(2),
            itemId: mojito.id,
            optionIds: [],
            qty: 1,
            note: '',
            mode: 'pay_first' as const,
            held: true,
            pending: false,
          },
        ],
        removed: [
          {
            id: lineId(3),
            itemId: mojito.id,
            optionIds: [],
            qty: 1,
            note: '',
            mode: 'on_bill' as const,
            undoSeconds: 7,
          },
        ],
        earlier: {
          setAsideAt: 1_700_000_000_000,
          lines: [
            {
              id: lineId(4),
              itemId: negroni.id,
              optionIds: [],
              qty: 1,
              note: '',
              mode: 'on_bill' as const,
            },
          ],
        },
      },
    },
    dispatch: () => Promise.reject(new Error('not in a static render')),
  }
  const html = withoutStyle(renderToStaticMarkup(<QrPhoneFace view={view} services={services} />))
  const doc = parseHtml(html)

  it('draws the order panel and an Add on each orderable item', () => {
    expect(withAttribute(doc, 'data-slot', 'menu.bag')).toHaveLength(1)
    const orderable = items.filter((item) => item.order.controls).length
    expect(orderable).toBeGreaterThan(0)
    expect(withAttribute(doc, 'data-slot', 'item.add')).toHaveLength(orderable)
  })

  it('draws each line with its quantity, and no controls on a held line', () => {
    const [first, held] = withAttribute(doc, 'data-order-line', lineId(1)).concat(
      withAttribute(doc, 'data-order-line', lineId(2)),
    )
    expect(first === undefined ? '' : textOf(first)).toContain('Negroni')
    expect(first === undefined ? '' : textOf(first)).toContain('× 2')
    expect(held === undefined ? '' : textOf(held)).toContain('Being paid')
    expect(held === undefined ? '' : textOf(held)).not.toContain('Remove')
  })

  it('says a pay-first item is ordered from the waiter', () => {
    expect(html).toContain('Order this from your waiter')
  })

  it('offers Undo on a removed line and Restore on the earlier order', () => {
    expect(withAttribute(doc, 'data-removed-line', lineId(3))).toHaveLength(1)
    expect(html).toContain('Mojito removed')
    expect(html).toContain('Undo')
    expect(withAttribute(doc, 'data-earlier-order', '')).toHaveLength(1)
    expect(html).toContain('Restore')
  })

  it('draws no order where the shell left ordering off', () => {
    const off = withoutStyle(
      renderToStaticMarkup(<QrPhoneFace view={viewOf('features-off')} services={services} />),
    )
    expect(off).not.toContain('data-slot="menu.bag"')
    expect(off).not.toContain('data-slot="item.add"')
  })
})

describe("Send's guards (#78)", () => {
  const view = viewOf('features-on')
  const items = view.sections.flatMap((section) => section.items)
  const negroni = items[0]
  const mojito = items[1]
  if (negroni === undefined || mojito === undefined) throw new Error('the fixture has no items')
  // The live overlay marks the Mojito sold out.
  const soldOutView: ViewModel = {
    ...view,
    sections: view.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.id === mojito.id
          ? { ...item, state: { ...item.state, code: 'sold_out' as const } }
          : item,
      ),
    })),
  }
  const line = (
    n: number,
    itemId: ViewModel['sections'][number]['items'][number]['id'],
    qty: number,
  ) => ({
    id: `ol_${'0'.repeat(21)}${n}` as const,
    itemId,
    optionIds: [],
    qty,
    note: '',
    mode: 'on_bill' as const,
    held: false,
    pending: false,
  })
  const draw = (shown: ViewModel, notesAndOptions?: boolean) => {
    const services = {
      state: {
        ...EMPTY_SERVICE_STATE,
        ordering: {
          state: 'on' as const,
          ...(notesAndOptions === undefined ? {} : { notesAndOptions }),
        },
        order: {
          lines: [line(1, negroni.id, 3), line(2, mojito.id, 1)],
          removed: [],
          earlier: null,
        },
      },
      dispatch: () => Promise.reject(new Error('not in a static render')),
    }
    const html = withoutStyle(
      renderToStaticMarkup(<QrPhoneFace view={shown} services={services} />),
    )
    return { html, doc: parseHtml(html) }
  }

  it('marks a sold-out line, keeps it on the order and offers "Send the other N"', () => {
    const { html, doc } = draw(soldOutView)
    const [marked] = withAttribute(doc, 'data-sold-out', '')
    expect(marked === undefined ? '' : textOf(marked)).toContain('Sold out')
    expect(withAttribute(doc, 'data-sold-out', '')).toHaveLength(1)
    expect(html).toContain('Send the other 3')
    expect(html).not.toContain('Send 4 items')
  })

  it('says "Send N items" when nothing is sold out', () => {
    const { html, doc } = draw(view)
    expect(withAttribute(doc, 'data-sold-out', '')).toHaveLength(0)
    expect(html).toContain('Send 4 items')
  })

  it('asks "Same as 4 minutes ago. Send another?" with Send another and Cancel', () => {
    const strings = stringsFor('en_US').services
    const ask = (minutes: number | null) =>
      renderToStaticMarkup(
        <DuplicateCheck
          minutes={minutes}
          strings={strings}
          onSend={() => {}}
          onCancel={() => {}}
        />,
      )
    expect(ask(4)).toContain('Same as 4 minutes ago. Send another?')
    expect(ask(4)).toContain('Send another')
    expect(ask(4)).toContain('Cancel')
    expect(ask(0)).toContain('Same as a moment ago')
    expect(ask(null)).toContain(strings.refusals.duplicate_order)
  })

  it('says "Tell the staff" where notes and options do not reach the ticket', () => {
    for (const declared of [undefined, false]) {
      const { doc } = draw(view, declared)
      const [line] = withAttribute(doc, 'data-notes-at-staff', '')
      expect(line === undefined ? '' : textOf(line)).toBe(
        'Allergies or special requests? Tell the staff.',
      )
    }
    expect(withAttribute(draw(view, true).doc, 'data-notes-at-staff', '')).toHaveLength(0)
  })

  it('orders an item that needs a choice from the waiter where options do not reach the ticket', () => {
    const shot: ViewModel = {
      ...view,
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.id === negroni.id
            ? {
                ...item,
                order: { ...item.order, controls: true },
                modifierGroups: [
                  {
                    id: 'nd_0000000000000000000000g1' as never,
                    name: negroni.name,
                    min: 1,
                    max: 1,
                    required: true,
                    options: [],
                  },
                ],
              }
            : item,
        ),
      })),
    }
    const asked = withAttribute(draw(shot).doc, 'data-order-from-waiter', '')
    expect(asked).toHaveLength(1)
    expect(asked[0] === undefined ? '' : textOf(asked[0])).toBe('Order this from your waiter')
    expect(draw(shot).html).not.toContain(`Add ${negroni.name.text}`)
    expect(withAttribute(draw(shot, true).doc, 'data-order-from-waiter', '')).toHaveLength(0)
    expect(draw(shot, true).html).toContain(`Add ${negroni.name.text}`)
  })

  it('counts the minutes since the sent order the check names', () => {
    const sentAt = 1_700_000_000_000
    const sent = [
      {
        id: 'so_1',
        ref: 'K7Q',
        state: 'added' as const,
        reason: null,
        mine: true,
        sentAt,
        lines: [],
      },
    ]
    expect(minutesSinceSent(sent as never, 'so_1', sentAt + 4 * 60_000 + 59_000)).toBe(4)
    expect(minutesSinceSent(sent as never, 'so_2', sentAt)).toBeNull()
  })
})

describe('out of stock at Send (#80)', () => {
  const view = viewOf('features-on')
  const items = view.sections.flatMap((section) => section.items)
  const negroni = items[0]
  const mojito = items[1]
  if (negroni === undefined || mojito === undefined) throw new Error('the fixture has no items')
  const line = (n: number, itemId: typeof negroni.id, qty: number) => ({
    id: `ol_${'0'.repeat(21)}${n}` as const,
    itemId,
    optionIds: [],
    qty,
    note: '',
    mode: 'on_bill' as const,
    held: false,
    pending: false,
  })
  // The POS refused the last Send for the Mojito; the menu does not show it sold out yet.
  const services = {
    state: {
      ...EMPTY_SERVICE_STATE,
      ordering: { state: 'on' as const },
      order: { lines: [line(1, negroni.id, 2), line(2, mojito.id, 1)], removed: [], earlier: null },
      sentOrders: [
        {
          id: 'so_1',
          state: 'not_sent' as const,
          reason: 'item_unavailable',
          ref: 'K7Q',
          lines: [
            { itemId: negroni.id, optionIds: [], qty: 2 },
            { itemId: mojito.id, optionIds: [], qty: 1, outOfStock: true as const },
          ],
          sentAt: 1_700_000_000_000,
          mine: true,
        },
      ],
    },
    dispatch: () => Promise.reject(new Error('not in a static render')),
  }
  const html = withoutStyle(renderToStaticMarkup(<QrPhoneFace view={view} services={services} />))
  const doc = parseHtml(html)

  it('greys the run-out line as sold out and offers to send the rest', () => {
    const [out] = withAttribute(doc, 'data-sold-out', '')
    expect(withAttribute(doc, 'data-sold-out', '')).toHaveLength(1)
    expect(out === undefined ? '' : textOf(out)).toContain(mojito.name.text)
    expect(out === undefined ? '' : textOf(out)).toContain('Sold out')
    expect(html).toContain('Send the other 2')
    expect(html).toContain('Nothing was sent: something ran out.')
  })
})

describe('the location check (#76)', () => {
  const view = viewOf('features-on')
  const controls = { allow: async () => null, decline() {}, reopen() {}, dismiss() {} }
  const noCalls = { ...view, features: { ...view.features, callWaiter: null } }
  const draw = (
    prompt: 'none' | 'consent' | 'checking' | 'failed',
    state = 'needed' as const,
    shown = view,
  ) => {
    const services = {
      state: {
        ...EMPTY_SERVICE_STATE,
        ordering: { state: 'on' as const },
        order: null,
        location: { state, prompt, consent: 'unknown' as const, venueName: 'Club Nova' },
      },
      dispatch: () => Promise.reject(new Error('not in a static render')),
      location: controls,
    }
    const html = withoutStyle(
      renderToStaticMarkup(<QrPhoneFace view={shown} services={services} />),
    )
    return { html, doc: parseHtml(html) }
  }

  it('asks for consent in D122’s words, naming the venue, with Allow and Not now', () => {
    const { html, doc } = draw('consent')
    expect(withAttribute(doc, 'data-location-prompt', 'consent')).toHaveLength(1)
    expect(html).toContain('Club Nova and Restro check your location')
    expect(html).not.toMatch(/\bpay\b/i)
    expect(html).toContain('Allow')
    expect(html).toContain('Not now')
  })

  it('offers Call a waiter and Cancel when the check fails where the venue takes calls', () => {
    const { html, doc } = draw('failed')
    expect(withAttribute(doc, 'data-location-prompt', 'failed')).toHaveLength(1)
    expect(html).toContain('Call a waiter')
    expect(html).not.toContain('Please order from your waiter')
    expect(html).toContain('Cancel')
  })

  it('shows the still card, never a Call a waiter button, where the venue takes no calls', () => {
    const { html, doc } = draw('failed', 'needed', noCalls)
    expect(withAttribute(doc, 'data-location-prompt', 'failed')).toHaveLength(1)
    expect(withAttribute(doc, 'data-location-still-card', '')).toHaveLength(1)
    expect(html).toContain('Please order from your waiter')
    expect(html).not.toContain('Call a waiter')
    expect(html).toContain('Cancel')
  })

  it('says why the order is hidden, with the guest’s own Allow location, and no empty order', () => {
    const { html, doc } = draw('none')
    expect(withAttribute(doc, 'data-location-prompt', 'none')).toHaveLength(1)
    expect(html).toContain('Allow location')
    expect(html).not.toContain('Nothing on the table order yet')
    expect(draw('checking').html).toContain('Checking your location')
  })
})

describe('the night of the venue (#82)', () => {
  const view = viewOf('features-on')
  const negroni = view.sections.flatMap((section) => section.items)[0]
  if (negroni === undefined) throw new Error('the fixture has no items')
  const draw = (night: {
    state: 'open' | 'last_orders' | 'opens_later' | 'closed'
    at: string | null
  }) => {
    const services = {
      state: {
        ...EMPTY_SERVICE_STATE,
        ordering: { state: 'on' as const, notesAndOptions: false, night },
        order: {
          lines: [
            {
              id: `ol_${'0'.repeat(22)}` as const,
              itemId: negroni.id,
              optionIds: [],
              qty: 1,
              note: '',
              mode: 'on_bill' as const,
              held: false,
              pending: false,
            },
          ],
          removed: [],
          earlier: null,
        },
      },
      dispatch: () => Promise.reject(new Error('not in a static render')),
    }
    const html = withoutStyle(renderToStaticMarkup(<QrPhoneFace view={view} services={services} />))
    return { html, doc: parseHtml(html) }
  }

  it('sends normally while open, with no notice', () => {
    const { html, doc } = draw({ state: 'open', at: null })
    expect(withAttribute(doc, 'data-send', '')).toHaveLength(1)
    expect(html).not.toContain('Last orders at')
  })

  it('says Last orders at 04:30 and still lets the guest send', () => {
    const { html, doc } = draw({ state: 'last_orders', at: '04:30' })
    expect(html).toContain('Last orders at 04:30')
    expect(withAttribute(doc, 'data-last-orders', '')).toHaveLength(1)
    expect(withAttribute(doc, 'data-send', '')).toHaveLength(1)
  })

  it('says ordering from phones has closed for tonight, and takes Send away', () => {
    const { html, doc } = draw({ state: 'closed', at: null })
    expect(html).toContain('Ordering from phones has closed for tonight')
    expect(withAttribute(doc, 'data-send', '')).toHaveLength(0)
  })

  it('says when ordering opens, and takes Send away until then', () => {
    const { html, doc } = draw({ state: 'opens_later', at: '22:00' })
    expect(html).toContain('Ordering from phones opens at 22:00')
    expect(withAttribute(doc, 'data-send', '')).toHaveLength(0)
  })
})
