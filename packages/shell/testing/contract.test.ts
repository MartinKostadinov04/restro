import { CALL_WAITER_KINDS, MenuSnapshotSchema, validateRoles } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { buildViewModel } from '../src/build'
import { type FaceManifest, validateManifest } from '../src/manifest'
import type { ViewItem, ViewModel, ViewSection } from '../src/view-model'
import { FEATURE_SLOTS, LAYOUT_SWITCH_SLOT, type RenderFn, runFaceContract } from './contract'
import { CUSTOM_ROLES, fixture, fixtureId, fixtures } from './fixtures'
import { type HtmlElement, parseHtml, textOf, withAttribute } from './html'
import { faceContractSuite } from './suite'

const manifest = (() => {
  const result = validateManifest({
    face: 'reference',
    version: '1.0.0',
    channels: ['qr'],
    slots: {
      'item.name': 'required',
      'item.price': 'required',
      'item.allergens': 'required',
      'item.state': 'required',
      'item.description': { optional: true, lines: 3, overflow: 'expand' },
      'item.image': { optional: true, variant: 'card', aspect: '4:3' },
      'item.badges': 'optional',
      'item.portion': 'optional',
      'item.dietary': 'optional',
      'item.tags': 'optional',
      'item.extra_fields': 'optional',
      'item.modifiers': 'optional',
    },
    allergen_mode: 'inline_codes',
    no_image_layout: 'text_only',
    ordering: false,
    paging: null,
    tokens: ['palette.50', 'font'],
  })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.manifest
})()

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const lang = (locale: string) => locale.replace('_', '-')

/** A small face that does everything right. `tweak` breaks one thing. */
function referenceFace(
  tweak: (item: ViewItem, html: string, view: ViewModel) => string = (_i, h) => h,
): RenderFn {
  return (view) => {
    const item = (entry: ViewItem): string => {
      const name = `<h3 data-slot="item.name" lang="${lang(entry.name.lang)}">${esc(entry.name.text)}</h3>`
      const price =
        entry.price === null ? '' : `<span data-slot="item.price">${esc(entry.price.text)}</span>`
      const state = `<span data-slot="item.state" data-state="${entry.state.code}">${esc(entry.state.label?.text ?? '')}</span>`
      const allergens =
        entry.allergens.length === 0
          ? ''
          : `<ul data-slot="item.allergens">${entry.allergens
              .map(
                (a) => `<li data-allergen="${a.code}" title="${esc(a.label.text)}">${a.code}</li>`,
              )
              .join('')}</ul>`
      const description =
        entry.description === null
          ? ''
          : `<p data-slot="item.description" lang="${lang(entry.description.lang)}">${esc(entry.description.text)}</p>`
      const image =
        entry.image === null
          ? ''
          : `<img data-slot="item.image" src="${entry.image.src}" alt="${esc(entry.image.alt?.text ?? '')}">`
      const badges =
        entry.badges.length === 0
          ? ''
          : `<span data-slot="item.badges">${entry.badges.map((b) => esc(b.label.text)).join(' ')}</span>`
      const portion =
        entry.portion === null
          ? ''
          : `<span data-slot="item.portion">${esc(entry.portion.text)}</span>`
      const dietary =
        entry.dietary.length === 0
          ? ''
          : `<span data-slot="item.dietary">${entry.dietary.map((d) => esc(d.label.text)).join(', ')}</span>`
      const tags =
        entry.tags.length === 0
          ? ''
          : `<span data-slot="item.tags">${entry.tags.map((t) => `<b data-tag="${t.id}">${esc(t.label.text)}</b>`).join('')}</span>`
      const extra =
        entry.extraFields.length === 0
          ? ''
          : `<dl data-slot="item.extra_fields">${entry.extraFields.map((f) => `<dt>${esc(f.label.text)}</dt><dd>${esc(f.text)}</dd>`).join('')}</dl>`
      const modifiers =
        entry.modifierGroups.length === 0
          ? ''
          : `<div data-slot="item.modifiers">${entry.modifierGroups.map((g) => `<section>${esc(g.name.text)}${g.options.map((o) => `<i>${esc(o.name.text)} ${esc(o.delta?.text ?? '')}</i>`).join('')}</section>`).join('')}</div>`
      const html = `<article data-item="${entry.id}">${image}${name}${price}${state}${allergens}${description}${badges}${portion}${dietary}${tags}${extra}${modifiers}</article>`
      return tweak(entry, html, view)
    }
    const section = (entry: ViewSection): string =>
      `<section><h2>${esc(entry.title.text)}</h2>${entry.items.map(item).join('')}${entry.sections.map(section).join('')}</section>`
    return `<!doctype html><html lang="${lang(view.locale)}"><body>${view.sections.map(section).join('')}</body></html>`
  }
}

function rules(report: Awaited<ReturnType<typeof runFaceContract>>): string[] {
  return [...new Set(report.failures.map((failure) => failure.rule))].sort()
}

describe('fixtures', () => {
  it('all pass the snapshot schema of S3-01a', () => {
    for (const fixture of fixtures()) {
      expect(MenuSnapshotSchema.safeParse(fixture.snapshot).success, fixture.name).toBe(true)
    }
  })

  it('cover the hard cases of the doc and the brief', () => {
    const all = fixtures()
    const byName = (name: string) => all.find((fixture) => fixture.name === name)
    const names = (name: string) => Object.values(byName(name)?.snapshot.items ?? {})

    expect(
      names('long-names').some((item) => Object.values(item.name).some((n) => n.length === 60)),
    ).toBe(true)
    expect(byName('six-languages')?.snapshot.locales.available).toHaveLength(6)
    expect(Object.keys(byName('no-images')?.snapshot.assets ?? {})).toEqual([])
    expect(Object.keys(byName('with-images')?.snapshot.assets ?? {}).length).toBeGreaterThan(0)
    expect(Object.keys(byName('sold-out')?.overlay?.items ?? {}).length).toBeGreaterThan(0)
    expect(names('scheduled').some((item) => item.availability.schedule !== null)).toBe(true)
    expect(Object.keys(byName('big-menu')?.snapshot.items ?? {})).toHaveLength(300)
    expect(
      Object.keys(byName('deep-modifiers')?.snapshot.modifier_groups ?? {}).length,
    ).toBeGreaterThanOrEqual(4)
    expect(names('ask-waiter').some((item) => item.order_mode === 'ask_waiter')).toBe(true)
    const tagged = byName('tags-dietary')
    expect(Object.keys(tagged?.snapshot.tags ?? {}).length).toBeGreaterThan(0)
    expect(
      Object.values(tagged?.snapshot.items ?? {}).some((item) => item.dietary.length > 0),
    ).toBe(true)
  })

  it('are built fresh, so one test cannot change another', () => {
    const a = fixtures()[0]
    const b = fixtures()[0]
    expect(a?.snapshot).toEqual(b?.snapshot)
    expect(a?.snapshot).not.toBe(b?.snapshot)
  })

  it('keep the ten fixtures of S3-02 first and in order, then the three of SH-03, the two of S6 and the two of D109', () => {
    expect(fixtures().map((f) => f.name)).toEqual([
      'long-names',
      'six-languages',
      'no-images',
      'with-images',
      'sold-out',
      'scheduled',
      'big-menu',
      'deep-modifiers',
      'ask-waiter',
      'tags-dietary',
      'custom-roles',
      'features-on',
      'features-off',
      'horizontal-sections',
      'one-column',
      'hostile-names',
      'crowded',
    ])
  })

  it('each describe their hard case', () => {
    for (const f of fixtures()) {
      expect(f.note.trim().length, f.name).toBeGreaterThan(20)
    }
  })
})

describe('the SH-03 fixtures', () => {
  const viewOf = (name: string): ViewModel => {
    const f = fixture(name)
    return buildViewModel(f.snapshot, f.overlay, f.context)
  }

  it('custom-roles: a snapshot with its own readable roles and a forced dark scheme', () => {
    const f = fixture('custom-roles')
    expect(f.snapshot.theme.roles).toEqual(CUSTOM_ROLES)
    expect(f.snapshot.theme.scheme).toBe('dark')
    expect(validateRoles(CUSTOM_ROLES)).toEqual([])
    const view = viewOf('custom-roles')
    expect(view.theme.scheme).toBe('dark')
    expect(view.theme.colors.background).toBe(CUSTOM_ROLES.light.background)
    expect(view.theme.colorsDark.accent).toBe(CUSTOM_ROLES.dark.accent)
  })

  it('features-on: every feature switched on, supported, at a table with ordering on, with chips', () => {
    const f = fixture('features-on')
    expect(f.snapshot.features).toEqual({
      filters: true,
      call_waiter: { enabled: true, kinds: [...CALL_WAITER_KINDS] },
      bill: true,
      ordering: true,
      pay: true,
    })
    expect(f.context).toMatchObject({
      orderingEnabled: true,
      capabilities: { callWaiter: true, bill: true, ordering: true, pay: true },
    })
    expect(f.context.tableToken).toEqual(expect.any(String))
    const view = viewOf('features-on')
    expect(view.features).toEqual({
      filters: true,
      callWaiter: { kinds: [...CALL_WAITER_KINDS] },
      bill: true,
      ordering: true,
      pay: true,
    })
    expect(view.ordering.enabled).toBe(true)
  })

  it('features-off: filters off while chips exist, every service off though the platform supports it', () => {
    const f = fixture('features-off')
    expect(f.snapshot.features?.filters).toBe(false)
    expect(f.context.capabilities).toEqual({
      callWaiter: true,
      bill: true,
      ordering: true,
      pay: true,
    })
    const view = viewOf('features-off')
    expect(view.filters.tags.length).toBeGreaterThan(0)
    expect(view.filters.dietary.length).toBeGreaterThan(0)
    expect(view.features).toEqual({
      filters: false,
      callWaiter: null,
      bill: false,
      ordering: false,
      pay: false,
    })
  })
})

describe('the S6 fixtures (D92)', () => {
  const viewOf = (name: string): ViewModel => {
    const f = fixture(name)
    return buildViewModel(f.snapshot, f.overlay, f.context)
  }
  const layouts = (view: ViewModel) => view.sections.map((section) => section.hints.layout)

  it('horizontal-sections: a horizontal section that is not the first; two columns, guests may switch', () => {
    const f = fixture('horizontal-sections')
    expect(f.snapshot.layout).toEqual({ default: 'two', guest_switch: true })
    const sections = f.snapshot.menu.sections.map((id) => f.snapshot.sections[id]?.hints.layout)
    // The third section is published without a layout, as a snapshot made before D92 is.
    expect(sections).toEqual(['vertical', 'horizontal', undefined])
    const view = viewOf('horizontal-sections')
    expect(view.layout).toEqual({ default: 'two', guestSwitch: true })
    expect(layouts(view)).toEqual(['vertical', 'horizontal', 'vertical'])
  })

  it('one-column: the first section horizontal; one column, no switch', () => {
    const view = viewOf('one-column')
    expect(view.layout).toEqual({ default: 'one', guestSwitch: false })
    expect(layouts(view)).toEqual(['horizontal', 'vertical'])
  })

  it('a fixture published before D92 reads as it looked: two columns with the switch, sections vertical', () => {
    const f = fixture('long-names')
    expect(f.snapshot).not.toHaveProperty('layout')
    const view = viewOf('long-names')
    expect(view.layout).toEqual({ default: 'two', guestSwitch: true })
    expect(layouts(view)).toEqual(['vertical'])
  })
})

describe('the D109 fixtures (worst cases)', () => {
  const viewOf = (name: string): ViewModel => {
    const f = fixture(name)
    return buildViewModel(f.snapshot, f.overlay, f.context)
  }
  const names = (view: ViewModel): string[] =>
    view.sections.flatMap((section) => section.items.map((item) => item.name.text))

  it('hostile-names: capitals with the tall marks, a sixty-character one, emoji, joiners, doubles', () => {
    const f = fixture('hostile-names')
    const texts = Object.values(f.snapshot.items).flatMap((item) => Object.values(item.name))
    const caps = texts.filter((text) => text === text.toUpperCase() && /[А-Я]/.test(text))
    for (const mark of ['Й', 'Ѝ', 'Ц', 'Щ']) {
      expect(
        caps.some((text) => text.includes(mark)),
        mark,
      ).toBe(true)
    }
    expect(caps.some((text) => [...text].length === 60)).toBe(true)
    expect(texts.some((text) => text.startsWith('🍸'))).toBe(true)
    expect(texts.some((text) => text.includes(String.fromCodePoint(0x200d)))).toBe(true)
    expect(texts.some((text) => text.includes('   '))).toBe(true)
  })

  it('hostile-names: two items share one name, in both languages, and stay two placements', () => {
    const view = viewOf('hostile-names')
    const [section] = view.sections
    const twins = (section?.items ?? []).filter((item) => item.name.text === 'Негрони')
    expect(twins).toHaveLength(2)
    expect(new Set(twins.map((item) => item.id)).size).toBe(2)
    expect(new Set(twins.map((item) => item.price?.text)).size).toBe(2)
  })

  it('hostile-names: a name that is only spaces falls back to the next language, or the item is left out', () => {
    const f = fixture('hostile-names')
    // The snapshot schema takes both (a non-empty string); the shell is where a blank name is read.
    expect(
      Object.values(f.snapshot.items).filter((item) => item.name.bg_BG === '   '),
    ).toHaveLength(2)
    const view = viewOf('hostile-names')
    const fallback = view.sections[0]?.items.find(
      (item) => item.name.text === 'Only the English name',
    )
    expect(fallback?.name.lang).toBe('en_US')
    // Ten items in the snapshot, nine on the page: the one with no readable name is not drawn.
    expect(Object.keys(f.snapshot.items)).toHaveLength(10)
    expect(view.sections[0]?.items).toHaveLength(9)
    expect(names(view).every((text) => text.trim() !== '')).toBe(true)
  })

  it('crowded: twelve tags on one item, one of forty characters with no space', () => {
    const f = fixture('crowded')
    const view = viewOf('crowded')
    const crowd = view.sections[0]?.items.find((item) => item.tags.length === 12)
    expect(crowd).toBeDefined()
    const labels = (crowd?.tags ?? []).map((tag) => tag.label.text)
    const unbroken = labels.filter((label) => !label.includes(' '))
    expect(unbroken.some((label) => [...label].length === 40)).toBe(true)
    expect(Object.keys(f.snapshot.tags)).toHaveLength(12)
  })

  it('crowded: one price text is sixteen characters', () => {
    const view = viewOf('crowded')
    const lengths = view.sections.flatMap((section) =>
      section.items.map((item) => [...(item.price?.text ?? '')].length),
    )
    expect(lengths).toContain(16)
  })

  it('crowded: a section with one item, and a section with no item that the shell leaves out', () => {
    const f = fixture('crowded')
    const itemCounts = f.snapshot.menu.sections.map((id) => f.snapshot.sections[id]?.items.length)
    expect(itemCounts).toEqual([2, 1, 0])
    const view = viewOf('crowded')
    expect(view.sections.map((section) => section.items.length)).toEqual([2, 1])
  })
})

describe('html reader', () => {
  it('reads attributes, text, entities and nesting', () => {
    const root = parseHtml(
      '<div data-item="nd_1" lang="bg-BG"><p data-slot="a">Tom &amp; Jerry &#39;x&#39;<br>and <b>bold</b></p><img alt="a&gt;b" src=x><script>var a = "<p>"</script></div>',
    )
    const [item] = withAttribute(root, 'data-item')
    expect(item?.attrs.lang).toBe('bg-BG')
    expect(textOf(item as HtmlElement)).toBe("Tom & Jerry 'x'and bold")
    expect(withAttribute(root, 'data-slot')).toHaveLength(1)
    expect(withAttribute(root, 'alt')[0]?.attrs.alt).toBe('a>b')
  })
})

describe('runFaceContract', () => {
  it('passes a face that follows the contract, on every fixture', async () => {
    const report = await runFaceContract(referenceFace(), manifest)
    expect(report.failures).toEqual([])
    expect(report.renders).toBe(fixtures().length)
    expect(report.items).toBeGreaterThan(300)
  })

  it('R7: catches a face that drops a required slot', async () => {
    const report = await runFaceContract(
      referenceFace((_item, html) =>
        html.replace(/<span data-slot="item.state"[^>]*>.*?<\/span>/, ''),
      ),
      manifest,
    )
    expect(rules(report)).toEqual(['R7'])
  })

  it('R6: catches a face that omits allergens', async () => {
    const report = await runFaceContract(
      referenceFace((_item, html) => html.replace(/<ul data-slot="item.allergens">.*?<\/ul>/, '')),
      manifest,
    )
    expect(rules(report)).toEqual(['R6'])
  })

  it('R6: catches allergens that are drawn but cannot be read', async () => {
    const report = await runFaceContract(
      referenceFace((item, html) =>
        item.allergens.length === 0
          ? html
          : html.replace(
              /<ul data-slot="item.allergens">.*?<\/ul>/,
              '<ul data-slot="item.allergens"><li>*</li></ul>',
            ),
      ),
      manifest,
    )
    expect(rules(report)).toEqual(['R6'])
  })

  it('R9: catches a face that truncates a name', async () => {
    const report = await runFaceContract(
      referenceFace((item, html) =>
        html.replace(esc(item.name.text), `${esc(item.name.text.slice(0, 20))}…`),
      ),
      manifest,
    )
    expect(rules(report)).toContain('R9')
  })

  it('R2: catches a face that reorders items', async () => {
    const reversed: RenderFn = (view) => {
      const parts = (referenceFace()(view) as string).split('<article')
      return [
        parts[0],
        ...parts
          .slice(1)
          .reverse()
          .map((part) => `<article${part}`),
      ].join('')
    }
    const report = await runFaceContract(reversed, manifest, {
      fixtures: fixtures().filter((f) => f.name === 'long-names'),
    })
    expect(rules(report)).toEqual(['R2'])
  })

  it('R8: catches a placeholder in an empty optional slot', async () => {
    const report = await runFaceContract(
      referenceFace((item, html) =>
        item.description === null
          ? html.replace(
              '</article>',
              '<p data-slot="item.description">No description</p></article>',
            )
          : html,
      ),
      manifest,
    )
    expect(rules(report)).toEqual(['R8'])
  })

  it('R8: catches a declared optional slot with content that is not drawn', async () => {
    const report = await runFaceContract(
      referenceFace((_item, html) =>
        html.replace(/<p data-slot="item.description"[^>]*>.*?<\/p>/, ''),
      ),
      manifest,
    )
    expect(rules(report)).toEqual(['R8'])
  })

  it('R3: catches a fallback text without its real lang', async () => {
    const report = await runFaceContract(
      referenceFace((_item, html) => html.replace(/ lang="[^"]*"/g, '')),
      manifest,
      { fixtures: fixtures().filter((f) => f.name === 'six-languages') },
    )
    expect(rules(report)).toEqual(['R3'])
  })

  it('R5: catches a face that does not show the state', async () => {
    const report = await runFaceContract(
      referenceFace((_item, html) => html.replace(/ data-state="[^"]*"/, '')),
      manifest,
      { fixtures: fixtures().filter((f) => f.name === 'sold-out') },
    )
    expect(rules(report)).toEqual(['R5'])
  })

  it('rule 3: catches an id that is not ours to show', async () => {
    const leak = (_item: ViewItem, html: string) =>
      html.replace('</article>', `<i data-barsy="${fixtureId('sn', 1)}"></i></article>`)
    const report = await runFaceContract(referenceFace(leak), manifest, {
      fixtures: fixtures().filter((f) => f.name === 'no-images'),
    })
    expect(rules(report)).toEqual(['rule 3'])
  })

  it('R6: a numbered-legend face must draw the legend; an info face must draw the info slot', async () => {
    const legend: FaceManifest = { ...manifest, allergen_mode: 'numbered_legend' }
    const report = await runFaceContract(
      (view) => referenceFace((_i, html) => html)(view),
      legend,
      { fixtures: fixtures().filter((f) => f.name === 'long-names') },
    )
    expect(rules(report)).toEqual(['R6'])
    const info: FaceManifest = { ...manifest, allergen_mode: 'info_qr' }
    const infoReport = await runFaceContract(
      (view) =>
        (referenceFace()(view) as string).replace(
          '<body>',
          '<body><div data-slot="menu.allergen_info"></div>',
        ),
      info,
      { fixtures: fixtures().filter((f) => f.name === 'long-names') },
    )
    expect(infoReport.failures).toEqual([])
  })

  it('renders every channel the manifest declares', async () => {
    const both: FaceManifest = { ...manifest, channels: ['qr', 'kiosk'] }
    const report = await runFaceContract(referenceFace(), both, {
      fixtures: fixtures().filter((f) => f.name === 'long-names'),
    })
    expect(report.renders).toBe(2)
  })
})

/** A manifest that has controls for every guest feature. */
const featureManifest: FaceManifest = (() => {
  const result = validateManifest({
    ...manifest,
    ordering: true,
    features: ['filters', 'call_waiter', 'bill', 'ordering', 'pay'],
  })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.manifest
})()

/** The slot of each feature, by name. */
const SLOT_OF = Object.fromEntries(FEATURE_SLOTS.map(({ slot, feature }) => [feature, slot]))

/** Whether the view model has the feature on. */
function isOn(view: ViewModel, feature: string): boolean {
  if (feature === 'filters') return view.features.filters
  if (feature === 'call_waiter') return view.features.callWaiter !== null
  if (feature === 'bill') return view.features.bill
  if (feature === 'ordering') return view.features.ordering
  return view.features.pay
}

/** The reference face with a control (an element carrying the feature's slot) added per `draw`. */
function featureFace(draw: (view: ViewModel) => string[]): RenderFn {
  const base = referenceFace()
  return async (view) => {
    const controls = draw(view)
      .map((slot) => `<button data-slot="${slot}"></button>`)
      .join('')
    return (await base(view)).replace('<body>', `<body>${controls}`)
  }
}

/** A face that draws exactly the controls the view model turns on. */
const rightFeatures = featureFace((view) =>
  FEATURE_SLOTS.filter(({ feature }) => isOn(view, feature)).map(({ slot }) => slot),
)

describe('runFaceContract: R15 feature slots (fail-closed)', () => {
  it('knows the five menu-level slots of the brief', () => {
    expect(FEATURE_SLOTS.map(({ slot }) => slot)).toEqual([
      'menu.filters',
      'menu.call_waiter',
      'menu.bill',
      'menu.bag',
      'menu.pay',
    ])
    expect(SLOT_OF.ordering).toBe('menu.bag')
  })

  it('passes a face that draws a control exactly when its feature is on', async () => {
    const report = await runFaceContract(rightFeatures, featureManifest)
    expect(report.failures).toEqual([])
    expect(report.renders).toBe(fixtures().length)
  })

  it('passes a face that draws no control at all when the manifest declares no feature', async () => {
    const report = await runFaceContract(referenceFace(), manifest)
    expect(report.failures).toEqual([])
  })

  it('catches a face that draws menu.bill while the bill feature is off', async () => {
    const report = await runFaceContract(
      featureFace((view) => [
        ...FEATURE_SLOTS.filter(({ feature }) => isOn(view, feature)).map(({ slot }) => slot),
        'menu.bill',
      ]),
      featureManifest,
    )
    expect(rules(report)).toEqual(['R15'])
    expect(report.failures.every((failure) => failure.message.includes('menu.bill'))).toBe(true)
    // It is wrong on every fixture where the bill is off, and right on the one where it is on.
    expect([...new Set(report.failures.map((failure) => failure.fixture))].sort()).toEqual(
      fixtures()
        .map((f) => f.name)
        .filter((name) => name !== 'features-on')
        .sort(),
    )
  })

  it('catches it whether or not the manifest declares the feature', async () => {
    const draws = featureFace(() => ['menu.pay'])
    for (const m of [manifest, featureManifest]) {
      const report = await runFaceContract(draws, m, {
        fixtures: fixtures().filter((f) => f.name === 'no-images'),
      })
      expect(rules(report), String(m.features)).toEqual(['R15'])
    }
  })

  it.each(FEATURE_SLOTS)('catches $slot drawn while $feature is off', async ({ slot, feature }) => {
    const report = await runFaceContract(
      featureFace((view) => [
        ...FEATURE_SLOTS.filter((entry) => isOn(view, entry.feature)).map((entry) => entry.slot),
        slot,
      ]),
      featureManifest,
      { fixtures: fixtures().filter((f) => f.name === 'features-off') },
    )
    expect(rules(report)).toEqual(['R15'])
    expect(report.failures.map((failure) => failure.message).join('\n')).toContain(
      `${slot} is drawn while the ${feature} feature is off`,
    )
  })

  it('catches a face that ignores the venue’s switch (features-off is the fixture for that)', async () => {
    // Draws the filter control whenever the menu has chips, as the face did before R15.
    const ignoresSwitch = featureFace((view) => {
      const chips = view.filters.tags.length + view.filters.dietary.length > 0
      return chips ? ['menu.filters'] : []
    })
    const report = await runFaceContract(ignoresSwitch, manifest)
    expect(rules(report)).toEqual(['R15'])
    expect([...new Set(report.failures.map((failure) => failure.fixture))]).toEqual([
      'features-off',
    ])
  })

  it('catches a declared feature that is on but whose control is not drawn', async () => {
    const report = await runFaceContract(
      featureFace((view) =>
        FEATURE_SLOTS.filter(({ feature }) => isOn(view, feature) && feature !== 'call_waiter').map(
          ({ slot }) => slot,
        ),
      ),
      featureManifest,
    )
    expect(rules(report)).toEqual(['R15'])
    expect([...new Set(report.failures.map((failure) => failure.fixture))]).toEqual(['features-on'])
    expect(report.failures[0]?.message).toContain('menu.call_waiter')
  })

  it('does not ask for the control of a feature the manifest does not declare', async () => {
    const filtersOnly: FaceManifest = { ...manifest, features: ['filters'] }
    const report = await runFaceContract(
      featureFace((view) => (view.features.filters ? ['menu.filters'] : [])),
      filtersOnly,
    )
    expect(report.failures).toEqual([])
  })

  it('looks at the whole page, not only at the items', async () => {
    const report = await runFaceContract(
      (view) =>
        (referenceFace()(view) as string).replace(
          '</body>',
          '<footer><nav><a data-slot="menu.pay">Pay</a></nav></footer></body>',
        ),
      manifest,
      { fixtures: fixtures().filter((f) => f.name === 'features-off') },
    )
    expect(rules(report)).toEqual(['R15'])
  })
})

describe('runFaceContract: the layout switch (D92, fail-closed)', () => {
  /** The reference face with the layout switch drawn when `draw` says so. */
  const switchFace = (draw: (view: ViewModel) => boolean): RenderFn => {
    const base = referenceFace()
    return async (view) => {
      const html = await base(view)
      return draw(view)
        ? html.replace(
            '<body>',
            `<body><div role="radiogroup" data-slot="${LAYOUT_SWITCH_SLOT}"></div>`,
          )
        : html
    }
  }

  it('passes a face that draws the switch exactly where the menu lets guests switch', async () => {
    const report = await runFaceContract(
      switchFace((view) => view.layout.guestSwitch),
      manifest,
    )
    expect(report.failures).toEqual([])
  })

  it('catches a face that draws the switch where the menu does not let guests switch', async () => {
    const report = await runFaceContract(
      switchFace(() => true),
      manifest,
    )
    expect(rules(report)).toEqual(['D92'])
    // Only where the menu says no: one-column (the others let guests switch, explicitly or as the
    // look from before D92).
    expect([...new Set(report.failures.map((failure) => failure.fixture))]).toEqual(['one-column'])
  })

  it('a non-interactive channel never gets the switch', async () => {
    const f = fixture('horizontal-sections')
    const view = buildViewModel(f.snapshot, f.overlay, { ...f.context, channel: 'print' })
    expect(view.layout).toEqual({ default: 'two', guestSwitch: false })
  })
})

// The suite every face's test calls, run on the harness's own reference face.
faceContractSuite('the harness reference face', {
  manifest: featureManifest,
  render: rightFeatures,
  css: '.ref { color: var(--ref-text, CanvasText); background: color-mix(in srgb, var(--ref-bg) 80%, transparent); }',
})
