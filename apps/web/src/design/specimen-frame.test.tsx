// @vitest-environment jsdom
// What a tile's frame draws for an option (D159): the specimen the panel cuts from the draft, through
// the preview's own view model, drawn by the face's specimen view as the part alone. Run on the
// app's path (`specimenOf`, `previewSnapshot`, `SpecimenFrame`), so a part the app cannot feed fails
// here and not only in the face's own tests. Each option must draw a part of ITS OWN page: a marker
// the contract gives that page, so an option mapped to another page's part fails.
import { DEFAULT_DESIGN, DESIGN_PAGES, type DesignPage } from '@restro/core'
import { specimenNeedsServices } from '@restro/editorial-market/preview'
import { fixture } from '@restro/shell/testing'
import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { pageOfMarker, specimenPartOf } from './advanced-model'
import { SpecimenFrame } from './design-frame'
import type { FrameContent } from './preview-frames'
import { previewSnapshot } from './preview-snapshot'
import { DEMO_ASSET_BASE, LOGO_OPTIONS, specimenOf } from './specimen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function contentOf(pageId: string, optionId: string): FrameContent {
  const part = specimenPartOf(pageId, optionId)
  if (part === null) throw new Error(`${pageId}.${optionId} has no part`)
  const services = specimenNeedsServices(part)
  const { snapshot } = fixture('big-menu')
  return {
    snapshot: previewSnapshot(
      specimenOf(snapshot, {
        services,
        strip: pageId === 'sections' && optionId === 'strip_card_size',
        part,
        logo: LOGO_OPTIONS.has(`${pageId}.${optionId}`),
      }),
      {} as never,
      DEFAULT_DESIGN.values,
    ),
    overlay: { version: 1, items: {} },
    scheme: 'light',
    services,
    assetBase: DEMO_ASSET_BASE,
    specimen: part,
  }
}

function draw(pageId: string, optionId: string) {
  const content = contentOf(pageId, optionId)
  const heights: number[] = []
  const { container } = renderWithIntl(
    <SpecimenFrame shared={content} onHeight={(height) => heights.push(height)} />,
  )
  const count = (marker: string) =>
    container.querySelectorAll(`[data-design-part="${marker}"]`).length
  /** The pages the drawn markers belong to, as a tap on them would open. */
  const pages = () =>
    new Set(
      [...container.querySelectorAll<HTMLElement>('[data-design-part]')].map((element) =>
        pageOfMarker(element.dataset.designPart ?? ''),
      ),
    )
  return { container, count, pages, heights, part: content.specimen }
}

describe("a tile's frame draws the option's part alone", () => {
  it('Items › Name size draws one dish and no header or section rail', () => {
    const { count } = draw('items', 'name_size')
    expect(count('item')).toBe(1)
    expect(count('header')).toBe(0)
    expect(count('nav')).toBe(0)
  })

  it('Header › Logo size draws a sample logo on a venue with none yet; the other header rows do not', () => {
    const { snapshot } = fixture('big-menu')
    expect(snapshot.theme.logo).toBeNull()
    expect(draw('header', 'logo_size').count('header.logo')).toBe(1)
    cleanup()
    expect(draw('header', 'band').count('header.logo')).toBe(0)
  })

  it('Photos › Fit and Backdrop draw an upright photo, so it is not the shape of the Landscape box', () => {
    const { snapshot } = fixture('big-menu')
    const tall = specimenOf(snapshot, {
      services: false,
      strip: false,
      part: 'dish-row',
      tall: true,
    })
    const image = Object.values(tall.items).find((item) => item.image !== null)?.image
    expect(image).toBe('as_DemoPhotoTall00000000A')
    const asset = tall.assets[image as string]
    expect((asset?.h ?? 0) > (asset?.w ?? 0)).toBe(true)
    expect(LOGO_OPTIONS.has('photos.fit')).toBe(false)
  })

  it('a venue logo is drawn as the sample logo, never as the demo dish photo', () => {
    const { snapshot } = fixture('big-menu')
    const withLogo = { ...snapshot, theme: { ...snapshot.theme, logo: 'as_VenueLogo00000000000A' } }
    const drawn = specimenOf(withLogo as typeof snapshot, { services: false, strip: false })
    expect(drawn.theme.logo).toBe('as_DemoLogo0000000000000A')
    expect(drawn.assets[drawn.theme.logo as string]?.variants.card).toMatch(/DemoLogo/)
  })

  it('Header › Band draws the header with its Bill pill, and no dish', () => {
    const { container, count } = draw('header', 'band')
    expect(count('header')).toBe(1)
    expect(count('item')).toBe(0)
    expect(container.querySelector('[data-slot="menu.bill"]')).not.toBeNull()
  })

  /** Every option with a part, with its page; General's options style the whole page. */
  const options: [DesignPage, string][] = DESIGN_PAGES.flatMap((page) =>
    page.options
      .filter((option) => specimenPartOf(page.id, option.id) !== null)
      .map((option): [DesignPage, string] => [page, option.id]),
  )
  for (const [page, optionId] of options) {
    it(`${page.id} › ${optionId} draws its own part`, async () => {
      const { container, pages, part } = draw(page.id, optionId)
      expect(container.querySelector(`[data-specimen="${part}"]`)).not.toBeNull()
      // Something of the guest page is drawn inside the part: not only a sheet's empty panel.
      await waitFor(() =>
        expect(
          container.querySelector(
            '[data-design-part]:not([data-specimen-panel]):not([data-design-part="sheet"])',
          ),
        ).not.toBeNull(),
      )
      // A part of the option's own page: the page a tap on it would open.
      if (page.id !== 'general') {
        await waitFor(() => expect([...pages()], `${page.id} › ${optionId}`).toContain(page.id))
      }
    })
  }
})

describe('a part that cannot be drawn', () => {
  it('draws nothing, tells the tile 0, and tries again with the next content', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const good = contentOf('items', 'name_size')
    const broken = { ...good, snapshot: {} as never }
    const heights: number[] = []
    const onHeight = (height: number) => heights.push(height)
    const view = renderWithIntl(<SpecimenFrame shared={broken} onHeight={onHeight} />)
    expect(view.container.querySelector('[data-specimen]')).toBeNull()
    expect(heights).toContain(0)
    view.rerender(<SpecimenFrame shared={good} onHeight={onHeight} />)
    expect(view.container.querySelector('[data-specimen="dish-row"]')).not.toBeNull()
  })
})
