import { MenuSnapshotSchema } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { type FaceManifest, validateManifest } from '../src/manifest'
import type { ViewItem, ViewModel, ViewSection } from '../src/view-model'
import { type RenderFn, runFaceContract } from './contract'
import { fixtureId, fixtures } from './fixtures'
import { type HtmlElement, parseHtml, textOf, withAttribute } from './html'

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
